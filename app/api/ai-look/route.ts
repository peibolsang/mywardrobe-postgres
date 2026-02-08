import "server-only";

import { readFile } from "fs/promises";
import path from "path";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import { NextResponse } from "next/server";
import { isOwnerSession } from "@/lib/owner";
import { getWardrobeData } from "@/lib/wardrobe";
import type { Garment } from "@/lib/types";
import schema from "@/public/schema.json";

const requestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
});

const intentSchema = z.object({
  weather: z.array(z.string()).max(4),
  occasion: z.array(z.string()).max(4),
  place: z.array(z.string()).max(4),
  timeOfDay: z.array(z.string()).max(3),
  formality: z.string().nullable(),
  style: z.array(z.string()).max(4),
  notes: z.string(),
}).strict();

const recommendationSchema = z.object({
  lookName: z.string().min(1),
  selectedGarmentIds: z.array(z.number().int()).min(3).max(8),
  rationale: z.string().min(1),
  modelConfidence: z.number().min(0).max(100),
});

type SchemaItems = {
  properties?: {
    suitable_weather?: { items?: { enum?: string[] } };
    suitable_occasions?: { items?: { enum?: string[] } };
    suitable_places?: { items?: { enum?: string[] } };
    suitable_time_of_day?: { items?: { enum?: string[] } };
    style?: { enum?: string[] };
    formality?: { enum?: string[] };
  };
};

interface CanonicalIntent {
  weather: string[];
  occasion: string[];
  place: string[];
  timeOfDay: string[];
  formality: string | null;
  style: string[];
  notes: string;
}

interface WeatherContext {
  locationLabel: string;
  summary: string;
}

type WeatherContextStatus =
  | "not_requested"
  | "location_detected"
  | "fetched"
  | "failed";

type RateLimitState = {
  count: number;
  windowStart: number;
};

const AI_LOOK_WINDOW_MS = 60 * 1000;
const AI_LOOK_MAX_REQUESTS_PER_WINDOW = 8;
const aiLookRateLimit = new Map<string, RateLimitState>();

const SCHEMA_ITEMS = (schema?.items ?? {}) as SchemaItems;

const WEATHER_OPTIONS = SCHEMA_ITEMS.properties?.suitable_weather?.items?.enum ?? [];
const OCCASION_OPTIONS = SCHEMA_ITEMS.properties?.suitable_occasions?.items?.enum ?? [];
const PLACE_OPTIONS = SCHEMA_ITEMS.properties?.suitable_places?.items?.enum ?? [];
const TIME_OPTIONS = SCHEMA_ITEMS.properties?.suitable_time_of_day?.items?.enum ?? [];
const STYLE_OPTIONS = SCHEMA_ITEMS.properties?.style?.enum ?? [];
const FORMALITY_OPTIONS = SCHEMA_ITEMS.properties?.formality?.enum ?? [];

const INTERPRETER_APPENDIX = `
You are the intent interpreter for a wardrobe stylist.
Map natural language to canonical wardrobe filters.

Rules:
- Use only canonical values from the provided option lists.
- If the user mentions a city/region/country/place, call the tool getWeatherByLocation.
- Infer nearest canonical match for free text (examples):
  - "comfy", "cozy", "relaxed" -> casual social / low-key / informal leaning.
  - "edgy" -> darker, contrasty styling; often evening/night leaning.
  - concrete real-world places (cities, homes, cafes) -> best matching canonical place.
- If intent is ambiguous, keep arrays short and add a concise note in "notes".
- Do not invent categories.
`;

const RECOMMENDER_APPENDIX = `
Output requirements:
- Return exactly one look.
- Use only garment IDs from the provided wardrobe JSON.
- selectedGarmentIds must be ordered from top to bottom.
- Prefer complete silhouette: top, bottom, footwear, optional outer layer.
- Keep rationale crisp and grounded in canonical intent + garment materials/features.
- Do not include garment IDs in the rationale text.
`;

const WEATHER_TOOL_INPUT_SCHEMA = z.object({
  locationQuery: z.string().min(1).describe("Location query string, e.g. 'Aviles, Asturias, Spain'."),
  dayReference: z.enum(["today", "tomorrow", "unspecified"]).describe("Day reference inferred from user request."),
}).strict();

const normalize = (value: unknown): string => String(value ?? "").trim();

const sanitizeRationale = (raw: string): string =>
  raw
    .replace(/\(\s*database\s*id\s*:\s*\d+\s*\)/gi, "")
    .replace(/\b(database\s*id|id)\s*[:#]?\s*\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const inferDayReferenceFromPrompt = (prompt: string): "today" | "tomorrow" | "unspecified" => {
  const lower = prompt.toLowerCase();
  if (/\btomorrow\b/.test(lower)) return "tomorrow";
  if (/\btoday\b|\btonight\b|\bnow\b/.test(lower)) return "today";
  return "unspecified";
};

const extractLocationHintFromPrompt = (prompt: string): string | null => {
  const text = prompt.trim();
  if (!text) return null;

  const inMatch = text.match(/\bin\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]*(?:,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]*){0,2})/i);
  if (inMatch?.[1]) return inMatch[1].trim();

  const commaMatch = text.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]+,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]+)/);
  if (commaMatch?.[1]) return commaMatch[1].trim();

  return null;
};

const weatherCodeToText = (code: number | null | undefined): string => {
  if (code == null) return "unknown conditions";
  if (code === 0) return "clear";
  if ([1, 2, 3].includes(code)) return "partly cloudy";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "rain";
  if ([71, 73, 75, 77].includes(code)) return "snow";
  if ([80, 81, 82].includes(code)) return "rain showers";
  if ([85, 86].includes(code)) return "snow showers";
  if ([95, 96, 99].includes(code)) return "thunderstorm";
  return "variable conditions";
};

async function fetchWeatherContext(locationQuery: string, dayReference: "today" | "tomorrow" | "unspecified"): Promise<WeatherContext | null> {
  const query = normalize(locationQuery);
  if (!query) return null;

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  const currentUrl = new URL("https://api.openweathermap.org/data/2.5/weather");
  currentUrl.searchParams.set("q", query);
  currentUrl.searchParams.set("units", "metric");
  currentUrl.searchParams.set("appid", apiKey);

  const currentResponse = await fetch(currentUrl.toString(), { cache: "no-store" });
  if (!currentResponse.ok) return null;

  const currentJson = await currentResponse.json() as {
    name?: string;
    sys?: { country?: string };
    dt?: number;
    weather?: Array<{ description?: string }>;
    main?: { temp?: number; feels_like?: number; temp_min?: number; temp_max?: number; humidity?: number };
    wind?: { speed?: number };
  };

  let dayDescription = normalize(currentJson.weather?.[0]?.description);
  let dayTempMin = currentJson.main?.temp_min;
  let dayTempMax = currentJson.main?.temp_max;
  let dayHumidity: number | undefined = currentJson.main?.humidity;
  let dayWindMs: number | undefined = currentJson.wind?.speed;

  if (dayReference === "tomorrow") {
    const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
    forecastUrl.searchParams.set("q", query);
    forecastUrl.searchParams.set("units", "metric");
    forecastUrl.searchParams.set("appid", apiKey);

    const forecastResponse = await fetch(forecastUrl.toString(), { cache: "no-store" });
    if (forecastResponse.ok) {
      const forecastJson = await forecastResponse.json() as {
        list?: Array<{
          dt?: number;
          weather?: Array<{ description?: string }>;
          main?: { temp_min?: number; temp_max?: number; humidity?: number };
          wind?: { speed?: number };
        }>;
      };

      const now = new Date();
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const tomorrowKey = tomorrow.toISOString().slice(0, 10);
      const tomorrowEntries = (forecastJson.list ?? []).filter((entry) => {
        if (!entry.dt) return false;
        const key = new Date(entry.dt * 1000).toISOString().slice(0, 10);
        return key === tomorrowKey;
      });

      if (tomorrowEntries.length > 0) {
        const descriptions = tomorrowEntries
          .map((entry) => normalize(entry.weather?.[0]?.description))
          .filter(Boolean);
        dayDescription = descriptions[0] || dayDescription;

        const mins = tomorrowEntries.map((entry) => entry.main?.temp_min).filter((v): v is number => typeof v === "number");
        const maxs = tomorrowEntries.map((entry) => entry.main?.temp_max).filter((v): v is number => typeof v === "number");
        const humidities = tomorrowEntries.map((entry) => entry.main?.humidity).filter((v): v is number => typeof v === "number");
        const winds = tomorrowEntries.map((entry) => entry.wind?.speed).filter((v): v is number => typeof v === "number");

        if (mins.length > 0) dayTempMin = Math.min(...mins);
        if (maxs.length > 0) dayTempMax = Math.max(...maxs);
        if (humidities.length > 0) dayHumidity = Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length);
        if (winds.length > 0) dayWindMs = Math.round((winds.reduce((a, b) => a + b, 0) / winds.length) * 10) / 10;
      }
    }
  }

  const locationLabel = [normalize(currentJson.name), normalize(currentJson.sys?.country)].filter(Boolean).join(", ") || query;
  const currentTemp = currentJson.main?.temp;
  const currentFeelsLike = currentJson.main?.feels_like;
  const windKmh = typeof dayWindMs === "number" ? dayWindMs * 3.6 : null;

  const summary = [
    `Weather context for ${locationLabel}:`,
    `${dayReference === "tomorrow" ? "Tomorrow" : "Today"} looks ${dayDescription || "variable"}.`,
    typeof dayTempMin === "number" && typeof dayTempMax === "number" ? `Expected range ${Math.round(dayTempMin)}-${Math.round(dayTempMax)}°C.` : "",
    typeof currentTemp === "number" ? `Current temperature ${Math.round(currentTemp)}°C.` : "",
    typeof currentFeelsLike === "number" ? `Feels like ${Math.round(currentFeelsLike)}°C.` : "",
    typeof dayHumidity === "number" ? `Humidity ${Math.round(dayHumidity)}%.` : "",
    typeof windKmh === "number" ? `Wind ${Math.round(windKmh)} km/h.` : "",
  ].filter(Boolean).join(" ");

  return { locationLabel, summary };
}

const toCanonicalValues = (values: string[] | undefined, allowed: string[]): string[] => {
  if (!values || allowed.length === 0) return [];
  const allowedByLower = new Map(allowed.map((value) => [value.toLowerCase(), value]));
  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const value of values) {
    const key = normalize(value).toLowerCase();
    if (!key || seen.has(key)) continue;
    const canonical = allowedByLower.get(key);
    if (!canonical) continue;
    seen.add(key);
    resolved.push(canonical);
  }

  return resolved;
};

const toCanonicalSingle = (value: string | null | undefined, allowed: string[]): string | null => {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return null;
  return allowed.find((candidate) => candidate.toLowerCase() === normalized) ?? null;
};

const categorizeType = (type: string): "top" | "bottom" | "footwear" | "other" => {
  const normalized = type.toLowerCase();
  if (/(sneaker|loafer|boot|shoe|oxford|derby|moccasin|sandals?)/.test(normalized)) return "footwear";
  if (/(jeans?|pants?|trousers?|shorts?|chinos?|cargo)/.test(normalized)) return "bottom";
  if (/(shirt|t-shirt|tee|polo|sweater|sweatshirt|hoodie|knit|blazer|jacket|coat|overshirt|cardigan)/.test(normalized))
    return "top";
  return "other";
};

const intersectionMatches = (garmentValues: string[], selected: string[], options?: { allDayAlias?: string; allSeasonAlias?: string }) => {
  if (selected.length === 0) return null;
  const garmentSet = new Set(garmentValues.map((value) => value.toLowerCase()));
  for (const target of selected) {
    const candidate = target.toLowerCase();
    if (garmentSet.has(candidate)) return true;
    if (options?.allDayAlias && garmentSet.has(options.allDayAlias)) return true;
    if (options?.allSeasonAlias && garmentSet.has(options.allSeasonAlias)) return true;
  }
  return false;
};

const computeObjectiveMatchScore = (lineup: Garment[], intent: CanonicalIntent): number => {
  if (lineup.length === 0) return 0;

  const dimensionScores: number[] = [];
  const ratioScore = (matches: boolean[]) =>
    (matches.filter(Boolean).length / lineup.length) * 100;

  const weatherMatches = lineup.map((garment) =>
    Boolean(intersectionMatches(garment.suitable_weather, intent.weather, { allSeasonAlias: "all season" }))
  );
  if (intent.weather.length > 0) dimensionScores.push(ratioScore(weatherMatches));

  const occasionMatches = lineup.map((garment) =>
    Boolean(intersectionMatches(garment.suitable_occasions, intent.occasion))
  );
  if (intent.occasion.length > 0) dimensionScores.push(ratioScore(occasionMatches));

  const placeMatches = lineup.map((garment) =>
    Boolean(intersectionMatches(garment.suitable_places, intent.place))
  );
  if (intent.place.length > 0) dimensionScores.push(ratioScore(placeMatches));

  const timeMatches = lineup.map((garment) =>
    Boolean(intersectionMatches(garment.suitable_time_of_day, intent.timeOfDay, { allDayAlias: "all day" }))
  );
  if (intent.timeOfDay.length > 0) dimensionScores.push(ratioScore(timeMatches));

  if (intent.formality) {
    const formalityMatches = lineup.map((garment) => garment.formality?.toLowerCase() === intent.formality!.toLowerCase());
    dimensionScores.push(ratioScore(formalityMatches));
  }

  if (intent.style.length > 0) {
    const styleMatches = lineup.map((garment) => intent.style.some((style) => style.toLowerCase() === garment.style?.toLowerCase()));
    dimensionScores.push(ratioScore(styleMatches));
  }

  const categories = new Set(lineup.map((garment) => categorizeType(garment.type)));
  const completenessScore =
    (categories.has("top") ? 40 : 0) +
    (categories.has("bottom") ? 35 : 0) +
    (categories.has("footwear") ? 25 : 0);

  const active = [...dimensionScores, completenessScore];
  const average = active.reduce((sum, value) => sum + value, 0) / active.length;
  return Math.round(average);
};

const getClientIp = (request: Request): string =>
  normalize(
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
      request.headers.get("x-real-ip") ||
      "unknown"
  );

const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const existing = aiLookRateLimit.get(key);

  if (!existing) {
    aiLookRateLimit.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (now - existing.windowStart > AI_LOOK_WINDOW_MS) {
    aiLookRateLimit.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (existing.count >= AI_LOOK_MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  aiLookRateLimit.set(key, {
    count: existing.count + 1,
    windowStart: existing.windowStart,
  });
  return false;
};

const isAllowedOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;

  // Non-browser/server-to-server requests may omit Origin.
  if (!origin) return true;
  return origin === requestOrigin;
};

export async function POST(request: Request) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }

    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsedBody = requestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Invalid prompt payload." }, { status: 400 });
    }

    const rateLimitKey = `owner:${getClientIp(request)}`;
    if (isRateLimited(rateLimitKey)) {
      return NextResponse.json(
        { error: "Too many AI look requests. Please wait and try again." },
        { status: 429 }
      );
    }

    const userPrompt = parsedBody.data.prompt;
    const wardrobeData = await getWardrobeData({ forceFresh: true });

    if (wardrobeData.length === 0) {
      return NextResponse.json({ error: "Wardrobe is empty. Add garments first." }, { status: 400 });
    }

    const systemPrompt = await readFile(
      path.join(process.cwd(), "app", "api", "ai-look", "prompt.md"),
      "utf-8"
    );
    const compactWardrobe = wardrobeData.map((garment) => ({
      id: garment.id,
      file_name: garment.file_name,
      model: garment.model,
      brand: garment.brand,
      type: garment.type,
      style: garment.style,
      formality: garment.formality,
      material_composition: garment.material_composition,
      suitable_weather: garment.suitable_weather,
      suitable_time_of_day: garment.suitable_time_of_day,
      suitable_places: garment.suitable_places,
      suitable_occasions: garment.suitable_occasions,
      features: garment.features,
      favorite: Boolean(garment.favorite),
    }));

    const canonicalOptions = {
      weather: WEATHER_OPTIONS,
      occasion: OCCASION_OPTIONS,
      place: PLACE_OPTIONS,
      timeOfDay: TIME_OPTIONS,
      style: STYLE_OPTIONS,
      formality: FORMALITY_OPTIONS,
    };

    const { output: interpreted, toolResults } = await generateText({
      model: openai("gpt-4.1-mini"),
      output: Output.object({
        schema: intentSchema,
      }),
      tools: {
        getWeatherByLocation: tool({
          description: "Fetch weather summary for a location. Use when user mentions a city, region, country, or place.",
          inputSchema: WEATHER_TOOL_INPUT_SCHEMA,
          execute: async ({ locationQuery, dayReference }) => {
            const weather = await fetchWeatherContext(locationQuery, dayReference);
            return {
              found: Boolean(weather),
              locationLabel: weather?.locationLabel ?? "",
              summary: weather?.summary ?? "",
            };
          },
        }),
      },
      stopWhen: stepCountIs(6),
      temperature: 0,
      system: INTERPRETER_APPENDIX,
      prompt: `Canonical options:\n${JSON.stringify(canonicalOptions)}\n\nUser request:\n${userPrompt}`,
    });

    const latestWeatherToolResult = [...toolResults]
      .reverse()
      .find((result) => result.type === "tool-result" && result.toolName === "getWeatherByLocation");
    const weatherOutput =
      latestWeatherToolResult && typeof latestWeatherToolResult.output === "object" && latestWeatherToolResult.output
        ? latestWeatherToolResult.output as { summary?: string }
        : null;
    let weatherContextSummary = normalize(weatherOutput?.summary);
    let weatherStatus: WeatherContextStatus = "not_requested";

    // Fallback: if first pass skipped tool call, force one when a location hint exists.
    const locationHint = extractLocationHintFromPrompt(userPrompt);
    if (locationHint) {
      weatherStatus = "location_detected";
    }

    if (!weatherContextSummary) {
      if (locationHint) {
        const dayReference = inferDayReferenceFromPrompt(userPrompt);
        const fallbackWeather = await generateText({
          model: openai("gpt-4.1-mini"),
          tools: {
            getWeatherByLocation: tool({
              description: "Fetch weather summary for a location.",
              inputSchema: WEATHER_TOOL_INPUT_SCHEMA,
              execute: async ({ locationQuery, dayReference }) => {
                const weather = await fetchWeatherContext(locationQuery, dayReference);
                return {
                  found: Boolean(weather),
                  locationLabel: weather?.locationLabel ?? "",
                  summary: weather?.summary ?? "",
                };
              },
            }),
          },
          toolChoice: { type: "tool", toolName: "getWeatherByLocation" },
          stopWhen: stepCountIs(2),
          prompt: `Get weather for location "${locationHint}" with dayReference "${dayReference}".`,
        });

        const fallbackToolResult = [...fallbackWeather.toolResults]
          .reverse()
          .find((result) => result.type === "tool-result" && result.toolName === "getWeatherByLocation");
        const fallbackOutput =
          fallbackToolResult && typeof fallbackToolResult.output === "object" && fallbackToolResult.output
            ? fallbackToolResult.output as { summary?: string }
            : null;
        weatherContextSummary = normalize(fallbackOutput?.summary);
      }
    }

    // Final fallback: deterministic server-side fetch if tool path returned no weather.
    if (!weatherContextSummary && locationHint) {
      try {
        const directWeather = await fetchWeatherContext(locationHint, inferDayReferenceFromPrompt(userPrompt));
        weatherContextSummary = normalize(directWeather?.summary);
      } catch (error) {
        console.warn("Direct weather fallback failed:", error);
      }
    }

    if (weatherContextSummary) {
      weatherStatus = "fetched";
    } else if (locationHint) {
      weatherStatus = "failed";
    }

    const canonicalIntent: CanonicalIntent = {
      weather: toCanonicalValues(interpreted.weather, WEATHER_OPTIONS),
      occasion: toCanonicalValues(interpreted.occasion, OCCASION_OPTIONS),
      place: toCanonicalValues(interpreted.place, PLACE_OPTIONS),
      timeOfDay: toCanonicalValues(interpreted.timeOfDay, TIME_OPTIONS),
      formality: toCanonicalSingle(interpreted.formality ?? null, FORMALITY_OPTIONS),
      style: toCanonicalValues(interpreted.style, STYLE_OPTIONS),
      notes: normalize(interpreted.notes),
    };

    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: recommendationSchema,
      temperature: 0.2,
      system: `${systemPrompt}\n\n${RECOMMENDER_APPENDIX}`,
      prompt: `User request:\n${userPrompt}\n\nCanonical interpreted intent:\n${JSON.stringify(canonicalIntent)}\n\n${weatherContextSummary || "No external weather context available."}\n\nWardrobe JSON:\n${JSON.stringify(compactWardrobe)}`,
    });

    const garmentById = new Map(wardrobeData.map((garment) => [garment.id, garment]));
    const uniqueValidIds = Array.from(
      new Set(
        object.selectedGarmentIds.filter((id) => garmentById.has(id))
      )
    );

    if (uniqueValidIds.length === 0) {
      return NextResponse.json(
        { error: "AI could not infer a valid look from current wardrobe data. Please refine your prompt." },
        { status: 422 }
      );
    }

    const lineupGarments = uniqueValidIds.map((id) => garmentById.get(id)!).filter(Boolean);
    const lineup = lineupGarments.map((garment) => {
      return {
        id: garment.id,
        model: garment.model,
        brand: garment.brand,
        type: garment.type,
        file_name: garment.file_name,
      };
    });

    const matchScore = computeObjectiveMatchScore(lineupGarments, canonicalIntent);
    const modelConfidence = Math.round(object.modelConfidence);
    const confidence = Math.max(
      20,
      Math.min(100, Math.round((modelConfidence * 0.3) + (matchScore * 0.7)))
    );

    return NextResponse.json({
      lookName: object.lookName,
      lineup,
      rationale: sanitizeRationale(object.rationale),
      confidence,
      modelConfidence,
      matchScore,
      interpretedIntent: canonicalIntent,
      weatherContext: weatherContextSummary || null,
      weatherContextStatus: weatherStatus,
    });
  } catch (error) {
    console.error("Failed to generate AI look:", error);
    return NextResponse.json({ error: "Failed to generate look." }, { status: 500 });
  }
}
