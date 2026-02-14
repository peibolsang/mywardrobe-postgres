import "server-only";

import schema from "@/public/schema.json";

type SchemaItems = {
  properties?: {
    style?: { enum?: string[] };
    formality?: { enum?: string[] };
  };
};

const SCHEMA_ITEMS = (schema?.items ?? {}) as SchemaItems;
const STYLE_OPTIONS = (SCHEMA_ITEMS.properties?.style?.enum ?? []).map((value) => String(value).trim());
const FORMALITY_OPTIONS = (SCHEMA_ITEMS.properties?.formality?.enum ?? []).map((value) => String(value).trim());

const normalize = (value: unknown): string => String(value ?? "").trim();

const normalizeStyleToken = (value: string): string =>
  normalize(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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

const STYLE_TAG_SYNONYM_MAP: Record<string, string[]> = {
  americana: ["vintage", "western", "workwear", "classic"],
  "classic menswear": ["classic", "preppy"],
  ivy: ["preppy", "classic"],
  tailoring: ["classic", "minimalist"],
  "soft shoulder": ["classic"],
  "elevated slouch": ["minimalist", "mod"],
  "high low": ["minimalist", "mod"],
  textural: ["vintage", "classic"],
  "grunge luxe": ["mod", "vintage"],
  sartorial: ["classic"],
  "luxury minimalist": ["minimalist", "classic"],
  bespoke: ["classic"],
  "craft focused": ["classic", "vintage"],
};

export const canonicalizeStyleTags = (values: string[]): string[] => {
  const canonicalByLower = new Map(STYLE_OPTIONS.map((value) => [value.toLowerCase(), value]));
  const result: string[] = [];

  for (const rawValue of values) {
    const value = normalize(rawValue);
    if (!value) continue;

    const exact = canonicalByLower.get(value.toLowerCase());
    if (exact) {
      result.push(exact);
      continue;
    }

    const normalizedToken = normalizeStyleToken(value);
    const mapped = STYLE_TAG_SYNONYM_MAP[normalizedToken];
    if (!mapped || mapped.length === 0) continue;
    for (const mappedValue of mapped) {
      const canonical = canonicalByLower.get(mappedValue.toLowerCase());
      if (canonical) {
        result.push(canonical);
      }
    }
  }

  return dedupeLowercase(result);
};

export const canonicalizeFormalityOption = (value?: string | null): string | null => {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return null;
  const found = FORMALITY_OPTIONS.find((option) => option.toLowerCase() === normalizedValue.toLowerCase());
  return found ?? null;
};
