import "server-only";

import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { getWardrobeData } from "@/lib/wardrobe";
import { sql } from "@/lib/db";
import type { Garment } from "@/lib/types";
import { getActiveStyleDirectiveCatalog, type StyleDirectiveCatalogEntry } from "@/lib/profile-styles";
import {
  getActiveReferenceDirectiveCatalog,
  type ReferenceDirectiveCatalogEntry,
} from "@/lib/profile-references";
import { canonicalizeFormalityOption, canonicalizeStyleTags } from "@/lib/style-taxonomy";
import { getUserProfileByOwnerKey } from "@/lib/user-profile";
import schema from "@/public/schema.json";

const singleSelectedToolSchema = z.object({
  type: z.enum(["style", "reference", "icon"]),
  id: z.string().trim().min(1).max(80),
}).strict();

const singleLookRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
  anchorGarmentId: z.coerce.number().int().positive().optional(),
  anchorMode: z.enum(["strict", "soft"]).optional(),
  selectedTools: z.array(singleSelectedToolSchema).max(8).optional(),
});

const travelRequestSchema = z.object({
  mode: z.literal("travel"),
  destination: z.string().trim().min(1, "Destination is required."),
  startDate: z.string().trim().min(1, "Start date is required."),
  endDate: z.string().trim().min(1, "End date is required."),
  reason: z.enum(["Vacation", "Office", "Customer visit"]),
});

const contextIntentSchema = z.object({
  weather: z.array(z.string()).max(4),
  occasion: z.array(z.string()).max(4),
  place: z.array(z.string()).max(4),
  timeOfDay: z.array(z.string()).max(3),
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

interface ContextIntent {
  weather: string[];
  occasion: string[];
  place: string[];
  timeOfDay: string[];
  notes: string;
}

type WeatherProfileTempBand = "cold" | "cool" | "mild" | "warm" | "hot";
type WeatherProfilePrecipitationLevel = "none" | "light" | "moderate" | "heavy";
type WeatherProfilePrecipitationType = "none" | "rain" | "snow" | "mixed";
type WeatherProfileWindBand = "calm" | "breezy" | "windy";
type WeatherProfileHumidityBand = "dry" | "normal" | "humid";
type WeatherProfileWetRisk = "low" | "medium" | "high";
type WeatherProfileConfidence = "high" | "medium" | "low";

interface WeatherProfile {
  tempBand: WeatherProfileTempBand;
  precipitationLevel: WeatherProfilePrecipitationLevel;
  precipitationType: WeatherProfilePrecipitationType;
  windBand: WeatherProfileWindBand;
  humidityBand: WeatherProfileHumidityBand;
  wetSurfaceRisk: WeatherProfileWetRisk;
  confidence: WeatherProfileConfidence;
}

interface DerivedProfile {
  formality: string | null;
  style: string[];
  materialTargets: {
    prefer: string[];
    avoid: string[];
  };
}

type DirectiveConfidence = "high" | "medium" | "low";
type SelectedToolType = "style" | "reference";
type SelectedToolInputType = SelectedToolType | "icon";

interface SingleSelectedTool {
  type: SelectedToolInputType;
  id: string;
}

interface NormalizedSelectedTool {
  type: SelectedToolType;
  id: string;
}

interface AppliedSelectedTool {
  type: SelectedToolType;
  id: string;
  applied: boolean;
  resolvedKey: string | null;
}

interface UserStyleDirective {
  key: string;
  sourceTerms: string[];
  canonicalStyleTags: string[];
  silhouetteBiasTags: string[];
  materialBias: {
    prefer: string[];
    avoid: string[];
  };
  formalityBias: string | null;
  confidence: DirectiveConfidence;
}

interface UserReferenceDirective {
  referenceKey: string;
  sourceTerms: string[];
  styleBiasTags: string[];
  silhouetteBiasTags: string[];
  materialBias: {
    prefer: string[];
    avoid: string[];
  };
  formalityBias: string | null;
  confidence: DirectiveConfidence;
}

interface UserIntentDirectives {
  selectedTools: AppliedSelectedTool[];
  styleDirectives: UserStyleDirective[];
  referenceDirectives: UserReferenceDirective[];
  merged: {
    styleTagsPrefer: string[];
    silhouetteTagsPrefer: string[];
    materialPrefer: string[];
    materialAvoid: string[];
    formalityBias: string | null;
  };
}

interface WeatherContext {
  locationLabel: string;
  summary: string;
  weather: string[];
  weatherProfile: WeatherProfile;
}

interface TravelDayWeather {
  date: string;
  summary: string;
  weather: string[];
  weatherProfile: WeatherProfile;
  status: "forecast" | "seasonal" | "failed";
}

interface TravelReasonIntent {
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

interface TravelDayConstraintEnvelope {
  label: string;
  relaxationLevel:
    | "strict"
    | "travel_top_bottom_place"
    | "travel_top_bottom_place_occasion"
    | "travel_top_bottom_reason";
  defaultConstraints: StrictDayConstraints;
  categoryOverrides: Partial<Record<GarmentCategory, StrictDayConstraints>>;
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

type WeatherContextSource =
  | "none"
  | "model_tool"
  | "forced_tool"
  | "direct_fetch"
  | "forecast_api"
  | "llm_climate_fallback"
  | "seasonal_fallback";

type SingleTemporalTargetType = "current" | "single_date" | "date_range" | "unknown";
type SingleTemporalWeatherStatus = "current" | "forecast" | "seasonal" | "failed";

interface SingleTemporalTargetResolution {
  targetType: SingleTemporalTargetType;
  targetDate: string | null;
  targetRange: { startDate: string; endDate: string } | null;
  trigger: string | null;
  resolvedBy: "keyword" | "weekday" | "explicit_date" | "none";
}

interface SingleTemporalWeatherResolution {
  weatherContextSummary: string;
  weatherTags: string[];
  weatherProfile: WeatherProfile;
  source: Exclude<WeatherContextSource, "none" | "model_tool" | "forced_tool" | "direct_fetch">;
  status: SingleTemporalWeatherStatus;
}

type InMemoryRateLimitState = {
  count: number;
  windowStart: number;
};

const AI_LOOK_MINUTE_WINDOW_MS = 60 * 1000;
const AI_LOOK_HOUR_WINDOW_MS = 60 * 60 * 1000;
const AI_LOOK_MAX_REQUESTS_PER_MINUTE = 8;
const AI_LOOK_MAX_REQUESTS_PER_HOUR = 120;
const MAX_TRAVEL_PLAN_DAYS = 21;
const AI_LOOK_DEBUG = process.env.AI_LOOK_DEBUG === "1";
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
Map natural language to canonical context filters.

Rules:
- Use only canonical values from the provided option lists.
- If the user mentions a city/region/country/place, call the tool getWeatherByLocation.
- Return only context dimensions: weather, occasion, place, and timeOfDay (plus concise notes).
- Do not infer or output style/formality directly; those are derived server-side from context.
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

const stripWeatherStatusClaims = (value: string): string =>
  normalize(value)
    .replace(/\b(current\s+)?weather\s+(resolved|considered)[^.]*\.?/gi, "")
    .replace(/\bweather(?:\s+data)?[^.]*\b(unavailable|not\s+available|not\s+found|failed|could\s+not\s+be\s+(?:retrieved|resolved))\b[^.]*\.?/gi, "")
    .replace(/\bassuming[^.]*weather[^.]*\.?/gi, "")
    .replace(/\bno\s+specific\s+(?:city|location|weather)[^.]*\.?/gi, "")
    .replace(/\bif\s+you\s+want[^.]*\b(?:weather|forecast|city|colder|hotter)[^.]*\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const stripStyleDirectiveDisclaimers = (value: string): string =>
  normalize(value)
    .replace(
      /\b[a-z\s/-]*style\s+noted\s+but\s+not\s+(?:categorized|returned|output|included)[^.]*\.?/gi,
      ""
    )
    .replace(/\bas\s+per\s+instructions[^.]*\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const buildWeatherLocationQueryVariants = (locationQuery: string): string[] => {
  const base = normalize(locationQuery).replace(/\s+/g, " ").trim();
  if (!base) return [];

  const variants: string[] = [];
  const pushVariant = (candidate: string) => {
    const normalizedCandidate = normalize(candidate)
      .replace(/\s+,/g, ",")
      .replace(/,\s*,+/g, ", ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[,\-\s]+|[,\-\s]+$/g, "")
      .trim();
    if (!normalizedCandidate) return;
    if (variants.some((item) => item.toLowerCase() === normalizedCandidate.toLowerCase())) return;
    variants.push(normalizedCandidate);
  };

  pushVariant(base);
  pushVariant(base.replace(/\(([^)]+)\)/g, ", $1"));
  pushVariant(base.replace(/\([^)]*\)/g, ""));

  return variants.slice(0, 3);
};

const summarizeWeatherContext = (weatherContext: string): string => {
  const normalized = normalize(weatherContext);
  if (!normalized) return "";

  const noDirectForecastMatch = normalized.match(/^No direct forecast for\s+(\d{4}-\d{2}-\d{2})\s+in\s+([^\.]+)\./i);
  if (noDirectForecastMatch?.[1] && noDirectForecastMatch?.[2]) {
    const dateIso = normalize(noDirectForecastMatch[1]);
    const location = normalize(noDirectForecastMatch[2]);
    const remainder = normalize(
      normalized.replace(/^No direct forecast for\s+\d{4}-\d{2}-\d{2}\s+in\s+[^\.]+\.\s*/i, "")
    );
    const details = remainder || normalized;
    return toSentence(`Weather outlook for ${location} on ${dateIso}: ${details}`);
  }

  const datedForecastMatch = normalized.match(/^([^:]+)\s+on\s+(\d{4}-\d{2}-\d{2}):/i);
  const rangeForecastMatch = normalized.match(
    /^Weather context for\s+([^:]+)\s+from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2}):/i
  );

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
    if (rangeForecastMatch?.[1] && rangeForecastMatch?.[2] && rangeForecastMatch?.[3]) {
      return toSentence(
        `Weather outlook for ${normalize(rangeForecastMatch[1])} from ${normalize(rangeForecastMatch[2])} to ${normalize(rangeForecastMatch[3])}: ${normalized}`
      );
    }
    if (datedForecastMatch?.[1] && datedForecastMatch?.[2]) {
      return toSentence(
        `Weather outlook for ${normalize(datedForecastMatch[1])} on ${normalize(datedForecastMatch[2])}: ${normalized}`
      );
    }
    return toSentence(`Weather context considered: ${normalized}`);
  }

  const lead = rangeForecastMatch?.[1] && rangeForecastMatch?.[2] && rangeForecastMatch?.[3]
    ? `Weather outlook for ${normalize(rangeForecastMatch[1])} from ${normalize(rangeForecastMatch[2])} to ${normalize(rangeForecastMatch[3])}`
    : datedForecastMatch?.[1] && datedForecastMatch?.[2]
      ? `Weather for ${normalize(datedForecastMatch[1])} on ${normalize(datedForecastMatch[2])}`
      : location
        ? `Current weather in ${location}`
        : "Current weather";
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

  let normalizedNotes = stripWeatherStatusClaims(intent.notes);

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

  const isLikelyLocationHint = (value: string): boolean => {
    const normalized = normalize(value).replace(/\s+/g, " ");
    if (!normalized) return false;

    const lower = normalized.toLowerCase();
    if (/^(a|an|the)\s+/.test(lower)) return false;
    if (/\b(we|i|later|then|because|while|after)\b/.test(lower)) return false;
    if (!lower.includes(",") && lower.split(" ").length > 6) return false;

    return true;
  };

  const inMatch = text.match(
    /\bin\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]{0,80}?)(?=(?:\s+(?:and|but|then|later|because|while|after)\b|[.!?]|$))/i
  );
  if (inMatch?.[1] && isLikelyLocationHint(inMatch[1])) return inMatch[1].trim();

  const commaMatch = text.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]+,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]+)/);
  if (commaMatch?.[1] && isLikelyLocationHint(commaMatch[1])) return commaMatch[1].trim();

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

const toTempBand = (minTemp: number, maxTemp: number): WeatherProfileTempBand => {
  const avg = (minTemp + maxTemp) / 2;
  if (avg >= 30) return "hot";
  if (avg >= 24) return "warm";
  if (avg >= 16) return "mild";
  if (avg >= 8) return "cool";
  return "cold";
};

const inferPrecipitationProfile = (description: string): {
  type: WeatherProfilePrecipitationType;
  level: WeatherProfilePrecipitationLevel;
} => {
  const normalized = normalize(description).toLowerCase();
  if (!normalized) return { type: "none", level: "none" };

  const hasSnow = /\b(snow|snowy|sleet|hail|blizzard|flurr(y|ies)|ice|icy)\b/.test(normalized);
  const hasRain = /\b(rain|rainy|drizzle|drizzly|shower|showers|storm|stormy|thunder)\b/.test(normalized);
  const type: WeatherProfilePrecipitationType =
    hasSnow && hasRain ? "mixed" : hasSnow ? "snow" : hasRain ? "rain" : "none";

  if (type === "none") return { type, level: "none" };
  if (/\b(heavy|intense|severe|thunderstorm|storm)\b/.test(normalized)) {
    return { type, level: "heavy" };
  }
  if (/\b(moderate)\b/.test(normalized)) {
    return { type, level: "moderate" };
  }
  return { type, level: "light" };
};

const inferWindKmhFromDescription = (description: string): number | undefined => {
  const normalized = normalize(description).toLowerCase();
  if (!normalized) return undefined;
  if (/\b(gale|gales|storm|stormy|very windy|strong winds?)\b/.test(normalized)) return 38;
  if (/\b(windy|wind|gust|gusty|breezy|brisk)\b/.test(normalized)) return 28;
  return undefined;
};

const inferHumidityFromDescription = (description: string): number | undefined => {
  const normalized = normalize(description).toLowerCase();
  if (!normalized) return undefined;
  if (/\b(humid|damp|wet|rain|rainy|drizzle|shower|mist|fog|overcast)\b/.test(normalized)) return 80;
  return undefined;
};

const toWindBand = (windKmh: number | null): WeatherProfileWindBand => {
  if (typeof windKmh !== "number" || !Number.isFinite(windKmh)) return "calm";
  if (windKmh >= 28) return "windy";
  if (windKmh >= 12) return "breezy";
  return "calm";
};

const toHumidityBand = (humidity: number | undefined): WeatherProfileHumidityBand => {
  if (typeof humidity !== "number" || !Number.isFinite(humidity)) return "normal";
  if (humidity < 40) return "dry";
  if (humidity > 70) return "humid";
  return "normal";
};

const toWetSurfaceRisk = ({
  precipitationType,
  precipitationLevel,
  humidityBand,
  tempBand,
}: {
  precipitationType: WeatherProfilePrecipitationType;
  precipitationLevel: WeatherProfilePrecipitationLevel;
  humidityBand: WeatherProfileHumidityBand;
  tempBand: WeatherProfileTempBand;
}): WeatherProfileWetRisk => {
  if (precipitationLevel === "heavy" || precipitationType === "snow" || precipitationType === "mixed") {
    return "high";
  }
  if (precipitationLevel === "moderate") return "high";
  if (precipitationLevel === "light") return "medium";
  if (humidityBand === "humid" && (tempBand === "cold" || tempBand === "cool")) return "medium";
  return "low";
};

const buildWeatherProfile = ({
  minTemp,
  maxTemp,
  humidity,
  windKmh,
  description,
  confidence,
  fallbackWeather,
}: {
  minTemp?: number;
  maxTemp?: number;
  humidity?: number;
  windKmh?: number | null;
  description?: string;
  confidence: WeatherProfileConfidence;
  fallbackWeather?: string[];
}): WeatherProfile => {
  const safeMin = typeof minTemp === "number" ? minTemp : typeof maxTemp === "number" ? maxTemp : 16;
  const safeMax = typeof maxTemp === "number" ? maxTemp : typeof minTemp === "number" ? minTemp : 20;
  const tempBand = toTempBand(safeMin, safeMax);
  const precipFromDescription = inferPrecipitationProfile(description ?? "");

  const fallbackSet = new Set((fallbackWeather ?? []).map((item) => normalize(item).toLowerCase()));
  const precipitationType: WeatherProfilePrecipitationType = (() => {
    if (precipFromDescription.type !== "none") return precipFromDescription.type;
    if (fallbackSet.has("cold") && fallbackSet.has("mild")) return "mixed";
    return "none";
  })();
  const precipitationLevel: WeatherProfilePrecipitationLevel =
    precipFromDescription.level !== "none" ? precipFromDescription.level : "none";
  const inferredHumidity = typeof humidity === "number" && Number.isFinite(humidity)
    ? humidity
    : inferHumidityFromDescription(description ?? "");
  const inferredWindKmh = typeof windKmh === "number" && Number.isFinite(windKmh)
    ? windKmh
    : inferWindKmhFromDescription(description ?? "");
  const humidityBand = toHumidityBand(inferredHumidity);
  const windBand = toWindBand(typeof inferredWindKmh === "number" ? inferredWindKmh : null);
  const wetSurfaceRisk = toWetSurfaceRisk({
    precipitationType,
    precipitationLevel,
    humidityBand,
    tempBand,
  });

  return {
    tempBand,
    precipitationLevel,
    precipitationType,
    windBand,
    humidityBand,
    wetSurfaceRisk,
    confidence,
  };
};

const inferTempBandFromWeatherTags = (weatherTags: string[]): WeatherProfileTempBand => {
  const set = new Set(weatherTags.map((value) => normalize(value).toLowerCase()));
  if (set.has("hot")) return "hot";
  if (set.has("warm")) return "warm";
  if (set.has("mild")) return "mild";
  if (set.has("cool")) return "cool";
  if (set.has("cold")) return "cold";
  return "mild";
};

const buildFallbackWeatherProfile = ({
  weatherTags,
  summary,
  confidence,
}: {
  weatherTags: string[];
  summary?: string | null;
  confidence: WeatherProfileConfidence;
}): WeatherProfile => {
  const tempBand = inferTempBandFromWeatherTags(weatherTags);
  const tempRangeByBand: Record<WeatherProfileTempBand, [number, number]> = {
    cold: [2, 7],
    cool: [8, 15],
    mild: [16, 22],
    warm: [23, 29],
    hot: [30, 36],
  };
  const [minTemp, maxTemp] = tempRangeByBand[tempBand];

  return buildWeatherProfile({
    minTemp,
    maxTemp,
    description: normalize(summary ?? ""),
    confidence,
    fallbackWeather: weatherTags,
  });
};

async function fetchWeatherContext(locationQuery: string): Promise<WeatherContext | null> {
  const queryVariants = buildWeatherLocationQueryVariants(locationQuery);
  if (queryVariants.length === 0) return null;

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  for (const query of queryVariants) {
    const currentUrl = new URL("https://api.openweathermap.org/data/2.5/weather");
    currentUrl.searchParams.set("q", query);
    currentUrl.searchParams.set("units", "metric");
    currentUrl.searchParams.set("appid", apiKey);

    const currentResponse = await fetch(currentUrl.toString(), { cache: "no-store" });
    if (!currentResponse.ok) continue;

    const currentJson = await currentResponse.json() as {
      name?: string;
      sys?: { country?: string };
      dt?: number;
      weather?: Array<{ description?: string }>;
      main?: { temp?: number; feels_like?: number; temp_min?: number; temp_max?: number; humidity?: number };
      wind?: { speed?: number };
    };

    const dayDescription = normalize(currentJson.weather?.[0]?.description);
    const dayTempMin = currentJson.main?.temp_min;
    const dayTempMax = currentJson.main?.temp_max;
    const dayHumidity: number | undefined = currentJson.main?.humidity;
    const dayWindMs: number | undefined = currentJson.wind?.speed;

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

    const weatherProfile = buildWeatherProfile({
      minTemp: dayTempMin,
      maxTemp: dayTempMax,
      humidity: dayHumidity,
      windKmh,
      description: dayDescription,
      confidence: "high",
      fallbackWeather: weather,
    });

    return { locationLabel, summary, weather, weatherProfile };
  }

  return null;
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
          weatherProfile: llmFallback.weatherProfile,
          status: "seasonal",
        });
        continue;
      }

      days.push({
        date,
        summary: `Weather unavailable for ${date}; using destination and reason context only.`,
        weather: [],
        weatherProfile: buildFallbackWeatherProfile({
          weatherTags: [],
          summary: "",
          confidence: "low",
        }),
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
        weatherProfile: buildWeatherProfile({
          minTemp: min,
          maxTemp: max,
          humidity: humidities.length > 0
            ? humidities.reduce((a, b) => a + b, 0) / humidities.length
            : undefined,
          windKmh: winds.length > 0
            ? (winds.reduce((a, b) => a + b, 0) / winds.length) * 3.6
            : undefined,
          description,
          confidence: "high",
          fallbackWeather: weather,
        }),
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
        weatherProfile: llmFallback.weatherProfile,
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
      weatherProfile: buildFallbackWeatherProfile({
        weatherTags: seasonalWeather,
        summary: `Typical seasonal conditions for ${locationLabel} in month ${month + 1}.`,
        confidence: "low",
      }),
      status: "seasonal",
    });
  }

  return { locationLabel, days };
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const addUtcDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const sanitizeNaturalDatePhrase = (value: string): string =>
  normalize(value)
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

const parseExplicitDateFromPrompt = (prompt: string): string | null => {
  const isoMatch = normalize(prompt).match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) {
    const parsed = parseIsoDate(isoMatch[1]);
    if (parsed) return toIsoDate(parsed);
  }

  const naturalMatch = normalize(prompt).match(
    /\b(?:on\s+)?([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)\b/i
  );
  if (!naturalMatch?.[1]) return null;
  const sanitized = sanitizeNaturalDatePhrase(naturalMatch[1]);
  const parsedMillis = Date.parse(`${sanitized} UTC`);
  if (!Number.isFinite(parsedMillis)) return null;
  const parsed = new Date(parsedMillis);
  if (Number.isNaN(parsed.getTime())) return null;
  return toIsoDate(new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate()
  )));
};

const resolveSingleTemporalTargetFromPrompt = (
  prompt: string,
  now: Date = new Date()
): SingleTemporalTargetResolution => {
  const normalized = normalize(prompt).toLowerCase();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (!normalized) {
    return {
      targetType: "unknown",
      targetDate: null,
      targetRange: null,
      trigger: null,
      resolvedBy: "none",
    };
  }

  if (/\b(now|today|tonight)\b/.test(normalized)) {
    return {
      targetType: "current",
      targetDate: toIsoDate(today),
      targetRange: null,
      trigger: "today",
      resolvedBy: "keyword",
    };
  }

  if (/\btomorrow\b/.test(normalized)) {
    return {
      targetType: "single_date",
      targetDate: toIsoDate(addUtcDays(today, 1)),
      targetRange: null,
      trigger: "tomorrow",
      resolvedBy: "keyword",
    };
  }

  if (/\bnext week\b/.test(normalized)) {
    const currentWeekday = today.getUTCDay();
    const daysUntilNextMonday = ((1 - currentWeekday + 7) % 7) || 7;
    const start = addUtcDays(today, daysUntilNextMonday);
    const end = addUtcDays(start, 6);
    return {
      targetType: "date_range",
      targetDate: null,
      targetRange: {
        startDate: toIsoDate(start),
        endDate: toIsoDate(end),
      },
      trigger: "next week",
      resolvedBy: "keyword",
    };
  }

  const weekdayMatch = normalized.match(
    /\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
  );
  if (weekdayMatch?.[1] && weekdayMatch?.[2]) {
    const modifier = weekdayMatch[1];
    const weekdayLabel = weekdayMatch[2];
    const targetWeekday = WEEKDAY_TO_INDEX[weekdayLabel];
    const currentWeekday = today.getUTCDay();
    let delta = (targetWeekday - currentWeekday + 7) % 7;
    if (modifier === "next") {
      delta = delta === 0 ? 7 : delta;
    }
    const targetDate = addUtcDays(today, delta);
    return {
      targetType: "single_date",
      targetDate: toIsoDate(targetDate),
      targetRange: null,
      trigger: `${modifier} ${weekdayLabel}`,
      resolvedBy: "weekday",
    };
  }

  const explicitDate = parseExplicitDateFromPrompt(prompt);
  if (explicitDate) {
    return {
      targetType: "single_date",
      targetDate: explicitDate,
      targetRange: null,
      trigger: explicitDate,
      resolvedBy: "explicit_date",
    };
  }

  return {
    targetType: "unknown",
    targetDate: null,
    targetRange: null,
    trigger: null,
    resolvedBy: "none",
  };
};

const WEATHER_TEMP_ORDER: WeatherProfileTempBand[] = ["cold", "cool", "mild", "warm", "hot"];
const WEATHER_PRECIP_ORDER: WeatherProfilePrecipitationLevel[] = ["none", "light", "moderate", "heavy"];
const WEATHER_WIND_ORDER: WeatherProfileWindBand[] = ["calm", "breezy", "windy"];
const WEATHER_HUMIDITY_ORDER: WeatherProfileHumidityBand[] = ["dry", "normal", "humid"];
const WEATHER_WET_RISK_ORDER: WeatherProfileWetRisk[] = ["low", "medium", "high"];
const WEATHER_CONFIDENCE_ORDER: WeatherProfileConfidence[] = ["low", "medium", "high"];

const maxByOrder = <T extends string>(values: T[], order: readonly T[], fallback: T): T => {
  let best = fallback;
  let bestIndex = order.indexOf(fallback);
  for (const value of values) {
    const index = order.indexOf(value);
    if (index > bestIndex) {
      best = value;
      bestIndex = index;
    }
  }
  return best;
};

const minByOrder = <T extends string>(values: T[], order: readonly T[], fallback: T): T => {
  let best = fallback;
  let bestIndex = order.indexOf(fallback);
  for (const value of values) {
    const index = order.indexOf(value);
    if (index >= 0 && index < bestIndex) {
      best = value;
      bestIndex = index;
    }
  }
  return best;
};

const inferTemporalWeatherSourceFromTravelDay = (
  day: TravelDayWeather
): Exclude<WeatherContextSource, "none" | "model_tool" | "forced_tool" | "direct_fetch"> => {
  if (day.status === "forecast") return "forecast_api";
  if (day.status === "failed") return "seasonal_fallback";
  const summary = normalize(day.summary).toLowerCase();
  if (summary.includes("model-estimated monthly climate")) {
    return "llm_climate_fallback";
  }
  return "seasonal_fallback";
};

const aggregateSingleTemporalWeatherFromDays = ({
  locationLabel,
  days,
  startDate,
  endDate,
}: {
  locationLabel: string;
  days: TravelDayWeather[];
  startDate: string;
  endDate: string;
}): SingleTemporalWeatherResolution | null => {
  if (days.length === 0) return null;

  const weatherTags = dedupeCanonicalWeather(days.flatMap((day) => day.weather));
  const tempBand = minByOrder(
    days.map((day) => day.weatherProfile.tempBand),
    WEATHER_TEMP_ORDER,
    "mild"
  );
  const precipitationLevel = maxByOrder(
    days.map((day) => day.weatherProfile.precipitationLevel),
    WEATHER_PRECIP_ORDER,
    "none"
  );
  const precipitationTypes = new Set(
    days.map((day) => day.weatherProfile.precipitationType).filter((value) => value !== "none")
  );
  const precipitationType: WeatherProfilePrecipitationType = precipitationTypes.size > 1
    ? "mixed"
    : (precipitationTypes.values().next().value ?? "none");
  const windBand = maxByOrder(
    days.map((day) => day.weatherProfile.windBand),
    WEATHER_WIND_ORDER,
    "calm"
  );
  const humidityBand = maxByOrder(
    days.map((day) => day.weatherProfile.humidityBand),
    WEATHER_HUMIDITY_ORDER,
    "normal"
  );
  const wetSurfaceRisk = maxByOrder(
    days.map((day) => day.weatherProfile.wetSurfaceRisk),
    WEATHER_WET_RISK_ORDER,
    "low"
  );
  const confidence = minByOrder(
    days.map((day) => day.weatherProfile.confidence),
    WEATHER_CONFIDENCE_ORDER,
    "high"
  );

  const profile: WeatherProfile = {
    tempBand,
    precipitationLevel,
    precipitationType,
    windBand,
    humidityBand,
    wetSurfaceRisk,
    confidence,
  };

  const sources = new Set(days.map(inferTemporalWeatherSourceFromTravelDay));
  const source: Exclude<WeatherContextSource, "none" | "model_tool" | "forced_tool" | "direct_fetch"> =
    sources.has("forecast_api")
      ? (sources.size === 1 ? "forecast_api" : "llm_climate_fallback")
      : sources.has("llm_climate_fallback")
        ? "llm_climate_fallback"
        : "seasonal_fallback";
  const status: SingleTemporalWeatherStatus = source === "forecast_api" ? "forecast" : "seasonal";
  const summary = [
    `Weather context for ${locationLabel} from ${startDate} to ${endDate}:`,
    `Aggregated from ${days.length} daily estimates.`,
    weatherTags.length > 0 ? `Likely conditions include ${joinNaturalList(weatherTags)}.` : "",
    `Highest precipitation signal: ${precipitationLevel}${precipitationType !== "none" ? ` (${precipitationType})` : ""}.`,
    `Wet-surface risk: ${wetSurfaceRisk}.`,
  ].filter(Boolean).join(" ");

  return {
    weatherContextSummary: summary,
    weatherTags,
    weatherProfile: profile,
    source,
    status,
  };
};

const resolveSingleTemporalWeather = async ({
  locationHint,
  temporalTarget,
}: {
  locationHint: string;
  temporalTarget: SingleTemporalTargetResolution;
}): Promise<SingleTemporalWeatherResolution | null> => {
  if (temporalTarget.targetType === "single_date" && temporalTarget.targetDate) {
    const weatherByDate = await fetchTravelWeatherByDateRange(locationHint, [temporalTarget.targetDate]);
    const day = weatherByDate.days[0];
    if (!day) return null;
    const source = inferTemporalWeatherSourceFromTravelDay(day);
    const status: SingleTemporalWeatherStatus =
      day.status === "forecast" ? "forecast" : day.status === "seasonal" ? "seasonal" : "failed";
    return {
      weatherContextSummary: day.summary,
      weatherTags: dedupeCanonicalWeather(day.weather),
      weatherProfile: day.weatherProfile,
      source,
      status,
    };
  }

  if (temporalTarget.targetType === "date_range" && temporalTarget.targetRange) {
    const dates = enumerateDateRange(
      temporalTarget.targetRange.startDate,
      temporalTarget.targetRange.endDate
    );
    if (dates.length === 0) return null;
    const weatherByDate = await fetchTravelWeatherByDateRange(locationHint, dates);
    return aggregateSingleTemporalWeatherFromDays({
      locationLabel: weatherByDate.locationLabel,
      days: weatherByDate.days,
      startDate: temporalTarget.targetRange.startDate,
      endDate: temporalTarget.targetRange.endDate,
    });
  }

  return null;
};

const monthLabel = (dateIso: string): string => {
  const date = parseIsoDate(dateIso) ?? new Date();
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

async function fetchLlmClimateFallback(
  destination: string,
  dateIso: string
): Promise<{ summary: string; weather: string[]; weatherProfile: WeatherProfile } | null> {
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

    const normalizedNotes = normalize(object.notes);
    const climateDescriptor = [object.likelyConditions.join(", "), normalizedNotes].filter(Boolean).join(". ");

    return {
      summary: `No direct forecast for ${dateIso} in ${destination}. Using model-estimated monthly climate for ${climateMonth}: typically ${Math.round(object.avgMinTempC)}-${Math.round(object.avgMaxTempC)}°C with ${object.likelyConditions.join(", ")}. ${normalize(object.notes)}`,
      weather,
      weatherProfile: buildWeatherProfile({
        minTemp: object.avgMinTempC,
        maxTemp: object.avgMaxTempC,
        description: climateDescriptor,
        confidence: "medium",
        fallbackWeather: weather,
      }),
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

const normalizeDirectiveText = (value: string): string =>
  normalize(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const directiveTextIncludesTerm = (text: string, term: string): boolean => {
  const haystack = ` ${normalizeDirectiveText(text)} `;
  const normalizedTerm = normalizeDirectiveText(term);
  if (!normalizedTerm) return false;
  return haystack.includes(` ${normalizedTerm} `);
};

const dedupeLowercase = (values: string[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalizedValue = normalize(value);
    if (!normalizedValue) continue;
    const key = normalizedValue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalizedValue);
  }
  return result;
};

const toCanonicalStyleDirectiveTags = (values: string[]): string[] => canonicalizeStyleTags(values);

const toCanonicalFormalityDirective = (value?: string | null): string | null => {
  return canonicalizeFormalityOption(value);
};

const buildStyleDirectiveFromEntry = ({
  entry,
  sourceTerms,
  confidence,
}: {
  entry: StyleDirectiveCatalogEntry;
  sourceTerms: string[];
  confidence: DirectiveConfidence;
}): UserStyleDirective => ({
  key: entry.key,
  sourceTerms: dedupeLowercase(sourceTerms),
  canonicalStyleTags: toCanonicalStyleDirectiveTags(entry.styleTags),
  silhouetteBiasTags: dedupeLowercase(entry.silhouetteTags),
  materialBias: {
    prefer: dedupeLowercase(entry.materialPrefer),
    avoid: dedupeLowercase(entry.materialAvoid),
  },
  formalityBias: toCanonicalFormalityDirective(entry.formalityBias),
  confidence,
});

const buildReferenceDirectiveFromEntry = ({
  entry,
  sourceTerms,
  confidence,
}: {
  entry: ReferenceDirectiveCatalogEntry;
  sourceTerms: string[];
  confidence: DirectiveConfidence;
}): UserReferenceDirective => ({
  referenceKey: entry.referenceKey,
  sourceTerms: dedupeLowercase(sourceTerms),
  styleBiasTags: toCanonicalStyleDirectiveTags(entry.styleTags),
  silhouetteBiasTags: dedupeLowercase(entry.silhouetteTags),
  materialBias: {
    prefer: dedupeLowercase(entry.materialPrefer),
    avoid: dedupeLowercase(entry.materialAvoid),
  },
  formalityBias: toCanonicalFormalityDirective(entry.formalityBias),
  confidence,
});

const dedupeSelectedTools = (selectedTools: SingleSelectedTool[] | undefined): NormalizedSelectedTool[] => {
  if (!selectedTools || selectedTools.length === 0) return [];
  const seen = new Set<string>();
  const deduped: NormalizedSelectedTool[] = [];

  for (const tool of selectedTools) {
    const normalizedType: SelectedToolType = tool.type === "style" ? "style" : "reference";
    const normalizedId = normalize(tool.id);
    if (!normalizedId) continue;
    const key = `${normalizedType}:${normalizeDirectiveText(normalizedId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ type: normalizedType, id: normalizedId });
  }

  return deduped;
};

const extractUserIntentDirectives = ({
  userPrompt,
  styleCatalog,
  referenceCatalog,
  selectedTools,
}: {
  userPrompt: string;
  styleCatalog: StyleDirectiveCatalogEntry[];
  referenceCatalog: ReferenceDirectiveCatalogEntry[];
  selectedTools?: SingleSelectedTool[];
}): UserIntentDirectives => {
  const dedupedSelectedTools = dedupeSelectedTools(selectedTools);
  const selectedToolDirectives: AppliedSelectedTool[] = [];
  const styleToolDirectives: UserStyleDirective[] = [];
  const referenceToolDirectives: UserReferenceDirective[] = [];

  for (const selectedTool of dedupedSelectedTools) {
    if (selectedTool.type === "style") {
      const styleEntry = styleCatalog.find(
        (entry) => normalizeDirectiveText(entry.key) === normalizeDirectiveText(selectedTool.id)
      );
      if (styleEntry) {
        styleToolDirectives.push(
          buildStyleDirectiveFromEntry({
            entry: styleEntry,
            sourceTerms: [`tool:style:${styleEntry.key}`],
            confidence: "high",
          })
        );
        selectedToolDirectives.push({
          type: "style",
          id: selectedTool.id,
          applied: true,
          resolvedKey: styleEntry.key,
        });
      } else {
        selectedToolDirectives.push({
          type: "style",
          id: selectedTool.id,
          applied: false,
          resolvedKey: null,
        });
      }
      continue;
    }

    const referenceEntry = referenceCatalog.find(
      (entry) => normalizeDirectiveText(entry.referenceKey) === normalizeDirectiveText(selectedTool.id)
    );
    if (referenceEntry) {
      referenceToolDirectives.push(
        buildReferenceDirectiveFromEntry({
          entry: referenceEntry,
          sourceTerms: [`tool:reference:${referenceEntry.referenceKey}`],
          confidence: "high",
        })
      );
      selectedToolDirectives.push({
        type: "reference",
        id: selectedTool.id,
        applied: true,
        resolvedKey: referenceEntry.referenceKey,
      });
    } else {
      selectedToolDirectives.push({
        type: "reference",
        id: selectedTool.id,
        applied: false,
        resolvedKey: null,
      });
    }
  }

  const freeTextStyleDirectives: UserStyleDirective[] = [];
  for (const entry of styleCatalog) {
    const matchedTerms = entry.terms.filter((term) => directiveTextIncludesTerm(userPrompt, term));
    if (matchedTerms.length === 0) continue;
    freeTextStyleDirectives.push(
      buildStyleDirectiveFromEntry({
        entry,
        sourceTerms: matchedTerms,
        confidence: matchedTerms.length > 1 ? "high" : "medium",
      })
    );
  }

  const freeTextReferenceDirectives: UserReferenceDirective[] = [];
  for (const entry of referenceCatalog) {
    const matchedTerms = entry.terms.filter((term) => directiveTextIncludesTerm(userPrompt, term));
    if (matchedTerms.length === 0) continue;
    freeTextReferenceDirectives.push(
      buildReferenceDirectiveFromEntry({
        entry,
        sourceTerms: matchedTerms,
        confidence: matchedTerms.length > 1 ? "high" : "medium",
      })
    );
  }

  const styleToolKeys = new Set(styleToolDirectives.map((directive) => directive.key.toLowerCase()));
  const referenceToolKeys = new Set(referenceToolDirectives.map((directive) => directive.referenceKey.toLowerCase()));
  const styleDirectives = [
    ...styleToolDirectives,
    ...freeTextStyleDirectives.filter((directive) => !styleToolKeys.has(directive.key.toLowerCase())),
  ];
  const referenceDirectives = [
    ...referenceToolDirectives,
    ...freeTextReferenceDirectives.filter((directive) => !referenceToolKeys.has(directive.referenceKey.toLowerCase())),
  ];

  const styleTagsPrefer = dedupeLowercase([
    ...styleDirectives.flatMap((directive) => directive.canonicalStyleTags),
    ...referenceDirectives.flatMap((directive) => directive.styleBiasTags),
  ]);
  const silhouetteTagsPrefer = dedupeLowercase([
    ...styleDirectives.flatMap((directive) => directive.silhouetteBiasTags),
    ...referenceDirectives.flatMap((directive) => directive.silhouetteBiasTags),
  ]);
  const materialPrefer = dedupeLowercase([
    ...styleDirectives.flatMap((directive) => directive.materialBias.prefer),
    ...referenceDirectives.flatMap((directive) => directive.materialBias.prefer),
  ]);
  const materialAvoid = dedupeLowercase([
    ...styleDirectives.flatMap((directive) => directive.materialBias.avoid),
    ...referenceDirectives.flatMap((directive) => directive.materialBias.avoid),
  ]);
  const formalityBias = toCanonicalFormalityDirective(
    styleDirectives.find((directive) => directive.formalityBias)?.formalityBias ??
    referenceDirectives.find((directive) => directive.formalityBias)?.formalityBias ??
    null
  );

  return {
    selectedTools: selectedToolDirectives,
    styleDirectives,
    referenceDirectives,
    merged: {
      styleTagsPrefer,
      silhouetteTagsPrefer,
      materialPrefer,
      materialAvoid,
      formalityBias,
    },
  };
};

const mergeDerivedProfileWithUserDirectives = ({
  derivedProfile,
  userDirectives,
}: {
  derivedProfile: DerivedProfile;
  userDirectives: UserIntentDirectives;
}): DerivedProfile => {
  const directiveStyles = userDirectives.merged.styleTagsPrefer;
  const mergedStyles = dedupeLowercase([...directiveStyles, ...derivedProfile.style]).slice(0, 4);

  const preferSet = new Set(
    dedupeLowercase([...derivedProfile.materialTargets.prefer, ...userDirectives.merged.materialPrefer]).map((value) =>
      value.toLowerCase()
    )
  );
  const avoidSet = new Set(
    dedupeLowercase([...derivedProfile.materialTargets.avoid, ...userDirectives.merged.materialAvoid]).map((value) =>
      value.toLowerCase()
    )
  );
  for (const bucket of preferSet) {
    avoidSet.delete(bucket);
  }

  const selectedToolFormalityBias = toCanonicalFormalityDirective(
    userDirectives.styleDirectives.find(
      (directive) =>
        directive.formalityBias &&
        directive.sourceTerms.some((term) => normalize(term).toLowerCase().startsWith("tool:"))
    )?.formalityBias ??
    userDirectives.referenceDirectives.find(
      (directive) =>
        directive.formalityBias &&
        directive.sourceTerms.some((term) => normalize(term).toLowerCase().startsWith("tool:"))
    )?.formalityBias ??
    null
  );

  return {
    // Tool-selected formality bias must take precedence over derived fallback.
    formality: selectedToolFormalityBias ?? userDirectives.merged.formalityBias ?? derivedProfile.formality,
    style: mergedStyles.length > 0 ? mergedStyles : derivedProfile.style,
    materialTargets: {
      prefer: Array.from(preferSet),
      avoid: Array.from(avoidSet),
    },
  };
};

type StyleDirectiveFit = {
  score: number;
  styleMatchCount: number;
  totalGarments: number;
  matchedStyleTags: string[];
  requestedStyleTags: string[];
  matchedUniqueStyleTagCount: number;
  missingStyleTags: string[];
  styleCoverageRatio: number;
  styleTagHitCounts: Record<string, number>;
  matchedReferenceKeys: string[];
};

const computeStyleDirectiveFit = ({
  lineup,
  userDirectives,
}: {
  lineup: Array<Pick<Garment, "style" | "formality" | "material_composition">>;
  userDirectives?: UserIntentDirectives | null;
}): StyleDirectiveFit => {
  const requestedStyleTags = userDirectives?.merged.styleTagsPrefer ?? [];
  if (!userDirectives || requestedStyleTags.length === 0 || lineup.length === 0) {
    return {
      score: 0,
      styleMatchCount: 0,
      totalGarments: lineup.length,
      matchedStyleTags: [],
      requestedStyleTags,
      matchedUniqueStyleTagCount: 0,
      missingStyleTags: requestedStyleTags,
      styleCoverageRatio: 0,
      styleTagHitCounts: {},
      matchedReferenceKeys: userDirectives?.referenceDirectives.map((directive) => directive.referenceKey) ?? [],
    };
  }

  const requestedStyleTagsNormalized = dedupeLowercase(requestedStyleTags);
  const toolRequestedStyleTags = dedupeLowercase([
    ...(
      userDirectives.styleDirectives
        .filter((directive) =>
          directive.sourceTerms.some((term) => normalize(term).toLowerCase().startsWith("tool:"))
        )
        .flatMap((directive) => directive.canonicalStyleTags)
    ),
    ...(
      userDirectives.referenceDirectives
        .filter((directive) =>
          directive.sourceTerms.some((term) => normalize(term).toLowerCase().startsWith("tool:"))
        )
        .flatMap((directive) => directive.styleBiasTags)
    ),
  ]);
  const toolRequestedSet = new Set(toolRequestedStyleTags.map((tag) => tag.toLowerCase()));
  const requestedSet = new Set(requestedStyleTagsNormalized.map((tag) => tag.toLowerCase()));
  let score = 0;
  let styleMatchCount = 0;
  const styleTagHitCounts = new Map<string, number>();

  for (const garment of lineup) {
    const garmentStyle = normalize(garment.style).toLowerCase();
    if (garmentStyle && requestedSet.has(garmentStyle)) {
      styleMatchCount += 1;
      // Reward per-garment adherence, but put more emphasis on unique requested-tag coverage below.
      score += 5;
      styleTagHitCounts.set(garmentStyle, (styleTagHitCounts.get(garmentStyle) ?? 0) + 1);
    }

    const materials = (garment.material_composition ?? []).map((entry) => normalize(entry.material).toLowerCase());
    for (const preferredMaterial of userDirectives.merged.materialPrefer) {
      const preferredLower = preferredMaterial.toLowerCase();
      if (materials.some((material) => material.includes(preferredLower))) {
        score += 2;
      }
    }
    for (const avoidedMaterial of userDirectives.merged.materialAvoid) {
      const avoidedLower = avoidedMaterial.toLowerCase();
      if (materials.some((material) => material.includes(avoidedLower))) {
        score -= 3;
      }
    }

    if (
      userDirectives.merged.formalityBias &&
      normalize(garment.formality).toLowerCase() === userDirectives.merged.formalityBias.toLowerCase()
    ) {
      score += 1;
    }
  }

  const matchedStyleTags = Array.from(styleTagHitCounts.keys());
  const missingStyleTags = requestedStyleTagsNormalized
    .map((tag) => tag.toLowerCase())
    .filter((tag) => !styleTagHitCounts.has(tag));
  const matchedToolStyleTagCount = matchedStyleTags.filter((tag) => toolRequestedSet.has(tag.toLowerCase())).length;
  const missingToolStyleTags = toolRequestedStyleTags
    .map((tag) => tag.toLowerCase())
    .filter((tag) => !styleTagHitCounts.has(tag));
  const matchedUniqueStyleTagCount = matchedStyleTags.length;
  const styleCoverageRatio = requestedStyleTagsNormalized.length > 0
    ? matchedUniqueStyleTagCount / requestedStyleTagsNormalized.length
    : 0;
  const styleCoverageBonus = Math.round(styleCoverageRatio * 16);
  score += matchedUniqueStyleTagCount * 6;
  score += styleCoverageBonus;
  score -= missingStyleTags.length * 5;
  if (toolRequestedStyleTags.length > 0) {
    score += matchedToolStyleTagCount * 6;
    score -= missingToolStyleTags.length * 9;
  }

  if (styleMatchCount === 0) {
    score -= 12;
  }
  if (matchedUniqueStyleTagCount === 0) {
    score -= 8;
  }

  return {
    score,
    styleMatchCount,
    totalGarments: lineup.length,
    matchedStyleTags,
    requestedStyleTags: requestedStyleTagsNormalized,
    matchedUniqueStyleTagCount,
    missingStyleTags,
    styleCoverageRatio,
    styleTagHitCounts: Object.fromEntries(styleTagHitCounts.entries()),
    matchedReferenceKeys: userDirectives.referenceDirectives.map((directive) => directive.referenceKey),
  };
};

const resolveTravelReasonIntent = (reason: "Vacation" | "Office" | "Customer visit"): TravelReasonIntent => {
  if (reason === "Vacation") {
    return {
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
      occasion: [casualSocialOccasion, dateNightOccasion, outdoorSocialOccasion].filter((v): v is string => Boolean(v)),
      place: [officePlace, workshopPlace, atelierPlace, cityPlace].filter((v): v is string => Boolean(v)),
      notes: "Office intent: favor elevated smart-casual combinations with polished, versatile silhouettes.",
    };
  }

  return {
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

const matchesWeatherIntent = (garmentValues: string[] | undefined, requiredWeather: string[]): boolean => {
  if (requiredWeather.length === 0) return true;
  return Boolean(intersectionMatches(garmentValues ?? [], requiredWeather, { allSeasonAlias: "all season" }));
};

const missingWeatherCompatibleCategoriesFromWardrobe = (
  wardrobe: Array<{ type: string; suitable_weather?: string[] }>,
  requiredWeather: string[],
  requiredCategories: GarmentCategory[] = CORE_SILHOUETTE_CATEGORIES
): GarmentCategory[] => {
  if (requiredWeather.length === 0) return [];
  const present = new Set(
    wardrobe
      .filter((garment) => matchesWeatherIntent(garment.suitable_weather ?? [], requiredWeather))
      .map((garment) => categorizeType(garment.type))
  );
  return requiredCategories.filter((category) => !present.has(category));
};

const MATERIAL_KEYWORD_BUCKETS = {
  breathable: ["linen", "cotton", "hemp", "ramie", "lyocell", "tencel", "viscose", "rayon"],
  insulating: ["wool", "merino", "cashmere", "alpaca", "mohair", "fleece", "flannel", "down", "corduroy"],
  technical: ["nylon", "polyester", "polyamide", "gore", "shell", "membrane", "elastane", "spandex", "neoprene"],
  refined: ["wool", "cashmere", "silk", "linen", "merino", "mohair", "suede"],
  rugged: ["canvas", "denim", "twill", "leather", "cordura", "ripstop"],
  absorbent: ["cotton", "linen", "suede", "viscose", "rayon"],
} as const;

type MaterialBucket = keyof typeof MATERIAL_KEYWORD_BUCKETS;

const inferWetConditions = (
  weatherContext?: string | null,
  weatherProfile?: WeatherProfile | null
): boolean => {
  if (weatherProfile?.wetSurfaceRisk === "high" || weatherProfile?.wetSurfaceRisk === "medium") {
    return true;
  }
  const text = normalize(weatherContext).toLowerCase();
  if (!text) return false;
  return /\b(rain|drizzle|shower|storm|thunder|snow|sleet|hail|precipitation|wet)\b/.test(text);
};

const materialBucketShare = (
  materialComposition: Garment["material_composition"] | undefined,
  bucket: MaterialBucket
): number => {
  const entries = (materialComposition ?? [])
    .map((entry) => ({
      material: normalize(entry.material).toLowerCase(),
      weight: Number.isFinite(entry.percentage) && entry.percentage > 0 ? entry.percentage : 0,
    }))
    .filter((entry) => entry.material);

  if (entries.length === 0) return 0;

  const normalizedEntries = entries.map((entry) => ({
    material: entry.material,
    weight: entry.weight > 0 ? entry.weight : 1,
  }));
  const totalWeight = normalizedEntries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return 0;

  const keywords = MATERIAL_KEYWORD_BUCKETS[bucket];
  const matchedWeight = normalizedEntries.reduce((sum, entry) => {
    const matches = keywords.some((keyword) => entry.material.includes(keyword));
    return matches ? sum + entry.weight : sum;
  }, 0);

  return matchedWeight / totalWeight;
};

const RAIN_CONTEXT_REGEX = /\b(rain|drizzle|shower|storm|thunder|snow|sleet|hail|precipitation|wet)\b/;
const RAIN_READY_FEATURE_REGEX =
  /\b(waterproof|water-resistant|water resistant|water-repellent|water repellent|weatherproof|rain-ready|rain ready|gore-tex|goretex|membrane|waxed|sealed seams?|storm)\b/;
const ABSORBENT_RAIN_MATERIAL_REGEX =
  /\b(cotton|denim|canvas|suede|linen|viscose|rayon|tweed|wool|flannel|corduroy)\b/;
const TECHNICAL_RAIN_MATERIAL_REGEX =
  /\b(nylon|polyester|polyamide|gore|gore-tex|goretex|membrane|shell|neoprene|rubber|pvc)\b/;
const NON_RAIN_OUTERWEAR_TYPE_REGEX = /\b(overshirt|trucker|blazer|cardigan|shirt jacket|shirt-jacket)\b/;
const NON_RAIN_FOOTWEAR_TYPE_REGEX = /\b(sneaker|trainer|canvas shoe|canvas sneaker)\b/;

const isWetWeatherSafetyGateActive = (
  weatherContext?: string | null,
  weatherProfile?: WeatherProfile | null
): boolean => {
  const wetRisk = weatherProfile?.wetSurfaceRisk ?? (inferWetConditions(weatherContext, weatherProfile) ? "high" : "low");
  if (wetRisk !== "high" && wetRisk !== "medium") return false;

  const hasPrecipitationFromProfile =
    weatherProfile != null &&
    weatherProfile.precipitationType !== "none" &&
    weatherProfile.precipitationLevel !== "none";
  const contextHasWetTerms = RAIN_CONTEXT_REGEX.test(normalize(weatherContext).toLowerCase());

  return hasPrecipitationFromProfile || contextHasWetTerms;
};

type WetWeatherSafetyAssessment = {
  gateActive: boolean;
  applicable: boolean;
  rainReady: boolean | null;
  reason: string | null;
};

const assessWetWeatherSafety = (
  garment: Pick<CompactGarment, "type" | "material_composition" | "features">,
  options?: { weatherContext?: string | null; weatherProfile?: WeatherProfile | null }
): WetWeatherSafetyAssessment => {
  const gateActive = isWetWeatherSafetyGateActive(options?.weatherContext, options?.weatherProfile);
  const category = categorizeType(garment.type);
  const applicable = category === "outerwear" || category === "footwear";
  if (!gateActive || !applicable) {
    return {
      gateActive,
      applicable,
      rainReady: null,
      reason: null,
    };
  }

  const wetRisk = options?.weatherProfile?.wetSurfaceRisk ?? "medium";
  const technicalShare = materialBucketShare(garment.material_composition, "technical");
  const absorbentShare = materialBucketShare(garment.material_composition, "absorbent");
  const materialNames = (garment.material_composition ?? [])
    .map((entry) => normalize(entry.material).toLowerCase())
    .filter(Boolean);
  const typeText = normalize(garment.type).toLowerCase();
  const featureText = normalize(garment.features).toLowerCase();

  const hasRainReadyFeature = RAIN_READY_FEATURE_REGEX.test(featureText);
  const hasAbsorbentRainMaterial = materialNames.some((name) => ABSORBENT_RAIN_MATERIAL_REGEX.test(name));
  const hasTechnicalRainMaterial = materialNames.some((name) => TECHNICAL_RAIN_MATERIAL_REGEX.test(name));

  if (hasRainReadyFeature) {
    return {
      gateActive,
      applicable,
      rainReady: true,
      reason: null,
    };
  }

  if (category === "outerwear") {
    if (NON_RAIN_OUTERWEAR_TYPE_REGEX.test(typeText) && !hasTechnicalRainMaterial) {
      return {
        gateActive,
        applicable,
        rainReady: false,
        reason: "non_rain_outerwear_type",
      };
    }
    if (hasAbsorbentRainMaterial && !hasTechnicalRainMaterial) {
      return {
        gateActive,
        applicable,
        rainReady: false,
        reason: "absorbent_outerwear_material",
      };
    }
    if (wetRisk === "high" && technicalShare < 0.15 && absorbentShare > 0.35) {
      return {
        gateActive,
        applicable,
        rainReady: false,
        reason: "insufficient_rain_protection_outerwear",
      };
    }
  }

  if (category === "footwear") {
    if (NON_RAIN_FOOTWEAR_TYPE_REGEX.test(typeText) && technicalShare < 0.2) {
      return {
        gateActive,
        applicable,
        rainReady: false,
        reason: "non_rain_footwear_type",
      };
    }
    if (hasAbsorbentRainMaterial && !hasTechnicalRainMaterial && technicalShare < 0.2) {
      return {
        gateActive,
        applicable,
        rainReady: false,
        reason: "absorbent_footwear_material",
      };
    }
    if (wetRisk === "high" && !/\bboot\b/.test(typeText) && technicalShare < 0.1) {
      return {
        gateActive,
        applicable,
        rainReady: false,
        reason: "insufficient_rain_protection_footwear",
      };
    }
  }

  return {
    gateActive,
    applicable,
    rainReady: true,
    reason: null,
  };
};

const computeMaterialIntentScore = ({
  materialComposition,
  intent,
  category,
  weatherContext,
  weatherProfile,
  derivedProfile,
}: {
  materialComposition: Garment["material_composition"] | undefined;
  intent: CanonicalIntent;
  category?: GarmentCategory;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
}): number => {
  const breathable = materialBucketShare(materialComposition, "breathable");
  const insulating = materialBucketShare(materialComposition, "insulating");
  const technical = materialBucketShare(materialComposition, "technical");
  const refined = materialBucketShare(materialComposition, "refined");
  const rugged = materialBucketShare(materialComposition, "rugged");
  const absorbent = materialBucketShare(materialComposition, "absorbent");

  const weatherSet = new Set(intent.weather.map((value) => value.toLowerCase()));
  const placeSet = new Set(intent.place.map((value) => value.toLowerCase()));
  const occasionSet = new Set(intent.occasion.map((value) => value.toLowerCase()));
  const timeSet = new Set(intent.timeOfDay.map((value) => value.toLowerCase()));
  const isWet = inferWetConditions(weatherContext, weatherProfile);
  const preferredBuckets = new Set((derivedProfile?.materialTargets.prefer ?? []).map((value) => value.toLowerCase()));
  const avoidedBuckets = new Set((derivedProfile?.materialTargets.avoid ?? []).map((value) => value.toLowerCase()));

  let score = 0;

  if (preferredBuckets.has("breathable")) score += breathable * 9;
  if (preferredBuckets.has("insulating")) score += insulating * 9;
  if (preferredBuckets.has("technical")) score += technical * 11;
  if (preferredBuckets.has("refined")) score += refined * 7;
  if (preferredBuckets.has("rugged")) score += rugged * 6;
  if (preferredBuckets.has("absorbent")) score += absorbent * 5;

  if (avoidedBuckets.has("breathable")) score -= breathable * 10;
  if (avoidedBuckets.has("insulating")) score -= insulating * 10;
  if (avoidedBuckets.has("technical")) score -= technical * 8;
  if (avoidedBuckets.has("refined")) score -= refined * 7;
  if (avoidedBuckets.has("rugged")) score -= rugged * 6;
  if (avoidedBuckets.has("absorbent")) score -= absorbent * 10;

  if (weatherSet.has("hot") || weatherSet.has("warm")) {
    score += breathable * 14;
    score -= insulating * 12;
  } else if (weatherSet.has("cold")) {
    score += insulating * 15;
    score -= breathable * 8;
  } else if (weatherSet.has("cool")) {
    score += insulating * 10;
    score += refined * 3;
  } else if (weatherSet.has("mild")) {
    score += breathable * 6;
    score += insulating * 4;
  }

  if (isWet) {
    score += technical * 14;
    score -= absorbent * 8;
  }

  if (weatherProfile?.wetSurfaceRisk === "high" && (category === "outerwear" || category === "footwear")) {
    score += technical * 16;
    score += rugged * 6;
    score -= absorbent * 14;
  } else if (weatherProfile?.wetSurfaceRisk === "medium") {
    score += technical * 8;
    score -= absorbent * 6;
  }

  if (category === "outerwear") {
    if (weatherProfile?.tempBand === "hot" || weatherProfile?.tempBand === "warm") {
      score -= insulating * 12;
      score += breathable * 6;
    }
    if (weatherProfile?.tempBand === "cold" || weatherProfile?.tempBand === "cool") {
      score += insulating * 10;
    }
  }

  if (category === "top" || category === "bottom") {
    if (weatherProfile?.tempBand === "hot" || weatherProfile?.tempBand === "warm") {
      score += breathable * 10;
      score -= insulating * 8;
    }
    if (weatherProfile?.tempBand === "cold" || weatherProfile?.tempBand === "cool") {
      score += insulating * 8;
    }
  }

  if (category === "footwear") {
    if (weatherProfile?.wetSurfaceRisk === "high") {
      score += technical * 10;
      score += rugged * 8;
      score -= absorbent * 14;
    }
    if (weatherProfile?.tempBand === "hot") {
      score += breathable * 4;
    }
  }

  const placeSignalsTechnical =
    placeSet.has("transit hub / airport") ||
    placeSet.has("wilderness") ||
    placeSet.has("coastal / beach") ||
    placeSet.has("workshop");
  if (placeSignalsTechnical) {
    score += technical * 6;
    score += rugged * 3;
  }

  const placeSignalsRefined =
    placeSet.has("office / boardroom") ||
    placeSet.has("metropolitan / city") ||
    placeSet.has("creative studio / atelier");
  if (placeSignalsRefined) {
    score += refined * 5;
  }

  const occasionSignalsRefined =
    occasionSet.has("black tie / evening wear") ||
    occasionSet.has("business formal") ||
    occasionSet.has("ceremonial / wedding") ||
    occasionSet.has("date night / intimate dinner");
  if (occasionSignalsRefined) {
    score += refined * 8;
    score -= technical * 3;
  }

  const occasionSignalsTechnical =
    occasionSet.has("active transit / commuting") ||
    occasionSet.has("active rugged / field sports") ||
    occasionSet.has("manual labor / craft") ||
    occasionSet.has("spectator sports");
  if (occasionSignalsTechnical) {
    score += technical * 8;
    score += rugged * 4;
  }

  if (timeSet.has("evening") || timeSet.has("night")) {
    score += refined * 4;
  } else if (timeSet.has("morning") || timeSet.has("afternoon") || timeSet.has("all day")) {
    score += breathable * 3;
  }

  return Math.round(score);
};

const deriveStylingFromContext = ({
  weather,
  occasion,
  place,
  timeOfDay,
  weatherContext,
  weatherProfile,
}: {
  weather: string[];
  occasion: string[];
  place: string[];
  timeOfDay: string[];
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
}): { formality: string | null; style: string[] } => {
  const formalityScores = new Map<string, number>();
  const styleScores = new Map<string, number>();

  const addFormality = (label: string, weight: number) => {
    const canonical = findCanonicalOption(FORMALITY_OPTIONS, label);
    if (!canonical) return;
    formalityScores.set(canonical, (formalityScores.get(canonical) ?? 0) + weight);
  };
  const addStyle = (label: string, weight: number) => {
    const canonical = findCanonicalOption(STYLE_OPTIONS, label);
    if (!canonical) return;
    styleScores.set(canonical, (styleScores.get(canonical) ?? 0) + weight);
  };

  const weatherSet = new Set(weather.map((value) => value.toLowerCase()));
  const occasionSet = new Set(occasion.map((value) => value.toLowerCase()));
  const placeSet = new Set(place.map((value) => value.toLowerCase()));
  const timeSet = new Set(timeOfDay.map((value) => value.toLowerCase()));
  const isWet = inferWetConditions(weatherContext, weatherProfile);

  if (occasionSet.has("black tie / evening wear") || occasionSet.has("ceremonial / wedding")) {
    addFormality("Formal", 8);
    addFormality("Business Formal", 3);
    addStyle("classic", 4);
    addStyle("preppy", 2);
  }
  if (occasionSet.has("business formal")) {
    addFormality("Business Formal", 8);
    addFormality("Formal", 2);
    addStyle("classic", 4);
    addStyle("minimalist", 2);
  }
  if (occasionSet.has("date night / intimate dinner")) {
    addFormality("Elevated Casual", 6);
    addFormality("Business Casual", 3);
    addStyle("classic", 3);
    addStyle("minimalist", 3);
    addStyle("mod", 2);
  }
  if (
    occasionSet.has("casual social") ||
    occasionSet.has("errands / low-key social") ||
    occasionSet.has("outdoor social / garden party")
  ) {
    addFormality("Casual", 5);
    addFormality("Elevated Casual", 3);
    addStyle("classic", 2);
    addStyle("preppy", 2);
    addStyle("minimalist", 1);
  }
  if (
    occasionSet.has("active transit / commuting") ||
    occasionSet.has("active rugged / field sports") ||
    occasionSet.has("manual labor / craft") ||
    occasionSet.has("spectator sports")
  ) {
    addFormality("Technical", 6);
    addFormality("Casual", 2);
    addStyle("sporty", 4);
    addStyle("outdoorsy", 4);
    addStyle("workwear", 3);
  }

  if (placeSet.has("office / boardroom")) {
    addFormality("Business Formal", 5);
    addFormality("Business Casual", 4);
    addStyle("classic", 3);
    addStyle("minimalist", 3);
    addStyle("preppy", 2);
  }
  if (
    placeSet.has("transit hub / airport") ||
    placeSet.has("workshop") ||
    placeSet.has("wilderness")
  ) {
    addFormality("Technical", 4);
    addFormality("Casual", 2);
    addStyle("workwear", 4);
    addStyle("outdoorsy", 4);
    addStyle("sporty", 2);
  }
  if (placeSet.has("creative studio / atelier")) {
    addFormality("Elevated Casual", 3);
    addStyle("vintage", 4);
    addStyle("mod", 3);
    addStyle("workwear", 2);
    addStyle("minimalist", 2);
  }
  if (placeSet.has("metropolitan / city")) {
    addFormality("Elevated Casual", 3);
    addFormality("Business Casual", 2);
    addStyle("minimalist", 3);
    addStyle("classic", 2);
  }
  if (placeSet.has("coastal / beach") || placeSet.has("countryside / estate") || placeSet.has("home / wfh")) {
    addFormality("Casual", 4);
    addStyle("sporty", 2);
    addStyle("preppy", 2);
    addStyle("outdoorsy", 2);
  }

  if (timeSet.has("night") || timeSet.has("evening")) {
    addFormality("Elevated Casual", 3);
    addFormality("Business Casual", 2);
    addFormality("Formal", 1);
    addStyle("classic", 2);
    addStyle("minimalist", 2);
    addStyle("mod", 2);
  } else if (timeSet.has("morning") || timeSet.has("afternoon") || timeSet.has("all day")) {
    addFormality("Casual", 2);
    addFormality("Business Casual", 1);
    addStyle("sporty", 1);
    addStyle("preppy", 1);
  }

  if (weatherSet.has("hot") || weatherSet.has("warm")) {
    addFormality("Casual", 2);
    addFormality("Technical", 1);
    addStyle("sporty", 2);
    addStyle("preppy", 1);
  } else if (weatherSet.has("cold") || weatherSet.has("cool")) {
    addFormality("Elevated Casual", 2);
    addFormality("Business Casual", 1);
    addStyle("classic", 1);
    addStyle("workwear", 1);
  } else if (weatherSet.has("mild")) {
    addFormality("Elevated Casual", 1);
  }

  if (isWet) {
    addFormality("Technical", 3);
    addStyle("workwear", 2);
    addStyle("outdoorsy", 2);
  }

  const rankedFormality = Array.from(formalityScores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label]) => label);
  const rankedStyles = Array.from(styleScores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, score]) => ({ label, score }));

  const fallbackFormality =
    findCanonicalOption(FORMALITY_OPTIONS, "Casual") ??
    findCanonicalOption(FORMALITY_OPTIONS, "Elevated Casual") ??
    FORMALITY_OPTIONS[0] ??
    null;
  const fallbackStyle =
    findCanonicalOption(STYLE_OPTIONS, "classic") ??
    findCanonicalOption(STYLE_OPTIONS, "minimalist") ??
    STYLE_OPTIONS[0] ??
    null;

  return {
    formality: rankedFormality[0] ?? fallbackFormality,
    style: rankedStyles.filter((item) => item.score > 0).slice(0, 2).map((item) => item.label)
      .concat(rankedStyles.length === 0 && fallbackStyle ? [fallbackStyle] : [])
      .slice(0, 2),
  };
};

const deriveMaterialTargetsFromContext = ({
  weather,
  occasion,
  place,
  timeOfDay,
  weatherContext,
  weatherProfile,
}: {
  weather: string[];
  occasion: string[];
  place: string[];
  timeOfDay: string[];
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
}): { prefer: string[]; avoid: string[] } => {
  const prefer = new Set<string>();
  const avoid = new Set<string>();

  const weatherSet = new Set(weather.map((value) => value.toLowerCase()));
  const placeSet = new Set(place.map((value) => value.toLowerCase()));
  const occasionSet = new Set(occasion.map((value) => value.toLowerCase()));
  const timeSet = new Set(timeOfDay.map((value) => value.toLowerCase()));
  const isWet = inferWetConditions(weatherContext, weatherProfile);
  const wetRisk = weatherProfile?.wetSurfaceRisk ?? (isWet ? "high" : "low");
  const isWarmContext =
    weatherSet.has("hot") ||
    weatherSet.has("warm") ||
    weatherProfile?.tempBand === "hot" ||
    weatherProfile?.tempBand === "warm";
  const isColdContext =
    weatherSet.has("cold") ||
    weatherSet.has("cool") ||
    weatherProfile?.tempBand === "cold" ||
    weatherProfile?.tempBand === "cool";

  if (isWarmContext) {
    prefer.add("breathable");
    avoid.add("insulating");
  }
  if (isColdContext) {
    prefer.add("insulating");
  }
  if (wetRisk === "high" || wetRisk === "medium") {
    prefer.add("technical");
    avoid.add("absorbent");
  }

  const technicalPlace =
    placeSet.has("transit hub / airport") ||
    placeSet.has("wilderness") ||
    placeSet.has("workshop") ||
    placeSet.has("coastal / beach");
  if (technicalPlace) {
    prefer.add("technical");
    prefer.add("rugged");
  }

  const refinedPlace =
    placeSet.has("office / boardroom") ||
    placeSet.has("metropolitan / city") ||
    placeSet.has("creative studio / atelier");
  if (refinedPlace) {
    prefer.add("refined");
  }

  const refinedOccasion =
    occasionSet.has("black tie / evening wear") ||
    occasionSet.has("business formal") ||
    occasionSet.has("ceremonial / wedding") ||
    occasionSet.has("date night / intimate dinner");
  if (refinedOccasion) {
    prefer.add("refined");
    if (wetRisk === "low") {
      avoid.add("technical");
    }
  }

  const technicalOccasion =
    occasionSet.has("active transit / commuting") ||
    occasionSet.has("active rugged / field sports") ||
    occasionSet.has("manual labor / craft");
  if (technicalOccasion) {
    prefer.add("technical");
    prefer.add("rugged");
  }

  if (timeSet.has("night") || timeSet.has("evening")) {
    prefer.add("refined");
  }
  if (
    (timeSet.has("morning") || timeSet.has("afternoon") || timeSet.has("all day")) &&
    !isColdContext &&
    wetRisk === "low"
  ) {
    prefer.add("breathable");
  }

  if (isColdContext || wetRisk !== "low") {
    prefer.delete("breathable");
  }
  if (isWarmContext && wetRisk === "low") {
    prefer.delete("insulating");
  }
  if (wetRisk !== "low") {
    avoid.delete("technical");
    avoid.add("absorbent");
  }

  return {
    prefer: Array.from(prefer),
    avoid: Array.from(avoid),
  };
};

const buildDerivedProfileFromContext = ({
  context,
  weatherContext,
  weatherProfile,
}: {
  context: ContextIntent;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
}): DerivedProfile => {
  const derivedStyling = deriveStylingFromContext({
    weather: context.weather,
    occasion: context.occasion,
    place: context.place,
    timeOfDay: context.timeOfDay,
    weatherContext,
    weatherProfile,
  });

  return {
    formality: derivedStyling.formality,
    style: derivedStyling.style,
    materialTargets: deriveMaterialTargetsFromContext({
      weather: context.weather,
      occasion: context.occasion,
      place: context.place,
      timeOfDay: context.timeOfDay,
      weatherContext,
      weatherProfile,
    }),
  };
};

const buildCanonicalIntentFromContext = ({
  context,
  weatherContext,
  weatherProfile,
  derivedProfile,
}: {
  context: ContextIntent;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
}): CanonicalIntent => {
  const resolvedDerivedProfile = derivedProfile ?? buildDerivedProfileFromContext({
    context,
    weatherContext,
    weatherProfile,
  });

  return {
    weather: context.weather,
    occasion: context.occasion,
    place: context.place,
    timeOfDay: context.timeOfDay,
    formality: resolvedDerivedProfile.formality,
    style: resolvedDerivedProfile.style,
    notes: context.notes,
  };
};

type GarmentHardFailReason =
  | "weather_mismatch"
  | "occasion_mismatch"
  | "place_mismatch"
  | "wet_material_conflict"
  | "wet_weather_not_rain_ready";

const evaluateGarmentHardConstraints = (
  garment: Pick<
    CompactGarment,
    "type" | "features" | "material_composition" | "suitable_weather" | "suitable_occasions" | "suitable_places"
  >,
  intent: CanonicalIntent,
  options?: { weatherContext?: string | null; weatherProfile?: WeatherProfile | null }
): {
  passes: boolean;
  reasons: GarmentHardFailReason[];
  weatherMatch: boolean;
  occasionMatch: boolean;
  placeMatch: boolean;
  wetWeatherSafetyGateActive: boolean;
  rainReady: boolean | null;
  rainReadyReason: string | null;
} => {
  const reasons: GarmentHardFailReason[] = [];
  const weatherMatch =
    intent.weather.length === 0 ||
    Boolean(intersectionMatches(garment.suitable_weather ?? [], intent.weather, { allSeasonAlias: "all season" }));
  const occasionMatch =
    intent.occasion.length === 0 ||
    Boolean(intersectionMatches(garment.suitable_occasions ?? [], intent.occasion));
  const placeMatch =
    intent.place.length === 0 ||
    Boolean(intersectionMatches(garment.suitable_places ?? [], intent.place));

  if (!weatherMatch) reasons.push("weather_mismatch");
  if (!occasionMatch) reasons.push("occasion_mismatch");
  if (!placeMatch) reasons.push("place_mismatch");

  const wetWeatherSafety = assessWetWeatherSafety(
    {
      type: garment.type,
      features: garment.features,
      material_composition: garment.material_composition,
    },
    options
  );
  if (wetWeatherSafety.gateActive && wetWeatherSafety.applicable && wetWeatherSafety.rainReady === false) {
    reasons.push("wet_weather_not_rain_ready");
  }

  const category = categorizeType(garment.type);
  const wetRisk = options?.weatherProfile?.wetSurfaceRisk ?? (inferWetConditions(options?.weatherContext) ? "high" : "low");
  if ((category === "outerwear" || category === "footwear") && (wetRisk === "high" || wetRisk === "medium")) {
    const technicalShare = materialBucketShare(garment.material_composition, "technical");
    const absorbentShare = materialBucketShare(garment.material_composition, "absorbent");
    const failsHighWet = wetRisk === "high" && absorbentShare > 0.55 && technicalShare < 0.2;
    const failsMediumWet = wetRisk === "medium" && absorbentShare > 0.6 && technicalShare < 0.15;
    if (failsHighWet || failsMediumWet) {
      reasons.push("wet_material_conflict");
    }
  }

  return {
    passes: reasons.length === 0,
    reasons,
    weatherMatch,
    occasionMatch,
    placeMatch,
    wetWeatherSafetyGateActive: wetWeatherSafety.gateActive,
    rainReady: wetWeatherSafety.rainReady,
    rainReadyReason: wetWeatherSafety.reason,
  };
};

const missingWetSafeCategoriesFromWardrobe = (
  wardrobe: CompactGarment[],
  intent: CanonicalIntent,
  options: { weatherContext?: string | null; weatherProfile?: WeatherProfile | null },
  requiredCategories: GarmentCategory[] = ["outerwear", "footwear"]
): GarmentCategory[] => {
  if (!isWetWeatherSafetyGateActive(options.weatherContext, options.weatherProfile)) {
    return [];
  }

  const present = new Set(
    wardrobe
      .filter((garment) => requiredCategories.includes(categorizeType(garment.type)))
      .filter((garment) =>
        evaluateGarmentHardConstraints(
          {
            type: garment.type,
            features: garment.features,
            material_composition: garment.material_composition,
            suitable_weather: garment.suitable_weather,
            suitable_occasions: garment.suitable_occasions,
            suitable_places: garment.suitable_places,
          },
          intent,
          options
        ).passes
      )
      .map((garment) => categorizeType(garment.type))
  );

  return requiredCategories.filter((category) => !present.has(category));
};

const scoreGarmentForIntent = (
  garment: Pick<
    CompactGarment,
    "type" | "style" | "formality" | "features" | "material_composition" | "suitable_weather" | "suitable_occasions" | "suitable_places" | "suitable_time_of_day"
  >,
  intent: CanonicalIntent,
  options?: {
    weatherContext?: string | null;
    weatherProfile?: WeatherProfile | null;
    derivedProfile?: DerivedProfile | null;
    userDirectives?: UserIntentDirectives | null;
  }
): number => {
  const category = categorizeType(garment.type);
  const hardEvaluation = evaluateGarmentHardConstraints(garment, intent, {
    weatherContext: options?.weatherContext,
    weatherProfile: options?.weatherProfile,
  });
  if (!hardEvaluation.passes) {
    return -10000 - (hardEvaluation.reasons.length * 250);
  }

  let score = 0;

  if (hardEvaluation.weatherMatch) {
    score += 40;
  }
  if (hardEvaluation.occasionMatch) {
    score += 24;
  }
  if (hardEvaluation.placeMatch) {
    score += 24;
  }
  if (intent.timeOfDay.length > 0 && intersectionMatches(garment.suitable_time_of_day ?? [], intent.timeOfDay, { allDayAlias: "all day" })) {
    score += 10;
  }
  if (intent.formality && normalize(garment.formality).toLowerCase() === intent.formality.toLowerCase()) {
    score += 8;
  }
  if (intent.style.length > 0 && intent.style.some((style) => style.toLowerCase() === normalize(garment.style).toLowerCase())) {
    score += 6;
  }
  score += computeMaterialIntentScore({
    materialComposition: garment.material_composition,
    intent,
    category,
    weatherContext: options?.weatherContext,
    weatherProfile: options?.weatherProfile,
    derivedProfile: options?.derivedProfile,
  });

  const directiveStyles = options?.userDirectives?.merged.styleTagsPrefer ?? [];
  if (directiveStyles.length > 0) {
    const styleSet = new Set(directiveStyles.map((style) => style.toLowerCase()));
    const garmentStyle = normalize(garment.style).toLowerCase();
    if (garmentStyle && styleSet.has(garmentStyle)) {
      score += 8;
    } else {
      score -= 2;
    }
  }

  if (options?.userDirectives?.merged.formalityBias) {
    const expectedFormality = options.userDirectives.merged.formalityBias.toLowerCase();
    if (normalize(garment.formality).toLowerCase() === expectedFormality) {
      score += 3;
    } else {
      score -= 1;
    }
  }

  return score;
};

const buildLineupRuleTrace = ({
  lineup,
  intent,
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
}: {
  lineup: Array<Pick<Garment, "id" | "type" | "model" | "features" | "suitable_weather" | "suitable_occasions" | "suitable_places" | "suitable_time_of_day" | "formality" | "style" | "material_composition">>;
  intent: CanonicalIntent;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
}) =>
  lineup.map((garment) => {
    const category = categorizeType(garment.type);
    const hardEvaluation = evaluateGarmentHardConstraints(
      {
        type: garment.type,
        features: garment.features,
        material_composition: garment.material_composition,
        suitable_weather: garment.suitable_weather,
        suitable_occasions: garment.suitable_occasions,
        suitable_places: garment.suitable_places,
      },
      intent,
      {
        weatherContext,
        weatherProfile,
      }
    );
    const materialScore = computeMaterialIntentScore({
      materialComposition: garment.material_composition,
      intent,
      category,
      weatherContext,
      weatherProfile,
      derivedProfile,
    });
    const directiveStyles = userDirectives?.merged.styleTagsPrefer ?? [];
    const directiveStyleMatch =
      directiveStyles.length === 0
        ? null
        : directiveStyles.some((style) => style.toLowerCase() === normalize(garment.style).toLowerCase());
    const directiveFit = computeStyleDirectiveFit({
      lineup: [garment],
      userDirectives,
    });

    return {
      garmentId: garment.id,
      category,
      hardPass: hardEvaluation.passes,
      hardFailReasons: hardEvaluation.reasons,
      weatherMatch: hardEvaluation.weatherMatch,
      occasionMatch: hardEvaluation.occasionMatch,
      placeMatch: hardEvaluation.placeMatch,
      wetWeatherSafetyGateActive: hardEvaluation.wetWeatherSafetyGateActive,
      rainReady: hardEvaluation.rainReady,
      rainReadyReason: hardEvaluation.rainReadyReason,
      timeMatch:
        intent.timeOfDay.length === 0 ||
        Boolean(intersectionMatches(garment.suitable_time_of_day ?? [], intent.timeOfDay, { allDayAlias: "all day" })),
      formalityMatch:
        !intent.formality || normalize(garment.formality).toLowerCase() === intent.formality.toLowerCase(),
      styleMatch:
        intent.style.length === 0 ||
        intent.style.some((style) => style.toLowerCase() === normalize(garment.style).toLowerCase()),
      directiveStyleMatch,
      directiveStyleFitScore: directiveFit.score,
      materialScore,
    };
  });

const buildTravelPromptWardrobe = ({
  eligibleWardrobe,
  dayIntent,
  weatherContext,
  weatherProfile,
  derivedProfile,
  usedGarmentIds,
  recentLookHistory,
  requiredIds,
}: {
  eligibleWardrobe: CompactGarment[];
  dayIntent: CanonicalIntent;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  usedGarmentIds: Set<number>;
  recentLookHistory: Array<{ date: string; ids: number[] }>;
  requiredIds?: number[];
}): CompactGarment[] => {
  const recentIds = new Set(recentLookHistory.flatMap((item) => item.ids));
  const scored = eligibleWardrobe.map((garment) => {
    const intentScore = scoreGarmentForIntent(garment, dayIntent, {
      weatherContext,
      weatherProfile,
      derivedProfile,
    });
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
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
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
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
  requiredCategories?: GarmentCategory[];
}): number[] => {
  const blockedIdSet = new Set(blockedIds);
  const poolById = new Map(pool.map((garment) => [garment.id, garment]));
  const selected = Array.from(new Set(ids)).filter((id) => {
    if (blockedIdSet.has(id)) return false;
    const garment = poolById.get(id);
    if (!garment) return false;
    return matchesWeatherIntent(garment.suitable_weather ?? [], intent.weather);
  });
  const selectedSet = new Set(selected);

  const candidateSort = (left: CompactGarment, right: CompactGarment) => {
    const leftScore = scoreGarmentForIntent(left, intent, {
      weatherContext,
      weatherProfile,
      derivedProfile,
      userDirectives,
    }) + (usedGarmentIds.has(left.id) ? 0 : 25) + (left.favorite ? 5 : 0);
    const rightScore = scoreGarmentForIntent(right, intent, {
      weatherContext,
      weatherProfile,
      derivedProfile,
      userDirectives,
    }) + (usedGarmentIds.has(right.id) ? 0 : 25) + (right.favorite ? 5 : 0);
    return rightScore - leftScore;
  };

  for (const category of requiredCategories) {
    if (selected.some((id) => garmentCategoryById.get(id) === category)) continue;

    const candidates = pool
      .filter((garment) => {
        if (selectedSet.has(garment.id)) return false;
        if (blockedIdSet.has(garment.id)) return false;
        if (categorizeType(garment.type) !== category) return false;
        if (!matchesWeatherIntent(garment.suitable_weather ?? [], intent.weather)) return false;
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
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
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
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
  requiredCategories?: GarmentCategory[];
}): number[] => {
  const historyIds = [
    ...recentLookHistory.map((entry) => entry.ids),
    ...(avoidHistoryIds ?? []),
  ];
  const poolById = new Map(pool.map((garment) => [garment.id, garment]));
  const current = toTopDownOrderedIds(ids, garmentCategoryById);
  const currentSignature = lineupSignature(current);
  const currentOverlap = maxOverlapAgainstHistory(current, historyIds);
  const currentHasWeatherMismatch = current.some((id) => {
    const garment = poolById.get(id);
    if (!garment) return true;
    return !matchesWeatherIntent(garment.suitable_weather ?? [], intent.weather);
  });

  if (
    !currentHasWeatherMismatch &&
    !usedLookSignatures.has(currentSignature) &&
    !(avoidSignatures?.has(currentSignature) ?? false) &&
    currentOverlap <= MAX_ALLOWED_OVERLAP_RATIO
  ) {
    return current;
  }

  const blockedIdSet = new Set(blockedIds);
  const replacementPriority = current
    .map((id, index) => {
      const garment = poolById.get(id);
      const weatherMismatch = garment
        ? !matchesWeatherIntent(garment.suitable_weather ?? [], intent.weather)
        : true;
      return { id, index, alreadyUsed: usedGarmentIds.has(id), weatherMismatch };
    })
    .sort(
      (left, right) =>
        Number(right.weatherMismatch) - Number(left.weatherMismatch) ||
        Number(right.alreadyUsed) - Number(left.alreadyUsed)
    );

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
        if (!matchesWeatherIntent(garment.suitable_weather ?? [], intent.weather)) return false;
        if (targetCategory === "outerwear" && lockedOuterwearId != null && garment.id !== lockedOuterwearId) {
          return false;
        }
        if (targetCategory === "footwear" && !isTravelDay && lockedFootwearId != null && garment.id !== lockedFootwearId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const leftScore = scoreGarmentForIntent(left, intent, {
          weatherContext,
          weatherProfile,
          derivedProfile,
          userDirectives,
        }) + (usedGarmentIds.has(left.id) ? 0 : 30) + (left.favorite ? 5 : 0);
        const rightScore = scoreGarmentForIntent(right, intent, {
          weatherContext,
          weatherProfile,
          derivedProfile,
          userDirectives,
        }) + (usedGarmentIds.has(right.id) ? 0 : 30) + (right.favorite ? 5 : 0);
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
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
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
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
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
    weatherContext,
    weatherProfile,
    derivedProfile,
    userDirectives,
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

    const currentCategoryIds = normalized.filter((id) => {
      if (garmentCategoryById.get(id) !== category || used.has(id)) return false;
      const garment = poolById.get(id);
      if (!garment) return false;
      return matchesWeatherIntent(garment.suitable_weather ?? [], intent.weather);
    });
    const currentCategoryIdSet = new Set(currentCategoryIds);
    const fallbackIds = pool
      .filter(
        (garment) =>
          categorizeType(garment.type) === category &&
          !used.has(garment.id) &&
          matchesWeatherIntent(garment.suitable_weather ?? [], intent.weather)
      )
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
          scoreGarmentForIntent(garment, intent, {
            weatherContext,
            weatherProfile,
            derivedProfile,
            userDirectives,
          }) +
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

const computeObjectiveMatchScore = (
  lineup: Garment[],
  intent: CanonicalIntent,
  options?: {
    weatherContext?: string | null;
    weatherProfile?: WeatherProfile | null;
    derivedProfile?: DerivedProfile | null;
    userDirectives?: UserIntentDirectives | null;
  }
): number => {
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

  const styleDirectiveFit = computeStyleDirectiveFit({
    lineup,
    userDirectives: options?.userDirectives,
  });
  if ((options?.userDirectives?.merged.styleTagsPrefer.length ?? 0) > 0) {
    const normalizedDirectiveScore = Math.max(0, Math.min(100, 50 + (styleDirectiveFit.score * 3)));
    dimensionScores.push(normalizedDirectiveScore);
  }

  const materialScores = lineup.map((garment) =>
    computeMaterialIntentScore({
      materialComposition: garment.material_composition,
      intent,
      category: categorizeType(garment.type),
      weatherContext: options?.weatherContext,
      weatherProfile: options?.weatherProfile,
      derivedProfile: options?.derivedProfile,
    })
  );
  if (materialScores.length > 0) {
    const materialDimensionScore =
      materialScores.reduce((sum, score) => sum + Math.max(0, Math.min(100, 50 + (score * 3))), 0) / materialScores.length;
    dimensionScores.push(materialDimensionScore);
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

const normalizeModelConfidence = (raw: number): number => {
  if (!Number.isFinite(raw)) return 50;
  const clamped = Math.max(0, raw);

  // Heuristic normalization for common LLM scale drift:
  // - 0.x -> percentage (x100)
  // - 1..10 -> decile scale (x10)
  if (clamped > 0 && clamped < 1) {
    return Math.max(0, Math.min(100, Math.round(clamped * 100)));
  }
  if (clamped >= 1 && clamped <= 10) {
    return Math.max(0, Math.min(100, Math.round(clamped * 10)));
  }
  return Math.max(0, Math.min(100, Math.round(clamped)));
};

const toValidatedSingleLookCandidate = ({
  lookName,
  modelConfidence,
  ids,
  intent,
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
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
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
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
    weatherContext,
    weatherProfile,
    derivedProfile,
    userDirectives,
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
  const hasHardConstraintMismatch = lineupGarments.some((garment) =>
    !evaluateGarmentHardConstraints(
      {
        type: garment.type,
        features: garment.features,
        material_composition: garment.material_composition,
        suitable_weather: garment.suitable_weather,
        suitable_occasions: garment.suitable_occasions,
        suitable_places: garment.suitable_places,
      },
      intent,
      {
        weatherContext,
        weatherProfile,
      }
    ).passes
  );
  if (hasHardConstraintMismatch) return null;

  const matchScore = computeObjectiveMatchScore(lineupGarments, intent, {
    weatherContext,
    weatherProfile,
    derivedProfile,
    userDirectives,
  });
  const roundedModelConfidence = normalizeModelConfidence(modelConfidence);
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
  weatherProfile,
  derivedProfile,
  userDirectives,
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
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
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
          scoreGarmentForIntent(garment, intent, {
            weatherContext,
            weatherProfile,
            derivedProfile,
            userDirectives,
          }) +
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
    weatherProfile,
    derivedProfile,
    userDirectives,
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

type SingleFeedbackSignalRow = {
  signature: string;
  ids: number[];
  reason: string;
};

type SingleFeedbackSignals = {
  penalizedSignatures: Set<string>;
  penalizedGarmentIds: Set<number>;
  rainMismatchSignal: boolean;
  materialMismatchSignal: boolean;
  formalityMismatchSignal: boolean;
  styleMismatchSignal: boolean;
  timeMismatchSignal: boolean;
  evidenceCounts: {
    rain: number;
    material: number;
    formality: number;
    style: number;
    time: number;
  };
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

const FEEDBACK_NEGATIVE_CUE_REGEX =
  /\b(too|not|isn't|isnt|doesn't|doesnt|didn't|didnt|mismatch|wrong|off|lack|lacking|missing|avoid|conflict|issue|problem|inappropriate|bad|poor)\b/;
const FEEDBACK_RAIN_REGEX =
  /\b(rain|rainy|wet|waterproof|water-resistant|water resistant|drizzle|soaked|umbrella|puddle|slippery)\b/;
const FEEDBACK_MATERIAL_REGEX =
  /\b(material|materials|fabric|textile|tweed|canvas|absorbent|technical|synthetic|polyester|nylon|wool|cotton|linen|denim|suede|leather)\b/;
const FEEDBACK_FORMALITY_REGEX =
  /\b(formality|too formal|too casual|dressy|underdressed|overdressed|formal|casual)\b/;
const FEEDBACK_STYLE_REGEX =
  /\b(style|vibe|aesthetic|silhouette|fit|theme|look|minimalist|classic|sporty|workwear|vintage|western|outdoorsy)\b/;
const FEEDBACK_TIME_REGEX =
  /\b(time|timing|all day|morning|afternoon|evening|night|daytime)\b/;

const hasMismatchSignal = ({
  reason,
  categoryRegex,
  allowCategoryOnly = false,
}: {
  reason: string;
  categoryRegex: RegExp;
  allowCategoryOnly?: boolean;
}): boolean => {
  if (!reason || !categoryRegex.test(reason)) return false;
  if (allowCategoryOnly) return true;
  return FEEDBACK_NEGATIVE_CUE_REGEX.test(reason);
};

const buildSingleFeedbackSignals = (rows: SingleFeedbackSignalRow[]): SingleFeedbackSignals => {
  const penalizedSignatures = new Set(rows.map((row) => row.signature).filter(Boolean));
  const penalizedGarmentIds = new Set(rows.flatMap((row) => row.ids));

  let rainEvidenceCount = 0;
  let materialEvidenceCount = 0;
  let formalityEvidenceCount = 0;
  let styleEvidenceCount = 0;
  let timeEvidenceCount = 0;

  for (const row of rows) {
    const reason = row.reason.toLowerCase();
    if (hasMismatchSignal({ reason, categoryRegex: FEEDBACK_RAIN_REGEX, allowCategoryOnly: true })) rainEvidenceCount += 1;
    if (hasMismatchSignal({ reason, categoryRegex: FEEDBACK_MATERIAL_REGEX })) materialEvidenceCount += 1;
    if (hasMismatchSignal({ reason, categoryRegex: FEEDBACK_FORMALITY_REGEX })) formalityEvidenceCount += 1;
    if (hasMismatchSignal({ reason, categoryRegex: FEEDBACK_STYLE_REGEX })) styleEvidenceCount += 1;
    if (hasMismatchSignal({ reason, categoryRegex: FEEDBACK_TIME_REGEX })) timeEvidenceCount += 1;
  }

  return {
    penalizedSignatures,
    penalizedGarmentIds,
    rainMismatchSignal: rainEvidenceCount > 0,
    materialMismatchSignal: materialEvidenceCount > 0,
    formalityMismatchSignal: formalityEvidenceCount > 0,
    styleMismatchSignal: styleEvidenceCount > 0,
    timeMismatchSignal: timeEvidenceCount > 0,
    evidenceCounts: {
      rain: rainEvidenceCount,
      material: materialEvidenceCount,
      formality: formalityEvidenceCount,
      style: styleEvidenceCount,
      time: timeEvidenceCount,
    },
  };
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

const buildSingleRequestFingerprint = ({
  weather,
  occasion,
  place,
  timeOfDay,
  locationHint,
  temporalTarget,
}: {
  weather: string[];
  occasion: string[];
  place: string[];
  timeOfDay: string[];
  locationHint?: string | null;
  temporalTarget?: SingleTemporalTargetResolution | null;
}): string =>
  {
    const temporalDateSegment = (() => {
      if (!temporalTarget) return new Date().toISOString().slice(0, 10);
      if (temporalTarget.targetType === "single_date" && temporalTarget.targetDate) {
        return temporalTarget.targetDate;
      }
      if (temporalTarget.targetType === "date_range" && temporalTarget.targetRange) {
        return `${temporalTarget.targetRange.startDate}_${temporalTarget.targetRange.endDate}`;
      }
      return new Date().toISOString().slice(0, 10);
    })();

    return [
      "single",
      normalizeFingerprintSegment(locationHint ?? ""),
      normalizeFingerprintSegment(weather.join(",")),
      normalizeFingerprintSegment(occasion.join(",")),
      normalizeFingerprintSegment(place.join(",")),
      normalizeFingerprintSegment(timeOfDay.join(",")),
      normalizeFingerprintSegment(temporalDateSegment),
    ].join("|");
  };

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

const getRecentSingleFeedbackSignals = async ({
  ownerKey,
  weatherProfile,
  derivedProfile,
}: {
  ownerKey: string;
  weatherProfile: WeatherProfile;
  derivedProfile: DerivedProfile;
}): Promise<SingleFeedbackSignals> => {
  const rows = await sql`
    SELECT lineup_signature, garment_ids_json, reason_text
    FROM ai_look_feedback
    WHERE owner_key = ${ownerKey}
      AND mode = 'single'
      AND vote = 'down'
      AND (
        COALESCE(NULLIF(weather_profile_json, ''), '{}')::jsonb->>'tempBand' = ${weatherProfile.tempBand}
        OR COALESCE(NULLIF(weather_profile_json, ''), '{}')::jsonb->>'wetSurfaceRisk' = ${weatherProfile.wetSurfaceRisk}
        OR COALESCE(NULLIF(derived_profile_json, ''), '{}')::jsonb->>'formality' = ${derivedProfile.formality ?? ""}
      )
    ORDER BY created_at DESC
    LIMIT 80;
  ` as Array<{
    lineup_signature: string;
    garment_ids_json: string;
    reason_text: string | null;
  }>;

  const normalizedRows: SingleFeedbackSignalRow[] = rows.map((row) => ({
    signature: normalize(row.lineup_signature),
    ids: parseHistoryIds(normalize(row.garment_ids_json)),
    reason: normalize(row.reason_text ?? ""),
  }));

  return buildSingleFeedbackSignals(normalizedRows);
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

const isToolSourcedDirective = (sourceTerms: string[]): boolean =>
  sourceTerms.some((term) => normalize(term).toLowerCase().startsWith("tool:"));

const getToolStyleTagGroups = (userDirectives?: UserIntentDirectives | null): string[][] => {
  if (!userDirectives) return [];

  const styleGroups = userDirectives.styleDirectives
    .filter((directive) => isToolSourcedDirective(directive.sourceTerms))
    .map((directive) => dedupeLowercase(directive.canonicalStyleTags));

  const referenceGroups = userDirectives.referenceDirectives
    .filter((directive) => isToolSourcedDirective(directive.sourceTerms))
    .map((directive) => dedupeLowercase(directive.styleBiasTags));

  return [...styleGroups, ...referenceGroups].filter((group) => group.length > 0);
};

const countCoveredToolStyleGroups = (
  lineup: Array<Pick<Garment, "style">>,
  toolStyleTagGroups: string[][]
): number => {
  if (toolStyleTagGroups.length === 0) return 0;
  const lineupStyles = new Set(lineup.map((garment) => normalize(garment.style).toLowerCase()).filter(Boolean));
  return toolStyleTagGroups.filter((group) =>
    group.some((tag) => lineupStyles.has(normalize(tag).toLowerCase()))
  ).length;
};

const getToolMaterialAvoidTerms = (userDirectives?: UserIntentDirectives | null): string[] => {
  if (!userDirectives) return [];
  return dedupeLowercase([
    ...userDirectives.styleDirectives
      .filter((directive) => isToolSourcedDirective(directive.sourceTerms))
      .flatMap((directive) => directive.materialBias.avoid),
    ...userDirectives.referenceDirectives
      .filter((directive) => isToolSourcedDirective(directive.sourceTerms))
      .flatMap((directive) => directive.materialBias.avoid),
  ]);
};

const candidateHasToolMaterialAvoidConflict = (
  candidate: SingleLookCandidate,
  toolMaterialAvoidTerms: string[]
): boolean => {
  if (toolMaterialAvoidTerms.length === 0) return false;
  const avoidTerms = toolMaterialAvoidTerms.map((term) => normalize(term).toLowerCase()).filter(Boolean);
  if (avoidTerms.length === 0) return false;

  for (const garment of candidate.lineupGarments) {
    const materials = (garment.material_composition ?? []).map((entry) => normalize(entry.material).toLowerCase());
    if (
      avoidTerms.some((avoid) =>
        materials.some((material) => material.includes(avoid))
      )
    ) {
      return true;
    }
  }
  return false;
};

type SingleLookRerankBreakdown = {
  total: number;
  baseConfidence: number;
  styleDirectiveScore: number;
  toolStyleCoveragePenalty: number;
  toolMaterialAvoidPenalty: number;
  matchingHistoryPenalty: number;
  historyOverlapPenalty: number;
  feedbackPenalty: number;
};

const computeSingleLookRerankBreakdown = ({
  candidate,
  history,
  intent,
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
  feedbackSignals,
}: {
  candidate: SingleLookCandidate;
  history: SingleLookHistoryEntry[];
  intent: CanonicalIntent;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
  feedbackSignals?: SingleFeedbackSignals | null;
}): SingleLookRerankBreakdown => {
  const styleDirectiveFit = computeStyleDirectiveFit({
    lineup: candidate.lineupGarments,
    userDirectives,
  });

  const toolStyleGroups = getToolStyleTagGroups(userDirectives);
  const coveredToolGroups = countCoveredToolStyleGroups(candidate.lineupGarments, toolStyleGroups);
  const missingToolGroups = Math.max(0, toolStyleGroups.length - coveredToolGroups);
  // Keep tool-style influence soft to avoid over-constraining diverse but valid candidates.
  const toolStyleCoveragePenalty = missingToolGroups * 4;

  const toolMaterialAvoidTerms = getToolMaterialAvoidTerms(userDirectives);
  // Material avoid conflicts should bias rerank, not hard-dominate it.
  const toolMaterialAvoidPenalty = candidateHasToolMaterialAvoidConflict(candidate, toolMaterialAvoidTerms) ? 6 : 0;

  const matchingHistoryCount = history.filter((item) => item.signature === candidate.signature).length;
  const matchingHistoryPenalty = matchingHistoryCount > 0 ? Math.min(48, matchingHistoryCount * 16) : 0;

  const historyIds = history.map((item) => item.ids).filter((ids) => ids.length > 0);
  const historyOverlap = historyIds.length > 0
    ? maxOverlapAgainstHistory(candidate.selectedGarmentIds, historyIds)
    : 0;
  const historyOverlapPenalty = Math.round(historyOverlap * 30);

  let feedbackPenalty = 0;
  if (feedbackSignals) {
    if (feedbackSignals.penalizedSignatures.has(candidate.signature)) {
      feedbackPenalty += 22;
    }

    const penalizedOverlapCount = candidate.selectedGarmentIds.filter((id) =>
      feedbackSignals.penalizedGarmentIds.has(id)
    ).length;
    feedbackPenalty += Math.min(28, penalizedOverlapCount * 7);

    const isWetContext = weatherProfile?.wetSurfaceRisk === "high" || weatherProfile?.wetSurfaceRisk === "medium";
    if (isWetContext && (feedbackSignals.rainMismatchSignal || feedbackSignals.materialMismatchSignal)) {
      let wetMaterialPenalty = 0;
      for (const garment of candidate.lineupGarments) {
        const category = categorizeType(garment.type);
        if (category !== "outerwear" && category !== "footwear") continue;
        const technicalShare = materialBucketShare(garment.material_composition, "technical");
        const absorbentShare = materialBucketShare(garment.material_composition, "absorbent");
        if (absorbentShare > 0.45 && technicalShare < 0.25) {
          wetMaterialPenalty += 12;
        }
      }
      feedbackPenalty += wetMaterialPenalty;
    }

    if (feedbackSignals.formalityMismatchSignal && derivedProfile?.formality) {
      const mismatches = candidate.lineupGarments.filter(
        (garment) => normalize(garment.formality).toLowerCase() !== derivedProfile.formality!.toLowerCase()
      ).length;
      feedbackPenalty += mismatches * 3;
    }

    if (feedbackSignals.styleMismatchSignal && (derivedProfile?.style.length ?? 0) > 0) {
      const mismatches = candidate.lineupGarments.filter(
        (garment) =>
          !derivedProfile!.style.some((style) => style.toLowerCase() === normalize(garment.style).toLowerCase())
      ).length;
      feedbackPenalty += mismatches * 2;
    }

    if (feedbackSignals.timeMismatchSignal && intent.timeOfDay.length > 0) {
      const mismatches = candidate.lineupGarments.filter(
        (garment) =>
          !Boolean(intersectionMatches(garment.suitable_time_of_day ?? [], intent.timeOfDay, { allDayAlias: "all day" }))
      ).length;
      feedbackPenalty += mismatches * 2;
    }

    if (feedbackSignals.materialMismatchSignal) {
      const materialScores = candidate.lineupGarments.map((garment) =>
        computeMaterialIntentScore({
          materialComposition: garment.material_composition,
          intent,
          category: categorizeType(garment.type),
          weatherContext,
          weatherProfile,
          derivedProfile,
        })
      );
      const averageMaterialScore = materialScores.length > 0
        ? materialScores.reduce((sum, value) => sum + value, 0) / materialScores.length
        : 0;
      if (averageMaterialScore < 0) {
        feedbackPenalty += Math.round(Math.abs(averageMaterialScore));
      }
    }
  }

  const total =
    candidate.confidence +
    styleDirectiveFit.score -
    toolStyleCoveragePenalty -
    toolMaterialAvoidPenalty -
    matchingHistoryPenalty -
    historyOverlapPenalty -
    feedbackPenalty;

  return {
    total,
    baseConfidence: candidate.confidence,
    styleDirectiveScore: styleDirectiveFit.score,
    toolStyleCoveragePenalty,
    toolMaterialAvoidPenalty,
    matchingHistoryPenalty,
    historyOverlapPenalty,
    feedbackPenalty,
  };
};

const computeSingleLookRerankScore = ({
  candidate,
  history,
  intent,
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
  feedbackSignals,
}: {
  candidate: SingleLookCandidate;
  history: SingleLookHistoryEntry[];
  intent: CanonicalIntent;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
  feedbackSignals?: SingleFeedbackSignals | null;
}): number => {
  return computeSingleLookRerankBreakdown({
    candidate,
    history,
    intent,
    weatherContext,
    weatherProfile,
    derivedProfile,
    userDirectives,
    feedbackSignals,
  }).total;
};

const chooseTopSingleLookCandidate = ({
  candidates,
  history,
  intent,
  weatherContext,
  weatherProfile,
  derivedProfile,
  userDirectives,
  feedbackSignals,
}: {
  candidates: SingleLookCandidate[];
  history: SingleLookHistoryEntry[];
  intent: CanonicalIntent;
  weatherContext?: string | null;
  weatherProfile?: WeatherProfile | null;
  derivedProfile?: DerivedProfile | null;
  userDirectives?: UserIntentDirectives | null;
  feedbackSignals?: SingleFeedbackSignals | null;
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

  const hasDirectiveStyles = (userDirectives?.merged.styleTagsPrefer.length ?? 0) > 0;
  if (hasDirectiveStyles) {
    const directiveFitThreshold = 10;
    const requestedStyleCount = userDirectives?.merged.styleTagsPrefer.length ?? 0;
    const minUniqueStyleCoverage = Math.min(2, requestedStyleCount);
    const primaryStyleAlignedPool = pool.filter((candidate) => {
      const fit = computeStyleDirectiveFit({ lineup: candidate.lineupGarments, userDirectives });
      return fit.score >= directiveFitThreshold && fit.matchedUniqueStyleTagCount >= minUniqueStyleCoverage;
    });
    if (primaryStyleAlignedPool.length > 0) {
      pool = primaryStyleAlignedPool;
    } else {
      const fallbackStyleAlignedPool = pool.filter((candidate) =>
        computeStyleDirectiveFit({ lineup: candidate.lineupGarments, userDirectives }).score >= directiveFitThreshold
      );
      if (fallbackStyleAlignedPool.length > 0) {
        pool = fallbackStyleAlignedPool;
      }
    }
  }

  const ranked = pool
    .map((candidate) => ({
      candidate,
      styleFit: computeStyleDirectiveFit({
        lineup: candidate.lineupGarments,
        userDirectives,
      }),
      rerankBreakdown: computeSingleLookRerankBreakdown({
        candidate,
        history,
        intent,
        weatherContext,
        weatherProfile,
        derivedProfile,
        userDirectives,
        feedbackSignals,
      }),
    }))
    .sort((left, right) => {
      if (right.rerankBreakdown.total !== left.rerankBreakdown.total) {
        return right.rerankBreakdown.total - left.rerankBreakdown.total;
      }
      if (right.styleFit.matchedUniqueStyleTagCount !== left.styleFit.matchedUniqueStyleTagCount) {
        return right.styleFit.matchedUniqueStyleTagCount - left.styleFit.matchedUniqueStyleTagCount;
      }
      if (right.styleFit.styleCoverageRatio !== left.styleFit.styleCoverageRatio) {
        return right.styleFit.styleCoverageRatio - left.styleFit.styleCoverageRatio;
      }
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
  const requestId = randomUUID();
  const toErrorDetails = (error: unknown) => {
    if (error instanceof Error) {
      return AI_LOOK_DEBUG
        ? { message: error.message, stack: error.stack ?? null }
        : { message: error.message };
    }
    return { message: String(error) };
  };
  const logInfo = (
    event: string,
    payload: Record<string, unknown>,
    options?: { debugOnly?: boolean }
  ) => {
    if (options?.debugOnly !== false && !AI_LOOK_DEBUG) return;
    console.info(event, JSON.stringify({ requestId, ...payload }));
  };
  const logWarn = (event: string, payload: Record<string, unknown>) => {
    console.warn(event, JSON.stringify({ requestId, ...payload }));
  };
  const logError = (event: string, payload: Record<string, unknown>) => {
    console.error(event, JSON.stringify({ requestId, ...payload }));
  };
  const responseJson = (
    body: Record<string, unknown>,
    init?: { status: number }
  ) => NextResponse.json({ requestId, ...body }, init);

  try {
    logInfo(
      "[ai-look][request][received]",
      {
        method: request.method,
        path: new URL(request.url).pathname,
      },
      { debugOnly: false }
    );

    if (!isAllowedOrigin(request)) {
      logWarn("[ai-look][request][rejected-origin]", { reason: "invalid-origin" });
      return responseJson({ error: "Invalid request origin." }, { status: 403 });
    }

    if (!(await isOwnerSession())) {
      logWarn("[ai-look][request][rejected-auth]", { reason: "owner-session-required" });
      return responseJson({ error: "Forbidden" }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsedTravelBody = travelRequestSchema.safeParse(rawBody);
    const parsedSingleBody = singleLookRequestSchema.safeParse(rawBody);
    if (!parsedTravelBody.success && !parsedSingleBody.success) {
      logWarn("[ai-look][request][invalid-payload]", { reason: "schema-parse-failed" });
      return responseJson({ error: "Invalid AI look payload." }, { status: 400 });
    }

    const ownerRateLimitKey = getOwnerKey();
    if (await isRateLimited(ownerRateLimitKey)) {
      logWarn("[ai-look][request][rate-limited]", { ownerRateLimitKey });
      return responseJson(
        { error: "Too many AI look requests. Please wait and try again." },
        { status: 429 }
      );
    }

    const wardrobeData = await getWardrobeData({ forceFresh: true });

    if (wardrobeData.length === 0) {
      logWarn("[ai-look][request][empty-wardrobe]", { ownerRateLimitKey });
      return responseJson({ error: "Wardrobe is empty. Add garments first." }, { status: 400 });
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
        logWarn("[ai-look][travel][invalid-date-range]", { startDate, endDate });
        return responseJson({ error: "Invalid date range." }, { status: 400 });
      }
      if (requestedDates.length > MAX_TRAVEL_PLAN_DAYS) {
        logWarn("[ai-look][travel][range-too-large]", {
          requestedDays: requestedDates.length,
          maxDays: MAX_TRAVEL_PLAN_DAYS,
        });
        return responseJson(
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
        logWarn("[ai-look][travel][history][read-failed]", {
          requestFingerprint: travelRequestFingerprint,
          error: toErrorDetails(error),
        });
      }
      const historicalTravelDaysByDate = new Map<string, TravelDayHistoryEntry[]>();
      for (const entry of historicalTravelDays) {
        const bucket = historicalTravelDaysByDate.get(entry.dayDate) ?? [];
        bucket.push(entry);
        historicalTravelDaysByDate.set(entry.dayDate, bucket);
      }
      logInfo(
        "[ai-look][travel][history][loaded]",
        {
          requestFingerprint: travelRequestFingerprint,
          rows: historicalTravelDays.length,
          distinctDates: historicalTravelDaysByDate.size,
        }
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
      const errandsOccasion = findCanonicalOption(OCCASION_OPTIONS, "Errands / Low-Key Social");

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
      const hasAnyWetTripDay = weatherByDate.days.some((day) =>
        isWetWeatherSafetyGateActive(day.summary, day.weatherProfile)
      );

      const travelConstraintForCategory = (
        envelope: TravelDayConstraintEnvelope,
        category: GarmentCategory
      ): StrictDayConstraints =>
        envelope.categoryOverrides[category] ?? envelope.defaultConstraints;

      const buildEligibleWardrobeForEnvelope = ({
        envelope,
        weatherTags,
      }: {
        envelope: TravelDayConstraintEnvelope;
        weatherTags: string[];
      }): CompactGarment[] =>
        compactWardrobe.filter((garment) => {
          const category = categorizeType(garment.type);
          const constraints = travelConstraintForCategory(envelope, category);
          const matchesPlace = hasAnyCanonicalMatch(garment.suitable_places ?? [], constraints.requiredPlaces);
          const matchesOccasion = hasAnyCanonicalMatch(garment.suitable_occasions ?? [], constraints.requiredOccasions);
          const matchesWeather = matchesWeatherIntent(garment.suitable_weather ?? [], weatherTags);
          return matchesPlace && matchesOccasion && matchesWeather;
        });

      const resolveTravelDayConstraintEnvelope = ({
        isTravelDay,
        strictConstraints,
        weatherTags,
      }: {
        isTravelDay: boolean;
        strictConstraints: StrictDayConstraints;
        weatherTags: string[];
      }): {
        envelope: TravelDayConstraintEnvelope;
        eligibleWardrobe: CompactGarment[];
        strictEligibleCount: number;
        strictMissingCore: GarmentCategory[];
      } => {
        const strictEnvelope: TravelDayConstraintEnvelope = {
          label: strictConstraints.label,
          relaxationLevel: "strict",
          defaultConstraints: strictConstraints,
          categoryOverrides: {},
        };
        const strictEligibleWardrobe = buildEligibleWardrobeForEnvelope({
          envelope: strictEnvelope,
          weatherTags,
        });
        const strictMissingCore = missingCoreSilhouetteCategoriesFromWardrobe(
          strictEligibleWardrobe,
          TRAVEL_REQUIRED_CATEGORIES
        );

        if (!isTravelDay) {
          return {
            envelope: strictEnvelope,
            eligibleWardrobe: strictEligibleWardrobe,
            strictEligibleCount: strictEligibleWardrobe.length,
            strictMissingCore,
          };
        }

        const topBottomFallbackPlaces = Array.from(
          new Set(
            [transitPlace, cityPlace, officePlace, workshopPlace, atelierPlace, ...reasonIntent.place]
              .filter((value): value is string => Boolean(value))
          )
        );
        const topBottomFallbackOccasions = Array.from(
          new Set(
            [
              transitOccasion,
              commuteOccasion,
              casualOccasion,
              errandsOccasion,
              businessOccasion,
              ...reasonIntent.occasion,
            ].filter((value): value is string => Boolean(value))
          )
        );

        const buildTopBottomOverride = (constraints: StrictDayConstraints): Partial<Record<GarmentCategory, StrictDayConstraints>> => ({
          top: constraints,
          bottom: constraints,
        });

        const candidateEnvelopes: TravelDayConstraintEnvelope[] = [
          strictEnvelope,
          {
            label: `${strictConstraints.label} + top/bottom place relaxation`,
            relaxationLevel: "travel_top_bottom_place",
            defaultConstraints: strictConstraints,
            categoryOverrides: buildTopBottomOverride({
              requiredPlaces: topBottomFallbackPlaces,
              requiredOccasions: strictConstraints.requiredOccasions,
              label: "Travel day top/bottom (place-relaxed)",
            }),
          },
          {
            label: `${strictConstraints.label} + top/bottom place+occasion relaxation`,
            relaxationLevel: "travel_top_bottom_place_occasion",
            defaultConstraints: strictConstraints,
            categoryOverrides: buildTopBottomOverride({
              requiredPlaces: topBottomFallbackPlaces,
              requiredOccasions: topBottomFallbackOccasions,
              label: "Travel day top/bottom (place+occasion-relaxed)",
            }),
          },
          {
            label: `${strictConstraints.label} + top/bottom reason-aware relaxation`,
            relaxationLevel: "travel_top_bottom_reason",
            defaultConstraints: strictConstraints,
            categoryOverrides: buildTopBottomOverride({
              requiredPlaces: topBottomFallbackPlaces,
              requiredOccasions: topBottomFallbackOccasions,
              label: "Travel day top/bottom (reason-aware)",
            }),
          },
        ];

        let bestEnvelope = candidateEnvelopes[0];
        let bestEligible = strictEligibleWardrobe;
        let bestMissing = strictMissingCore;

        for (const candidate of candidateEnvelopes) {
          const candidateEligible = buildEligibleWardrobeForEnvelope({
            envelope: candidate,
            weatherTags,
          });
          const candidateMissing = missingCoreSilhouetteCategoriesFromWardrobe(
            candidateEligible,
            TRAVEL_REQUIRED_CATEGORIES
          );

          const isViable = candidateEligible.length >= 4 && candidateMissing.length === 0;
          if (isViable) {
            return {
              envelope: candidate,
              eligibleWardrobe: candidateEligible,
              strictEligibleCount: strictEligibleWardrobe.length,
              strictMissingCore,
            };
          }

          const isBetterThanBest =
            candidateMissing.length < bestMissing.length ||
            (candidateMissing.length === bestMissing.length && candidateEligible.length > bestEligible.length);
          if (isBetterThanBest) {
            bestEnvelope = candidate;
            bestEligible = candidateEligible;
            bestMissing = candidateMissing;
          }
        }

        return {
          envelope: bestEnvelope,
          eligibleWardrobe: bestEligible,
          strictEligibleCount: strictEligibleWardrobe.length,
          strictMissingCore,
        };
      };

      if (outerwearGarmentIds.length === 0) {
        return responseJson(
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
            if (!matchesPlace || !matchesOccasion || !matchesWeather) return false;
            const dayWeather = weatherByDate.days[plan.dayIndex];
            if (!dayWeather) return false;
            const wetSafety = assessWetWeatherSafety(
              {
                type: garment.type,
                features: garment.features,
                material_composition: garment.material_composition,
              },
              {
                weatherContext: dayWeather.summary,
                weatherProfile: dayWeather.weatherProfile,
              }
            );
            return !wetSafety.gateActive || wetSafety.rainReady !== false;
          })
        );

      if (tripWideOuterwearCandidates.length === 0) {
        return responseJson(
          {
            error: hasAnyWetTripDay
              ? "Cannot build travel pack with one outerwear: no single rain-ready jacket/coat satisfies all days (weather/place/occasion)."
              : "Cannot build travel pack with one outerwear: no single jacket/coat satisfies all days (weather/place/occasion).",
          },
          { status: 422 }
        );
      }

      const tripDerivedStyling = deriveStylingFromContext({
        weather: Array.from(new Set(dayConstraintPlans.flatMap((plan) => plan.weatherTags))),
        occasion: Array.from(new Set(dayConstraintPlans.flatMap((plan) => plan.strictConstraints.requiredOccasions))),
        place: Array.from(new Set(dayConstraintPlans.flatMap((plan) => plan.strictConstraints.requiredPlaces))),
        timeOfDay: timeAllDay ? [timeAllDay] : [],
        weatherContext: weatherByDate.days.map((day) => day.summary).join(" "),
        weatherProfile: weatherByDate.days[0]?.weatherProfile ?? null,
      });

      tripWideOuterwearCandidates.sort((left, right) => {
        const leftRainReadyScore = hasAnyWetTripDay
          ? (assessWetWeatherSafety(
              {
                type: left.type,
                features: left.features,
                material_composition: left.material_composition,
              },
              {
                weatherContext: weatherByDate.days[0]?.summary,
                weatherProfile: weatherByDate.days[0]?.weatherProfile ?? null,
              }
            ).rainReady === true ? 12 : 0)
          : 0;
        const rightRainReadyScore = hasAnyWetTripDay
          ? (assessWetWeatherSafety(
              {
                type: right.type,
                features: right.features,
                material_composition: right.material_composition,
              },
              {
                weatherContext: weatherByDate.days[0]?.summary,
                weatherProfile: weatherByDate.days[0]?.weatherProfile ?? null,
              }
            ).rainReady === true ? 12 : 0)
          : 0;
        const leftScore =
          leftRainReadyScore +
          (left.favorite ? 6 : 0) +
          (tripDerivedStyling.formality && normalize(left.formality).toLowerCase() === tripDerivedStyling.formality.toLowerCase() ? 8 : 0) +
          (tripDerivedStyling.style.some((style) => normalize(left.style).toLowerCase() === style.toLowerCase()) ? 8 : 0);
        const rightScore =
          rightRainReadyScore +
          (right.favorite ? 6 : 0) +
          (tripDerivedStyling.formality && normalize(right.formality).toLowerCase() === tripDerivedStyling.formality.toLowerCase() ? 8 : 0) +
          (tripDerivedStyling.style.some((style) => normalize(right.style).toLowerCase() === style.toLowerCase()) ? 8 : 0);
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
        lineupSignature: string;
        weatherProfile: WeatherProfile;
        derivedProfile: DerivedProfile;
        interpretedIntent: CanonicalIntent;
      }> = [];
      const travelFinalDebugDays: Array<{
        date: string;
        lookName: string;
        lineupSignature: string;
        garments: Garment[];
        rationale: string;
        confidence: number;
        modelConfidence: number;
        matchScore: number;
        weatherContext: string;
        weatherProfile: WeatherProfile;
        interpretedIntent: CanonicalIntent;
        derivedProfile: DerivedProfile;
      }> = [];
      const skippedDays: Array<{ date: string; reason: string; weatherContext: string; weatherStatus: "forecast" | "seasonal" | "failed" }> = [];
      const travelDaysToPersist: Array<{ dayDate: string; dayIndex: number; signature: string; ids: number[] }> = [];

      for (let index = 0; index < weatherByDate.days.length; index += 1) {
        const dayWeather = weatherByDate.days[index];
        const dayPlan = dayConstraintPlans[index];
        const isTravelDay = dayPlan.isTravelDay;
        const strictConstraints = dayPlan.strictConstraints;
        const {
          envelope: dayConstraintEnvelope,
          eligibleWardrobe,
          strictEligibleCount,
          strictMissingCore,
        } = resolveTravelDayConstraintEnvelope({
          isTravelDay,
          strictConstraints,
          weatherTags: dayPlan.weatherTags,
        });
        const dayConstraintsForCategory = (category: GarmentCategory): StrictDayConstraints =>
          travelConstraintForCategory(dayConstraintEnvelope, category);
        const topCategoryConstraints = dayConstraintsForCategory("top");
        const dayOccasion = isTravelDay
          ? Array.from(new Set([
              ...strictConstraints.requiredOccasions,
              ...topCategoryConstraints.requiredOccasions,
            ]))
          : reasonIntent.occasion;
        const dayPlace = isTravelDay
          ? Array.from(new Set([
              ...strictConstraints.requiredPlaces,
              ...topCategoryConstraints.requiredPlaces,
            ]))
          : reasonIntent.place;
        const fallbackDayContext: ContextIntent = {
          weather: toCanonicalValues(dayWeather.weather, WEATHER_OPTIONS),
          occasion: dayOccasion,
          place: dayPlace,
          timeOfDay: timeAllDay ? [timeAllDay] : [],
          notes: isTravelDay
            ? `${reasonIntent.notes} This is a travel/commute day (airport/transit), prioritize mobility and comfort while staying context-appropriate. Destination: ${weatherByDate.locationLabel}.`
            : `${reasonIntent.notes} Destination: ${weatherByDate.locationLabel}.`,
        };

        if (isTravelDay && dayConstraintEnvelope.relaxationLevel !== "strict") {
          logInfo("[ai-look][travel][constraints][relaxed]", {
            date: dayWeather.date,
            strictLabel: strictConstraints.label,
            effectiveLabel: dayConstraintEnvelope.label,
            relaxationLevel: dayConstraintEnvelope.relaxationLevel,
            strictEligibleCount,
            effectiveEligibleCount: eligibleWardrobe.length,
            strictMissingCore,
            effectiveMissingCore: missingCoreSilhouetteCategoriesFromWardrobe(
              eligibleWardrobe,
              TRAVEL_REQUIRED_CATEGORIES
            ),
            strictPlaces: strictConstraints.requiredPlaces,
            strictOccasions: strictConstraints.requiredOccasions,
            topBottomPlaces: topCategoryConstraints.requiredPlaces,
            topBottomOccasions: topCategoryConstraints.requiredOccasions,
          });
        }

        const eligibleIdSet = new Set(eligibleWardrobe.map((garment) => garment.id));

        if (eligibleWardrobe.length < 4) {
          skippedDays.push({
            date: dayWeather.date,
            reason: `Not enough garments satisfy ${dayConstraintEnvelope.label.toLowerCase()} weather/place/occasion constraints.`,
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
            reason: `${dayConstraintEnvelope.label} weather/place/occasion constraints do not include required ${missingCoreInEligible.join(", ")} garments for a full look.`,
            weatherContext: dayWeather.summary,
            weatherStatus: dayWeather.status,
          });
          continue;
        }

        let dayContext: ContextIntent = fallbackDayContext;
        try {
          const { output: interpretedTravelDayContext } = await generateText({
            model: openai("gpt-4.1-mini"),
            output: Output.object({
              schema: contextIntentSchema,
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
                effectiveTopBottomPlaces: topCategoryConstraints.requiredPlaces,
                effectiveTopBottomOccasions: topCategoryConstraints.requiredOccasions,
                constraintRelaxationLevel: dayConstraintEnvelope.relaxationLevel,
              })}`,
              "Map this day to canonical intent arrays and concise notes.",
            ].join("\n\n"),
          });

          dayContext = {
            weather: (() => {
              const interpretedWeather = toCanonicalValues(interpretedTravelDayContext.weather, WEATHER_OPTIONS);
              const merged = Array.from(new Set([...fallbackDayContext.weather, ...interpretedWeather]));
              return merged.length > 0 ? merged : fallbackDayContext.weather;
            })(),
            occasion: (() => {
              const merged = [
                ...fallbackDayContext.occasion,
                ...toCanonicalValues(interpretedTravelDayContext.occasion, OCCASION_OPTIONS),
              ];
              return merged.length > 0 ? Array.from(new Set(merged)) : fallbackDayContext.occasion;
            })(),
            place: (() => {
              const merged = [
                ...fallbackDayContext.place,
                ...toCanonicalValues(interpretedTravelDayContext.place, PLACE_OPTIONS),
              ];
              return merged.length > 0 ? Array.from(new Set(merged)) : fallbackDayContext.place;
            })(),
            timeOfDay: (() => {
              const interpretedTimes = toCanonicalValues(interpretedTravelDayContext.timeOfDay, TIME_OPTIONS);
              return interpretedTimes.length > 0 ? interpretedTimes : fallbackDayContext.timeOfDay;
            })(),
            notes: normalize(interpretedTravelDayContext.notes) || fallbackDayContext.notes,
          };
        } catch (error) {
          logWarn("[ai-look][travel][day-intent][fallback-used]", {
            date: dayWeather.date,
            error: toErrorDetails(error),
          });
        }

        const dayDerivedProfile = buildDerivedProfileFromContext({
          context: dayContext,
          weatherContext: dayWeather.summary,
          weatherProfile: dayWeather.weatherProfile,
        });
        const dayIntent = buildCanonicalIntentFromContext({
          context: dayContext,
          weatherContext: dayWeather.summary,
          weatherProfile: dayWeather.weatherProfile,
          derivedProfile: dayDerivedProfile,
        });

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
          weatherContext: dayWeather.summary,
          weatherProfile: dayWeather.weatherProfile,
          derivedProfile: dayDerivedProfile,
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
          logInfo(
            "[ai-look][travel][history][day-loaded]",
            {
              date: dayWeather.date,
              rows: dayHistoricalRows.length,
              signatures: historicalSignatures.size,
            }
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
              dayPlan.weatherTags.length > 0
                ? `STRICT WEATHER RULE (every selected garment must match at least one): ${JSON.stringify(dayPlan.weatherTags)}`
                : "No strict weather tags available for this day.",
              isTravelDay && dayConstraintEnvelope.relaxationLevel !== "strict"
                ? `STRICT PLACE RULE: outerwear+footwear must match ${JSON.stringify(strictConstraints.requiredPlaces)}; top+bottom may match ${JSON.stringify(topCategoryConstraints.requiredPlaces)}.`
                : `STRICT PLACE RULE (every selected garment must match at least one): ${JSON.stringify(strictConstraints.requiredPlaces)}`,
              isTravelDay && dayConstraintEnvelope.relaxationLevel !== "strict"
                ? `STRICT OCCASION RULE: outerwear+footwear must match ${JSON.stringify(strictConstraints.requiredOccasions)}; top+bottom may match ${JSON.stringify(topCategoryConstraints.requiredOccasions)}.`
                : `STRICT OCCASION RULE (every selected garment must match at least one): ${JSON.stringify(strictConstraints.requiredOccasions)}`,
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
            weatherContext: dayWeather.summary,
            weatherProfile: dayWeather.weatherProfile,
            derivedProfile: dayDerivedProfile,
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
            weatherContext: dayWeather.summary,
            weatherProfile: dayWeather.weatherProfile,
            derivedProfile: dayDerivedProfile,
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
            logInfo(
              "[ai-look][travel][history][retry-on-repeat]",
              {
                date: dayWeather.date,
                signature: firstPassSignature,
              }
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
            const category = categorizeType(garment.type);
            const constraints = dayConstraintsForCategory(category);
            return !hasAnyCanonicalMatch(garment.suitable_places ?? [], constraints.requiredPlaces);
          });
          const violatesOccasionRule = orderedIds.some((id) => {
            const garment = garmentById.get(id);
            if (!garment) return true;
            const category = categorizeType(garment.type);
            const constraints = dayConstraintsForCategory(category);
            return !hasAnyCanonicalMatch(garment.suitable_occasions ?? [], constraints.requiredOccasions);
          });
          const violatesWeatherRule =
            dayPlan.weatherTags.length > 0 &&
            orderedIds.some((id) => {
              const garment = garmentById.get(id);
              if (!garment) return true;
              return !matchesWeatherIntent(garment.suitable_weather ?? [], dayPlan.weatherTags);
            });
          const violatesHardConstraintRule = orderedIds.some((id) => {
            const garment = garmentById.get(id);
            if (!garment) return true;
            return !evaluateGarmentHardConstraints(
              {
                type: garment.type,
                features: garment.features,
                material_composition: garment.material_composition,
                suitable_weather: garment.suitable_weather,
                suitable_occasions: garment.suitable_occasions,
                suitable_places: garment.suitable_places,
              },
              dayIntent,
              {
                weatherContext: dayWeather.summary,
                weatherProfile: dayWeather.weatherProfile,
              }
            ).passes;
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
            violatesWeatherRule,
            violatesHardConstraintRule,
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
          violatesWeatherRule,
          violatesHardConstraintRule,
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
              violatesWeatherRule,
              violatesHardConstraintRule,
              violatesCoreSilhouette,
              violatesDuplicateLookRule,
              violatesHighOverlapRule,
              violatesHistoricalRepeatRule,
              historicalOverlap,
            } = computeDayViolations(relaxedNormalized.ids));
            generatedDay = relaxedGeneratedDay;
            logInfo(
              "[ai-look][travel][fallback][relaxed-diversity-attempted]",
              {
                date: dayWeather.date,
                signature,
                resolvedCoreSilhouette: !violatesCoreSilhouette,
              }
            );
          } catch (error) {
            logWarn("[ai-look][travel][fallback][relaxed-diversity-failed]", {
              date: dayWeather.date,
              error: toErrorDetails(error),
            });
          }
        }

        const hasStrictDayViolation =
          orderedIds.length === 0 ||
          violatesFootwearRule ||
          violatesOuterwearRule ||
          violatesTransitReserveRule ||
          violatesPlaceRule ||
          violatesOccasionRule ||
          violatesWeatherRule ||
          violatesHardConstraintRule ||
          violatesCoreSilhouette ||
          violatesDuplicateLookRule ||
          violatesHighOverlapRule;

        if (violatesHistoricalRepeatRule && !hasStrictDayViolation) {
          logInfo(
            "[ai-look][travel][history][repeat-allowed]",
            {
              date: dayWeather.date,
              signature,
              historicalOverlap,
            }
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
          violatesWeatherRule ||
          violatesHardConstraintRule ||
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
                      : violatesHardConstraintRule
                        ? "Could not satisfy wet-weather safety rule (rain-ready outerwear/footwear required)."
                      : violatesPlaceRule || violatesOccasionRule || violatesWeatherRule
                        ? `Could not satisfy ${dayConstraintEnvelope.label.toLowerCase()} weather/place/occasion constraints.`
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

        const matchScore = computeObjectiveMatchScore(lineupGarments, dayIntent, {
          weatherContext: dayWeather.summary,
          weatherProfile: dayWeather.weatherProfile,
          derivedProfile: dayDerivedProfile,
        });
        const modelConfidence = normalizeModelConfidence(generatedDay.modelConfidence);
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
        logInfo(
          "[ai-look][travel][day-selected]",
          {
            date: dayWeather.date,
            signature,
            repeatedFromHistory: historicalSignatures.has(signature),
            historicalOverlap,
            weatherProfile: dayWeather.weatherProfile,
            ruleTrace: buildLineupRuleTrace({
              lineup: lineupGarments,
              intent: dayIntent,
              weatherContext: dayWeather.summary,
              weatherProfile: dayWeather.weatherProfile,
              derivedProfile: dayDerivedProfile,
            }),
          }
        );
        const finalDayRationale = buildAlignedRationale({
          lineupGarments,
          intent: dayIntent,
          weatherContext: dayWeather.summary,
          contextLabel: `travel day in ${weatherByDate.locationLabel}`,
        });
        logInfo(
          "[ai-look][travel][day-final-output]",
          {
            date: dayWeather.date,
            lookName: generatedDay.lookName,
            lineupSignature: signature,
            garments: lineupGarments,
            rationale: finalDayRationale,
            confidence,
            modelConfidence,
            matchScore,
            weatherContext: dayWeather.summary,
            weatherProfile: dayWeather.weatherProfile,
            interpretedIntent: dayIntent,
            derivedProfile: dayDerivedProfile,
          }
        );
        days.push({
          date: dayWeather.date,
          lookName: generatedDay.lookName,
          lineup,
          lineupSignature: signature,
          rationale: finalDayRationale,
          confidence,
          modelConfidence,
          matchScore,
          weatherContext: dayWeather.summary,
          weatherStatus: dayWeather.status,
          weatherProfile: dayWeather.weatherProfile,
          derivedProfile: dayDerivedProfile,
          reusedGarmentIds,
          interpretedIntent: dayIntent,
        });
        travelFinalDebugDays.push({
          date: dayWeather.date,
          lookName: generatedDay.lookName,
          lineupSignature: signature,
          garments: lineupGarments,
          rationale: finalDayRationale,
          confidence,
          modelConfidence,
          matchScore,
          weatherContext: dayWeather.summary,
          weatherProfile: dayWeather.weatherProfile,
          interpretedIntent: dayIntent,
          derivedProfile: dayDerivedProfile,
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
          logInfo(
            "[ai-look][travel][history][persisted]",
            {
              requestFingerprint: travelRequestFingerprint,
              rows: travelDaysToPersist.length,
            }
          );
        } catch (error) {
          logWarn("[ai-look][travel][history][write-failed]", {
            requestFingerprint: travelRequestFingerprint,
            error: toErrorDetails(error),
          });
        }
      }

      logInfo(
        "[ai-look][travel][final-output]",
        {
          requestFingerprint: travelRequestFingerprint,
          destination: weatherByDate.locationLabel,
          reason,
          startDate,
          endDate,
          days: travelFinalDebugDays,
          skippedDays,
        }
      );

      return responseJson({
        mode: "travel",
        requestFingerprint: travelRequestFingerprint,
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
      logWarn("[ai-look][single][invalid-payload]", { reason: "schema-parse-failed" });
      return responseJson({ error: "Invalid prompt payload." }, { status: 400 });
    }

    const userPrompt = parsedSingleBody.data.prompt;
    const requestedAnchorGarmentId = parsedSingleBody.data.anchorGarmentId ?? null;
    const requestedAnchorMode: AnchorMode = parsedSingleBody.data.anchorMode ?? "strict";

    const { output: interpretedContext, toolResults } = await generateText({
      model: openai("gpt-4.1-mini"),
      output: Output.object({
        schema: contextIntentSchema,
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
              weatherProfile: weather?.weatherProfile ?? null,
            };
          },
        }),
      },
      stopWhen: stepCountIs(6),
      temperature: 0.3,
      system: INTERPRETER_APPENDIX,
      prompt: `Canonical options:\n${JSON.stringify(canonicalOptions)}\n\nUser request:\n${userPrompt}`,
    });
    logInfo("[ai-look][single][step-1][interpreted-context]", interpretedContext as Record<string, unknown>);

    const latestWeatherToolResult = [...toolResults]
      .reverse()
      .find((result) => result.type === "tool-result" && result.toolName === "getWeatherByLocation");
    const weatherOutput =
      latestWeatherToolResult && typeof latestWeatherToolResult.output === "object" && latestWeatherToolResult.output
        ? latestWeatherToolResult.output as { summary?: string; weather?: string[]; weatherProfile?: WeatherProfile | null }
        : null;
    let weatherContextSummary = normalize(weatherOutput?.summary);
    let resolvedWeatherTags = dedupeCanonicalWeather(weatherOutput?.weather ?? []);
    let resolvedWeatherProfile: WeatherProfile | null = weatherOutput?.weatherProfile ?? null;
    let weatherStatus: WeatherContextStatus = "not_requested";
    let weatherContextSource: WeatherContextSource = weatherContextSummary ? "model_tool" : "none";
    let temporalWeatherStatus: SingleTemporalWeatherStatus | null = null;

    let profileDefaultLocation: string | null = null;
    try {
      const userProfile = await getUserProfileByOwnerKey(ownerRateLimitKey);
      profileDefaultLocation = userProfile?.defaultLocation ?? null;
    } catch (error) {
      logWarn("[ai-look][single][profile][load-failed]", {
        ownerKey: ownerRateLimitKey,
        error: toErrorDetails(error),
      });
    }

    const promptLocationHint = extractLocationHintFromPrompt(userPrompt);
    const locationHint = promptLocationHint || profileDefaultLocation || null;
    const resolvedLocationSource = promptLocationHint
      ? "prompt"
      : profileDefaultLocation
        ? "profile"
        : "none";

    // Fallback: if first pass skipped tool call, force one when a resolved location exists.
    const temporalTarget = resolveSingleTemporalTargetFromPrompt(userPrompt, new Date());
    if (locationHint) {
      weatherStatus = "location_detected";
    }
    logInfo(
      "[ai-look][single][step-1][temporal-resolution]",
      {
        targetType: temporalTarget.targetType,
        targetDate: temporalTarget.targetDate,
        targetRange: temporalTarget.targetRange,
        trigger: temporalTarget.trigger,
        resolvedBy: temporalTarget.resolvedBy,
        locationHint: locationHint || null,
        resolvedLocationSource,
      }
    );

    const temporalDateAwareTarget =
      Boolean(locationHint) &&
      (temporalTarget.targetType === "single_date" || temporalTarget.targetType === "date_range");

    if (temporalDateAwareTarget && locationHint) {
      weatherContextSummary = "";
      resolvedWeatherTags = [];
      resolvedWeatherProfile = null;
      weatherContextSource = "none";

      try {
        const temporalWeather = await resolveSingleTemporalWeather({
          locationHint,
          temporalTarget,
        });
        if (temporalWeather) {
          weatherContextSummary = normalize(temporalWeather.weatherContextSummary);
          resolvedWeatherTags = dedupeCanonicalWeather(temporalWeather.weatherTags);
          resolvedWeatherProfile = temporalWeather.weatherProfile;
          weatherContextSource = temporalWeather.source;
          temporalWeatherStatus = temporalWeather.status;
        } else {
          temporalWeatherStatus = "failed";
        }
      } catch (error) {
        temporalWeatherStatus = "failed";
        logWarn("[ai-look][single][weather][temporal-fetch-failed]", {
          locationHint,
          targetType: temporalTarget.targetType,
          targetDate: temporalTarget.targetDate,
          targetRange: temporalTarget.targetRange,
          error: toErrorDetails(error),
        });
      }
    }

    if (!temporalDateAwareTarget && !weatherContextSummary) {
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
                  weatherProfile: weather?.weatherProfile ?? null,
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
            ? fallbackToolResult.output as { summary?: string; weather?: string[]; weatherProfile?: WeatherProfile | null }
            : null;
        weatherContextSummary = normalize(fallbackOutput?.summary);
        const fallbackWeatherTags = dedupeCanonicalWeather(fallbackOutput?.weather ?? []);
        if (fallbackWeatherTags.length > 0) {
          resolvedWeatherTags = fallbackWeatherTags;
        }
        if (fallbackOutput?.weatherProfile) {
          resolvedWeatherProfile = fallbackOutput.weatherProfile;
        }
        if (weatherContextSummary) {
          weatherContextSource = "forced_tool";
        }
      }
    }

    // Final fallback: deterministic server-side fetch if tool path returned no weather.
    if (!temporalDateAwareTarget && !weatherContextSummary && locationHint) {
      try {
        const directWeather = await fetchWeatherContext(locationHint);
        weatherContextSummary = normalize(directWeather?.summary);
        const directWeatherTags = dedupeCanonicalWeather(directWeather?.weather ?? []);
        if (directWeatherTags.length > 0) {
          resolvedWeatherTags = directWeatherTags;
        }
        if (directWeather?.weatherProfile) {
          resolvedWeatherProfile = directWeather.weatherProfile;
        }
        if (weatherContextSummary) {
          weatherContextSource = "direct_fetch";
        }
      } catch (error) {
        logWarn("[ai-look][single][weather][direct-fetch-failed]", {
          locationHint,
          error: toErrorDetails(error),
        });
      }
    }

    if (temporalDateAwareTarget) {
      if (temporalWeatherStatus && temporalWeatherStatus !== "failed") {
        weatherStatus = "fetched";
      } else if (locationHint) {
        weatherStatus = "failed";
      }
    } else {
      if (weatherContextSummary) {
        weatherStatus = "fetched";
      } else if (locationHint) {
        weatherStatus = "failed";
      }
    }
    logInfo(
      "[ai-look][single][step-1][weather-resolution]",
      {
        weatherStatus,
        weatherContextSource,
        locationHint: locationHint || null,
        temporalTargetType: temporalTarget.targetType,
        temporalTargetDate: temporalTarget.targetDate,
        temporalTargetRange: temporalTarget.targetRange,
        temporalWeatherStatus,
        resolvedLocationSource,
        resolvedWeatherTags,
        weatherProfile: resolvedWeatherProfile,
      }
    );

    const interpretedWeather = toCanonicalValues(interpretedContext.weather, WEATHER_OPTIONS);
    const canonicalWeather = resolvedWeatherTags.length > 0 ? resolvedWeatherTags : interpretedWeather;
    const interpretedNotes = normalize(interpretedContext.notes);
    const cleanedInterpretedNotes = stripStyleDirectiveDisclaimers(interpretedNotes);
    const withoutWeatherStatusClaims = stripWeatherStatusClaims(cleanedInterpretedNotes);
    const canonicalNotes = weatherContextSummary
      ? withoutWeatherStatusClaims
      : withoutWeatherStatusClaims || cleanedInterpretedNotes;

    const canonicalContext: ContextIntent = {
      weather: canonicalWeather,
      occasion: toCanonicalValues(interpretedContext.occasion, OCCASION_OPTIONS),
      place: toCanonicalValues(interpretedContext.place, PLACE_OPTIONS),
      timeOfDay: toCanonicalValues(interpretedContext.timeOfDay, TIME_OPTIONS),
      notes: canonicalNotes,
    };
    const canonicalWeatherProfile = resolvedWeatherProfile ?? buildFallbackWeatherProfile({
      weatherTags: canonicalContext.weather,
      summary: weatherContextSummary || canonicalNotes,
      confidence: weatherContextSummary ? "medium" : "low",
    });
    logInfo("[ai-look][single][step-1][canonical-context]", { ...canonicalContext });

    let styleCatalog: StyleDirectiveCatalogEntry[] = [];
    try {
      styleCatalog = await getActiveStyleDirectiveCatalog();
      logInfo("[ai-look][single][step-1][style-catalog]", {
        loaded: styleCatalog.length,
      });
    } catch (error) {
      logWarn("[ai-look][single][step-1][style-catalog][load-failed]", {
        error: toErrorDetails(error),
      });
    }
    let referenceCatalog: ReferenceDirectiveCatalogEntry[] = [];
    try {
      referenceCatalog = await getActiveReferenceDirectiveCatalog(ownerRateLimitKey);
      logInfo("[ai-look][single][step-1][reference-catalog]", {
        loaded: referenceCatalog.length,
      });
    } catch (error) {
      logWarn("[ai-look][single][step-1][reference-catalog][load-failed]", {
        error: toErrorDetails(error),
      });
    }

    const userDirectives = extractUserIntentDirectives({
      userPrompt,
      styleCatalog,
      referenceCatalog,
      selectedTools: parsedSingleBody.data.selectedTools,
    });
    logInfo("[ai-look][single][step-1][selected-tools]", {
      requested: parsedSingleBody.data.selectedTools ?? [],
      applied: userDirectives.selectedTools,
    });
    logInfo("[ai-look][single][step-1][user-directives]", {
      selectedTools: userDirectives.selectedTools,
      styleDirectives: userDirectives.styleDirectives,
      referenceDirectives: userDirectives.referenceDirectives,
      merged: userDirectives.merged,
    });

    const derivedProfileBase = buildDerivedProfileFromContext({
      context: canonicalContext,
      weatherContext: weatherContextSummary || null,
      weatherProfile: canonicalWeatherProfile,
    });
    const derivedProfile = mergeDerivedProfileWithUserDirectives({
      derivedProfile: derivedProfileBase,
      userDirectives,
    });
    const canonicalIntent = buildCanonicalIntentFromContext({
      context: canonicalContext,
      weatherContext: weatherContextSummary || null,
      weatherProfile: canonicalWeatherProfile,
      derivedProfile,
    });
    logInfo(
      "[ai-look][single][step-1][derived-styling]",
      {
        formality: derivedProfile.formality,
        style: derivedProfile.style,
        materialTargets: derivedProfile.materialTargets,
      }
    );
    logInfo("[ai-look][single][step-1][canonical-intent]", { ...canonicalIntent });

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
        return responseJson(
          { error: `Anchored garment ${requestedAnchorGarmentId} was not found in your wardrobe.` },
          { status: 422 }
        );
      }
      const anchorCategory = garmentCategoryById.get(requestedAnchorGarmentId) ?? "other";
      const isAnchorCompatible = SINGLE_REQUIRED_CATEGORIES.includes(anchorCategory);
      if (!isAnchorCompatible && requestedAnchorMode === "strict") {
        return responseJson(
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
    logInfo(
      "[ai-look][single][anchor][request]",
      {
        requestedAnchorGarmentId,
        requestedAnchorMode,
        effectiveAnchorGarmentId,
        effectiveAnchorMode,
        effectiveAnchorCategory,
      }
    );
    const missingSingleCategories = missingCoreSilhouetteCategoriesFromWardrobe(
      compactWardrobe,
      SINGLE_REQUIRED_CATEGORIES
    );
    if (missingSingleCategories.length > 0) {
      return responseJson(
        { error: `AI could not produce a complete look. Missing category data: ${missingSingleCategories.join(", ")}.` },
        { status: 422 }
      );
    }
    const missingWeatherCompatibleSingleCategories = missingWeatherCompatibleCategoriesFromWardrobe(
      compactWardrobe,
      canonicalIntent.weather,
      SINGLE_REQUIRED_CATEGORIES
    );
    if (missingWeatherCompatibleSingleCategories.length > 0) {
      const weatherLabel = canonicalIntent.weather.join(", ");
      return responseJson(
        {
          error: `AI could not produce a weather-compatible complete look for ${weatherLabel}. Missing category data: ${missingWeatherCompatibleSingleCategories.join(", ")}.`,
        },
        { status: 422 }
      );
    }
    const missingWetSafeSingleCategories = missingWetSafeCategoriesFromWardrobe(
      compactWardrobe,
      canonicalIntent,
      {
        weatherContext: weatherContextSummary || null,
        weatherProfile: canonicalWeatherProfile,
      },
      ["outerwear", "footwear"]
    );
    if (missingWetSafeSingleCategories.length > 0) {
      return responseJson(
        {
          error: `AI could not produce a rain-ready complete look for current wet conditions. Missing rain-safe category data: ${missingWetSafeSingleCategories.join(", ")}.`,
        },
        { status: 422 }
      );
    }

    let recentSingleHistory: SingleLookHistoryEntry[] = [];
    try {
      recentSingleHistory = await getRecentSingleLookHistory(ownerRateLimitKey);
    } catch (error) {
      logWarn("[ai-look][single][history][read-failed]", {
        error: toErrorDetails(error),
      });
    }
    const recentSignatureSet = recentSignatureSetFromHistory(recentSingleHistory);
    const recentUsedIds = recentUsedIdSetFromHistory(recentSingleHistory);
    let singleFeedbackSignals: SingleFeedbackSignals | null = null;
    try {
      singleFeedbackSignals = await getRecentSingleFeedbackSignals({
        ownerKey: ownerRateLimitKey,
        weatherProfile: canonicalWeatherProfile,
        derivedProfile,
      });
      logInfo("[ai-look][single][feedback-signals][loaded]", {
        penalizedSignatures: singleFeedbackSignals.penalizedSignatures.size,
        penalizedGarmentIds: singleFeedbackSignals.penalizedGarmentIds.size,
        rainMismatchSignal: singleFeedbackSignals.rainMismatchSignal,
        materialMismatchSignal: singleFeedbackSignals.materialMismatchSignal,
        formalityMismatchSignal: singleFeedbackSignals.formalityMismatchSignal,
        styleMismatchSignal: singleFeedbackSignals.styleMismatchSignal,
        timeMismatchSignal: singleFeedbackSignals.timeMismatchSignal,
        evidenceCounts: singleFeedbackSignals.evidenceCounts,
      });
    } catch (error) {
      logWarn("[ai-look][single][feedback-signals][read-failed]", {
        error: toErrorDetails(error),
      });
    }

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
            `Structured weather profile (deterministic):\n${JSON.stringify(canonicalWeatherProfile)}`,
            `Derived profile (deterministic):\n${JSON.stringify(derivedProfile)}`,
            `User style/reference directives (deterministic):\n${JSON.stringify(userDirectives)}`,
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
            canonicalIntent.weather.length > 0
              ? `STRICT WEATHER RULE: Every selected garment must match at least one weather tag from ${JSON.stringify(canonicalIntent.weather)} (treat 'all season' as compatible).`
              : "No strict weather tags available.",
            userDirectives.merged.styleTagsPrefer.length > 0
              ? `STYLE DIRECTIVE RULE: Prioritize candidates aligned with requested style tags ${JSON.stringify(userDirectives.merged.styleTagsPrefer)} while preserving hard context constraints.`
              : "No explicit user style directives detected.",
            `Wardrobe JSON:\n${JSON.stringify(compactWardrobe)}`,
          ].join("\n\n"),
        });

        logInfo(
          "[ai-look][single][step-2][candidates-generated]",
          {
            attempt: attempt + 1,
            rawCandidates: object.candidates.length,
          }
        );

        for (const candidate of object.candidates) {
          const validated = toValidatedSingleLookCandidate({
            lookName: candidate.lookName,
            modelConfidence: candidate.modelConfidence,
            ids: candidate.selectedGarmentIds,
            intent: canonicalIntent,
            weatherContext: weatherContextSummary || null,
            weatherProfile: canonicalWeatherProfile,
            derivedProfile,
            userDirectives,
            recentUsedIds,
            anchorGarmentId: effectiveAnchorGarmentId,
            anchorMode: effectiveAnchorMode,
            compactWardrobe,
            garmentById,
            garmentCategoryById,
          });

          if (!validated) {
            logInfo(
              "[ai-look][single][step-2][candidate-dropped]",
              { reason: "failed-validation-or-normalization" }
            );
            continue;
          }
          if (
            effectiveAnchorMode === "strict" &&
            effectiveAnchorGarmentId != null &&
            !validated.selectedGarmentIds.includes(effectiveAnchorGarmentId)
          ) {
            logInfo(
              "[ai-look][single][anchor][candidate-dropped]",
              { reason: "missing-anchor-after-normalization" }
            );
            continue;
          }
          if (seenSignatures.has(validated.signature)) {
            logInfo(
              "[ai-look][single][step-2][candidate-dropped]",
              { reason: "duplicate-signature", signature: validated.signature }
            );
            continue;
          }

          logInfo("[ai-look][single][step-2][style-fit]", {
            signature: validated.signature,
            fit: computeStyleDirectiveFit({
              lineup: validated.lineupGarments,
              userDirectives,
            }),
          });

          seenSignatures.add(validated.signature);
          collectedCandidates.push(validated);
          if (collectedCandidates.length >= SINGLE_LOOK_TARGET_CANDIDATES) break;
        }
      } catch (error) {
        logWarn(
          "[ai-look][single][step-2][candidate-generation-failed]",
          { attempt: attempt + 1 }
        );
        logWarn("[ai-look][single][step-2][candidate-generation-error]", {
          attempt: attempt + 1,
          error: toErrorDetails(error),
        });
      }
    }

    logInfo(
      "[ai-look][single][step-2][candidate-final-count]",
      {
        attemptedTarget: SINGLE_LOOK_TARGET_CANDIDATES,
        finalValidCandidates: collectedCandidates.length,
        nonRepeatedCandidates: collectedCandidates.filter((candidate) => !recentSignatureSet.has(candidate.signature)).length,
      }
    );

    const styleFitThreshold = 10;
    const candidateStyleFits = collectedCandidates.map((candidate) => ({
      signature: candidate.signature,
      fit: computeStyleDirectiveFit({
        lineup: candidate.lineupGarments,
        userDirectives,
      }),
    }));
    if (candidateStyleFits.length > 0) {
      logInfo("[ai-look][single][step-2][style-fit-summary]", {
        threshold: styleFitThreshold,
        candidates: candidateStyleFits,
      });
    }
    if (
      (userDirectives.merged.styleTagsPrefer.length > 0) &&
      candidateStyleFits.length > 0 &&
      candidateStyleFits.every((entry) => entry.fit.score < styleFitThreshold)
    ) {
      logInfo("[ai-look][single][step-2][style-threshold-relaxed]", {
        threshold: styleFitThreshold,
        reason: "no-style-compatible-candidate-above-threshold",
      });
    }

    let selectedLook = chooseTopSingleLookCandidate({
      candidates: collectedCandidates,
      history: recentSingleHistory,
      intent: canonicalIntent,
      weatherContext: weatherContextSummary || null,
      weatherProfile: canonicalWeatherProfile,
      derivedProfile,
      userDirectives,
      feedbackSignals: singleFeedbackSignals,
    });

    if (!selectedLook) {
      selectedLook = buildDeterministicSingleLookFallbackCandidate({
        intent: canonicalIntent,
        weatherContext: weatherContextSummary || null,
        weatherProfile: canonicalWeatherProfile,
        derivedProfile,
        userDirectives,
        recentUsedIds,
        avoidSignatures: recentSignatureSet,
        anchorGarmentId: effectiveAnchorGarmentId,
        anchorMode: effectiveAnchorMode,
        compactWardrobe,
        garmentById,
        garmentCategoryById,
      });
      if (selectedLook) {
        logInfo(
          "[ai-look][single][step-2][fallback-used]",
          {
            signature: selectedLook.signature,
            includedAnchor:
              effectiveAnchorGarmentId != null &&
              selectedLook.selectedGarmentIds.includes(effectiveAnchorGarmentId),
          }
        );
      }
    }

    if (!selectedLook) {
      return responseJson(
        { error: "AI could not produce a complete look. Please refine your prompt." },
        { status: 422 }
      );
    }
    if (
      effectiveAnchorMode === "strict" &&
      effectiveAnchorGarmentId != null &&
      !selectedLook.selectedGarmentIds.includes(effectiveAnchorGarmentId)
    ) {
      return responseJson(
        { error: "Could not produce a complete anchored look with current wardrobe constraints." },
        { status: 422 }
      );
    }

    logInfo(
      "[ai-look][single][step-2][selected]",
      {
        rerankBreakdown: computeSingleLookRerankBreakdown({
          candidate: selectedLook,
          history: recentSingleHistory,
          intent: canonicalIntent,
          weatherContext: weatherContextSummary || null,
          weatherProfile: canonicalWeatherProfile,
          derivedProfile,
          userDirectives,
          feedbackSignals: singleFeedbackSignals,
        }),
        signature: selectedLook.signature,
        confidence: selectedLook.confidence,
        repeatedFromHistory: recentSignatureSet.has(selectedLook.signature),
        includedAnchor:
          effectiveAnchorGarmentId != null &&
          selectedLook.selectedGarmentIds.includes(effectiveAnchorGarmentId),
        rerankScore: computeSingleLookRerankScore({
          candidate: selectedLook,
          history: recentSingleHistory,
          intent: canonicalIntent,
          weatherContext: weatherContextSummary || null,
          weatherProfile: canonicalWeatherProfile,
          derivedProfile,
          userDirectives,
          feedbackSignals: singleFeedbackSignals,
        }),
        styleDirectiveFit: computeStyleDirectiveFit({
          lineup: selectedLook.lineupGarments,
          userDirectives,
        }),
        weatherProfile: canonicalWeatherProfile,
        derivedProfile,
        userDirectives,
        ruleTrace: buildLineupRuleTrace({
          lineup: selectedLook.lineupGarments,
          intent: canonicalIntent,
          weatherContext: weatherContextSummary || null,
          weatherProfile: canonicalWeatherProfile,
          derivedProfile,
          userDirectives,
        }),
      }
    );

    try {
      await persistSingleLookHistory({
        ownerKey: ownerRateLimitKey,
        ids: selectedLook.selectedGarmentIds,
      });
    } catch (error) {
      logWarn("[ai-look][single][history][write-failed]", {
        error: toErrorDetails(error),
      });
    }

    const singleRequestFingerprint = buildSingleRequestFingerprint({
      weather: canonicalContext.weather,
      occasion: canonicalContext.occasion,
      place: canonicalContext.place,
      timeOfDay: canonicalContext.timeOfDay,
      locationHint,
      temporalTarget,
    });

    logInfo(
      "[ai-look][single][final-output]",
      {
        requestFingerprint: singleRequestFingerprint,
        lookName: selectedLook.lookName,
        lineupSignature: selectedLook.signature,
        garments: selectedLook.lineupGarments,
        rationale: selectedLook.rationale,
        confidence: selectedLook.confidence,
        modelConfidence: selectedLook.modelConfidence,
        matchScore: selectedLook.matchScore,
        interpretedIntent: canonicalIntent,
        weatherProfile: canonicalWeatherProfile,
        derivedProfile,
        userDirectives,
        styleDirectiveFit: computeStyleDirectiveFit({
          lineup: selectedLook.lineupGarments,
          userDirectives,
        }),
        weatherContext: weatherContextSummary || null,
        weatherContextStatus: weatherStatus,
        weatherTemporalTarget: temporalTarget,
        weatherTemporalStatus: temporalWeatherStatus,
      }
    );

    return responseJson({
      mode: "single",
      requestFingerprint: singleRequestFingerprint,
      primaryLook: {
        lookName: selectedLook.lookName,
        lineupSignature: selectedLook.signature,
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
      weatherProfile: canonicalWeatherProfile,
      derivedProfile,
      userDirectives,
      styleDirectiveFit: computeStyleDirectiveFit({
        lineup: selectedLook.lineupGarments,
        userDirectives,
      }),
      weatherContext: weatherContextSummary || null,
      weatherContextStatus: weatherStatus,
      weatherTemporalTarget: temporalTarget,
      weatherTemporalStatus: temporalWeatherStatus,
    });
  } catch (error) {
    logError("[ai-look][request][failed]", {
      error: toErrorDetails(error),
    });
    return responseJson({ error: "Failed to generate look." }, { status: 500 });
  }
}
