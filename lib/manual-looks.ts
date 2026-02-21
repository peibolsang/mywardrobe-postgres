import "server-only";

import { sql } from "@/lib/db";

const normalize = (value: unknown): string => String(value ?? "").trim();

const normalizeGarmentIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<number>();
  const ids: number[] = [];
  for (const raw of value) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
};

export interface ManualLookSaved {
  id: number;
  ownerKey: string;
  title: string;
  garmentIds: number[];
  generatedImageUrl: string;
  locationLabel: string;
  weatherSummary: string;
  weatherSource: "live" | "fallback";
  createdAt: string;
  updatedAt: string;
}

interface ManualLookSavedRow {
  id: number;
  owner_key: string;
  title: string;
  garment_ids_json: unknown;
  generated_image_url: string;
  location_label: string;
  weather_summary: string;
  weather_source: string;
  created_at: string | Date;
  updated_at: string | Date;
}

const mapRow = (row: ManualLookSavedRow): ManualLookSaved => ({
  id: Number(row.id),
  ownerKey: normalize(row.owner_key),
  title: normalize(row.title),
  garmentIds: normalizeGarmentIds(row.garment_ids_json),
  generatedImageUrl: normalize(row.generated_image_url),
  locationLabel: normalize(row.location_label),
  weatherSummary: normalize(row.weather_summary),
  weatherSource: normalize(row.weather_source) === "live" ? "live" : "fallback",
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const listManualLooksByOwner = async (ownerKey: string): Promise<ManualLookSaved[]> => {
  const rows = (await sql`
    SELECT
      id,
      owner_key,
      title,
      garment_ids_json,
      generated_image_url,
      location_label,
      weather_summary,
      weather_source,
      created_at,
      updated_at
    FROM manual_look_saved
    WHERE owner_key = ${ownerKey}
    ORDER BY created_at DESC;
  `) as ManualLookSavedRow[];

  return rows.map(mapRow);
};

export const getManualLookById = async ({
  ownerKey,
  id,
}: {
  ownerKey: string;
  id: number;
}): Promise<ManualLookSaved | null> => {
  const rows = (await sql`
    SELECT
      id,
      owner_key,
      title,
      garment_ids_json,
      generated_image_url,
      location_label,
      weather_summary,
      weather_source,
      created_at,
      updated_at
    FROM manual_look_saved
    WHERE owner_key = ${ownerKey}
      AND id = ${id}
    LIMIT 1;
  `) as ManualLookSavedRow[];

  const row = rows[0];
  return row ? mapRow(row) : null;
};

export const insertManualLook = async ({
  ownerKey,
  title,
  garmentIds,
  generatedImageUrl,
  locationLabel,
  weatherSummary,
  weatherSource,
}: {
  ownerKey: string;
  title: string;
  garmentIds: number[];
  generatedImageUrl: string;
  locationLabel: string;
  weatherSummary: string;
  weatherSource: "live" | "fallback";
}): Promise<ManualLookSaved> => {
  const rows = (await sql`
    INSERT INTO manual_look_saved (
      owner_key,
      title,
      garment_ids_json,
      generated_image_url,
      location_label,
      weather_summary,
      weather_source
    )
    VALUES (
      ${ownerKey},
      ${title},
      ${JSON.stringify(garmentIds)},
      ${generatedImageUrl},
      ${locationLabel},
      ${weatherSummary},
      ${weatherSource}
    )
    RETURNING
      id,
      owner_key,
      title,
      garment_ids_json,
      generated_image_url,
      location_label,
      weather_summary,
      weather_source,
      created_at,
      updated_at;
  `) as ManualLookSavedRow[];

  return mapRow(rows[0]);
};

export const deleteManualLookById = async ({
  ownerKey,
  id,
}: {
  ownerKey: string;
  id: number;
}): Promise<boolean> => {
  const rows = (await sql`
    DELETE FROM manual_look_saved
    WHERE owner_key = ${ownerKey}
      AND id = ${id}
    RETURNING id;
  `) as Array<{ id: number }>;

  return rows.length > 0;
};
