import { NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import schema from "@/public/schema.json";
import { isOwnerSession } from "@/lib/owner";
import { normalizeReferenceKey } from "@/lib/profile-references";
import { canonicalizeFormalityOption, canonicalizeStyleTags } from "@/lib/style-taxonomy";

type SchemaItems = {
  properties?: {
    style?: { enum?: string[] };
    formality?: { enum?: string[] };
  };
};

const SCHEMA_ITEMS = (schema?.items ?? {}) as SchemaItems;
const STYLE_OPTIONS = SCHEMA_ITEMS.properties?.style?.enum ?? [];
const FORMALITY_OPTIONS = SCHEMA_ITEMS.properties?.formality?.enum ?? [];

const loadReferenceRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
}).strict();

const loadedReferenceSchema = z.object({
  displayName: z.string().min(1).max(160),
  aliases: z.array(z.string().min(1).max(120)).min(3).max(12),
  styleBiasTags: z.array(z.string().min(1).max(80)).min(2).max(8),
  silhouetteBiasTags: z.array(z.string().min(1).max(80)).min(1).max(10),
  materialPrefer: z.array(z.string().min(1).max(120)).min(2).max(12),
  materialAvoid: z.array(z.string().min(1).max(120)).max(12),
  formalityBias: z.string().min(1).max(80).nullable(),
  summary: z.string().min(1).max(800),
}).strict();

const normalize = (value: unknown): string => String(value ?? "").trim();

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

export async function POST(request: Request) {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsed = loadReferenceRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid load payload" }, { status: 400 });
    }

    const requestedName = parsed.data.name;
    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      temperature: 0.3,
      schema: loadedReferenceSchema,
      prompt: [
        "You are a menswear stylist knowledge assistant.",
        "Given a menswear reference person's name, return a concise style profile suitable for wardrobe recommendation constraints.",
        `Reference name: ${requestedName}`,
        `Allowed canonical style tags: ${JSON.stringify(STYLE_OPTIONS)}`,
        `Allowed formality options: ${JSON.stringify(FORMALITY_OPTIONS)}`,
        "Rules:",
        "- styleBiasTags must use only values from allowed canonical style tags.",
        "- formalityBias must be null or one of allowed formality options.",
        "- aliases should include variants users might type (full name, surname, known handle).",
        "- Keep fields practical for deterministic recommendation constraints.",
      ].join("\n"),
    });

    const displayName = normalize(object.displayName) || requestedName;
    const key = normalizeReferenceKey(displayName || requestedName);
    const aliases = dedupeLowercase([...(object.aliases ?? []), displayName, requestedName, key.replace(/_/g, " "), key]);
    const styleBiasTags = canonicalizeStyleTags(object.styleBiasTags ?? []);
    const silhouetteBiasTags = dedupeLowercase(object.silhouetteBiasTags ?? []);
    const materialPrefer = dedupeLowercase(object.materialPrefer ?? []);
    const materialAvoid = dedupeLowercase(object.materialAvoid ?? []);
    const formalityBias = canonicalizeFormalityOption(object.formalityBias);

    if (!key || !displayName || aliases.length === 0 || styleBiasTags.length === 0) {
      return NextResponse.json(
        { error: "Loaded reference profile is incomplete. Please retry with a more specific name." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      reference: {
        key,
        displayName,
        sourceName: requestedName,
        aliases,
        styleBiasTags,
        silhouetteBiasTags,
        materialPrefer,
        materialAvoid,
        formalityBias,
        schemaVersion: 1,
        summary: normalize(object.summary),
      },
    });
  } catch (error) {
    console.error("Failed to load profile reference:", error);
    return NextResponse.json({ error: "Failed to load profile reference" }, { status: 500 });
  }
}
