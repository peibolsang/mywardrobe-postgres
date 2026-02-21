import "server-only";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { sql } from "@/lib/db";

const FEEDBACK_MAX_STYLE_TAGS = 8;
const FEEDBACK_MAX_MATERIAL_TARGETS = 24;

const weatherProfileSchema = z.object({
  tempBand: z.enum(["cold", "cool", "mild", "warm", "hot"]),
  precipitationLevel: z.enum(["none", "light", "moderate", "heavy"]),
  precipitationType: z.enum(["none", "rain", "snow", "mixed"]),
  windBand: z.enum(["calm", "breezy", "windy"]),
  humidityBand: z.enum(["dry", "normal", "humid"]),
  wetSurfaceRisk: z.enum(["low", "medium", "high"]),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();

const derivedProfileSchema = z.object({
  formality: z.string().nullable(),
  style: z.array(z.string()).max(FEEDBACK_MAX_STYLE_TAGS),
  materialTargets: z.object({
    prefer: z.array(z.string()).max(FEEDBACK_MAX_MATERIAL_TARGETS),
    avoid: z.array(z.string()).max(FEEDBACK_MAX_MATERIAL_TARGETS),
  }).strict(),
}).strict();

const feedbackRequestSchema = z.object({
  mode: z.enum(["single", "travel"]),
  requestFingerprint: z.string().trim().min(1).max(500),
  lineupSignature: z.string().trim().min(1).max(300),
  garmentIds: z.array(z.number().int().positive()).min(1).max(12),
  vote: z.enum(["up", "down"]),
  reasonText: z.string().trim().max(2000).optional(),
  weatherProfile: weatherProfileSchema.optional(),
  derivedProfile: derivedProfileSchema.optional(),
}).strict();

const normalize = (value: unknown): string => String(value ?? "").trim();
const normalizeStringList = (values: string[], max: number): string[] =>
  Array.from(new Set(values.map((value) => normalize(value)).filter(Boolean))).slice(0, max);

const isAllowedOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (!origin) return true;
  return origin === requestOrigin;
};

export async function POST(request: Request) {
  const requestId = randomUUID();
  const toErrorDetails = (error: unknown) => {
    if (error instanceof Error) {
      return { message: error.message };
    }
    return { message: String(error) };
  };
  const logWarn = (event: string, payload: Record<string, unknown>) => {
    console.warn(event, JSON.stringify({ requestId, ...payload }));
  };
  const logError = (event: string, payload: Record<string, unknown>) => {
    console.error(event, JSON.stringify({ requestId, ...payload }));
  };
  const logInfo = (event: string, payload: Record<string, unknown>) => {
    if (process.env.AI_LOOK_DEBUG !== "1") return;
    console.info(event, JSON.stringify({ requestId, ...payload }));
  };
  const responseJson = (
    body: Record<string, unknown>,
    init?: { status: number }
  ) => NextResponse.json({ requestId, ...body }, init);

  try {
    if (!isAllowedOrigin(request)) {
      logWarn("[ai-look][feedback][rejected-origin]", { reason: "invalid-origin" });
      return responseJson({ error: "Invalid request origin." }, { status: 403 });
    }

    if (!(await isOwnerSession())) {
      logWarn("[ai-look][feedback][rejected-auth]", { reason: "owner-session-required" });
      return responseJson({ error: "Forbidden" }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsed = feedbackRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      logWarn("[ai-look][feedback][invalid-payload]", { reason: "schema-parse-failed" });
      return responseJson({ error: "Invalid feedback payload." }, { status: 400 });
    }

    const {
      mode,
      requestFingerprint,
      lineupSignature,
      garmentIds,
      vote,
      reasonText,
      weatherProfile,
      derivedProfile,
    } = parsed.data;

    const ownerKey = getOwnerKey();
    const normalizedReason = normalize(reasonText);
    const persistedReason = normalizedReason.length > 0 ? normalizedReason : null;
    const normalizedDerivedProfile = derivedProfile
      ? {
          formality: normalize(derivedProfile.formality) || null,
          style: normalizeStringList(derivedProfile.style, FEEDBACK_MAX_STYLE_TAGS),
          materialTargets: {
            prefer: normalizeStringList(
              derivedProfile.materialTargets.prefer,
              FEEDBACK_MAX_MATERIAL_TARGETS
            ),
            avoid: normalizeStringList(
              derivedProfile.materialTargets.avoid,
              FEEDBACK_MAX_MATERIAL_TARGETS
            ),
          },
        }
      : undefined;

    await sql`
      INSERT INTO ai_look_feedback (
        owner_key,
        mode,
        request_fingerprint,
        lineup_signature,
        garment_ids_json,
        vote,
        reason_text,
        weather_profile_json,
        derived_profile_json
      )
      VALUES (
        ${ownerKey},
        ${mode},
        ${requestFingerprint},
        ${lineupSignature},
        ${JSON.stringify(Array.from(new Set(garmentIds)))},
        ${vote},
        ${persistedReason},
        ${JSON.stringify(weatherProfile ?? {})},
        ${JSON.stringify(normalizedDerivedProfile ?? {})}
      );
    `;

    logInfo("[ai-look][feedback][saved]", {
      mode,
      requestFingerprint,
      lineupSignature,
      vote,
      hasReason: Boolean(persistedReason),
    });
    return responseJson({ ok: true });
  } catch (error) {
    logError("[ai-look][feedback][failed]", { error: toErrorDetails(error) });
    return responseJson({ error: "Failed to save feedback." }, { status: 500 });
  }
}
