import "server-only";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { z } from "zod";

import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { isAllowedOrigin } from "@/lib/request-origin";
import { getUserProfileByOwnerKey } from "@/lib/user-profile";
import { getWardrobeData } from "@/lib/wardrobe";

const FALLBACK_LOCATION_LABEL = "New York City, USA";
const FALLBACK_WEATHER_SUMMARY = "Mild, neutral overcast daylight conditions.";
const OPEN_WEATHER_URL_CURRENT = "https://api.openweathermap.org/data/2.5/weather";
const OPEN_WEATHER_URL_GEOCODE = "https://api.openweathermap.org/geo/1.0/direct";
const PROFILE_BODY_PHOTO_REQUIRED = "PROFILE_BODY_PHOTO_REQUIRED";

const tryOnRequestSchema = z.object({
  garmentIds: z.array(z.number().int().positive()).min(2).max(8),
}).strict();

type WeatherContext = {
  locationLabel: string;
  weatherSummary: string;
  weatherSource: "live" | "fallback";
};

type InMemoryRateState = {
  count: number;
  windowStart: number;
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const inMemoryRate = new Map<string, InMemoryRateState>();

const normalize = (value: unknown): string => String(value ?? "").trim();

const toCanonicalIds = (ids: number[]): number[] => {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const weatherCodeToLabel = (code?: number): string => {
  if (typeof code !== "number") return "variable";
  if (code >= 200 && code < 300) return "thunderstorms";
  if (code >= 300 && code < 400) return "drizzle";
  if (code >= 500 && code < 600) return "rain";
  if (code >= 600 && code < 700) return "snow";
  if (code >= 700 && code < 800) return "haze";
  if (code === 800) return "clear skies";
  if (code > 800) return "cloudy skies";
  return "variable";
};

const isRateLimited = (ownerKey: string): boolean => {
  const now = Date.now();
  const existing = inMemoryRate.get(ownerKey);
  if (!existing) {
    inMemoryRate.set(ownerKey, { count: 1, windowStart: now });
    return false;
  }

  if (now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    inMemoryRate.set(ownerKey, { count: 1, windowStart: now });
    return false;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  inMemoryRate.set(ownerKey, {
    count: existing.count + 1,
    windowStart: existing.windowStart,
  });
  return false;
};

const resolveWeatherContext = async (locationHint: string | null): Promise<WeatherContext> => {
  const apiKey = normalize(process.env.OPENWEATHER_API_KEY);
  const fallback: WeatherContext = {
    locationLabel: FALLBACK_LOCATION_LABEL,
    weatherSummary: FALLBACK_WEATHER_SUMMARY,
    weatherSource: "fallback",
  };

  if (!apiKey || !locationHint) {
    return fallback;
  }

  try {
    const geocodeUrl = new URL(OPEN_WEATHER_URL_GEOCODE);
    geocodeUrl.searchParams.set("q", locationHint);
    geocodeUrl.searchParams.set("limit", "1");
    geocodeUrl.searchParams.set("appid", apiKey);

    const geocodeResponse = await fetch(geocodeUrl.toString(), { cache: "no-store" });
    if (!geocodeResponse.ok) return fallback;
    const geocodeJson = (await geocodeResponse.json()) as Array<{
      name?: string;
      state?: string;
      country?: string;
      lat?: number;
      lon?: number;
    }>;

    const firstMatch = geocodeJson[0];
    if (!firstMatch || typeof firstMatch.lat !== "number" || typeof firstMatch.lon !== "number") {
      return fallback;
    }

    const currentUrl = new URL(OPEN_WEATHER_URL_CURRENT);
    currentUrl.searchParams.set("lat", String(firstMatch.lat));
    currentUrl.searchParams.set("lon", String(firstMatch.lon));
    currentUrl.searchParams.set("units", "metric");
    currentUrl.searchParams.set("appid", apiKey);

    const currentResponse = await fetch(currentUrl.toString(), { cache: "no-store" });
    if (!currentResponse.ok) return fallback;

    const currentJson = (await currentResponse.json()) as {
      weather?: Array<{ description?: string; id?: number }>;
      main?: { temp?: number; humidity?: number };
      wind?: { speed?: number };
    };

    const locationLabel = [firstMatch.name, firstMatch.state, firstMatch.country]
      .map((part) => normalize(part))
      .filter(Boolean)
      .join(", ");

    const primaryWeather = currentJson.weather?.[0];
    const weatherLabel = normalize(primaryWeather?.description) || weatherCodeToLabel(primaryWeather?.id);
    const tempC = typeof currentJson.main?.temp === "number" ? `${Math.round(currentJson.main.temp)}°C` : "unknown temp";
    const humidity = typeof currentJson.main?.humidity === "number" ? `${currentJson.main.humidity}% humidity` : "humidity unknown";
    const wind = typeof currentJson.wind?.speed === "number"
      ? `${Math.round(currentJson.wind.speed * 3.6)} km/h wind`
      : "calm wind";

    return {
      locationLabel: locationLabel || locationHint,
      weatherSummary: `Current weather: ${weatherLabel}, ${tempC}, ${humidity}, ${wind}.`,
      weatherSource: "live",
    };
  } catch {
    return fallback;
  }
};

const sanitizeOwnerKey = (ownerKey: string): string =>
  ownerKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "owner";

const buildTryOnPrompt = ({
  garments,
  locationLabel,
  weatherSummary,
}: {
  garments: Array<{
    model: string;
    brand: string;
    type: string;
    imageUrl: string;
    features: string;
    material: string;
    style: string;
  }>;
  locationLabel: string;
  weatherSummary: string;
}): string => {
  const garmentList = garments
    .map((garment, index) =>
      `${index + 1}. ${garment.type} - ${garment.model} by ${garment.brand}; image url: ${garment.imageUrl || "unavailable"}; material: ${garment.material}; style tags: ${garment.style}; features: ${garment.features}`
    )
    .join("\n");

  return [
    "Create one photorealistic full-body image of the exact same person from the provided reference body photo.",
    "Identity preservation is mandatory: keep face, body shape, skin tone, and age characteristics consistent with the reference photo.",
    "Keep all listed garments visible and faithfully represented.",
    "FRAMING REQUIREMENT (MANDATORY): Head-to-toe full-body shot, with the entire head and both shoes fully visible.",
    "Leave small empty margins above the head and below the shoes so no body parts are cropped.",
    "Camera should be far enough to capture the complete silhouette in a natural standing pose.",
    `Scene location: ${locationLabel}.`,
    `Weather context: ${weatherSummary}`,
    "The man should be naturally integrated into that city and weather conditions.",
    "Natural posture, realistic proportions, no text overlays, no logos added, no collage.",
    "STYLING RULE (MANDATORY): Every shirt and t-shirt must be tucked into the pants.",
    "STYLING RULE (MANDATORY): Whenever loafers are worn, include socks (no barefoot loafers).",
    "Outfit garments:",
    garmentList,
  ].join("\n\n");
};

const generateImageBytesWithReference = async ({
  prompt,
  bodyPhotoUrl,
}: {
  prompt: string;
  bodyPhotoUrl: string;
}): Promise<Buffer> => {
  const apiKey = normalize(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const referenceResponse = await fetch(bodyPhotoUrl, { cache: "no-store" });
  if (!referenceResponse.ok) {
    throw new Error("Failed to load profile body photo.");
  }

  const contentType = normalize(referenceResponse.headers.get("content-type")).toLowerCase();
  const normalizedContentType =
    contentType.includes("png")
      ? "image/png"
      : contentType.includes("webp")
        ? "image/webp"
        : "image/jpeg";

  const referenceBuffer = Buffer.from(await referenceResponse.arrayBuffer());
  const formData = new FormData();
  formData.append("model", "gpt-image-1.5");
  formData.append("prompt", prompt);
  formData.append("size", "1024x1536");
  formData.append("n", "1");
  formData.append(
    "image",
    new Blob([referenceBuffer], {
      type: normalizedContentType,
    }),
    `profile-body-photo.${normalizedContentType === "image/png" ? "png" : normalizedContentType === "image/webp" ? "webp" : "jpg"}`
  );

  const imageResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!imageResponse.ok) {
    const errorText = await imageResponse.text();
    throw new Error(`Image generation failed: ${errorText}`);
  }

  const imageJson = (await imageResponse.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const first = imageJson.data?.[0];
  if (!first) {
    throw new Error("Image generation returned no data.");
  }

  if (first.b64_json) {
    return Buffer.from(first.b64_json, "base64");
  }

  if (first.url) {
    const downloaded = await fetch(first.url);
    if (!downloaded.ok) {
      throw new Error("Generated image URL download failed.");
    }
    const arrayBuffer = await downloaded.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error("Image generation returned unsupported payload.");
};

export async function POST(request: Request) {
  const requestId = randomUUID();
  const responseJson = (body: Record<string, unknown>, init?: { status: number }) =>
    NextResponse.json({ requestId, ...body }, init);

  try {
    if (!isAllowedOrigin(request)) {
      return responseJson({ error: "Invalid request origin." }, { status: 403 });
    }

    if (!(await isOwnerSession())) {
      return responseJson({ error: "Forbidden" }, { status: 403 });
    }

    const ownerKey = getOwnerKey();
    if (isRateLimited(ownerKey)) {
      return responseJson({ error: "Too many requests. Please wait and try again." }, { status: 429 });
    }

    const rawBody = await request.json();
    const parsed = tryOnRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return responseJson({ error: "Invalid try-on payload." }, { status: 400 });
    }

    const garmentIds = toCanonicalIds(parsed.data.garmentIds);
    if (garmentIds.length < 2 || garmentIds.length > 8) {
      return responseJson({ error: "Selection must include 2 to 8 unique garments." }, { status: 400 });
    }

    const wardrobe = await getWardrobeData({ forceFresh: true });
    const garmentById = new Map(wardrobe.map((garment) => [garment.id, garment]));
    const selectedGarments = garmentIds
      .map((id) => garmentById.get(id))
      .filter((garment): garment is NonNullable<typeof garment> => Boolean(garment));

    if (selectedGarments.length !== garmentIds.length) {
      return responseJson({ error: "Some selected garments were not found." }, { status: 422 });
    }

    const profile = await getUserProfileByOwnerKey(ownerKey);
    if (!profile?.bodyPhotoUrl) {
      return responseJson(
        {
          error: "Please upload your full-body photo in Profile before using Try it.",
          errorCode: PROFILE_BODY_PHOTO_REQUIRED,
        },
        { status: 422 }
      );
    }

    const weatherContext = await resolveWeatherContext(profile.defaultLocation ?? null);

    const prompt = buildTryOnPrompt({
      garments: selectedGarments.map((garment) => ({
        model: garment.model,
        brand: garment.brand,
        type: garment.type,
        imageUrl: normalize(garment.file_name),
        features: normalize(garment.features),
        material: (garment.material_composition ?? [])
          .map((entry) => `${entry.material} ${entry.percentage}%`)
          .join(", "),
        style: (Array.isArray(garment.styles) && garment.styles.length > 0
          ? garment.styles
          : [garment.style]
        )
          .filter(Boolean)
          .join(", "),
      })),
      locationLabel: weatherContext.locationLabel,
      weatherSummary: weatherContext.weatherSummary,
    });

    const imageBytes = await generateImageBytesWithReference({
      prompt,
      bodyPhotoUrl: profile.bodyPhotoUrl,
    });

    const blob = await put(
      `manual-looks/${sanitizeOwnerKey(ownerKey)}/try-on-${Date.now()}.png`,
      imageBytes,
      {
        access: "public",
        addRandomSuffix: true,
        contentType: "image/png",
      }
    );

    return responseJson({
      ok: true,
      generatedImageUrl: blob.url,
      context: {
        locationLabel: weatherContext.locationLabel,
        weatherSummary: weatherContext.weatherSummary,
        weatherSource: weatherContext.weatherSource,
      },
    });
  } catch (error) {
    console.error("[manual-look][try-on][failed]", { requestId, error });
    return responseJson({ error: "Failed to generate try-on image." }, { status: 500 });
  }
}
