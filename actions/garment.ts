'use server';

import { neon } from '@neondatabase/serverless';
import { revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOwnerSession } from '@/lib/owner';
import schema from '@/public/schema.json';
import 'server-only';

// ─────────────────────────────────────────────────────────────
// Access control
// ─────────────────────────────────────────────────────────────
async function requireOwner<T extends { message: string; status: string }>(
  unauthorized: T
): Promise<{ ok: true } | { ok: false; result: T }> {
  if (!(await isOwnerSession())) return { ok: false, result: unauthorized };
  return { ok: true };
}

// Helper so callers get consistent error shape
const UNAUTHORIZED_RESULT = { message: 'Forbidden', status: 'error' } as const;

type MaterialInput = { material: string; percentage: number };
type MaterialToInsert = { id: number; percentage: number };
type TypeLookupResult = { id: number } | null;
type LookupIdResult = { id: number } | null;

type SchemaItems = {
  properties?: {
    style?: { enum?: string[] };
  };
};

const SCHEMA_ITEMS = (schema?.items ?? {}) as SchemaItems;
const SCHEMA_STYLE_OPTIONS = (SCHEMA_ITEMS.properties?.style?.enum ?? [])
  .map((value) => String(value ?? '').trim().toLowerCase())
  .filter(Boolean);
const SCHEMA_HAS_IVY_STYLE = SCHEMA_STYLE_OPTIONS.includes('ivy');

function normalizeLookupValues(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const normalizedValue = String(value ?? '').trim().toLowerCase();
    if (!normalizedValue || seen.has(normalizedValue)) continue;
    seen.add(normalizedValue);
    normalized.push(normalizedValue);
  }

  return normalized;
}

function parseStringArrayField(input: FormDataEntryValue | null): string[] {
  if (typeof input !== 'string') return [];
  const raw = input.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((value) => String(value ?? '').trim())
        .filter(Boolean);
    }
  } catch {
    // Backward-compatibility with old comma-separated format.
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeMaterialComposition(materials: MaterialInput[]): Array<{ name: string; percentage: number }> {
  const merged = new Map<string, number>();

  for (const material of materials) {
    const name = String(material.material ?? '').trim().toLowerCase();
    const percentage = Number.parseInt(String(material.percentage), 10);

    if (!name || Number.isNaN(percentage) || percentage <= 0) continue;
    merged.set(name, (merged.get(name) ?? 0) + percentage);
  }

  return Array.from(merged.entries()).map(([name, percentage]) => ({ name, percentage }));
}

async function resolveMaterialCompositionToInsert(
  sql: any,
  materials: MaterialInput[]
): Promise<MaterialToInsert[]> {
  const normalized = normalizeMaterialComposition(materials);
  if (normalized.length === 0) return [];

  const materialNames = normalized.map((material) => material.name);

  const existingMaterials = await sql`
    SELECT id, LOWER(name) AS normalized_name
    FROM materials
    WHERE LOWER(name) = ANY(${materialNames})
  ` as any[];
  const existingIdByName = new Map(existingMaterials.map((row: any) => [row.normalized_name, row.id]));

  const missingMaterialNames = materialNames.filter((name) => !existingIdByName.has(name));
  if (missingMaterialNames.length > 0) {
    await sql`
      INSERT INTO materials (name)
      SELECT unnest(${missingMaterialNames}::text[])
      ON CONFLICT (name) DO NOTHING
    `;
  }

  const resolvedMaterials = await sql`
    SELECT id, LOWER(name) AS normalized_name
    FROM materials
    WHERE LOWER(name) = ANY(${materialNames})
  ` as any[];
  const idByName = new Map(resolvedMaterials.map((row: any) => [row.normalized_name, row.id]));

  return normalized.flatMap((material) => {
    const materialId = idByName.get(material.name);
    return typeof materialId === 'number'
      ? [{ id: materialId, percentage: material.percentage }]
      : [];
  });
}

async function resolveColorIds(sql: any, colorNames: string[]): Promise<number[]> {
  const normalizedColorNames = normalizeLookupValues(colorNames);
  if (normalizedColorNames.length === 0) return [];

  const existingColors = await sql`
    SELECT id, LOWER(name) AS normalized_name
    FROM colors
    WHERE LOWER(name) = ANY(${normalizedColorNames})
  ` as any[];
  const existingIdsByName = new Map(existingColors.map((row: any) => [row.normalized_name, row.id]));

  const missingColors = normalizedColorNames.filter((name) => !existingIdsByName.has(name));
  if (missingColors.length > 0) {
    await sql`
      INSERT INTO colors (name)
      SELECT unnest(${missingColors}::text[])
      ON CONFLICT (name) DO NOTHING
    `;
  }

  const resolvedColors = await sql`
    SELECT id, LOWER(name) AS normalized_name
    FROM colors
    WHERE LOWER(name) = ANY(${normalizedColorNames})
  ` as any[];
  const resolvedIdsByName = new Map(resolvedColors.map((row: any) => [row.normalized_name, row.id]));

  return normalizedColorNames.flatMap((name) => {
    const colorId = resolvedIdsByName.get(name);
    return typeof colorId === 'number' ? [colorId] : [];
  });
}

async function resolveTypeId(sql: any, typeName: string): Promise<TypeLookupResult> {
  const normalizedTypeName = String(typeName ?? '').trim();
  if (!normalizedTypeName) return null;

  const existingType = await sql`
    SELECT id
    FROM types
    WHERE LOWER(name) = LOWER(${normalizedTypeName})
    LIMIT 1
  ` as any[];

  if (existingType.length > 0) {
    return { id: existingType[0].id };
  }

  await sql`
    INSERT INTO types (name)
    VALUES (${normalizedTypeName})
    ON CONFLICT (name) DO NOTHING
  `;

  const insertedOrExistingType = await sql`
    SELECT id
    FROM types
    WHERE LOWER(name) = LOWER(${normalizedTypeName})
    LIMIT 1
  ` as any[];

  if (insertedOrExistingType.length === 0) return null;
  return { id: insertedOrExistingType[0].id };
}

async function resolveStyleIds(
  sql: any,
  styleNames: string[]
): Promise<{ ids: number[]; missing: string[] }> {
  const normalizedStyleNames = normalizeLookupValues(styleNames);
  if (normalizedStyleNames.length === 0) {
    return { ids: [], missing: [] };
  }

  const existingStyles = await sql`
    SELECT id, LOWER(name) AS normalized_name
    FROM styles
    WHERE LOWER(name) = ANY(${normalizedStyleNames})
  ` as any[];

  const idByName = new Map(existingStyles.map((row: any) => [row.normalized_name, row.id]));
  const ids: number[] = [];
  const missing: string[] = [];

  for (const styleName of normalizedStyleNames) {
    const styleId = idByName.get(styleName);
    if (typeof styleId === 'number') {
      ids.push(styleId);
    } else {
      missing.push(styleName);
    }
  }

  return { ids, missing };
}

function buildStyleValidationError(missingStyles: string[]): { message: string; status: string } {
  const missingSet = new Set(missingStyles.map((style) => style.toLowerCase()));
  if (SCHEMA_HAS_IVY_STYLE && missingSet.has('ivy')) {
    console.error('[style-taxonomy][parity][missing-style]', {
      style: 'ivy',
      source: 'schema',
      missingStyles,
    });
    return {
      message:
        "Style taxonomy out of sync: missing canonical style 'ivy' in DB. Run style seed SQL and retry.",
      status: 'error',
    };
  }
  return { message: 'Style is required and must match an existing style option.', status: 'error' };
}

async function resolveFormalityId(sql: any, formalityName: string): Promise<LookupIdResult> {
  const normalizedFormalityName = String(formalityName ?? '').trim();
  if (!normalizedFormalityName) return null;

  const existingFormality = await sql`
    SELECT id
    FROM formalities
    WHERE LOWER(name) = LOWER(${normalizedFormalityName})
    LIMIT 1
  ` as any[];

  if (existingFormality.length === 0) return null;
  return { id: existingFormality[0].id };
}

// ─────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────

export async function createGarment(prevState: any, formData: FormData): Promise<{ message: string; status: string; newGarmentId?: number }> {

  const gate = await requireOwner(UNAUTHORIZED_RESULT);
  if (!gate.ok) return gate.result;

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // 1. Extract data from formData
    const fileName = formData.get('file_name') as string;
    const model = formData.get('model') as string;
    const brand = formData.get('brand') as string;
    const type = formData.get('type') as string;
    const features = formData.get('features') as string;
    const favorite = formData.get('favorite') === 'true';

    // Single-select lookup fields
    const styleName = String(formData.get('style') ?? '').trim();
    const styleNamesInput = parseStringArrayField(formData.get('styles'));
    const styleNames = styleNamesInput.length > 0 ? styleNamesInput : (styleName ? [styleName] : []);
    const formalityName = String(formData.get('formality') ?? '').trim();

    // Multi-select lookup fields (JSON arrays, fallback to legacy comma-separated values)
    const colorNames = parseStringArrayField(formData.get('colors'));
    const suitableWeatherNames = parseStringArrayField(formData.get('suitableWeathers'));
    const suitableTimeOfDayNames = parseStringArrayField(formData.get('suitableTimesOfDay'));
    const suitablePlaceNames = parseStringArrayField(formData.get('suitablePlaces'));
    const suitableOccasionNames = parseStringArrayField(formData.get('suitableOccasions'));

    // Material composition (JSON string)
    const materialsJson = formData.get('materials') as string;
    const materials: MaterialInput[] = materialsJson ? JSON.parse(materialsJson) : [];

    // 2. Fetch IDs for all lookup values in parallel
    const [
      resolvedStyles,
      resolvedFormality,
      suitableWeathersResult,
      suitableTimesOfDayResult,
      suitablePlacesResult,
      suitableOccasionsResult
    ] = await Promise.all([
      resolveStyleIds(sql, styleNames),
      resolveFormalityId(sql, formalityName),
      suitableWeatherNames.length > 0 ? sql`SELECT id FROM suitable_weathers WHERE name = ANY(${suitableWeatherNames})` : Promise.resolve([]),
      suitableTimeOfDayNames.length > 0 ? sql`SELECT id FROM suitable_times_of_day WHERE name = ANY(${suitableTimeOfDayNames})` : Promise.resolve([]),
      suitablePlaceNames.length > 0 ? sql`SELECT id FROM suitable_places WHERE name = ANY(${suitablePlaceNames})` : Promise.resolve([]),
      suitableOccasionNames.length > 0 ? sql`SELECT id FROM suitable_occasions WHERE name = ANY(${suitableOccasionNames})` : Promise.resolve([])
    ]);

    const styleIds = resolvedStyles.ids;
    const styleId = styleIds[0];
    const formalityId = resolvedFormality?.id;
    if (!styleId || resolvedStyles.missing.length > 0) {
      return buildStyleValidationError(resolvedStyles.missing);
    }
    if (!formalityId) {
      return { message: 'Formality is required and must match an existing formality option.', status: 'error' };
    }

    const colorIds = await resolveColorIds(sql, colorNames);
    const suitableWeatherIds = suitableWeathersResult.map((row: any) => row.id);
    const suitableTimeOfDayIds = suitableTimesOfDayResult.map((row: any) => row.id);
    const suitablePlaceIds = suitablePlacesResult.map((row: any) => row.id);
    const suitableOccasionIds = suitableOccasionsResult.map((row: any) => row.id);

    const materialCompositionToInsert = await resolveMaterialCompositionToInsert(sql, materials);
    if (materialCompositionToInsert.length === 0) {
      return { message: 'Please add at least one valid material with percentage greater than 0.', status: 'error' };
    }
    const resolvedType = await resolveTypeId(sql, type);
    if (!resolvedType) {
      return { message: 'Type is required.', status: 'error' };
    }

    // 3. Insert garment and relations atomically
    const materialIds = materialCompositionToInsert.map((material) => material.id);
    const percentages = materialCompositionToInsert.map((material) => material.percentage);
    const insertedRows = await sql.transaction((tx: any) => {
      const txQueries: any[] = [
        tx`
          INSERT INTO garments (file_name, model, brand, type_id, features, favorite, style_id, formality_id)
          VALUES (${fileName}, ${model}, ${brand}, ${resolvedType.id}, ${features}, ${favorite}, ${styleId}, ${formalityId})
        `,
        tx`
          INSERT INTO garment_style (garment_id, style_id)
          SELECT currval(pg_get_serial_sequence('garments', 'id')), unnest(${styleIds}::int[])
          ON CONFLICT (garment_id, style_id) DO NOTHING
        `,
        tx`
          INSERT INTO garment_material_composition (garment_id, material_id, percentage)
          SELECT currval(pg_get_serial_sequence('garments', 'id')), unnest(${materialIds}::int[]), unnest(${percentages}::int[])
        `,
      ];

      if (colorIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_color (garment_id, color_id)
          SELECT currval(pg_get_serial_sequence('garments', 'id')), unnest(${colorIds}::int[])
        `);
      }
      if (suitableWeatherIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_weather (garment_id, suitable_weather_id)
          SELECT currval(pg_get_serial_sequence('garments', 'id')), unnest(${suitableWeatherIds}::int[])
        `);
      }
      if (suitableTimeOfDayIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_time_of_day (garment_id, suitable_time_of_day_id)
          SELECT currval(pg_get_serial_sequence('garments', 'id')), unnest(${suitableTimeOfDayIds}::int[])
        `);
      }
      if (suitablePlaceIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_place (garment_id, suitable_place_id)
          SELECT currval(pg_get_serial_sequence('garments', 'id')), unnest(${suitablePlaceIds}::int[])
        `);
      }
      if (suitableOccasionIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_occasion (garment_id, suitable_occasion_id)
          SELECT currval(pg_get_serial_sequence('garments', 'id')), unnest(${suitableOccasionIds}::int[])
        `);
      }

      txQueries.push(tx`SELECT currval(pg_get_serial_sequence('garments', 'id')) AS id`);
      return txQueries;
    });

    const newGarmentId = insertedRows[insertedRows.length - 1]?.[0]?.id;
    if (!newGarmentId) {
      return { message: 'Failed to create garment.', status: 'error' };
    }

    // 4. Revalidate cache
    revalidateTag('garments');

    // 5. Redirect to the new garment's page
    redirect(`/garments/${newGarmentId}`);

    // This part is technically unreachable due to redirect, but good for type safety
    return { message: 'Garment created successfully!', status: 'success', newGarmentId };

  } catch (error: any) {
    if (error.digest?.startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('Failed to create garment:', error);
    return { message: 'Failed to create garment.', status: 'error' };
  }
}

export async function updateGarment(prevState: any, formData: FormData): Promise<{ message: string; status: string }> {

  const gate = await requireOwner(UNAUTHORIZED_RESULT);
  if (!gate.ok) return gate.result;

  const sql = neon(process.env.DATABASE_URL!);
  try {
    const id = parseInt(formData.get('id') as string);

    // Fetch existing garment data
    const existingGarmentResult = await sql`SELECT * FROM garments WHERE id = ${id}`;
    if (existingGarmentResult.length === 0) {
      return { message: 'Garment not found.', status: 'error' };
    }
    const existingGarment = existingGarmentResult[0];

    const fileName = (formData.get('file_name') as string) || existingGarment.file_name;
    const model = (formData.get('model') as string) || existingGarment.model;
    const brand = (formData.get('brand') as string) || existingGarment.brand;
    const typeInput = (formData.get('type') as string)?.trim();
    const features = (formData.get('features') as string) || existingGarment.features;
    const favorite = formData.has('favorite') ? (formData.get('favorite') === 'true') : existingGarment.favorite;

    // Get names for single-select lookup fields
    // Get names for single-select lookup fields
    const styleName = String(formData.get('style') ?? '').trim();
    const stylesInput = formData.get('styles');
    const providedStyleNames = stylesInput === null
      ? []
      : parseStringArrayField(stylesInput);
    const formalityName = String(formData.get('formality') ?? '').trim();

    // Get names for multi-select lookup fields.
    // If formData is empty, retain existing associations.
    const existingColors = await sql`SELECT c.name FROM colors c JOIN garment_color gc ON c.id = gc.color_id WHERE gc.garment_id = ${id}`;
    const existingColorNames = existingColors.map((row: any) => row.name);
    const colorsInput = formData.get('colors');
    const colorNames = colorsInput === null ? existingColorNames : parseStringArrayField(colorsInput);

    const existingSuitableWeathers = await sql`SELECT sw.name FROM suitable_weathers sw JOIN garment_suitable_weather gsw ON sw.id = gsw.suitable_weather_id WHERE gsw.garment_id = ${id}`;
    const existingSuitableWeatherNames = existingSuitableWeathers.map((row: any) => row.name);
    const suitableWeathersInput = formData.get('suitableWeathers');
    const suitableWeatherNames = suitableWeathersInput === null
      ? existingSuitableWeatherNames
      : parseStringArrayField(suitableWeathersInput);

    const existingSuitableTimesOfDay = await sql`SELECT st.name FROM suitable_times_of_day st JOIN garment_suitable_time_of_day gstd ON st.id = gstd.suitable_time_of_day_id WHERE gstd.garment_id = ${id}`;
    const existingSuitableTimeOfDayNames = existingSuitableTimesOfDay.map((row: any) => row.name);
    const suitableTimesOfDayInput = formData.get('suitableTimesOfDay');
    const suitableTimeOfDayNames = suitableTimesOfDayInput === null
      ? existingSuitableTimeOfDayNames
      : parseStringArrayField(suitableTimesOfDayInput);

    const existingSuitablePlaces = await sql`SELECT sp.name FROM suitable_places sp JOIN garment_suitable_place gsp ON sp.id = gsp.suitable_place_id WHERE gsp.garment_id = ${id}`;
    const existingSuitablePlaceNames = existingSuitablePlaces.map((row: any) => row.name);
    const suitablePlacesInput = formData.get('suitablePlaces');
    const suitablePlaceNames = suitablePlacesInput === null
      ? existingSuitablePlaceNames
      : parseStringArrayField(suitablePlacesInput);

    const existingSuitableOccasions = await sql`SELECT so.name FROM suitable_occasions so JOIN garment_suitable_occasion gso ON so.id = gso.suitable_occasion_id WHERE gso.garment_id = ${id}`;
    const existingSuitableOccasionNames = existingSuitableOccasions.map((row: any) => row.name);
    const suitableOccasionsInput = formData.get('suitableOccasions');
    const suitableOccasionNames = suitableOccasionsInput === null
      ? existingSuitableOccasionNames
      : parseStringArrayField(suitableOccasionsInput);

    const existingStyles = await sql`
      SELECT s.name
      FROM garment_style gs
      JOIN styles s ON gs.style_id = s.id
      WHERE gs.garment_id = ${id}
      ORDER BY gs.style_id ASC
    `;
    const existingStyleNames = existingStyles.map((row: any) => row.name);
    const fallbackExistingStyleNames = existingStyleNames.length > 0
      ? existingStyleNames
      : (existingGarment.style_id
        ? ((await sql`SELECT name FROM styles WHERE id = ${existingGarment.style_id} LIMIT 1`).map((row: any) => row.name))
        : []);
    const styleNames = providedStyleNames.length > 0
      ? providedStyleNames
      : (styleName ? [styleName] : fallbackExistingStyleNames);

    // Materials are complex, assuming a JSON string for now
    const materialsInput = formData.get('materials');
    let materials: MaterialInput[] = [];
    let materialsProvided = false;

    if (typeof materialsInput === 'string') {
      materialsProvided = true;
      try {
        const parsed = JSON.parse(materialsInput);
        const list = Array.isArray(parsed) ? parsed : [];
        materials = list.map((material: any) => ({
          material: material.material,
          percentage: Number.parseInt(String(material.percentage), 10)
        }));
      } catch (e) {
        console.error('Failed to parse materials JSON:', e);
        return { message: 'Error: Invalid materials data.', status: 'error' };
      }
    } else {
      // If no new materials are provided, fetch existing ones
      const existingMaterials = await sql`SELECT m.name as material, gm.percentage FROM materials m JOIN garment_material_composition gm ON m.id = gm.material_id WHERE gm.garment_id = ${id}`;
      materials = existingMaterials.map((material: any) => ({
        material: material.material,
        percentage: material.percentage
      }));
    }

    const materialCompositionToInsert = await resolveMaterialCompositionToInsert(sql, materials);
    if (materialsProvided && materialCompositionToInsert.length === 0) {
      return { message: 'Please keep at least one valid material with percentage greater than 0.', status: 'error' };
    }

    let typeId = existingGarment.type_id as number | undefined;
    if (!typeId && existingGarment.type) {
      const resolvedExistingType = await resolveTypeId(sql, existingGarment.type);
      typeId = resolvedExistingType?.id;
    }
    if (typeInput) {
      const resolvedType = await resolveTypeId(sql, typeInput);
      typeId = resolvedType?.id;
    }
    if (!typeId) {
      return { message: 'Type is required.', status: 'error' };
    }

    // Fetch IDs for lookup tables
    const [
      resolvedStyles,
      resolvedFormality,
      suitableWeathersResult,
      suitableTimesOfDayResult,
      suitablePlacesResult,
      suitableOccasionsResult,
    ] = await Promise.all([
      resolveStyleIds(sql, styleNames),
      formalityName ? resolveFormalityId(sql, formalityName) : Promise.resolve(null),
      suitableWeatherNames.length > 0 ? sql`SELECT id FROM suitable_weathers WHERE name = ANY(${suitableWeatherNames})` : Promise.resolve([]),
      suitableTimeOfDayNames.length > 0 ? sql`SELECT id FROM suitable_times_of_day WHERE name = ANY(${suitableTimeOfDayNames})` : Promise.resolve([]),
      suitablePlaceNames.length > 0 ? sql`SELECT id FROM suitable_places WHERE name = ANY(${suitablePlaceNames})` : Promise.resolve([]),
      suitableOccasionNames.length > 0 ? sql`SELECT id FROM suitable_occasions WHERE name = ANY(${suitableOccasionNames})` : Promise.resolve([]),
    ]);

    if (resolvedStyles.ids.length === 0 || resolvedStyles.missing.length > 0) {
      const baseError = buildStyleValidationError(resolvedStyles.missing);
      return {
        message:
          baseError.message === 'Style is required and must match an existing style option.'
            ? 'Style value is invalid. Please re-select style.'
            : baseError.message,
        status: baseError.status,
      };
    }
    if (formalityName && !resolvedFormality) {
      return { message: 'Formality value is invalid. Please re-select formality.', status: 'error' };
    }

    const styleIds = resolvedStyles.ids;
    const styleId = styleIds[0] || existingGarment.style_id;
    const formalityId = resolvedFormality?.id || existingGarment.formality_id;

    const colorIds = await resolveColorIds(sql, colorNames);
    const suitableWeatherIds = suitableWeathersResult.map((row: any) => row.id);
    const suitableTimeOfDayIds = suitableTimesOfDayResult.map((row: any) => row.id);
    const suitablePlaceIds = suitablePlacesResult.map((row: any) => row.id);
    const suitableOccasionIds = suitableOccasionsResult.map((row: any) => row.id);

    await sql.transaction((tx: any) => {
      const txQueries: any[] = [
        tx`
          UPDATE garments
          SET
            file_name = ${fileName},
            model = ${model},
            brand = ${brand},
            type_id = ${typeId},
            features = ${features},
            favorite = ${favorite},
            style_id = ${styleId},
            formality_id = ${formalityId}
          WHERE id = ${id}
        `,
        tx`DELETE FROM garment_style WHERE garment_id = ${id}`,
        tx`DELETE FROM garment_material_composition WHERE garment_id = ${id}`,
      ];

      if (styleIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_style (garment_id, style_id)
          SELECT ${id}, unnest(${styleIds}::int[])
          ON CONFLICT (garment_id, style_id) DO NOTHING
        `);
      }

      if (materialCompositionToInsert.length > 0) {
        const materialIds = materialCompositionToInsert.map((material) => material.id);
        const percentages = materialCompositionToInsert.map((material) => material.percentage);
        txQueries.push(tx`
          INSERT INTO garment_material_composition (garment_id, material_id, percentage)
          SELECT ${id}, unnest(${materialIds}::int[]), unnest(${percentages}::int[])
        `);
      }

      txQueries.push(
        tx`DELETE FROM garment_color WHERE garment_id = ${id}`,
        tx`DELETE FROM garment_suitable_weather WHERE garment_id = ${id}`,
        tx`DELETE FROM garment_suitable_time_of_day WHERE garment_id = ${id}`,
        tx`DELETE FROM garment_suitable_place WHERE garment_id = ${id}`,
        tx`DELETE FROM garment_suitable_occasion WHERE garment_id = ${id}`
      );

      if (colorIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_color (garment_id, color_id)
          SELECT ${id}, unnest(${colorIds}::int[])
        `);
      }
      if (suitableWeatherIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_weather (garment_id, suitable_weather_id)
          SELECT ${id}, unnest(${suitableWeatherIds}::int[])
        `);
      }
      if (suitableTimeOfDayIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_time_of_day (garment_id, suitable_time_of_day_id)
          SELECT ${id}, unnest(${suitableTimeOfDayIds}::int[])
        `);
      }
      if (suitablePlaceIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_place (garment_id, suitable_place_id)
          SELECT ${id}, unnest(${suitablePlaceIds}::int[])
        `);
      }
      if (suitableOccasionIds.length > 0) {
        txQueries.push(tx`
          INSERT INTO garment_suitable_occasion (garment_id, suitable_occasion_id)
          SELECT ${id}, unnest(${suitableOccasionIds}::int[])
        `);
      }

      return txQueries;
    });

    revalidateTag('garments'); // Invalidate cache for garments

    redirect(`/garments/${id}?updated=1`);

    return { message: 'Garment updated successfully!', status: 'success' };
  } catch (error: any) {
    if (error.digest?.startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('Failed to update garment:', error);
    return { message: 'Failed to update garment.', status: 'error' };
  }
}

export async function deleteGarment(id: number) {
  const gate = await requireOwner(UNAUTHORIZED_RESULT);
  if (!gate.ok) return gate.result;

  const sql = neon(process.env.DATABASE_URL!);
  try {
    await sql`DELETE FROM garment_style WHERE garment_id = ${id}`;
    await sql`DELETE FROM garment_material_composition WHERE garment_id = ${id}`;
    await sql`DELETE FROM garment_color WHERE garment_id = ${id}`;
    await sql`DELETE FROM garment_suitable_weather WHERE garment_id = ${id}`;
    await sql`DELETE FROM garment_suitable_time_of_day WHERE garment_id = ${id}`;
    await sql`DELETE FROM garment_suitable_place WHERE garment_id = ${id}`;
    await sql`DELETE FROM garment_suitable_occasion WHERE garment_id = ${id}`;

    const deleted = await sql`DELETE FROM garments WHERE id = ${id} RETURNING id`;
    if (deleted.length === 0) {
      return { message: 'Garment not found.', status: 'error' };
    }

    revalidateTag('garments');
    return { message: 'Garment deleted successfully!', status: 'success' };
  } catch (error) {
    console.error('Failed to delete garment:', error);
    return { message: 'Failed to delete garment.', status: 'error' };
  }
}
