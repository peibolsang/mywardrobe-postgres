import "server-only";

import { sql } from "@/lib/db";

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

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return dedupeLowercase(value.map((item) => normalize(item)).filter(Boolean));
  }

  const normalized = normalize(value);
  if (!normalized) return [];

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (Array.isArray(parsed)) {
      return dedupeLowercase(parsed.map((item) => normalize(item)).filter(Boolean));
    }
  } catch {
    // Ignore malformed JSON and return empty list.
  }

  return [];
};

const normalizeStyleKey = (value: unknown): string => normalize(value).toLowerCase();

export interface ProfileStyleOption {
  key: string;
  name: string;
  canonicalStyle: string;
  description: string | null;
}

interface ProfileStyleOptionRow {
  id: number;
  key: string;
  name: string;
  canonical_style: string;
  description: string | null;
}

interface StyleDirectiveCatalogRow {
  key: string;
  name: string;
  canonical_style: string;
  description: string | null;
  alias_terms: unknown;
  canonical_style_tags_json: string;
  silhouette_bias_tags_json: string;
  material_prefer_json: string;
  material_avoid_json: string;
  formality_bias: string | null;
}

export interface StyleDirectiveCatalogEntry {
  key: string;
  name: string;
  canonicalStyle: string;
  description: string | null;
  terms: string[];
  styleTags: string[];
  silhouetteTags: string[];
  materialPrefer: string[];
  materialAvoid: string[];
  formalityBias: string | null;
}

const mapProfileStyleOption = (row: ProfileStyleOptionRow): ProfileStyleOption => ({
  key: normalize(row.key),
  name: normalize(row.name),
  canonicalStyle: normalize(row.canonical_style),
  description: normalize(row.description) || null,
});

const getActiveStyleCatalogRows = async (): Promise<ProfileStyleOptionRow[]> => {
  return (await sql`
    SELECT id, key, name, canonical_style, description
    FROM style_catalog
    WHERE is_active = TRUE
    ORDER BY name ASC;
  `) as ProfileStyleOptionRow[];
};

export const getActiveStyleCatalogOptions = async (): Promise<ProfileStyleOption[]> => {
  const rows = await getActiveStyleCatalogRows();
  return rows.map(mapProfileStyleOption);
};

export const getUserProfileSelectedStyles = async (ownerKey: string): Promise<ProfileStyleOption[]> => {
  const rows = (await sql`
    SELECT sc.id, sc.key, sc.name, sc.canonical_style, sc.description
    FROM user_profile_style ups
    JOIN style_catalog sc ON sc.id = ups.style_catalog_id
    WHERE ups.owner_key = ${ownerKey}
      AND sc.is_active = TRUE
    ORDER BY sc.name ASC;
  `) as ProfileStyleOptionRow[];

  return rows.map(mapProfileStyleOption);
};

export const replaceUserProfileSelectedStyleKeys = async ({
  ownerKey,
  styleKeys,
}: {
  ownerKey: string;
  styleKeys: string[];
}): Promise<ProfileStyleOption[]> => {
  const catalogRows = await getActiveStyleCatalogRows();
  const catalogByKey = new Map(catalogRows.map((row) => [normalizeStyleKey(row.key), row]));

  const requestedKeys = dedupeLowercase(styleKeys.map((item) => normalizeStyleKey(item)).filter(Boolean));
  const selectedRows = requestedKeys
    .map((key) => catalogByKey.get(key) ?? null)
    .filter((row): row is ProfileStyleOptionRow => Boolean(row));

  await sql`
    DELETE FROM user_profile_style
    WHERE owner_key = ${ownerKey};
  `;

  for (const row of selectedRows) {
    await sql`
      INSERT INTO user_profile_style (owner_key, style_catalog_id)
      VALUES (${ownerKey}, ${row.id})
      ON CONFLICT (owner_key, style_catalog_id)
      DO NOTHING;
    `;
  }

  return getUserProfileSelectedStyles(ownerKey);
};

export const getActiveStyleDirectiveCatalog = async (): Promise<StyleDirectiveCatalogEntry[]> => {
  const rows = (await sql`
    SELECT
      sc.key,
      sc.name,
      sc.canonical_style,
      sc.description,
      COALESCE(
        (
          SELECT json_agg(sca.alias_term ORDER BY sca.alias_term)
          FROM style_catalog_alias sca
          WHERE sca.style_catalog_id = sc.id
        ),
        '[]'::json
      ) AS alias_terms,
      scd.canonical_style_tags_json,
      scd.silhouette_bias_tags_json,
      scd.material_prefer_json,
      scd.material_avoid_json,
      scd.formality_bias
    FROM style_catalog sc
    JOIN style_catalog_directive scd ON scd.style_catalog_id = sc.id
    WHERE sc.is_active = TRUE
    ORDER BY sc.name ASC;
  `) as StyleDirectiveCatalogRow[];

  return rows.map((row) => ({
    key: normalize(row.key),
    name: normalize(row.name),
    canonicalStyle: normalize(row.canonical_style),
    description: normalize(row.description) || null,
    terms: parseStringArray(row.alias_terms),
    styleTags: parseStringArray(row.canonical_style_tags_json),
    silhouetteTags: parseStringArray(row.silhouette_bias_tags_json),
    materialPrefer: parseStringArray(row.material_prefer_json),
    materialAvoid: parseStringArray(row.material_avoid_json),
    formalityBias: normalize(row.formality_bias) || null,
  }));
};
