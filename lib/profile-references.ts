import "server-only";

import { sql } from "@/lib/db";
import { canonicalizeFormalityOption, canonicalizeStyleTags } from "@/lib/style-taxonomy";

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

export const normalizeReferenceKey = (value: unknown): string =>
  normalize(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

export interface ProfileReferenceOption {
  key: string;
  displayName: string;
  sourceName: string | null;
  aliases: string[];
  schemaVersion: number;
  styleBiasTags: string[];
  silhouetteBiasTags: string[];
  materialPrefer: string[];
  materialAvoid: string[];
  formalityBias: string | null;
}

interface ProfileReferenceRow {
  key: string;
  display_name: string;
  source_name: string | null;
  schema_version: number;
  alias_terms: unknown;
  style_bias_tags_json: string;
  silhouette_bias_tags_json: string;
  material_prefer_json: string;
  material_avoid_json: string;
  formality_bias: string | null;
}

export interface ReferenceDirectiveCatalogEntry {
  referenceKey: string;
  displayName: string;
  terms: string[];
  styleTags: string[];
  silhouetteTags: string[];
  materialPrefer: string[];
  materialAvoid: string[];
  formalityBias: string | null;
}

export interface UpsertProfileReferenceInput {
  key: string;
  displayName: string;
  sourceName?: string | null;
  aliases: string[];
  styleBiasTags: string[];
  silhouetteBiasTags: string[];
  materialPrefer: string[];
  materialAvoid: string[];
  formalityBias?: string | null;
  schemaVersion?: number;
  referencePayload?: unknown;
}

const mapProfileReferenceRow = (row: ProfileReferenceRow): ProfileReferenceOption => ({
  key: normalize(row.key),
  displayName: normalize(row.display_name),
  sourceName: normalize(row.source_name) || null,
  aliases: parseStringArray(row.alias_terms),
  schemaVersion: Number(row.schema_version) > 0 ? Number(row.schema_version) : 1,
  styleBiasTags: canonicalizeStyleTags(parseStringArray(row.style_bias_tags_json)),
  silhouetteBiasTags: parseStringArray(row.silhouette_bias_tags_json),
  materialPrefer: parseStringArray(row.material_prefer_json),
  materialAvoid: parseStringArray(row.material_avoid_json),
  formalityBias: canonicalizeFormalityOption(normalize(row.formality_bias) || null),
});

const getUserActiveReferenceRows = async (ownerKey: string): Promise<ProfileReferenceRow[]> => {
  return (await sql`
    SELECT
      upr.key,
      upr.display_name,
      upr.source_name,
      upr.schema_version,
      COALESCE(
        (
          SELECT json_agg(upra.alias_term ORDER BY upra.alias_term)
          FROM user_profile_reference_alias upra
          WHERE upra.reference_id = upr.id
        ),
        '[]'::json
      ) AS alias_terms,
      uprd.style_bias_tags_json,
      uprd.silhouette_bias_tags_json,
      uprd.material_prefer_json,
      uprd.material_avoid_json,
      uprd.formality_bias
    FROM user_profile_reference upr
    JOIN user_profile_reference_directive uprd ON uprd.reference_id = upr.id
    WHERE upr.owner_key = ${ownerKey}
      AND upr.is_active = TRUE
    ORDER BY upr.display_name ASC;
  `) as ProfileReferenceRow[];
};

export const getUserProfileActiveReferences = async (ownerKey: string): Promise<ProfileReferenceOption[]> => {
  const rows = await getUserActiveReferenceRows(ownerKey);
  return rows.map(mapProfileReferenceRow);
};

export const getUserProfileReferenceToolOptions = async (
  ownerKey: string
): Promise<Array<{ id: string; label: string }>> => {
  const references = await getUserProfileActiveReferences(ownerKey);
  return references.map((reference) => ({
    id: reference.key,
    label: reference.displayName,
  }));
};

const getUserProfileReferenceByKey = async ({
  ownerKey,
  key,
}: {
  ownerKey: string;
  key: string;
}): Promise<ProfileReferenceOption | null> => {
  const rows = (await sql`
    SELECT
      upr.key,
      upr.display_name,
      upr.source_name,
      upr.schema_version,
      COALESCE(
        (
          SELECT json_agg(upra.alias_term ORDER BY upra.alias_term)
          FROM user_profile_reference_alias upra
          WHERE upra.reference_id = upr.id
        ),
        '[]'::json
      ) AS alias_terms,
      uprd.style_bias_tags_json,
      uprd.silhouette_bias_tags_json,
      uprd.material_prefer_json,
      uprd.material_avoid_json,
      uprd.formality_bias
    FROM user_profile_reference upr
    JOIN user_profile_reference_directive uprd ON uprd.reference_id = upr.id
    WHERE upr.owner_key = ${ownerKey}
      AND upr.key = ${key}
      AND upr.is_active = TRUE
    LIMIT 1;
  `) as ProfileReferenceRow[];

  const row = rows[0];
  return row ? mapProfileReferenceRow(row) : null;
};

export const upsertUserProfileReference = async ({
  ownerKey,
  reference,
}: {
  ownerKey: string;
  reference: UpsertProfileReferenceInput;
}): Promise<ProfileReferenceOption | null> => {
  const key = normalizeReferenceKey(reference.key || reference.displayName || reference.sourceName || "");
  const displayName = normalize(reference.displayName || reference.sourceName || key);
  const sourceName = normalize(reference.sourceName) || null;
  const aliases = dedupeLowercase(
    [
      ...reference.aliases,
      displayName,
      sourceName || "",
      key.replace(/_/g, " "),
      key,
    ].filter(Boolean)
  );
  const styleBiasTags = canonicalizeStyleTags(reference.styleBiasTags);
  const silhouetteBiasTags = dedupeLowercase(reference.silhouetteBiasTags);
  const materialPrefer = dedupeLowercase(reference.materialPrefer);
  const materialAvoid = dedupeLowercase(reference.materialAvoid);
  const formalityBias = canonicalizeFormalityOption(normalize(reference.formalityBias) || null);
  const schemaVersion = Number(reference.schemaVersion) > 0 ? Number(reference.schemaVersion) : 1;
  const referencePayloadJson =
    reference.referencePayload === undefined
      ? null
      : JSON.stringify(reference.referencePayload);

  if (!key || !displayName || aliases.length === 0 || styleBiasTags.length === 0) {
    return null;
  }

  await sql`
    INSERT INTO user_profile_reference (
      owner_key,
      key,
      display_name,
      source_name,
      reference_payload_json,
      schema_version,
      is_active
    )
    VALUES (
      ${ownerKey},
      ${key},
      ${displayName},
      ${sourceName},
      ${referencePayloadJson},
      ${schemaVersion},
      TRUE
    )
    ON CONFLICT (owner_key, key)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      source_name = EXCLUDED.source_name,
      reference_payload_json = EXCLUDED.reference_payload_json,
      schema_version = EXCLUDED.schema_version,
      is_active = TRUE,
      updated_at = NOW();
  `;

  await sql`
    DELETE FROM user_profile_reference_alias
    WHERE reference_id = (
      SELECT id
      FROM user_profile_reference
      WHERE owner_key = ${ownerKey}
        AND key = ${key}
      LIMIT 1
    );
  `;

  for (const alias of aliases) {
    await sql`
      INSERT INTO user_profile_reference_alias (reference_id, alias_term)
      SELECT id, ${alias}
      FROM user_profile_reference
      WHERE owner_key = ${ownerKey}
        AND key = ${key}
      LIMIT 1
      ON CONFLICT (reference_id, alias_term)
      DO NOTHING;
    `;
  }

  await sql`
    INSERT INTO user_profile_reference_directive (
      reference_id,
      style_bias_tags_json,
      silhouette_bias_tags_json,
      material_prefer_json,
      material_avoid_json,
      formality_bias
    )
    SELECT
      id,
      ${JSON.stringify(styleBiasTags)},
      ${JSON.stringify(silhouetteBiasTags)},
      ${JSON.stringify(materialPrefer)},
      ${JSON.stringify(materialAvoid)},
      ${formalityBias}
    FROM user_profile_reference
    WHERE owner_key = ${ownerKey}
      AND key = ${key}
    LIMIT 1
    ON CONFLICT (reference_id)
    DO UPDATE SET
      style_bias_tags_json = EXCLUDED.style_bias_tags_json,
      silhouette_bias_tags_json = EXCLUDED.silhouette_bias_tags_json,
      material_prefer_json = EXCLUDED.material_prefer_json,
      material_avoid_json = EXCLUDED.material_avoid_json,
      formality_bias = EXCLUDED.formality_bias,
      updated_at = NOW();
  `;

  return getUserProfileReferenceByKey({ ownerKey, key });
};

export const getActiveReferenceDirectiveCatalog = async (
  ownerKey: string
): Promise<ReferenceDirectiveCatalogEntry[]> => {
  const rows = await getUserActiveReferenceRows(ownerKey);

  return rows.map((row) => {
    const key = normalize(row.key);
    const displayName = normalize(row.display_name);
    const sourceName = normalize(row.source_name);
    const aliases = parseStringArray(row.alias_terms);
    const terms = dedupeLowercase([
      ...aliases,
      displayName,
      sourceName,
      key.replace(/_/g, " "),
      key,
    ]);

    return {
      referenceKey: key,
      displayName,
      terms,
      styleTags: canonicalizeStyleTags(parseStringArray(row.style_bias_tags_json)),
      silhouetteTags: parseStringArray(row.silhouette_bias_tags_json),
      materialPrefer: parseStringArray(row.material_prefer_json),
      materialAvoid: parseStringArray(row.material_avoid_json),
      formalityBias: canonicalizeFormalityOption(normalize(row.formality_bias) || null),
    };
  });
};

export const deactivateUserProfileReferenceByKey = async ({
  ownerKey,
  key,
}: {
  ownerKey: string;
  key: string;
}): Promise<boolean> => {
  const normalizedKey = normalizeReferenceKey(key);
  if (!normalizedKey) return false;

  const rows = await sql`
    UPDATE user_profile_reference
    SET
      is_active = FALSE,
      updated_at = NOW()
    WHERE owner_key = ${ownerKey}
      AND key = ${normalizedKey}
      AND is_active = TRUE
    RETURNING id;
  ` as Array<{ id: number }>;

  return rows.length > 0;
};
