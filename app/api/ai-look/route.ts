import "server-only";

import { readFile } from "fs/promises";
import path from "path";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import { NextResponse } from "next/server";
import { isOwnerSession } from "@/lib/owner";
import { getWardrobeData } from "@/lib/wardrobe";
import { sql } from "@/lib/db";
import type { Garment } from "@/lib/types";
import schema from "@/public/schema.json";

const singleLookRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
  anchorGarmentId: z.coerce.number().int().positive().optional(),
  anchorMode: z.enum(["strict", "soft"]).optional(),
});

const travelRequestSchema = z.object({
  mode: z.literal("travel"),
  destination: z.string().trim().min(1, "Destination is required."),
  startDate: z.string().trim().min(1, "Start date is required."),
  endDate: z.string().trim().min(1, "End date is required."),
  reason: z.enum(["Vacation", "Office", "Customer visit"]),
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

const singleLookCandidateSchema = z.object({
  lookName: z.string().min(1),
  selectedGarmentIds: z.array(z.number().int()).min(4).max(8),
  rationale: z.string().min(1),
  modelConfidence: z.number().min(0).max(100),
}).strict();

const singleLookCandidateBatchSchema = z.object({
  candidates: z.array(singleLookCandidateSchema).min(1).max(6),
}).strict();

const travelDayRecommendationSchema = z.object({
  lookName: z.string().min(1),
  selectedGarmentIds: z.array(z.number().int()).min(4).max(8),
  rationale: z.string().min(1),
  modelConfidence: z.number().min(0).max(100),
});

const climateFallbackSchema = z.object({
  avgMinTempC: z.number().min(-30).max(45),
  avgMaxTempC: z.number().min(-20).max(50),
  likelyConditions: z.array(z.string()).min(1).max(4),
  notes: z.string().min(1),
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
  weather: string[];
}

interface TravelDayWeather {
  date: string;
  summary: string;
  weather: string[];
  status: "forecast" | "seasonal" | "failed";
}

interface TravelReasonIntent {
  style: string[];
  formality: string | null;
  occasion: string[];
  place: string[];
  notes: string;
}
interface SingleLookCandidate {
  lookName: string;
  rationale: string;
  selectedGarmentIds: number[];
  lineupGarments: Garment[];
  signature: string;
  matchScore: number;
  modelConfidence: number;
  confidence: number;
}

interface StrictDayConstraints {
  requiredPlaces: string[];
  requiredOccasions: string[];
  label: string;
}

type AnchorMode = "strict" | "soft";

interface CompactGarment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: Garment["material_composition"];
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
  favorite: boolean;
}

type WeatherContextStatus =
  | "not_requested"
  | "location_detected"
  | "fetched"
  | "failed";

type InMemoryRateLimitState = {
  count: number;
  windowStart: number;
};

const AI_LOOK_MINUTE_WINDOW_MS = 60 * 1000;
const AI_LOOK_HOUR_WINDOW_MS = 60 * 60 * 1000;
const AI_LOOK_MAX_REQUESTS_PER_MINUTE = 8;
const AI_LOOK_MAX_REQUESTS_PER_HOUR = 120;
const MAX_TRAVEL_PLAN_DAYS = 21;
const aiLookInMemoryRateLimit = new Map<string, InMemoryRateLimitState>();
let aiLookRateLimitTableReadyPromise: Promise<void> | null = null;
let hasLoggedRateLimitFallback = false;

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
- Always return exactly four garments: one outerwear item (jacket/coat), one top, one bottom, and one footwear item.
- Do not return the exact same full lineup as previous travel days unless the prompt explicitly says no alternatives exist.
- Keep rationale crisp and grounded in canonical intent + garment materials/features.
- Do not include garment IDs in the rationale text.
`;

const SINGLE_CANDIDATE_RECOMMENDER_APPENDIX = `
Output requirements:
- Return up to 6 distinct candidate looks in "candidates".
- Use only garment IDs from the provided wardrobe JSON.
- selectedGarmentIds must be ordered from top to bottom.
- Each candidate must contain exactly four garments: one outerwear item (jacket/coat), one top, one bottom, and one footwear item.
- Keep each candidate rationale concise and grounded in canonical intent.
- Avoid returning duplicate lineups across candidates.
- Do not include garment IDs in rationale text.
`;

const SINGLE_LOOK_TARGET_CANDIDATES = 6;
const SINGLE_LOOK_MAX_GENERATION_ATTEMPTS = 2;
const SINGLE_RECENT_HISTORY_LIMIT = 18;
const TRAVEL_HISTORY_ROW_LIMIT = 240;

const WEATHER_TOOL_INPUT_SCHEMA = z.object({
  locationQuery: z.string().min(1).describe("Location query string, e.g. 'Aviles, Asturias, Spain'."),
}).strict();

const normalize = (value: unknown): string => String(value ?? "").trim();

const joinNaturalList = (values: string[]): string => {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
};

const stripWeatherNotes = (value: string): string => {
  const normalized = normalize(value).replace(/\s+/g, " ");
  if (!normalized) return "";

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalize(sentence))
    .filter(Boolean);

  const filtered = sentences.filter((sentence) =>
    !/\b(weather|forecast|temperature|conditions|humidity|wind|celsius|°c)\b/i.test(sentence)
  );

  return filtered.join(" ").trim();
};

const toSentence = (value: string): string => {
  const normalized = normalize(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const summarizeWeatherContext = (weatherContext: string): string => {
  const normalized = normalize(weatherContext);
  if (!normalized) return "";

  const locationMatch = normalized.match(/^Weather context for\s+([^:]+):/i);
  const conditionsMatch = normalized.match(/Current conditions look\s+([^\.]+)\./i);
  const rangeMatch = normalized.match(/Expected range\s+([^\.]+)\./i);
  const currentTempMatch = normalized.match(/Current temperature\s+([^\.]+)\./i);

  const location = normalize(locationMatch?.[1] ?? "");
  const conditions = normalize(conditionsMatch?.[1] ?? "");
  const range = normalize(rangeMatch?.[1] ?? "");
  const currentTemp = normalize(currentTempMatch?.[1] ?? "");

  const detailParts: string[] = [];
  if (conditions) detailParts.push(conditions);
  if (currentTemp) detailParts.push(`${currentTemp} now`);
  if (range) detailParts.push(`range ${range}`);

  if (detailParts.length === 0) {
    return toSentence(`Current weather considered: ${normalized}`);
  }

  const lead = location ? `Current weather in ${location}` : "Current weather";
  return toSentence(`${lead}: ${detailParts.join(", ")}`);
};

const buildAlignedRationale = ({
  lineupGarments,
  intent,
  weatherContext,
  contextLabel,
}: {
  lineupGarments: Garment[];
  intent: CanonicalIntent;
  weatherContext?: string | null;
  contextLabel?: string;
}): string => {
  const contextParts: string[] = [];
  const places = intent.place.slice(0, 3);
  const occasions = intent.occasion.slice(0, 3);
  const weatherTags = intent.weather.slice(0, 2);
  const timeTags = intent.timeOfDay.slice(0, 2);
  const styleTags = intent.style.slice(0, 2);

  if (normalize(contextLabel)) contextParts.push(normalize(contextLabel));
  if (places.length > 0) contextParts.push(`${joinNaturalList(places)} settings`);
  if (occasions.length > 0) contextParts.push(`${joinNaturalList(occasions)} moments`);

  const openingSentence = contextParts.length > 0
    ? toSentence(`This recommendation is built for ${contextParts.join(", ")}`)
    : "This recommendation is built around your request and daily context.";

  const dayFlowParts: string[] = [];
  if (timeTags.length > 0) dayFlowParts.push(`${joinNaturalList(timeTags)} wear`);
  if (places.length > 0) dayFlowParts.push(`environments like ${joinNaturalList(places)}`);
  if (occasions.length > 0) dayFlowParts.push(`${joinNaturalList(occasions)} activities`);
  const dayFlowSentence = dayFlowParts.length > 0
    ? toSentence(`It is tuned for ${dayFlowParts.join(", ")}, balancing comfort and polish as your day shifts`)
    : "It is tuned for day-to-day transitions, balancing comfort and polish without feeling overworked.";

  const stylingParts: string[] = [];
  if (intent.formality) stylingParts.push(`${intent.formality.toLowerCase()} formality`);
  if (styleTags.length > 0) stylingParts.push(`${joinNaturalList(styleTags)} style cues`);
  const stylingSentence = stylingParts.length > 0
    ? toSentence(`The styling direction stays consistent with ${stylingParts.join(" and ")}, so the overall impression feels intentional but easy`)
    : "The styling direction stays clean and versatile so the final look feels intentional but easy.";

  const normalizedWeatherContext = normalize(weatherContext);
  const weatherSentence = normalizedWeatherContext
    ? summarizeWeatherContext(normalizedWeatherContext)
    : weatherTags.length > 0
      ? toSentence(`Weather support is aligned to ${joinNaturalList(weatherTags)} conditions to keep the outfit practical`)
      : "Weather cues are limited, so the look favors adaptable layering and all-day comfort.";

  let normalizedNotes = normalize(intent.notes)
    .replace(/\b(current\s+)?weather\s+(resolved|considered)[^.]*\.?/gi, "")
    .replace(/\bweather data[^.]*unavailable[^.]*\.?/gi, "")
    .replace(/\bweather data[^.]*not available[^.]*\.?/gi, "")
    .replace(/\bweather data[^.]*not found[^.]*\.?/gi, "")
    .replace(/\bassuming[^.]*weather[^.]*\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (normalizedWeatherContext) {
    normalizedNotes = stripWeatherNotes(normalizedNotes);
  }

  const notesSentence = normalizedNotes
    ? toSentence(`${normalizedNotes}`)
    : "";

  const cohesionSentence = lineupGarments.length > 0
    ? "Overall, the lineup stays cohesive and practical, with enough flexibility for real-world use while still matching the requested intent."
    : "";

  return [openingSentence, dayFlowSentence, stylingSentence, weatherSentence, notesSentence, cohesionSentence]
    .filter(Boolean)
    .join(" ")
    .trim();
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

async function fetchWeatherContext(locationQuery: string): Promise<WeatherContext | null> {
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

  const locationLabel = [normalize(currentJson.name), normalize(currentJson.sys?.country)].filter(Boolean).join(", ") || query;
  const currentTemp = currentJson.main?.temp;
  const currentFeelsLike = currentJson.main?.feels_like;
  const windKmh = typeof dayWindMs === "number" ? dayWindMs * 3.6 : null;

  const summary = [
    `Weather context for ${locationLabel}:`,
    `Current conditions look ${dayDescription || "variable"}.`,
    typeof dayTempMin === "number" && typeof dayTempMax === "number" ? `Expected range ${Math.round(dayTempMin)}-${Math.round(dayTempMax)}°C.` : "",
    typeof currentTemp === "number" ? `Current temperature ${Math.round(currentTemp)}°C.` : "",
    typeof currentFeelsLike === "number" ? `Feels like ${Math.round(currentFeelsLike)}°C.` : "",
    typeof dayHumidity === "number" ? `Humidity ${Math.round(dayHumidity)}%.` : "",
    typeof windKmh === "number" ? `Wind ${Math.round(windKmh)} km/h.` : "",
  ].filter(Boolean).join(" ");

  const weather = typeof dayTempMin === "number" && typeof dayTempMax === "number"
    ? dedupeCanonicalWeather(inferCanonicalWeatherFromTemperature(dayTempMin, dayTempMax))
    : [];

  return { locationLabel, summary, weather };
}

const parseIsoDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const enumerateDateRange = (startIso: string, endIso: string): string[] => {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end || start > end) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const inferCanonicalWeatherFromTemperature = (minTemp: number, maxTemp: number): string[] => {
  const avg = (minTemp + maxTemp) / 2;
  if (avg >= 30) return ["hot"];
  if (avg >= 24) return ["warm"];
  if (avg >= 16) return ["mild"];
  if (avg >= 8) return ["cool"];
  return ["cold"];
};

const inferSeasonalWeatherByMonth = (month: number, latitude: number): string[] => {
  const normalizedMonth = ((month % 12) + 12) % 12;
  const isSouthernHemisphere = latitude < 0;
  const shiftedMonth = isSouthernHemisphere ? (normalizedMonth + 6) % 12 : normalizedMonth;

  // Shifted to northern-hemisphere equivalents for inference.
  if ([11, 0, 1].includes(shiftedMonth)) return ["cold", "cool"];
  if ([2, 3, 4].includes(shiftedMonth)) return ["cool", "mild", "warm"];
  if ([5, 6, 7].includes(shiftedMonth)) return ["warm", "hot"];
  return ["cool", "mild", "warm"];
};

const dedupeCanonicalWeather = (values: string[]): string[] => {
  const allowed = new Set(WEATHER_OPTIONS.map((option) => option.toLowerCase()));
  const seen = new Set<string>();
  const canonical: string[] = [];

  for (const value of values) {
    const key = normalize(value).toLowerCase();
    if (!key || seen.has(key) || !allowed.has(key)) continue;
    const option = WEATHER_OPTIONS.find((item) => item.toLowerCase() === key);
    if (!option) continue;
    seen.add(key);
    canonical.push(option);
  }

  return canonical;
};

async function fetchTravelWeatherByDateRange(
  destination: string,
  dateRange: string[]
): Promise<{ locationLabel: string; days: TravelDayWeather[] }> {
  const buildLlmFallbackDays = async (locationLabel: string): Promise<TravelDayWeather[]> => {
    const days: TravelDayWeather[] = [];
    for (const date of dateRange) {
      const llmFallback = await fetchLlmClimateFallback(locationLabel, date);
      if (llmFallback) {
        days.push({
          date,
          summary: llmFallback.summary,
          weather: llmFallback.weather,
          status: "seasonal",
        });
        continue;
      }

      days.push({
        date,
        summary: `Weather unavailable for ${date}; using destination and reason context only.`,
        weather: [],
        status: "failed",
      });
    }
    return days;
  };

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || dateRange.length === 0) {
    const fallbackDays = await buildLlmFallbackDays(destination);
    return {
      locationLabel: destination,
      days: fallbackDays,
    };
  }

  const geoUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
  geoUrl.searchParams.set("q", destination);
  geoUrl.searchParams.set("limit", "1");
  geoUrl.searchParams.set("appid", apiKey);
  const geoResponse = await fetch(geoUrl.toString(), { cache: "no-store" });

  if (!geoResponse.ok) {
    const fallbackDays = await buildLlmFallbackDays(destination);
    return {
      locationLabel: destination,
      days: fallbackDays,
    };
  }

  const geoJson = await geoResponse.json() as Array<{
    name?: string;
    country?: string;
    state?: string;
    lat?: number;
    lon?: number;
  }>;
  const bestMatch = geoJson[0];
  if (!bestMatch || typeof bestMatch.lat !== "number" || typeof bestMatch.lon !== "number") {
    const fallbackDays = await buildLlmFallbackDays(destination);
    return {
      locationLabel: destination,
      days: fallbackDays,
    };
  }

  const locationLabel = [bestMatch.name, bestMatch.state, bestMatch.country]
    .map((item) => normalize(item))
    .filter(Boolean)
    .join(", ") || destination;

  const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
  forecastUrl.searchParams.set("lat", String(bestMatch.lat));
  forecastUrl.searchParams.set("lon", String(bestMatch.lon));
  forecastUrl.searchParams.set("units", "metric");
  forecastUrl.searchParams.set("appid", apiKey);

  const forecastResponse = await fetch(forecastUrl.toString(), { cache: "no-store" });
  const forecastByDate = new Map<string, Array<{
    description: string;
    min?: number;
    max?: number;
    humidity?: number;
    wind?: number;
  }>>();

  if (forecastResponse.ok) {
    const forecastJson = await forecastResponse.json() as {
      list?: Array<{
        dt?: number;
        weather?: Array<{ description?: string }>;
        main?: { temp_min?: number; temp_max?: number; humidity?: number };
        wind?: { speed?: number };
      }>;
    };

    for (const entry of forecastJson.list ?? []) {
      if (!entry.dt) continue;
      const dateKey = new Date(entry.dt * 1000).toISOString().slice(0, 10);
      const bucket = forecastByDate.get(dateKey) ?? [];
      bucket.push({
        description: normalize(entry.weather?.[0]?.description) || "variable",
        min: entry.main?.temp_min,
        max: entry.main?.temp_max,
        humidity: entry.main?.humidity,
        wind: entry.wind?.speed,
      });
      forecastByDate.set(dateKey, bucket);
    }
  }

  const days: TravelDayWeather[] = [];
  for (const date of dateRange) {
    const forecastEntries = forecastByDate.get(date) ?? [];
    if (forecastEntries.length > 0) {
      const mins = forecastEntries.map((entry) => entry.min).filter((v): v is number => typeof v === "number");
      const maxs = forecastEntries.map((entry) => entry.max).filter((v): v is number => typeof v === "number");
      const humidities = forecastEntries.map((entry) => entry.humidity).filter((v): v is number => typeof v === "number");
      const winds = forecastEntries.map((entry) => entry.wind).filter((v): v is number => typeof v === "number");
      const description = forecastEntries[0]?.description || "variable";
      const min = mins.length ? Math.min(...mins) : undefined;
      const max = maxs.length ? Math.max(...maxs) : undefined;
      const weather = typeof min === "number" && typeof max === "number"
        ? dedupeCanonicalWeather(inferCanonicalWeatherFromTemperature(min, max))
        : [];

      days.push({
        date,
        summary: [
          `${locationLabel} on ${date}:`,
          `${description}.`,
          typeof min === "number" && typeof max === "number" ? `Expected range ${Math.round(min)}-${Math.round(max)}°C.` : "",
          humidities.length > 0 ? `Humidity ${Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length)}%.` : "",
          winds.length > 0 ? `Wind ${Math.round((winds.reduce((a, b) => a + b, 0) / winds.length) * 3.6)} km/h.` : "",
        ].filter(Boolean).join(" "),
        weather,
        status: "forecast",
      });
      continue;
    }

    const llmFallback = await fetchLlmClimateFallback(locationLabel, date);
    if (llmFallback) {
      days.push({
        date,
        summary: llmFallback.summary,
        weather: llmFallback.weather,
        status: "seasonal",
      });
      continue;
    }

    const dateObj = parseIsoDate(date);
    const month = dateObj ? dateObj.getUTCMonth() : new Date().getUTCMonth();
    const seasonalWeather = dedupeCanonicalWeather(inferSeasonalWeatherByMonth(month, bestMatch.lat ?? 0));
    days.push({
      date,
      summary: `No direct forecast for ${date} in ${locationLabel}. Using typical seasonal conditions for planning.`,
      weather: seasonalWeather,
      status: "seasonal",
    });
  }

  return { locationLabel, days };
}

const monthLabel = (dateIso: string): string => {
  const date = parseIsoDate(dateIso) ?? new Date();
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

async function fetchLlmClimateFallback(
  destination: string,
  dateIso: string
): Promise<{ summary: string; weather: string[] } | null> {
  try {
    const climateMonth = monthLabel(dateIso);
    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: climateFallbackSchema,
      temperature: 0,
      prompt: [
        "You are a weather-climate estimator.",
        "Provide typical monthly conditions for travel planning when forecast is unavailable.",
        `Location: ${destination}`,
        `Month: ${climateMonth}`,
        "Return realistic average min/max Celsius and 1-4 likely condition words.",
      ].join("\n"),
    });

    const weather = dedupeCanonicalWeather([
      ...inferCanonicalWeatherFromTemperature(object.avgMinTempC, object.avgMaxTempC),
      ...object.likelyConditions,
    ]);

    return {
      summary: `No direct forecast for ${dateIso} in ${destination}. Using model-estimated monthly climate for ${climateMonth}: typically ${Math.round(object.avgMinTempC)}-${Math.round(object.avgMaxTempC)}°C with ${object.likelyConditions.join(", ")}. ${normalize(object.notes)}`,
      weather,
    };
  } catch (error) {
    console.warn("LLM climate fallback failed:", error);
    return null;
  }
}

const findCanonicalOption = (options: string[], desired: string): string | null => {
  const found = options.find((item) => item.toLowerCase() === desired.toLowerCase());
  return found ?? null;
};

const resolveTravelReasonIntent = (reason: "Vacation" | "Office" | "Customer visit"): TravelReasonIntent => {
  if (reason === "Vacation") {
    return {
      style: [findCanonicalOption(STYLE_OPTIONS, "outdoorsy"), findCanonicalOption(STYLE_OPTIONS, "classic")].filter((v): v is string => Boolean(v)),
      formality: findCanonicalOption(FORMALITY_OPTIONS, "Casual"),
      occasion: [findCanonicalOption(OCCASION_OPTIONS, "Casual Social"), findCanonicalOption(OCCASION_OPTIONS, "Errands / Low-Key Social")].filter((v): v is string => Boolean(v)),
      place: [],
      notes: "Vacation intent: prioritize comfort, climate adaptability, and easy day-to-night transitions.",
    };
  }

  if (reason === "Office") {
    const officePlace = findCanonicalOption(PLACE_OPTIONS, "Office / Boardroom");
    const workshopPlace = findCanonicalOption(PLACE_OPTIONS, "Workshop");
    const atelierPlace = findCanonicalOption(PLACE_OPTIONS, "Creative Studio / Atelier");
    const cityPlace = findCanonicalOption(PLACE_OPTIONS, "Metropolitan / City");
    const casualSocialOccasion = findCanonicalOption(OCCASION_OPTIONS, "Casual Social");
    const dateNightOccasion = findCanonicalOption(OCCASION_OPTIONS, "Date Night / Intimate Dinner");
    const outdoorSocialOccasion = findCanonicalOption(OCCASION_OPTIONS, "Outdoor Social / Garden Party");
    return {
      style: [
        findCanonicalOption(STYLE_OPTIONS, "minimalist"),
        findCanonicalOption(STYLE_OPTIONS, "vintage"),
        findCanonicalOption(STYLE_OPTIONS, "classic"),
      ].filter((v): v is string => Boolean(v)),
      formality: findCanonicalOption(FORMALITY_OPTIONS, "Elevated Casual") ?? findCanonicalOption(FORMALITY_OPTIONS, "Business Casual"),
      occasion: [casualSocialOccasion, dateNightOccasion, outdoorSocialOccasion].filter((v): v is string => Boolean(v)),
      place: [officePlace, workshopPlace, atelierPlace, cityPlace].filter((v): v is string => Boolean(v)),
      notes: "Office intent: favor elevated smart-casual combinations with polished, versatile silhouettes.",
    };
  }

  return {
    style: [findCanonicalOption(STYLE_OPTIONS, "classic"), findCanonicalOption(STYLE_OPTIONS, "minimalist")].filter((v): v is string => Boolean(v)),
    formality: findCanonicalOption(FORMALITY_OPTIONS, "Business Formal") ?? findCanonicalOption(FORMALITY_OPTIONS, "Business Casual"),
    occasion: [findCanonicalOption(OCCASION_OPTIONS, "Business Formal")].filter((v): v is string => Boolean(v)),
    place: [findCanonicalOption(PLACE_OPTIONS, "Office / Boardroom")].filter((v): v is string => Boolean(v)),
    notes: "Customer visit intent: prioritize trust-building, polished, business-facing combinations.",
  };
};

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

const categorizeType = (type: string): "top" | "outerwear" | "bottom" | "footwear" | "other" => {
  const normalized = type.toLowerCase();
  if (/(sneaker|loafer|boot|shoe|oxford|derby|moccasin|sandals?)/.test(normalized)) return "footwear";
  if (/(jeans?|pants?|trousers?|shorts?|chinos?|cargo)/.test(normalized)) return "bottom";
  if (/(jacket|coat|blazer|overshirt|cardigan|parka|trench|windbreaker|shell)/.test(normalized)) return "outerwear";
  if (/(shirt|t-shirt|tee|polo|sweater|sweatshirt|hoodie|knit)/.test(normalized))
    return "top";
  return "other";
};

type GarmentCategory = ReturnType<typeof categorizeType>;

const CORE_SILHOUETTE_CATEGORIES: GarmentCategory[] = ["top", "bottom", "footwear"];
const SINGLE_REQUIRED_CATEGORIES: GarmentCategory[] = ["outerwear", "top", "bottom", "footwear"];
const TRAVEL_REQUIRED_CATEGORIES: GarmentCategory[] = ["outerwear", "top", "bottom", "footwear"];
const CATEGORY_PRIORITY: Record<GarmentCategory, number> = {
  outerwear: 0,
  top: 1,
  bottom: 2,
  footwear: 3,
  other: 4,
};

const TRAVEL_PROMPT_MAX_CANDIDATES = 90;
const TRAVEL_CATEGORY_QUOTAS: Record<GarmentCategory, number> = {
  outerwear: 22,
  top: 24,
  bottom: 20,
  footwear: 12,
  other: 12,
};
const MAX_RECENT_LOOK_HISTORY = 6;
const MAX_ALLOWED_OVERLAP_RATIO = 0.8;

const lineupSignature = (ids: number[]): string =>
  Array.from(new Set(ids)).sort((a, b) => a - b).join("-");

const overlapRatio = (left: number[], right: number[]): number => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 0;
  let overlap = 0;
  for (const id of leftSet) {
    if (rightSet.has(id)) overlap += 1;
  }
  const unionSize = new Set([...leftSet, ...rightSet]).size;
  return unionSize === 0 ? 0 : overlap / unionSize;
};

const maxOverlapAgainstHistory = (ids: number[], history: number[][]): number =>
  history.reduce((max, pastIds) => Math.max(max, overlapRatio(ids, pastIds)), 0);

const toTopDownOrderedIds = (ids: number[], garmentCategoryById: Map<number, GarmentCategory>): number[] => {
  const deduped = Array.from(new Set(ids));
  return deduped
    .map((id, index) => ({
      id,
      index,
      priority: CATEGORY_PRIORITY[garmentCategoryById.get(id) ?? "other"],
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map((entry) => entry.id);
};

const missingCoreSilhouetteCategoriesFromIds = (
  ids: number[],
  garmentCategoryById: Map<number, GarmentCategory>,
  requiredCategories: GarmentCategory[] = CORE_SILHOUETTE_CATEGORIES
): GarmentCategory[] => {
  const present = new Set(ids.map((id) => garmentCategoryById.get(id)).filter((item): item is GarmentCategory => Boolean(item)));
  return requiredCategories.filter((category) => !present.has(category));
};

const missingCoreSilhouetteCategoriesFromWardrobe = (
  wardrobe: Array<{ type: string }>,
  requiredCategories: GarmentCategory[] = CORE_SILHOUETTE_CATEGORIES
): GarmentCategory[] => {
  const present = new Set(wardrobe.map((garment) => categorizeType(garment.type)));
  return requiredCategories.filter((category) => !present.has(category));
};

const hasCoreSilhouetteFromIds = (
  ids: number[],
  garmentCategoryById: Map<number, GarmentCategory>,
  requiredCategories: GarmentCategory[] = CORE_SILHOUETTE_CATEGORIES
): boolean =>
  missingCoreSilhouetteCategoriesFromIds(ids, garmentCategoryById, requiredCategories).length === 0;

const scoreGarmentForIntent = (
  garment: Pick<
    CompactGarment,
    "style" | "formality" | "suitable_weather" | "suitable_occasions" | "suitable_places" | "suitable_time_of_day"
  >,
  intent: CanonicalIntent
): number => {
  let score = 0;

  if (intent.weather.length > 0 && intersectionMatches(garment.suitable_weather ?? [], intent.weather, { allSeasonAlias: "all season" })) {
    score += 16;
  }
  if (intent.occasion.length > 0 && intersectionMatches(garment.suitable_occasions ?? [], intent.occasion)) {
    score += 24;
  }
  if (intent.place.length > 0 && intersectionMatches(garment.suitable_places ?? [], intent.place)) {
    score += 24;
  }
  if (intent.timeOfDay.length > 0 && intersectionMatches(garment.suitable_time_of_day ?? [], intent.timeOfDay, { allDayAlias: "all day" })) {
    score += 12;
  }
  if (intent.formality && normalize(garment.formality).toLowerCase() === intent.formality.toLowerCase()) {
    score += 12;
  }
  if (intent.style.length > 0 && intent.style.some((style) => style.toLowerCase() === normalize(garment.style).toLowerCase())) {
    score += 12;
  }

  return score;
};

const buildTravelPromptWardrobe = ({
  eligibleWardrobe,
  dayIntent,
  usedGarmentIds,
  recentLookHistory,
  requiredIds,
}: {
  eligibleWardrobe: CompactGarment[];
  dayIntent: CanonicalIntent;
  usedGarmentIds: Set<number>;
  recentLookHistory: Array<{ date: string; ids: number[] }>;
  requiredIds?: number[];
}): CompactGarment[] => {
  const recentIds = new Set(recentLookHistory.flatMap((item) => item.ids));
  const scored = eligibleWardrobe.map((garment) => {
    const intentScore = scoreGarmentForIntent(garment, dayIntent);
    const noveltyBonus = usedGarmentIds.has(garment.id) ? -12 : 18;
    const recentPenalty = recentIds.has(garment.id) ? -8 : 0;
    const favoriteBonus = garment.favorite ? 4 : 0;
    const score = intentScore + noveltyBonus + recentPenalty + favoriteBonus;
    return { garment, score, category: categorizeType(garment.type) };
  });

  const byCategory: Record<GarmentCategory, Array<{ garment: CompactGarment; score: number }>> = {
    outerwear: [],
    top: [],
    bottom: [],
    footwear: [],
    other: [],
  };

  for (const item of scored) {
    byCategory[item.category].push({ garment: item.garment, score: item.score });
  }
  for (const category of Object.keys(byCategory) as GarmentCategory[]) {
    byCategory[category].sort((left, right) => right.score - left.score);
  }

  const selected = new Map<number, CompactGarment>();
  for (const category of Object.keys(TRAVEL_CATEGORY_QUOTAS) as GarmentCategory[]) {
    const quota = TRAVEL_CATEGORY_QUOTAS[category];
    for (const { garment } of byCategory[category].slice(0, quota)) {
      selected.set(garment.id, garment);
    }
  }

  if (requiredIds && requiredIds.length > 0) {
    const eligibleById = new Map(eligibleWardrobe.map((garment) => [garment.id, garment]));
    for (const requiredId of requiredIds) {
      const requiredGarment = eligibleById.get(requiredId);
      if (!requiredGarment) continue;
      selected.set(requiredGarment.id, requiredGarment);
    }
  }

  const globallySorted = scored
    .slice()
    .sort((left, right) => right.score - left.score)
    .map((item) => item.garment);

  for (const garment of globallySorted) {
    if (selected.size >= TRAVEL_PROMPT_MAX_CANDIDATES) break;
    selected.set(garment.id, garment);
  }

  return Array.from(selected.values());
};

const enforceCoreSilhouetteFromPool = ({
  ids,
  pool,
  garmentCategoryById,
  usedGarmentIds,
  blockedIds,
  lockedFootwearId,
  lockedOuterwearId,
  isTravelDay,
  intent,
  requiredCategories = CORE_SILHOUETTE_CATEGORIES,
}: {
  ids: number[];
  pool: CompactGarment[];
  garmentCategoryById: Map<number, GarmentCategory>;
  usedGarmentIds: Set<number>;
  blockedIds: number[];
  lockedFootwearId: number | null;
  lockedOuterwearId: number | null;
  isTravelDay: boolean;
  intent: CanonicalIntent;
  requiredCategories?: GarmentCategory[];
}): number[] => {
  const blockedIdSet = new Set(blockedIds);
  const selected = Array.from(new Set(ids)).filter((id) => !blockedIdSet.has(id));
  const selectedSet = new Set(selected);

  const candidateSort = (left: CompactGarment, right: CompactGarment) => {
    const leftScore = scoreGarmentForIntent(left, intent) + (usedGarmentIds.has(left.id) ? 0 : 25) + (left.favorite ? 5 : 0);
    const rightScore = scoreGarmentForIntent(right, intent) + (usedGarmentIds.has(right.id) ? 0 : 25) + (right.favorite ? 5 : 0);
    return rightScore - leftScore;
  };

  for (const category of requiredCategories) {
    if (selected.some((id) => garmentCategoryById.get(id) === category)) continue;

    const candidates = pool
      .filter((garment) => {
        if (selectedSet.has(garment.id)) return false;
        if (blockedIdSet.has(garment.id)) return false;
        if (categorizeType(garment.type) !== category) return false;
        if (category === "outerwear" && lockedOuterwearId != null && garment.id !== lockedOuterwearId) {
          return false;
        }
        if (category === "footwear" && !isTravelDay && lockedFootwearId != null && garment.id !== lockedFootwearId) {
          return false;
        }
        return true;
      })
      .sort(candidateSort);

    const best = candidates[0];
    if (!best) continue;
    selected.push(best.id);
    selectedSet.add(best.id);
  }

  return toTopDownOrderedIds(selected, garmentCategoryById);
};

const diversifyLineupFromPool = ({
  ids,
  pool,
  garmentCategoryById,
  usedGarmentIds,
  usedLookSignatures,
  recentLookHistory,
  avoidSignatures,
  avoidHistoryIds,
  blockedIds,
  lockedFootwearId,
  lockedOuterwearId,
  isTravelDay,
  intent,
  requiredCategories = CORE_SILHOUETTE_CATEGORIES,
}: {
  ids: number[];
  pool: CompactGarment[];
  garmentCategoryById: Map<number, GarmentCategory>;
  usedGarmentIds: Set<number>;
  usedLookSignatures: Set<string>;
  recentLookHistory: Array<{ date: string; ids: number[] }>;
  avoidSignatures?: Set<string>;
  avoidHistoryIds?: number[][];
  blockedIds: number[];
  lockedFootwearId: number | null;
  lockedOuterwearId: number | null;
  isTravelDay: boolean;
  intent: CanonicalIntent;
  requiredCategories?: GarmentCategory[];
}): number[] => {
  const historyIds = [
    ...recentLookHistory.map((entry) => entry.ids),
    ...(avoidHistoryIds ?? []),
  ];
  const current = toTopDownOrderedIds(ids, garmentCategoryById);
  const currentSignature = lineupSignature(current);
  const currentOverlap = maxOverlapAgainstHistory(current, historyIds);

  if (
    !usedLookSignatures.has(currentSignature) &&
    !(avoidSignatures?.has(currentSignature) ?? false) &&
    currentOverlap <= MAX_ALLOWED_OVERLAP_RATIO
  ) {
    return current;
  }

  const blockedIdSet = new Set(blockedIds);
  const replacementPriority = current
    .map((id, index) => ({ id, index, alreadyUsed: usedGarmentIds.has(id) }))
    .sort((left, right) => Number(right.alreadyUsed) - Number(left.alreadyUsed));

  for (const target of replacementPriority) {
    const targetCategory = garmentCategoryById.get(target.id) ?? "other";
    if (targetCategory === "outerwear" && lockedOuterwearId != null && target.id === lockedOuterwearId) {
      continue;
    }
    if (targetCategory === "footwear" && !isTravelDay && lockedFootwearId != null && target.id === lockedFootwearId) {
      continue;
    }

    const candidates = pool
      .filter((garment) => {
        if (blockedIdSet.has(garment.id)) return false;
        if (current.includes(garment.id)) return false;
        if (categorizeType(garment.type) !== targetCategory) return false;
        if (targetCategory === "outerwear" && lockedOuterwearId != null && garment.id !== lockedOuterwearId) {
          return false;
        }
        if (targetCategory === "footwear" && !isTravelDay && lockedFootwearId != null && garment.id !== lockedFootwearId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const leftScore = scoreGarmentForIntent(left, intent) + (usedGarmentIds.has(left.id) ? 0 : 30) + (left.favorite ? 5 : 0);
        const rightScore = scoreGarmentForIntent(right, intent) + (usedGarmentIds.has(right.id) ? 0 : 30) + (right.favorite ? 5 : 0);
        return rightScore - leftScore;
      });

    for (const replacement of candidates) {
      const next = [...current];
      next[target.index] = replacement.id;
      const normalized = toTopDownOrderedIds(next, garmentCategoryById);
      if (!hasCoreSilhouetteFromIds(normalized, garmentCategoryById, requiredCategories)) continue;

      const nextSignature = lineupSignature(normalized);
      const nextOverlap = maxOverlapAgainstHistory(normalized, historyIds);
      if (usedLookSignatures.has(nextSignature)) continue;
      if (avoidSignatures?.has(nextSignature)) continue;
      if (nextOverlap > MAX_ALLOWED_OVERLAP_RATIO && nextOverlap >= currentOverlap) continue;
      return normalized;
    }
  }

  return current;
};

const normalizeToFixedCategoryLook = ({
  ids,
  pool,
  garmentCategoryById,
  intent,
  requiredCategories,
  recentUsedIds,
  anchorGarmentId,
  anchorMode,
  preferProvidedIds = true,
}: {
  ids: number[];
  pool: CompactGarment[];
  garmentCategoryById: Map<number, GarmentCategory>;
  intent: CanonicalIntent;
  requiredCategories: GarmentCategory[];
  recentUsedIds?: Set<number>;
  anchorGarmentId?: number | null;
  anchorMode?: AnchorMode;
  preferProvidedIds?: boolean;
}): number[] => {
  const poolById = new Map(pool.map((garment) => [garment.id, garment]));
  const normalizedAnchorMode: AnchorMode = anchorMode ?? "strict";
  const anchorCategory = anchorGarmentId != null ? garmentCategoryById.get(anchorGarmentId) ?? "other" : null;
  const anchoredRequiredCategory =
    anchorCategory && requiredCategories.includes(anchorCategory) ? anchorCategory : null;
  const strictAnchorRequired =
    normalizedAnchorMode === "strict" && anchorGarmentId != null && anchoredRequiredCategory != null;
  let normalized = toTopDownOrderedIds(ids, garmentCategoryById);
  normalized = enforceCoreSilhouetteFromPool({
    ids: normalized,
    pool,
    garmentCategoryById,
    usedGarmentIds: new Set<number>(),
    blockedIds: [],
    lockedFootwearId: null,
    lockedOuterwearId: null,
    isTravelDay: true,
    intent,
    requiredCategories,
  });

  const used = new Set<number>();
  const selected: number[] = [];

  for (const category of requiredCategories) {
    if (
      strictAnchorRequired &&
      category === anchoredRequiredCategory &&
      anchorGarmentId != null &&
      poolById.has(anchorGarmentId) &&
      !used.has(anchorGarmentId)
    ) {
      selected.push(anchorGarmentId);
      used.add(anchorGarmentId);
      continue;
    }

    const currentCategoryIds = normalized.filter((id) => garmentCategoryById.get(id) === category && !used.has(id));
    const currentCategoryIdSet = new Set(currentCategoryIds);
    const fallbackIds = pool
      .filter((garment) => categorizeType(garment.type) === category && !used.has(garment.id))
      .map((garment) => garment.id);
    const candidates = Array.from(new Set([...currentCategoryIds, ...fallbackIds]))
      .map((id) => {
        const garment = poolById.get(id);
        if (!garment) return null;
        const isProvided = currentCategoryIdSet.has(id);
        const providedBonus = preferProvidedIds && isProvided ? 18 : 0;
        const anchorBonus =
          anchorGarmentId != null &&
          anchoredRequiredCategory === category &&
          id === anchorGarmentId
            ? (normalizedAnchorMode === "strict" ? 240 : 28)
            : 0;
        const noveltyBonus = recentUsedIds
          ? (recentUsedIds.has(id) ? -14 : 8)
          : 0;
        const score =
          scoreGarmentForIntent(garment, intent) +
          (garment.favorite ? 4 : 0) +
          providedBonus +
          anchorBonus +
          noveltyBonus;
        return { id, score };
      })
      .filter((item): item is { id: number; score: number } => Boolean(item))
      .sort((left, right) => right.score - left.score || left.id - right.id);

    if (candidates.length === 0) return [];
    const chosen = candidates[0].id;
    selected.push(chosen);
    used.add(chosen);
  }

  if (strictAnchorRequired && anchorGarmentId != null && !selected.includes(anchorGarmentId)) {
    return [];
  }

  return toTopDownOrderedIds(selected, garmentCategoryById);
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

const hasAnyCanonicalMatch = (garmentValues: string[], required: string[]): boolean => {
  if (required.length === 0) return true;
  const values = new Set((garmentValues ?? []).map((item) => normalize(item).toLowerCase()).filter(Boolean));
  return required.some((item) => values.has(item.toLowerCase()));
};

const destinationLooksBeachFriendly = (destination: string): boolean => {
  const lower = normalize(destination).toLowerCase();
  if (!lower) return false;
  return /(beach|coast|coastal|seaside|island|riviera|shore)/.test(lower);
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

const toValidatedSingleLookCandidate = ({
  lookName,
  modelConfidence,
  ids,
  intent,
  weatherContext,
  recentUsedIds,
  anchorGarmentId,
  anchorMode,
  compactWardrobe,
  garmentById,
  garmentCategoryById,
}: {
  lookName: string;
  modelConfidence: number;
  ids: number[];
  intent: CanonicalIntent;
  weatherContext?: string | null;
  recentUsedIds?: Set<number>;
  anchorGarmentId?: number | null;
  anchorMode?: AnchorMode;
  compactWardrobe: CompactGarment[];
  garmentById: Map<number, Garment>;
  garmentCategoryById: Map<number, GarmentCategory>;
}): SingleLookCandidate | null => {
  const uniqueValidIds = Array.from(new Set(ids.filter((id) => garmentById.has(id))));
  if (uniqueValidIds.length === 0) return null;

  const normalizedIds = normalizeToFixedCategoryLook({
    ids: uniqueValidIds,
    pool: compactWardrobe,
    garmentCategoryById,
    intent,
    requiredCategories: SINGLE_REQUIRED_CATEGORIES,
    recentUsedIds,
    anchorGarmentId,
    anchorMode,
    preferProvidedIds: true,
  });
  if (!hasCoreSilhouetteFromIds(normalizedIds, garmentCategoryById, SINGLE_REQUIRED_CATEGORIES)) {
    return null;
  }
  if (anchorMode === "strict" && anchorGarmentId != null && !normalizedIds.includes(anchorGarmentId)) {
    return null;
  }

  const lineupGarments = normalizedIds.map((id) => garmentById.get(id)!).filter(Boolean);
  if (lineupGarments.length !== SINGLE_REQUIRED_CATEGORIES.length) return null;

  const matchScore = computeObjectiveMatchScore(lineupGarments, intent);
  const roundedModelConfidence = Math.max(0, Math.min(100, Math.round(modelConfidence)));
  const confidence = Math.max(
    20,
    Math.min(100, Math.round((roundedModelConfidence * 0.3) + (matchScore * 0.7)))
  );

  const baseRationale = buildAlignedRationale({
    lineupGarments,
    intent,
    weatherContext: weatherContext || null,
  });

  return {
    lookName: normalize(lookName) || "Curated Wardrobe Look",
    rationale: baseRationale,
    selectedGarmentIds: normalizedIds,
    lineupGarments,
    signature: lineupSignature(normalizedIds),
    matchScore,
    modelConfidence: roundedModelConfidence,
    confidence,
  };
};

const buildDeterministicSingleLookFallbackCandidate = ({
  intent,
  weatherContext,
  recentUsedIds,
  avoidSignatures,
  anchorGarmentId,
  anchorMode,
  compactWardrobe,
  garmentById,
  garmentCategoryById,
}: {
  intent: CanonicalIntent;
  weatherContext?: string | null;
  recentUsedIds?: Set<number>;
  avoidSignatures?: Set<string>;
  anchorGarmentId?: number | null;
  anchorMode?: AnchorMode;
  compactWardrobe: CompactGarment[];
  garmentById: Map<number, Garment>;
  garmentCategoryById: Map<number, GarmentCategory>;
}): SingleLookCandidate | null => {
  const selected: number[] = [];
  const used = new Set<number>();

  for (const category of SINGLE_REQUIRED_CATEGORIES) {
    const options = compactWardrobe
      .filter((garment) => categorizeType(garment.type) === category && !used.has(garment.id))
      .map((garment) => ({
        garment,
        score:
          scoreGarmentForIntent(garment, intent) +
          (garment.favorite ? 6 : 0) +
          (recentUsedIds?.has(garment.id) ? -14 : 8),
      }))
      .sort((left, right) => right.score - left.score || left.garment.id - right.garment.id);

    const chosen = options[0]?.garment;
    if (!chosen) return null;
    selected.push(chosen.id);
    used.add(chosen.id);
  }

  const candidate = toValidatedSingleLookCandidate({
    lookName: "Curated Wardrobe Fallback",
    modelConfidence: 65,
    ids: selected,
    intent,
    weatherContext,
    recentUsedIds,
    anchorGarmentId,
    anchorMode,
    compactWardrobe,
    garmentById,
    garmentCategoryById,
  });

  if (!candidate) return null;
  if (avoidSignatures && avoidSignatures.has(candidate.signature)) {
    return null;
  }
  return candidate;
};

type SingleLookHistoryEntry = {
  signature: string;
  ids: number[];
};

type TravelDayHistoryEntry = {
  dayDate: string;
  dayIndex: number;
  signature: string;
  ids: number[];
};

const parseHistoryIds = (raw: string): number[] => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
};

const normalizeFingerprintSegment = (value: string): string =>
  normalize(value).toLowerCase().replace(/\s+/g, " ");

const buildTravelRequestFingerprint = ({
  destinationLabel,
  reason,
  startDate,
  endDate,
}: {
  destinationLabel: string;
  reason: "Vacation" | "Office" | "Customer visit";
  startDate: string;
  endDate: string;
}): string =>
  [
    normalizeFingerprintSegment(destinationLabel),
    normalizeFingerprintSegment(reason),
    normalizeFingerprintSegment(startDate),
    normalizeFingerprintSegment(endDate),
  ].join("|");

const getRecentSingleLookHistory = async (ownerKey: string): Promise<SingleLookHistoryEntry[]> => {
  const rows = await sql`
    SELECT lineup_signature, garment_ids_json
    FROM ai_look_lineup_history
    WHERE owner_key = ${ownerKey}
      AND mode = 'single'
    ORDER BY created_at DESC
    LIMIT ${SINGLE_RECENT_HISTORY_LIMIT};
  ` as Array<{ lineup_signature: string; garment_ids_json: string }>;

  return rows.map((row) => ({
    signature: normalize(row.lineup_signature),
    ids: parseHistoryIds(normalize(row.garment_ids_json)),
  }));
};

const getTravelDayHistoryForRequest = async ({
  ownerKey,
  requestFingerprint,
}: {
  ownerKey: string;
  requestFingerprint: string;
}): Promise<TravelDayHistoryEntry[]> => {
  const rows = await sql`
    SELECT day_date::text AS day_date, day_index, lineup_signature, garment_ids_json
    FROM ai_look_travel_day_history
    WHERE owner_key = ${ownerKey}
      AND request_fingerprint = ${requestFingerprint}
    ORDER BY created_at DESC
    LIMIT ${TRAVEL_HISTORY_ROW_LIMIT};
  ` as Array<{
    day_date: string;
    day_index: number;
    lineup_signature: string;
    garment_ids_json: string;
  }>;

  return rows
    .map((row) => ({
      dayDate: normalize(row.day_date),
      dayIndex: Number.isInteger(Number(row.day_index)) ? Number(row.day_index) : 0,
      signature: normalize(row.lineup_signature),
      ids: parseHistoryIds(normalize(row.garment_ids_json)),
    }))
    .filter((row) => Boolean(row.dayDate) && Boolean(row.signature) && row.ids.length > 0);
};

const persistSingleLookHistory = async ({
  ownerKey,
  ids,
}: {
  ownerKey: string;
  ids: number[];
}): Promise<void> => {
  const normalizedIds = Array.from(new Set(ids));
  const signature = lineupSignature(normalizedIds);
  await sql`
    INSERT INTO ai_look_lineup_history (
      owner_key,
      mode,
      panelist_key,
      lineup_signature,
      garment_ids_json
    )
    VALUES (
      ${ownerKey},
      'single',
      'single',
      ${signature},
      ${JSON.stringify(normalizedIds)}
    );
  `;
};

const persistTravelDayHistory = async ({
  ownerKey,
  requestFingerprint,
  destinationLabel,
  reason,
  days,
}: {
  ownerKey: string;
  requestFingerprint: string;
  destinationLabel: string;
  reason: "Vacation" | "Office" | "Customer visit";
  days: Array<{ dayDate: string; dayIndex: number; signature: string; ids: number[] }>;
}): Promise<void> => {
  for (const day of days) {
    const normalizedIds = Array.from(new Set(day.ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (!day.dayDate || normalizedIds.length === 0 || !day.signature) continue;

    await sql`
      INSERT INTO ai_look_travel_day_history (
        owner_key,
        request_fingerprint,
        destination_label,
        reason,
        day_date,
        day_index,
        lineup_signature,
        garment_ids_json
      )
      VALUES (
        ${ownerKey},
        ${requestFingerprint},
        ${destinationLabel},
        ${reason},
        ${day.dayDate},
        ${day.dayIndex},
        ${day.signature},
        ${JSON.stringify(normalizedIds)}
      );
    `;
  }
};

const recentSignatureSetFromHistory = (history: SingleLookHistoryEntry[]): Set<string> =>
  new Set(history.map((entry) => entry.signature).filter(Boolean));

const recentUsedIdSetFromHistory = (history: SingleLookHistoryEntry[]): Set<number> =>
  new Set(history.flatMap((entry) => entry.ids));

const computeSingleLookRerankScore = ({
  candidate,
  history,
}: {
  candidate: SingleLookCandidate;
  history: SingleLookHistoryEntry[];
}): number => {
  let score = candidate.confidence;

  const matchingHistoryCount = history.filter((item) => item.signature === candidate.signature).length;
  if (matchingHistoryCount > 0) {
    score -= Math.min(48, matchingHistoryCount * 16);
  }

  const historyIds = history.map((item) => item.ids).filter((ids) => ids.length > 0);
  const historyOverlap = historyIds.length > 0
    ? maxOverlapAgainstHistory(candidate.selectedGarmentIds, historyIds)
    : 0;
  score -= Math.round(historyOverlap * 30);

  return score;
};

const chooseTopSingleLookCandidate = ({
  candidates,
  history,
}: {
  candidates: SingleLookCandidate[];
  history: SingleLookHistoryEntry[];
}): SingleLookCandidate | null => {
  if (candidates.length === 0) return null;

  let pool = [...candidates];
  const recentSignatures = recentSignatureSetFromHistory(history);
  const historyIds = history.map((item) => item.ids).filter((ids) => ids.length > 0);

  // Hard anti-repeat: if at least one non-recent signature exists, exclude recent signatures.
  const nonRepeatedPool = pool.filter((candidate) => !recentSignatures.has(candidate.signature));
  if (nonRepeatedPool.length > 0) {
    pool = nonRepeatedPool;
  }

  // Hard anti-overlap: if at least one candidate is below threshold vs history, keep only those.
  if (historyIds.length > 0) {
    const lowOverlapPool = pool.filter(
      (candidate) => maxOverlapAgainstHistory(candidate.selectedGarmentIds, historyIds) < MAX_ALLOWED_OVERLAP_RATIO
    );
    if (lowOverlapPool.length > 0) {
      pool = lowOverlapPool;
    }
  }

  const ranked = pool
    .map((candidate) => ({
      candidate,
      rerankScore: computeSingleLookRerankScore({
        candidate,
        history,
      }),
    }))
    .sort((left, right) => {
      if (right.rerankScore !== left.rerankScore) return right.rerankScore - left.rerankScore;
      if (right.candidate.confidence !== left.candidate.confidence) {
        return right.candidate.confidence - left.candidate.confidence;
      }
      return left.candidate.signature.localeCompare(right.candidate.signature);
    });

  return ranked[0]?.candidate ?? null;
};

const ensureAiLookRateLimitTable = async (): Promise<void> => {
  if (!aiLookRateLimitTableReadyPromise) {
    aiLookRateLimitTableReadyPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS ai_look_rate_limits (
          bucket_key TEXT PRIMARY KEY,
          window_start_ms BIGINT NOT NULL,
          request_count INTEGER NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ai_look_rate_limits_updated_at_idx
        ON ai_look_rate_limits (updated_at);
      `;
    })();
  }

  try {
    await aiLookRateLimitTableReadyPromise;
  } catch (error) {
    aiLookRateLimitTableReadyPromise = null;
    throw error;
  }
};

const incrementPersistentRateLimitBucket = async ({
  bucketKey,
  windowMs,
  maxRequests,
}: {
  bucketKey: string;
  windowMs: number;
  maxRequests: number;
}): Promise<boolean> => {
  const nowMs = Date.now();
  const resetThresholdMs = nowMs - windowMs;

  const result = await sql`
    INSERT INTO ai_look_rate_limits (bucket_key, window_start_ms, request_count, updated_at)
    VALUES (${bucketKey}, ${nowMs}, 1, NOW())
    ON CONFLICT (bucket_key) DO UPDATE
    SET
      request_count = CASE
        WHEN ai_look_rate_limits.window_start_ms <= ${resetThresholdMs} THEN 1
        ELSE ai_look_rate_limits.request_count + 1
      END,
      window_start_ms = CASE
        WHEN ai_look_rate_limits.window_start_ms <= ${resetThresholdMs} THEN ${nowMs}
        ELSE ai_look_rate_limits.window_start_ms
      END,
      updated_at = NOW()
    RETURNING request_count;
  ` as Array<{ request_count: number | string }>;

  const requestCount = Number(result[0]?.request_count ?? 0);
  return requestCount > maxRequests;
};

const isRateLimitedInMemory = ({
  bucketKey,
  windowMs,
  maxRequests,
}: {
  bucketKey: string;
  windowMs: number;
  maxRequests: number;
}): boolean => {
  const now = Date.now();
  const existing = aiLookInMemoryRateLimit.get(bucketKey);

  if (!existing) {
    aiLookInMemoryRateLimit.set(bucketKey, { count: 1, windowStart: now });
    return false;
  }

  if (now - existing.windowStart > windowMs) {
    aiLookInMemoryRateLimit.set(bucketKey, { count: 1, windowStart: now });
    return false;
  }

  if (existing.count >= maxRequests) {
    return true;
  }

  aiLookInMemoryRateLimit.set(bucketKey, {
    count: existing.count + 1,
    windowStart: existing.windowStart,
  });
  return false;
};

const isRateLimited = async (baseKey: string): Promise<boolean> => {
  const minuteKey = `${baseKey}:1m`;
  const hourKey = `${baseKey}:1h`;

  try {
    await ensureAiLookRateLimitTable();

    const minuteLimited = await incrementPersistentRateLimitBucket({
      bucketKey: minuteKey,
      windowMs: AI_LOOK_MINUTE_WINDOW_MS,
      maxRequests: AI_LOOK_MAX_REQUESTS_PER_MINUTE,
    });
    if (minuteLimited) return true;

    return incrementPersistentRateLimitBucket({
      bucketKey: hourKey,
      windowMs: AI_LOOK_HOUR_WINDOW_MS,
      maxRequests: AI_LOOK_MAX_REQUESTS_PER_HOUR,
    });
  } catch (error) {
    if (!hasLoggedRateLimitFallback) {
      console.warn("Persistent AI look rate limiter unavailable; using in-memory fallback.", error);
      hasLoggedRateLimitFallback = true;
    }

    const minuteLimited = isRateLimitedInMemory({
      bucketKey: minuteKey,
      windowMs: AI_LOOK_MINUTE_WINDOW_MS,
      maxRequests: AI_LOOK_MAX_REQUESTS_PER_MINUTE,
    });
    if (minuteLimited) return true;

    return isRateLimitedInMemory({
      bucketKey: hourKey,
      windowMs: AI_LOOK_HOUR_WINDOW_MS,
      maxRequests: AI_LOOK_MAX_REQUESTS_PER_HOUR,
    });
  }
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
    const parsedTravelBody = travelRequestSchema.safeParse(rawBody);
    const parsedSingleBody = singleLookRequestSchema.safeParse(rawBody);
    if (!parsedTravelBody.success && !parsedSingleBody.success) {
      return NextResponse.json({ error: "Invalid AI look payload." }, { status: 400 });
    }

    const ownerRateLimitKey = `owner:${process.env.EDITOR_OWNER_EMAIL?.toLowerCase() || "owner"}`;
    if (await isRateLimited(ownerRateLimitKey)) {
      return NextResponse.json(
        { error: "Too many AI look requests. Please wait and try again." },
        { status: 429 }
      );
    }

    const wardrobeData = await getWardrobeData({ forceFresh: true });

    if (wardrobeData.length === 0) {
      return NextResponse.json({ error: "Wardrobe is empty. Add garments first." }, { status: 400 });
    }

    const systemPrompt = await readFile(
      path.join(process.cwd(), "app", "api", "ai-look", "prompt.md"),
      "utf-8"
    );
    const compactWardrobe: CompactGarment[] = wardrobeData.map((garment) => ({
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

    if (parsedTravelBody.success) {
      const { destination, startDate, endDate, reason } = parsedTravelBody.data;
      const requestedDates = enumerateDateRange(startDate, endDate);
      if (requestedDates.length === 0) {
        return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
      }
      if (requestedDates.length > MAX_TRAVEL_PLAN_DAYS) {
        return NextResponse.json(
          { error: `Travel range too large. Maximum supported range is ${MAX_TRAVEL_PLAN_DAYS} days.` },
          { status: 400 }
        );
      }

      const timeAllDay = findCanonicalOption(TIME_OPTIONS, "all day");
      const weatherByDate = await fetchTravelWeatherByDateRange(destination, requestedDates);
      const reasonIntent = resolveTravelReasonIntent(reason);
      const destinationHasBeachSignal = destinationLooksBeachFriendly(weatherByDate.locationLabel);
      const travelRequestFingerprint = buildTravelRequestFingerprint({
        destinationLabel: weatherByDate.locationLabel,
        reason,
        startDate,
        endDate,
      });
      let historicalTravelDays: TravelDayHistoryEntry[] = [];
      try {
        historicalTravelDays = await getTravelDayHistoryForRequest({
          ownerKey: ownerRateLimitKey,
          requestFingerprint: travelRequestFingerprint,
        });
      } catch (error) {
        console.warn("[ai-look][travel][history][read-failed]", error);
      }
      const historicalTravelDaysByDate = new Map<string, TravelDayHistoryEntry[]>();
      for (const entry of historicalTravelDays) {
        const bucket = historicalTravelDaysByDate.get(entry.dayDate) ?? [];
        bucket.push(entry);
        historicalTravelDaysByDate.set(entry.dayDate, bucket);
      }
      console.info(
        "[ai-look][travel][history][loaded]",
        JSON.stringify({
          requestFingerprint: travelRequestFingerprint,
          rows: historicalTravelDays.length,
          distinctDates: historicalTravelDaysByDate.size,
        })
      );

      const garmentById = new Map(wardrobeData.map((garment) => [garment.id, garment]));
      const garmentCategoryById = new Map(
        wardrobeData.map((garment) => [garment.id, categorizeType(garment.type)])
      );
      const usedGarmentIds = new Set<number>();
      const usedLookSignatures = new Set<string>();
      const recentLookHistory: Array<{ date: string; ids: number[] }> = [];
      const transitReservedIds = new Set<number>();
      const footwearGarmentIds = wardrobeData
        .filter((garment) => categorizeType(garment.type) === "footwear")
        .map((garment) => garment.id);
      const outerwearGarmentIds = wardrobeData
        .filter((garment) => categorizeType(garment.type) === "outerwear")
        .map((garment) => garment.id);
      let lockedFootwearId: number | null = null;
      let lockedOuterwearId: number | null = null;
      const transitPlace = findCanonicalOption(PLACE_OPTIONS, "Transit Hub / Airport");
      const transitOccasion = findCanonicalOption(OCCASION_OPTIONS, "Active Transit / Commuting");
      const officePlace = findCanonicalOption(PLACE_OPTIONS, "Office / Boardroom");
      const workshopPlace = findCanonicalOption(PLACE_OPTIONS, "Workshop");
      const atelierPlace = findCanonicalOption(PLACE_OPTIONS, "Creative Studio / Atelier");
      const cityPlace = findCanonicalOption(PLACE_OPTIONS, "Metropolitan / City");
      const beachPlace = findCanonicalOption(PLACE_OPTIONS, "Coastal / Beach");
      const activeOccasion = findCanonicalOption(OCCASION_OPTIONS, "Active Rugged / Field Sports");
      const commuteOccasion = findCanonicalOption(OCCASION_OPTIONS, "Active Transit / Commuting");
      const casualOccasion = findCanonicalOption(OCCASION_OPTIONS, "Casual Social");
      const dateNightOccasion = findCanonicalOption(OCCASION_OPTIONS, "Date Night / Intimate Dinner");
      const outdoorSocialOccasion = findCanonicalOption(OCCASION_OPTIONS, "Outdoor Social / Garden Party");
      const businessOccasion = findCanonicalOption(OCCASION_OPTIONS, "Business Formal");

      const buildStrictConstraintsForDay = (
        dayWeather: TravelDayWeather,
        dayIndex: number
      ): { strictConstraints: StrictDayConstraints; isTravelDay: boolean } => {
        const isTravelDay = dayIndex === 0 || dayIndex === weatherByDate.days.length - 1;
        const isWarmDay = dayWeather.weather.some((weatherTag) => {
          const key = normalize(weatherTag).toLowerCase();
          return key === "warm" || key === "hot";
        });

        let strictConstraints: StrictDayConstraints;
        if (isTravelDay) {
          strictConstraints = {
            requiredPlaces: [transitPlace].filter((v): v is string => Boolean(v)),
            requiredOccasions: [transitOccasion].filter((v): v is string => Boolean(v)),
            label: "Travel day (airport/transit)",
          };
        } else if (reason === "Office") {
          strictConstraints = {
            requiredPlaces: [officePlace, workshopPlace, atelierPlace, cityPlace].filter((v): v is string => Boolean(v)),
            requiredOccasions: [casualOccasion, dateNightOccasion, outdoorSocialOccasion].filter((v): v is string => Boolean(v)),
            label: "Office day",
          };
        } else if (reason === "Customer visit") {
          strictConstraints = {
            requiredPlaces: [officePlace].filter((v): v is string => Boolean(v)),
            requiredOccasions: [businessOccasion].filter((v): v is string => Boolean(v)),
            label: "Customer visit day",
          };
        } else {
          strictConstraints = {
            requiredPlaces: [
              cityPlace,
              destinationHasBeachSignal && isWarmDay ? beachPlace : null,
            ].filter((v): v is string => Boolean(v)),
            requiredOccasions: [activeOccasion, commuteOccasion, casualOccasion].filter((v): v is string => Boolean(v)),
            label: destinationHasBeachSignal && isWarmDay
              ? "Vacation day (city/active/beach)"
              : "Vacation day (city/active)",
          };
        }

        return { strictConstraints, isTravelDay };
      };

      const dayConstraintPlans = weatherByDate.days.map((dayWeather, dayIndex) => {
        const { strictConstraints, isTravelDay } = buildStrictConstraintsForDay(dayWeather, dayIndex);
        return {
          dayIndex,
          date: dayWeather.date,
          isTravelDay,
          strictConstraints,
          weatherTags: toCanonicalValues(dayWeather.weather, WEATHER_OPTIONS),
        };
      });

      if (outerwearGarmentIds.length === 0) {
        return NextResponse.json(
          { error: "Cannot build travel pack: no outerwear (jacket/coat) available in wardrobe." },
          { status: 422 }
        );
      }

      const tripWideOuterwearCandidates = compactWardrobe
        .filter((garment) => categorizeType(garment.type) === "outerwear")
        .filter((garment) =>
          dayConstraintPlans.every((plan) => {
            const matchesPlace = hasAnyCanonicalMatch(garment.suitable_places ?? [], plan.strictConstraints.requiredPlaces);
            const matchesOccasion = hasAnyCanonicalMatch(garment.suitable_occasions ?? [], plan.strictConstraints.requiredOccasions);
            const matchesWeather =
              plan.weatherTags.length === 0 ||
              Boolean(intersectionMatches(garment.suitable_weather ?? [], plan.weatherTags, { allSeasonAlias: "all season" }));
            return matchesPlace && matchesOccasion && matchesWeather;
          })
        );

      if (tripWideOuterwearCandidates.length === 0) {
        return NextResponse.json(
          { error: "Cannot build travel pack with one outerwear: no single jacket/coat satisfies all days (weather/place/occasion)." },
          { status: 422 }
        );
      }

      tripWideOuterwearCandidates.sort((left, right) => {
        const leftScore =
          (left.favorite ? 6 : 0) +
          (reasonIntent.formality && normalize(left.formality).toLowerCase() === reasonIntent.formality.toLowerCase() ? 8 : 0) +
          (reasonIntent.style.some((style) => normalize(left.style).toLowerCase() === style.toLowerCase()) ? 8 : 0);
        const rightScore =
          (right.favorite ? 6 : 0) +
          (reasonIntent.formality && normalize(right.formality).toLowerCase() === reasonIntent.formality.toLowerCase() ? 8 : 0) +
          (reasonIntent.style.some((style) => normalize(right.style).toLowerCase() === style.toLowerCase()) ? 8 : 0);
        return rightScore - leftScore || left.id - right.id;
      });

      lockedOuterwearId = tripWideOuterwearCandidates[0]?.id ?? null;

      const days: Array<{
        date: string;
        lookName: string;
        lineup: Array<{ id: number; model: string; brand: string; type: string; file_name: string }>;
        rationale: string;
        confidence: number;
        modelConfidence: number;
        matchScore: number;
        weatherContext: string;
        weatherStatus: "forecast" | "seasonal" | "failed";
        reusedGarmentIds: number[];
        interpretedIntent: CanonicalIntent;
      }> = [];
      const skippedDays: Array<{ date: string; reason: string; weatherContext: string; weatherStatus: "forecast" | "seasonal" | "failed" }> = [];
      const travelDaysToPersist: Array<{ dayDate: string; dayIndex: number; signature: string; ids: number[] }> = [];

      for (let index = 0; index < weatherByDate.days.length; index += 1) {
        const dayWeather = weatherByDate.days[index];
        const dayPlan = dayConstraintPlans[index];
        const isTravelDay = dayPlan.isTravelDay;
        const dayOccasion = isTravelDay
          ? [transitOccasion].filter((v): v is string => Boolean(v))
          : reasonIntent.occasion;
        const dayPlace = isTravelDay
          ? [transitPlace].filter((v): v is string => Boolean(v))
          : reasonIntent.place;
        const fallbackDayIntent: CanonicalIntent = {
          weather: toCanonicalValues(dayWeather.weather, WEATHER_OPTIONS),
          occasion: dayOccasion,
          place: dayPlace,
          timeOfDay: timeAllDay ? [timeAllDay] : [],
          formality: reasonIntent.formality,
          style: reasonIntent.style,
          notes: isTravelDay
            ? `${reasonIntent.notes} This is a travel/commute day (airport/transit), prioritize mobility and comfort while staying context-appropriate. Destination: ${weatherByDate.locationLabel}.`
            : `${reasonIntent.notes} Destination: ${weatherByDate.locationLabel}.`,
        };
        const strictConstraints = dayPlan.strictConstraints;

        const eligibleWardrobe = compactWardrobe.filter((garment) => {
          const matchesPlace = hasAnyCanonicalMatch(garment.suitable_places ?? [], strictConstraints.requiredPlaces);
          const matchesOccasion = hasAnyCanonicalMatch(garment.suitable_occasions ?? [], strictConstraints.requiredOccasions);
          return matchesPlace && matchesOccasion;
        });
        const eligibleIdSet = new Set(eligibleWardrobe.map((garment) => garment.id));

        if (eligibleWardrobe.length < 4) {
          skippedDays.push({
            date: dayWeather.date,
            reason: `Not enough garments satisfy strict ${strictConstraints.label.toLowerCase()} place/occasion constraints.`,
            weatherContext: dayWeather.summary,
            weatherStatus: dayWeather.status,
          });
          continue;
        }

        const missingCoreInEligible = missingCoreSilhouetteCategoriesFromWardrobe(
          eligibleWardrobe,
          TRAVEL_REQUIRED_CATEGORIES
        );
        if (missingCoreInEligible.length > 0) {
          skippedDays.push({
            date: dayWeather.date,
            reason: `Strict ${strictConstraints.label.toLowerCase()} constraints do not include required ${missingCoreInEligible.join(", ")} garments for a full look.`,
            weatherContext: dayWeather.summary,
            weatherStatus: dayWeather.status,
          });
          continue;
        }

        let dayIntent: CanonicalIntent = fallbackDayIntent;
        try {
          const { output: interpretedTravelDayIntent } = await generateText({
            model: openai("gpt-4.1-mini"),
            output: Output.object({
              schema: intentSchema,
            }),
            temperature: 0.3,
            system: INTERPRETER_APPENDIX,
            prompt: [
              `Canonical options:\n${JSON.stringify(canonicalOptions)}`,
              `Travel planning request (structured):\n${JSON.stringify({
                destination: weatherByDate.locationLabel,
                reason,
                date: dayWeather.date,
                weatherContext: dayWeather.summary,
                isTravelDay,
                strictRequiredPlaces: strictConstraints.requiredPlaces,
                strictRequiredOccasions: strictConstraints.requiredOccasions,
              })}`,
              "Map this day to canonical intent arrays and concise notes.",
            ].join("\n\n"),
          });

          dayIntent = {
            weather: (() => {
              const interpretedWeather = toCanonicalValues(interpretedTravelDayIntent.weather, WEATHER_OPTIONS);
              if (interpretedWeather.length > 0) return interpretedWeather;
              return fallbackDayIntent.weather;
            })(),
            occasion: (() => {
              const merged = [
                ...strictConstraints.requiredOccasions,
                ...toCanonicalValues(interpretedTravelDayIntent.occasion, OCCASION_OPTIONS),
              ];
              return merged.length > 0 ? Array.from(new Set(merged)) : fallbackDayIntent.occasion;
            })(),
            place: (() => {
              const merged = [
                ...strictConstraints.requiredPlaces,
                ...toCanonicalValues(interpretedTravelDayIntent.place, PLACE_OPTIONS),
              ];
              return merged.length > 0 ? Array.from(new Set(merged)) : fallbackDayIntent.place;
            })(),
            timeOfDay: (() => {
              const interpretedTimes = toCanonicalValues(interpretedTravelDayIntent.timeOfDay, TIME_OPTIONS);
              return interpretedTimes.length > 0 ? interpretedTimes : fallbackDayIntent.timeOfDay;
            })(),
            formality:
              toCanonicalSingle(interpretedTravelDayIntent.formality ?? null, FORMALITY_OPTIONS) ??
              fallbackDayIntent.formality,
            style: (() => {
              const interpretedStyles = toCanonicalValues(interpretedTravelDayIntent.style, STYLE_OPTIONS);
              return interpretedStyles.length > 0 ? interpretedStyles : fallbackDayIntent.style;
            })(),
            notes: normalize(interpretedTravelDayIntent.notes) || fallbackDayIntent.notes,
          };
        } catch (error) {
          console.warn("Travel day intent interpretation fallback used:", error);
        }

        const recentHistory = recentLookHistory.slice(-3);
        const dayHistoricalRows = historicalTravelDaysByDate.get(dayWeather.date) ?? [];
        const historicalSignatures = new Set(
          dayHistoricalRows.map((row) => row.signature).filter(Boolean)
        );
        const historicalIdsByDay = dayHistoricalRows.map((row) => row.ids).filter((ids) => ids.length > 0);
        const historicalUsedIdSet = new Set(historicalIdsByDay.flatMap((ids) => ids));
        const recentUsedIds = Array.from(
          new Set([...recentHistory.flatMap((item) => item.ids), ...historicalUsedIdSet])
        );
        const promptWardrobe = buildTravelPromptWardrobe({
          eligibleWardrobe,
          dayIntent,
          usedGarmentIds,
          recentLookHistory,
          requiredIds: [
            ...(lockedOuterwearId != null ? [lockedOuterwearId] : []),
            ...(!isTravelDay && lockedFootwearId != null ? [lockedFootwearId] : []),
          ],
        });
        const promptWardrobeIdSet = new Set(promptWardrobe.map((garment) => garment.id));
        const hasHistoricalFreshPool =
          promptWardrobe.filter((garment) => !historicalUsedIdSet.has(garment.id)).length >= 6;
        if (dayHistoricalRows.length > 0) {
          console.info(
            "[ai-look][travel][history][day-loaded]",
            JSON.stringify({
              date: dayWeather.date,
              rows: dayHistoricalRows.length,
              signatures: historicalSignatures.size,
            })
          );
        }

        const forbiddenIdSet = new Set<number>();
        if (!isTravelDay) {
          transitReservedIds.forEach((id) => {
            if (lockedOuterwearId != null && id === lockedOuterwearId) return;
            forbiddenIdSet.add(id);
          });
        }
        const forbiddenGarmentIds = Array.from(forbiddenIdSet);
        const avoidGarmentIds = recentUsedIds;
        const blockedFootwearIds = isTravelDay || lockedFootwearId == null
          ? []
          : footwearGarmentIds.filter((id) => id !== lockedFootwearId);
        const blockedOuterwearIds = lockedOuterwearId == null
          ? []
          : outerwearGarmentIds.filter((id) => id !== lockedOuterwearId);

        const generateTravelDayLook = async (
          hardForbiddenIds: number[],
          forcedFootwearId: number | null,
          forcedOuterwearId: number | null,
          hardAvoidSignatures: string[],
          softAvoidIds: number[],
          includeRecentHistory: boolean
        ) => {
          const { object } = await generateObject({
            model: openai("gpt-4.1-mini"),
            schema: travelDayRecommendationSchema,
            temperature: 0.7,
            system: `${systemPrompt}\n\n${RECOMMENDER_APPENDIX}`,
            prompt: [
              `Travel plan for ${weatherByDate.locationLabel}.`,
              `Reason: ${reason}.`,
              `Date: ${dayWeather.date}.`,
              `Weather context: ${dayWeather.summary}`,
              `Canonical interpreted intent: ${JSON.stringify(dayIntent)}`,
              hardForbiddenIds.length > 0
                ? `STRICT RULE: Do NOT use any of these garment IDs for this day: ${JSON.stringify(hardForbiddenIds)}.`
                : "No strict forbidden garment IDs for this day.",
              blockedFootwearIds.length > 0
                ? `STRICT FOOTWEAR RULE: Do NOT use these footwear IDs: ${JSON.stringify(blockedFootwearIds)}.`
                : "No footwear IDs are blocked yet.",
              forcedFootwearId != null
                ? `STRICT FOOTWEAR RULE: If including footwear, use only footwear ID ${forcedFootwearId}.`
                : "FOOTWEAR RULE: Use at most one footwear item in this look.",
              blockedOuterwearIds.length > 0
                ? `STRICT OUTERWEAR RULE: Do NOT use these outerwear IDs: ${JSON.stringify(blockedOuterwearIds)}.`
                : "No outerwear IDs are blocked.",
              forcedOuterwearId != null
                ? `STRICT OUTERWEAR RULE: Use outerwear ID ${forcedOuterwearId} and do not use any other outerwear ID.`
                : "OUTERWEAR RULE: Use exactly one outerwear item in this look.",
              hardAvoidSignatures.length > 0
                ? `HARD DIVERSITY RULE: Avoid these exact lineup signatures for this same travel day when alternatives exist: ${JSON.stringify(hardAvoidSignatures)}.`
                : "No historical day-signatures to hard avoid.",
              softAvoidIds.length > 0
                ? `SOFT RULE: Minimize repeated garments from this list when possible: ${JSON.stringify(softAvoidIds)}.`
                : "No soft repeat-avoid constraints.",
              includeRecentHistory && recentHistory.length > 0
                ? `RECENT LOOK HISTORY (avoid repeating full sets or high-overlap combos): ${JSON.stringify(recentHistory)}`
                : "No recent look history yet.",
              "REPEAT RULE: Only repeat an exact lineup if no other valid lineup exists.",
              "PACK RULE: Maximum one footwear pair across stay days (days between departure and return). Commute days are exempt.",
              "PACK RULE: Maximum one outerwear piece (jacket/coat) across the entire trip, including commute and stay days.",
              "PACK RULE: Commute-day reservation applies to stay days, except the single locked outerwear which must be reused across the whole trip.",
              isTravelDay
                ? "DAY RULE: This is a travel date. Outfit must be suitable for airport, travel, and commute."
                : "DAY RULE: This is a stay day. Optimize for the selected reason.",
              "SILHOUETTE RULE: Include at least one outerwear piece (jacket/coat), one top, one bottom, and one footwear item.",
              `STRICT PLACE RULE (every selected garment must match at least one): ${JSON.stringify(strictConstraints.requiredPlaces)}`,
              `STRICT OCCASION RULE (every selected garment must match at least one): ${JSON.stringify(strictConstraints.requiredOccasions)}`,
              `Wardrobe JSON: ${JSON.stringify(promptWardrobe)}`,
            ].join("\n\n"),
          });
          return object;
        };

        const enforceFootwearCap = (
          ids: number[],
          lockedId: number | null,
          useTripFootwearLock: boolean
        ): { ids: number[]; nextLockedId: number | null } => {
          const deduped = Array.from(new Set(ids.filter((id) => garmentById.has(id))));
          const footwearIds = deduped.filter((id) => garmentCategoryById.get(id) === "footwear");
          if (footwearIds.length <= 1) {
            if (useTripFootwearLock && lockedId == null && footwearIds.length === 1) {
              return { ids: deduped, nextLockedId: footwearIds[0] };
            }
            return { ids: deduped, nextLockedId: lockedId };
          }

          const chosenFootwearId = lockedId ?? footwearIds[0];
          const normalized = deduped.filter(
            (id) => garmentCategoryById.get(id) !== "footwear" || id === chosenFootwearId
          );
          return { ids: normalized, nextLockedId: useTripFootwearLock ? chosenFootwearId : lockedId };
        };

        const enforceOuterwearCap = (
          ids: number[],
          lockedId: number | null
        ): { ids: number[]; nextLockedId: number | null } => {
          const deduped = Array.from(new Set(ids.filter((id) => garmentById.has(id))));
          const outerwearIds = deduped.filter((id) => garmentCategoryById.get(id) === "outerwear");

          if (outerwearIds.length <= 1) {
            if (lockedId == null && outerwearIds.length === 1) {
              return { ids: deduped, nextLockedId: outerwearIds[0] };
            }
            if (lockedId != null && outerwearIds.length === 1 && outerwearIds[0] !== lockedId) {
              return {
                ids: deduped.filter((id) => garmentCategoryById.get(id) !== "outerwear" || id === lockedId),
                nextLockedId: lockedId,
              };
            }
            return { ids: deduped, nextLockedId: lockedId };
          }

          const chosenOuterwearId = lockedId ?? outerwearIds[0];
          const normalized = deduped.filter(
            (id) => garmentCategoryById.get(id) !== "outerwear" || id === chosenOuterwearId
          );
          return { ids: normalized, nextLockedId: chosenOuterwearId };
        };

        const enforceEligiblePool = (ids: number[]): number[] =>
          Array.from(
            new Set(ids.filter((id) => garmentById.has(id) && eligibleIdSet.has(id) && promptWardrobeIdSet.has(id)))
          );

        const normalizeTravelLineupIds = (
          ids: number[],
          footwearLockForAttempt: number | null,
          outerwearLockForAttempt: number | null
        ) => {
          let normalized = enforceEligiblePool(ids);
          const firstOuterwearPass = enforceOuterwearCap(normalized, outerwearLockForAttempt);
          normalized = firstOuterwearPass.ids;
          const resolvedOuterwearLock = firstOuterwearPass.nextLockedId;
          const firstFootwearPass = enforceFootwearCap(normalized, footwearLockForAttempt, !isTravelDay);
          normalized = firstFootwearPass.ids;
          const resolvedFootwearLock = firstFootwearPass.nextLockedId;
          const blockedIds = [...forbiddenGarmentIds, ...blockedFootwearIds, ...blockedOuterwearIds];

          normalized = enforceCoreSilhouetteFromPool({
            ids: normalized,
            pool: promptWardrobe,
            garmentCategoryById,
            usedGarmentIds,
            blockedIds,
            lockedFootwearId: resolvedFootwearLock,
            lockedOuterwearId: resolvedOuterwearLock,
            isTravelDay,
            intent: dayIntent,
            requiredCategories: TRAVEL_REQUIRED_CATEGORIES,
          });

          normalized = diversifyLineupFromPool({
            ids: normalized,
            pool: promptWardrobe,
            garmentCategoryById,
            usedGarmentIds,
            usedLookSignatures,
            recentLookHistory,
            avoidSignatures: historicalSignatures,
            avoidHistoryIds: historicalIdsByDay,
            blockedIds,
            lockedFootwearId: resolvedFootwearLock,
            lockedOuterwearId: resolvedOuterwearLock,
            isTravelDay,
            intent: dayIntent,
            requiredCategories: TRAVEL_REQUIRED_CATEGORIES,
          });

          const secondOuterwearPass = enforceOuterwearCap(normalized, resolvedOuterwearLock);
          normalized = secondOuterwearPass.ids;
          const secondFootwearPass = enforceFootwearCap(normalized, resolvedFootwearLock, !isTravelDay);
          return {
            ids: toTopDownOrderedIds(secondFootwearPass.ids, garmentCategoryById),
            nextLockedFootwearId: secondFootwearPass.nextLockedId,
            nextLockedOuterwearId: secondOuterwearPass.nextLockedId,
          };
        };

        const getFootwearIds = (ids: number[]) =>
          ids.filter((id) => garmentCategoryById.get(id) === "footwear");
        const getOuterwearIds = (ids: number[]) =>
          ids.filter((id) => garmentCategoryById.get(id) === "outerwear");

        const historicalSignatureList = Array.from(historicalSignatures).slice(0, 20);
        let generatedDay = await generateTravelDayLook(
          forbiddenGarmentIds,
          lockedFootwearId,
          lockedOuterwearId,
          historicalSignatureList,
          avoidGarmentIds,
          true
        );
        let normalizedGeneratedDay = normalizeTravelLineupIds(
          generatedDay.selectedGarmentIds,
          lockedFootwearId,
          lockedOuterwearId
        );
        let uniqueValidIds = normalizedGeneratedDay.ids;
        const provisionalLockedFootwearId = normalizedGeneratedDay.nextLockedFootwearId;
        const provisionalLockedOuterwearId = normalizedGeneratedDay.nextLockedOuterwearId;
        const firstPassFootwearIds = getFootwearIds(uniqueValidIds);
        const firstPassOuterwearIds = getOuterwearIds(uniqueValidIds);
        const firstPassViolatesFootwear =
          firstPassFootwearIds.length > 1 ||
          (lockedFootwearId != null && firstPassFootwearIds.some((id) => id !== lockedFootwearId));
        const firstPassViolatesOuterwear =
          firstPassOuterwearIds.length !== 1 ||
          (lockedOuterwearId != null && firstPassOuterwearIds.some((id) => id !== lockedOuterwearId));
        const firstPassSignature = lineupSignature(uniqueValidIds);
        const firstPassMissingCore = !hasCoreSilhouetteFromIds(
          uniqueValidIds,
          garmentCategoryById,
          TRAVEL_REQUIRED_CATEGORIES
        );
        const firstPassIsDuplicate = usedLookSignatures.has(firstPassSignature);
        const firstPassIsHistoricalDuplicate =
          hasHistoricalFreshPool && historicalSignatures.has(firstPassSignature);

        if (
          uniqueValidIds.length === 0 ||
          firstPassViolatesFootwear ||
          firstPassViolatesOuterwear ||
          firstPassMissingCore ||
          firstPassIsDuplicate ||
          firstPassIsHistoricalDuplicate
        ) {
          const retryFootwearId = !isTravelDay
            ? (provisionalLockedFootwearId ?? (firstPassFootwearIds.length > 0 ? firstPassFootwearIds[0] : null))
            : null;
          const retryOuterwearId = provisionalLockedOuterwearId ?? lockedOuterwearId;
          const diversityForbiddenIds = Array.from(new Set([
            ...forbiddenGarmentIds,
            ...recentUsedIds,
            ...uniqueValidIds,
          ]));
          if (firstPassIsHistoricalDuplicate) {
            console.info(
              "[ai-look][travel][history][retry-on-repeat]",
              JSON.stringify({
                date: dayWeather.date,
                signature: firstPassSignature,
              })
            );
          }
          generatedDay = await generateTravelDayLook(
            diversityForbiddenIds,
            retryFootwearId,
            retryOuterwearId,
            historicalSignatureList,
            avoidGarmentIds,
            true
          );
          normalizedGeneratedDay = normalizeTravelLineupIds(
            generatedDay.selectedGarmentIds,
            retryFootwearId,
            retryOuterwearId
          );
          uniqueValidIds = normalizedGeneratedDay.ids;
        }

        const hasWideFreshPool =
          promptWardrobe.filter((garment) => !recentUsedIds.includes(garment.id)).length >= 6;

        const computeDayViolations = (ids: number[]) => {
          const orderedIds = toTopDownOrderedIds(ids, garmentCategoryById);
          const footwearIds = getFootwearIds(orderedIds);
          const outerwearIds = getOuterwearIds(orderedIds);
          const violatesFootwearRule =
            footwearIds.length > 1 ||
            (!isTravelDay && lockedFootwearId != null && footwearIds.some((id) => id !== lockedFootwearId));
          const violatesOuterwearRule =
            outerwearIds.length !== 1 ||
            (lockedOuterwearId != null && outerwearIds.some((id) => id !== lockedOuterwearId));
          const violatesTransitReserveRule = !isTravelDay && orderedIds.some((id) =>
            transitReservedIds.has(id) && !(lockedOuterwearId != null && id === lockedOuterwearId)
          );
          const violatesPlaceRule = orderedIds.some((id) => {
            const garment = garmentById.get(id);
            if (!garment) return true;
            return !hasAnyCanonicalMatch(garment.suitable_places ?? [], strictConstraints.requiredPlaces);
          });
          const violatesOccasionRule = orderedIds.some((id) => {
            const garment = garmentById.get(id);
            if (!garment) return true;
            return !hasAnyCanonicalMatch(garment.suitable_occasions ?? [], strictConstraints.requiredOccasions);
          });
          const violatesCoreSilhouette = !hasCoreSilhouetteFromIds(
            orderedIds,
            garmentCategoryById,
            TRAVEL_REQUIRED_CATEGORIES
          );
          const signature = lineupSignature(orderedIds);
          const violatesDuplicateLookRule = hasWideFreshPool && usedLookSignatures.has(signature);
          const overlap = maxOverlapAgainstHistory(orderedIds, recentHistory.map((item) => item.ids));
          const violatesHighOverlapRule = hasWideFreshPool && overlap > MAX_ALLOWED_OVERLAP_RATIO;
          const violatesHistoricalRepeatRule =
            hasHistoricalFreshPool && historicalSignatures.has(signature);
          const historicalOverlap = historicalIdsByDay.length > 0
            ? maxOverlapAgainstHistory(orderedIds, historicalIdsByDay)
            : 0;

          return {
            orderedIds,
            footwearIds,
            outerwearIds,
            signature,
            violatesFootwearRule,
            violatesOuterwearRule,
            violatesTransitReserveRule,
            violatesPlaceRule,
            violatesOccasionRule,
            violatesCoreSilhouette,
            violatesDuplicateLookRule,
            violatesHighOverlapRule,
            violatesHistoricalRepeatRule,
            historicalOverlap,
          };
        };

        let {
          orderedIds,
          footwearIds,
          outerwearIds,
          signature,
          violatesFootwearRule,
          violatesOuterwearRule,
          violatesTransitReserveRule,
          violatesPlaceRule,
          violatesOccasionRule,
          violatesCoreSilhouette,
          violatesDuplicateLookRule,
          violatesHighOverlapRule,
          violatesHistoricalRepeatRule,
          historicalOverlap,
        } = computeDayViolations(uniqueValidIds);

        // Graceful fallback: if diversity pressure yields an invalid silhouette,
        // retry once with relaxed diversity hints while preserving strict day rules.
        if (
          orderedIds.length === 0 ||
          violatesFootwearRule ||
          violatesOuterwearRule ||
          violatesCoreSilhouette
        ) {
          try {
            const relaxedGeneratedDay = await generateTravelDayLook(
              forbiddenGarmentIds,
              lockedFootwearId,
              lockedOuterwearId,
              [],
              [],
              false
            );
            const relaxedNormalized = normalizeTravelLineupIds(
              relaxedGeneratedDay.selectedGarmentIds,
              lockedFootwearId,
              lockedOuterwearId
            );
            ({
              orderedIds,
              footwearIds,
              outerwearIds,
              signature,
              violatesFootwearRule,
              violatesOuterwearRule,
              violatesTransitReserveRule,
              violatesPlaceRule,
              violatesOccasionRule,
              violatesCoreSilhouette,
              violatesDuplicateLookRule,
              violatesHighOverlapRule,
              violatesHistoricalRepeatRule,
              historicalOverlap,
            } = computeDayViolations(relaxedNormalized.ids));
            generatedDay = relaxedGeneratedDay;
            console.info(
              "[ai-look][travel][fallback][relaxed-diversity-attempted]",
              JSON.stringify({
                date: dayWeather.date,
                signature,
                resolvedCoreSilhouette: !violatesCoreSilhouette,
              })
            );
          } catch (error) {
            console.warn("[ai-look][travel][fallback][relaxed-diversity-failed]", error);
          }
        }

        const hasStrictDayViolation =
          orderedIds.length === 0 ||
          violatesFootwearRule ||
          violatesOuterwearRule ||
          violatesTransitReserveRule ||
          violatesPlaceRule ||
          violatesOccasionRule ||
          violatesCoreSilhouette ||
          violatesDuplicateLookRule ||
          violatesHighOverlapRule;

        if (violatesHistoricalRepeatRule && !hasStrictDayViolation) {
          console.info(
            "[ai-look][travel][history][repeat-allowed]",
            JSON.stringify({
              date: dayWeather.date,
              signature,
              historicalOverlap,
            })
          );
          violatesHistoricalRepeatRule = false;
        }

        if (
          orderedIds.length === 0 ||
          violatesFootwearRule ||
          violatesOuterwearRule ||
          violatesTransitReserveRule ||
          violatesPlaceRule ||
          violatesOccasionRule ||
          violatesCoreSilhouette ||
          violatesDuplicateLookRule ||
          violatesHighOverlapRule ||
          violatesHistoricalRepeatRule
        ) {
          skippedDays.push({
            date: dayWeather.date,
            reason: orderedIds.length === 0
              ? "No valid garment combination returned for this day."
              : violatesFootwearRule
                ? "Could not satisfy footwear packing rules (max one pair across trip)."
                : violatesOuterwearRule
                  ? "Could not satisfy one-outerwear packing rule for the whole trip."
                : violatesTransitReserveRule
                  ? "Could not satisfy commute-reserve rule (travel-day garments cannot be reused on stay days)."
                  : violatesCoreSilhouette
                    ? "Could not produce a complete travel look (jacket/coat, top, bottom, footwear)."
                    : violatesDuplicateLookRule || violatesHighOverlapRule
                      ? "Could not generate a sufficiently distinct look from previous days under current constraints."
                      : violatesHistoricalRepeatRule
                        ? "Could not generate a sufficiently distinct look from previous identical travel runs under current constraints."
                      : violatesPlaceRule || violatesOccasionRule
                        ? `Could not satisfy strict ${strictConstraints.label.toLowerCase()} place/occasion constraints.`
                        : "Could not satisfy day constraints.",
            weatherContext: dayWeather.summary,
            weatherStatus: dayWeather.status,
          });
          continue;
        }

        const lineupGarments = orderedIds.map((id) => garmentById.get(id)!).filter(Boolean);
        const reusedGarmentIds = orderedIds.filter((id) => usedGarmentIds.has(id));
        const lineup = lineupGarments.map((garment) => ({
          id: garment.id,
          model: garment.model,
          brand: garment.brand,
          type: garment.type,
          file_name: garment.file_name,
        }));

        const matchScore = computeObjectiveMatchScore(lineupGarments, dayIntent);
        const modelConfidence = Math.round(generatedDay.modelConfidence);
        const confidence = Math.max(
          20,
          Math.min(100, Math.round((modelConfidence * 0.3) + (matchScore * 0.7)))
        );

        if (!isTravelDay && lockedFootwearId == null && footwearIds.length === 1) {
          lockedFootwearId = footwearIds[0];
        }
        if (lockedOuterwearId == null && outerwearIds.length === 1) {
          lockedOuterwearId = outerwearIds[0];
        }

        if (isTravelDay) {
          orderedIds.forEach((id) => {
            if (lockedOuterwearId != null && id === lockedOuterwearId) return;
            transitReservedIds.add(id);
          });
        }

        orderedIds.forEach((id) => {
          usedGarmentIds.add(id);
        });
        usedLookSignatures.add(signature);
        recentLookHistory.push({ date: dayWeather.date, ids: orderedIds });
        if (recentLookHistory.length > MAX_RECENT_LOOK_HISTORY) {
          recentLookHistory.shift();
        }
        travelDaysToPersist.push({
          dayDate: dayWeather.date,
          dayIndex: index,
          signature,
          ids: orderedIds,
        });
        console.info(
          "[ai-look][travel][day-selected]",
          JSON.stringify({
            date: dayWeather.date,
            signature,
            repeatedFromHistory: historicalSignatures.has(signature),
            historicalOverlap,
          })
        );
        days.push({
          date: dayWeather.date,
          lookName: generatedDay.lookName,
          lineup,
          rationale: buildAlignedRationale({
            lineupGarments,
            intent: dayIntent,
            weatherContext: dayWeather.summary,
            contextLabel: `travel day in ${weatherByDate.locationLabel}`,
          }),
          confidence,
          modelConfidence,
          matchScore,
          weatherContext: dayWeather.summary,
          weatherStatus: dayWeather.status,
          reusedGarmentIds,
          interpretedIntent: dayIntent,
        });
      }

      if (travelDaysToPersist.length > 0) {
        try {
          await persistTravelDayHistory({
            ownerKey: ownerRateLimitKey,
            requestFingerprint: travelRequestFingerprint,
            destinationLabel: weatherByDate.locationLabel,
            reason,
            days: travelDaysToPersist,
          });
          console.info(
            "[ai-look][travel][history][persisted]",
            JSON.stringify({
              requestFingerprint: travelRequestFingerprint,
              rows: travelDaysToPersist.length,
            })
          );
        } catch (error) {
          console.warn("[ai-look][travel][history][write-failed]", error);
        }
      }

      return NextResponse.json({
        mode: "travel",
        destination: weatherByDate.locationLabel,
        reason,
        startDate,
        endDate,
        days,
        skippedDays,
        summary: {
          requestedDays: requestedDates.length,
          generatedLooks: days.length,
          skippedDays: skippedDays.length,
        },
      });
    }

    if (!parsedSingleBody.success) {
      return NextResponse.json({ error: "Invalid prompt payload." }, { status: 400 });
    }

    const userPrompt = parsedSingleBody.data.prompt;
    const requestedAnchorGarmentId = parsedSingleBody.data.anchorGarmentId ?? null;
    const requestedAnchorMode: AnchorMode = parsedSingleBody.data.anchorMode ?? "strict";

    const { output: interpreted, toolResults } = await generateText({
      model: openai("gpt-4.1-mini"),
      output: Output.object({
        schema: intentSchema,
      }),
      tools: {
        getWeatherByLocation: tool({
          description: "Fetch weather summary for a location. Use when user mentions a city, region, country, or place.",
          inputSchema: WEATHER_TOOL_INPUT_SCHEMA,
          execute: async ({ locationQuery }) => {
            const weather = await fetchWeatherContext(locationQuery);
            return {
              found: Boolean(weather),
              locationLabel: weather?.locationLabel ?? "",
              summary: weather?.summary ?? "",
              weather: weather?.weather ?? [],
            };
          },
        }),
      },
      stopWhen: stepCountIs(6),
      temperature: 0.3,
      system: INTERPRETER_APPENDIX,
      prompt: `Canonical options:\n${JSON.stringify(canonicalOptions)}\n\nUser request:\n${userPrompt}`,
    });
    console.info("[ai-look][single][step-1][interpreted-intent]", JSON.stringify(interpreted));

    const latestWeatherToolResult = [...toolResults]
      .reverse()
      .find((result) => result.type === "tool-result" && result.toolName === "getWeatherByLocation");
    const weatherOutput =
      latestWeatherToolResult && typeof latestWeatherToolResult.output === "object" && latestWeatherToolResult.output
        ? latestWeatherToolResult.output as { summary?: string; weather?: string[] }
        : null;
    let weatherContextSummary = normalize(weatherOutput?.summary);
    let resolvedWeatherTags = dedupeCanonicalWeather(weatherOutput?.weather ?? []);
    let weatherStatus: WeatherContextStatus = "not_requested";

    // Fallback: if first pass skipped tool call, force one when a location hint exists.
    const locationHint = extractLocationHintFromPrompt(userPrompt);
    if (locationHint) {
      weatherStatus = "location_detected";
    }

    if (!weatherContextSummary) {
      if (locationHint) {
        const fallbackWeather = await generateText({
          model: openai("gpt-4.1-mini"),
          tools: {
            getWeatherByLocation: tool({
              description: "Fetch weather summary for a location.",
              inputSchema: WEATHER_TOOL_INPUT_SCHEMA,
              execute: async ({ locationQuery }) => {
                const weather = await fetchWeatherContext(locationQuery);
                return {
                  found: Boolean(weather),
                  locationLabel: weather?.locationLabel ?? "",
                  summary: weather?.summary ?? "",
                  weather: weather?.weather ?? [],
                };
              },
            }),
          },
          toolChoice: { type: "tool", toolName: "getWeatherByLocation" },
          stopWhen: stepCountIs(2),
          prompt: `Get current weather for location "${locationHint}".`,
        });

        const fallbackToolResult = [...fallbackWeather.toolResults]
          .reverse()
          .find((result) => result.type === "tool-result" && result.toolName === "getWeatherByLocation");
        const fallbackOutput =
          fallbackToolResult && typeof fallbackToolResult.output === "object" && fallbackToolResult.output
            ? fallbackToolResult.output as { summary?: string; weather?: string[] }
            : null;
        weatherContextSummary = normalize(fallbackOutput?.summary);
        const fallbackWeatherTags = dedupeCanonicalWeather(fallbackOutput?.weather ?? []);
        if (fallbackWeatherTags.length > 0) {
          resolvedWeatherTags = fallbackWeatherTags;
        }
      }
    }

    // Final fallback: deterministic server-side fetch if tool path returned no weather.
    if (!weatherContextSummary && locationHint) {
      try {
        const directWeather = await fetchWeatherContext(locationHint);
        weatherContextSummary = normalize(directWeather?.summary);
        const directWeatherTags = dedupeCanonicalWeather(directWeather?.weather ?? []);
        if (directWeatherTags.length > 0) {
          resolvedWeatherTags = directWeatherTags;
        }
      } catch (error) {
        console.warn("Direct weather fallback failed:", error);
      }
    }

    if (weatherContextSummary) {
      weatherStatus = "fetched";
    } else if (locationHint) {
      weatherStatus = "failed";
    }

    const interpretedWeather = toCanonicalValues(interpreted.weather, WEATHER_OPTIONS);
    const canonicalWeather = resolvedWeatherTags.length > 0 ? resolvedWeatherTags : interpretedWeather;
    const interpretedNotes = normalize(interpreted.notes);
    const withoutUnavailableWeatherClaim = interpretedNotes
      .replace(/weather data[^.]*unavailable[^.]*\.?/i, "")
      .replace(/weather data[^.]*not available[^.]*\.?/i, "")
      .replace(/(current\s+)?weather\s+resolved[^.]*\.?/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const canonicalNotes = withoutUnavailableWeatherClaim || interpretedNotes;

    const canonicalIntent: CanonicalIntent = {
      weather: canonicalWeather,
      occasion: toCanonicalValues(interpreted.occasion, OCCASION_OPTIONS),
      place: toCanonicalValues(interpreted.place, PLACE_OPTIONS),
      timeOfDay: toCanonicalValues(interpreted.timeOfDay, TIME_OPTIONS),
      formality: toCanonicalSingle(interpreted.formality ?? null, FORMALITY_OPTIONS),
      style: toCanonicalValues(interpreted.style, STYLE_OPTIONS),
      notes: canonicalNotes,
    };
    console.info("[ai-look][single][step-1][canonical-intent]", JSON.stringify(canonicalIntent));

    const garmentById = new Map(wardrobeData.map((garment) => [garment.id, garment]));
    const garmentCategoryById = new Map(
      wardrobeData.map((garment) => [garment.id, categorizeType(garment.type)])
    );
    let effectiveAnchorGarmentId: number | null = requestedAnchorGarmentId;
    let effectiveAnchorMode: AnchorMode = requestedAnchorMode;
    let effectiveAnchorCategory: GarmentCategory | null = null;
    if (requestedAnchorGarmentId != null) {
      const anchorGarment = garmentById.get(requestedAnchorGarmentId);
      if (!anchorGarment) {
        return NextResponse.json(
          { error: `Anchored garment ${requestedAnchorGarmentId} was not found in your wardrobe.` },
          { status: 422 }
        );
      }
      const anchorCategory = garmentCategoryById.get(requestedAnchorGarmentId) ?? "other";
      const isAnchorCompatible = SINGLE_REQUIRED_CATEGORIES.includes(anchorCategory);
      if (!isAnchorCompatible && requestedAnchorMode === "strict") {
        return NextResponse.json(
          { error: `Strict anchor is not compatible with fixed look silhouette. Garment category: ${anchorCategory}.` },
          { status: 422 }
        );
      }
      if (!isAnchorCompatible && requestedAnchorMode === "soft") {
        effectiveAnchorGarmentId = null;
      } else {
        effectiveAnchorCategory = anchorCategory;
      }
    } else {
      effectiveAnchorMode = "soft";
    }
    console.info(
      "[ai-look][single][anchor][request]",
      JSON.stringify({
        requestedAnchorGarmentId,
        requestedAnchorMode,
        effectiveAnchorGarmentId,
        effectiveAnchorMode,
        effectiveAnchorCategory,
      })
    );
    const missingSingleCategories = missingCoreSilhouetteCategoriesFromWardrobe(
      compactWardrobe,
      SINGLE_REQUIRED_CATEGORIES
    );
    if (missingSingleCategories.length > 0) {
      return NextResponse.json(
        { error: `AI could not produce a complete look. Missing category data: ${missingSingleCategories.join(", ")}.` },
        { status: 422 }
      );
    }

    let recentSingleHistory: SingleLookHistoryEntry[] = [];
    try {
      recentSingleHistory = await getRecentSingleLookHistory(ownerRateLimitKey);
    } catch (error) {
      console.warn("[ai-look][single][history][read-failed]", error);
    }
    const recentSignatureSet = recentSignatureSetFromHistory(recentSingleHistory);
    const recentUsedIds = recentUsedIdSetFromHistory(recentSingleHistory);

    const collectedCandidates: SingleLookCandidate[] = [];
    const seenSignatures = new Set<string>();

    for (
      let attempt = 0;
      attempt < SINGLE_LOOK_MAX_GENERATION_ATTEMPTS &&
      collectedCandidates.length < SINGLE_LOOK_TARGET_CANDIDATES;
      attempt += 1
    ) {
      const remaining = SINGLE_LOOK_TARGET_CANDIDATES - collectedCandidates.length;
      try {
        const { object } = await generateObject({
          model: openai("gpt-4.1-mini"),
          schema: singleLookCandidateBatchSchema,
          temperature: 0.7,
          system: `${systemPrompt}\n\n${SINGLE_CANDIDATE_RECOMMENDER_APPENDIX}`,
          prompt: [
            `User request:\n${userPrompt}`,
            `Canonical interpreted intent:\n${JSON.stringify(canonicalIntent)}`,
            weatherContextSummary || "No external weather context available.",
            `Return up to ${remaining} distinct candidates in this round.`,
            recentSignatureSet.size > 0
              ? `HARD DIVERSITY RULE: Avoid exact lineup signatures from recent requests when alternatives exist: ${JSON.stringify(Array.from(recentSignatureSet).slice(0, 12))}`
              : "No recent signatures to avoid.",
            recentUsedIds.size > 0
              ? `SOFT NOVELTY RULE: Minimize garment reuse from these recently used IDs when alternatives exist: ${JSON.stringify(Array.from(recentUsedIds).slice(0, 40))}`
              : "No recent garment IDs to avoid.",
            effectiveAnchorGarmentId != null
              ? effectiveAnchorMode === "strict"
                ? `STRICT ANCHOR RULE: Every candidate must include garment ID ${effectiveAnchorGarmentId}.`
                : `SOFT ANCHOR RULE: Prefer including garment ID ${effectiveAnchorGarmentId} when possible.`
              : "No anchor garment requested.",
            seenSignatures.size > 0
              ? `Do not repeat lineup signatures from previous rounds: ${JSON.stringify(Array.from(seenSignatures))}`
              : "No previous candidate signatures yet.",
            "Each candidate must be a complete 4-piece silhouette (outerwear, top, bottom, footwear).",
            `Wardrobe JSON:\n${JSON.stringify(compactWardrobe)}`,
          ].join("\n\n"),
        });

        console.info(
          "[ai-look][single][step-2][candidates-generated]",
          JSON.stringify({
            attempt: attempt + 1,
            rawCandidates: object.candidates.length,
          })
        );

        for (const candidate of object.candidates) {
          const validated = toValidatedSingleLookCandidate({
            lookName: candidate.lookName,
            modelConfidence: candidate.modelConfidence,
            ids: candidate.selectedGarmentIds,
            intent: canonicalIntent,
            weatherContext: weatherContextSummary || null,
            recentUsedIds,
            anchorGarmentId: effectiveAnchorGarmentId,
            anchorMode: effectiveAnchorMode,
            compactWardrobe,
            garmentById,
            garmentCategoryById,
          });

          if (!validated) {
            console.info(
              "[ai-look][single][step-2][candidate-dropped]",
              JSON.stringify({ reason: "failed-validation-or-normalization" })
            );
            continue;
          }
          if (
            effectiveAnchorMode === "strict" &&
            effectiveAnchorGarmentId != null &&
            !validated.selectedGarmentIds.includes(effectiveAnchorGarmentId)
          ) {
            console.info(
              "[ai-look][single][anchor][candidate-dropped]",
              JSON.stringify({ reason: "missing-anchor-after-normalization" })
            );
            continue;
          }
          if (seenSignatures.has(validated.signature)) {
            console.info(
              "[ai-look][single][step-2][candidate-dropped]",
              JSON.stringify({ reason: "duplicate-signature", signature: validated.signature })
            );
            continue;
          }

          seenSignatures.add(validated.signature);
          collectedCandidates.push(validated);
          if (collectedCandidates.length >= SINGLE_LOOK_TARGET_CANDIDATES) break;
        }
      } catch (error) {
        console.warn(
          "[ai-look][single][step-2][candidate-generation-failed]",
          JSON.stringify({ attempt: attempt + 1 })
        );
        console.warn(error);
      }
    }

    console.info(
      "[ai-look][single][step-2][candidate-final-count]",
      JSON.stringify({
        attemptedTarget: SINGLE_LOOK_TARGET_CANDIDATES,
        finalValidCandidates: collectedCandidates.length,
        nonRepeatedCandidates: collectedCandidates.filter((candidate) => !recentSignatureSet.has(candidate.signature)).length,
      })
    );

    let selectedLook = chooseTopSingleLookCandidate({
      candidates: collectedCandidates,
      history: recentSingleHistory,
    });

    if (!selectedLook) {
      selectedLook = buildDeterministicSingleLookFallbackCandidate({
        intent: canonicalIntent,
        weatherContext: weatherContextSummary || null,
        recentUsedIds,
        avoidSignatures: recentSignatureSet,
        anchorGarmentId: effectiveAnchorGarmentId,
        anchorMode: effectiveAnchorMode,
        compactWardrobe,
        garmentById,
        garmentCategoryById,
      });
      if (selectedLook) {
        console.info(
          "[ai-look][single][step-2][fallback-used]",
          JSON.stringify({
            signature: selectedLook.signature,
            includedAnchor:
              effectiveAnchorGarmentId != null &&
              selectedLook.selectedGarmentIds.includes(effectiveAnchorGarmentId),
          })
        );
      }
    }

    if (!selectedLook) {
      return NextResponse.json(
        { error: "AI could not produce a complete look. Please refine your prompt." },
        { status: 422 }
      );
    }
    if (
      effectiveAnchorMode === "strict" &&
      effectiveAnchorGarmentId != null &&
      !selectedLook.selectedGarmentIds.includes(effectiveAnchorGarmentId)
    ) {
      return NextResponse.json(
        { error: "Could not produce a complete anchored look with current wardrobe constraints." },
        { status: 422 }
      );
    }

    console.info(
      "[ai-look][single][step-2][selected]",
      JSON.stringify({
        signature: selectedLook.signature,
        confidence: selectedLook.confidence,
        repeatedFromHistory: recentSignatureSet.has(selectedLook.signature),
        includedAnchor:
          effectiveAnchorGarmentId != null &&
          selectedLook.selectedGarmentIds.includes(effectiveAnchorGarmentId),
        rerankScore: computeSingleLookRerankScore({
          candidate: selectedLook,
          history: recentSingleHistory,
        }),
      })
    );

    try {
      await persistSingleLookHistory({
        ownerKey: ownerRateLimitKey,
        ids: selectedLook.selectedGarmentIds,
      });
    } catch (error) {
      console.warn("[ai-look][single][history][write-failed]", error);
    }

    return NextResponse.json({
      mode: "single",
      primaryLook: {
        lookName: selectedLook.lookName,
        lineup: selectedLook.lineupGarments.map((garment) => ({
          id: garment.id,
          model: garment.model,
          brand: garment.brand,
          type: garment.type,
          file_name: garment.file_name,
        })),
        rationale: selectedLook.rationale,
        confidence: selectedLook.confidence,
        modelConfidence: selectedLook.modelConfidence,
        matchScore: selectedLook.matchScore,
      },
      interpretedIntent: canonicalIntent,
      weatherContext: weatherContextSummary || null,
      weatherContextStatus: weatherStatus,
    });
  } catch (error) {
    console.error("Failed to generate AI look:", error);
    return NextResponse.json({ error: "Failed to generate look." }, { status: 500 });
  }
}
