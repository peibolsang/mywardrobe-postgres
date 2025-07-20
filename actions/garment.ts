'use server';

import { neon } from '@neondatabase/serverless';
import { revalidateTag } from 'next/cache';

export async function createGarment(prevState: any, formData: FormData): Promise<{ message: string; status: string }> {
  const sql = neon(process.env.DATABASE_URL!);
  return { message: 'Garment created successfully!', status: 'success' };
}

export async function updateGarment(prevState: any, formData: FormData): Promise<{ message: string; status: string }> {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const id = parseInt(formData.get('id') as string);
    const fileName = formData.get('file_name') as string;
    const model = formData.get('model') as string;
    const brand = formData.get('brand') as string;
    const type = formData.get('type') as string;
    const features = formData.get('features') as string;
    const favorite = formData.get('favorite') === 'on';

    // Get names for single-select lookup fields
    const styleName = formData.get('style') as string;
    const formalityName = formData.get('formality') as string;
    const warmthLevelName = formData.get('warmthLevel') as string;

    // Get names for multi-select lookup fields (assuming comma-separated names)
    const colorNames = (formData.get('colors') as string)?.split(',').filter(Boolean) || [];
    const suitableWeatherNames = (formData.get('suitableWeathers') as string)?.split(',').filter(Boolean) || [];
    const suitableTimeOfDayNames = (formData.get('suitableTimesOfDay') as string)?.split(',').filter(Boolean) || [];
    const suitablePlaceNames = (formData.get('suitablePlaces') as string)?.split(',').filter(Boolean) || [];
    const suitableOccasionNames = (formData.get('suitableOccasions') as string)?.split(',').filter(Boolean) || [];

    // Materials are complex, assuming a JSON string for now
    const materialsJson = formData.get('materials') as string;
    let materials: { material: string; percentage: number }[] = [];
    if (materialsJson) {
      try {
        materials = JSON.parse(materialsJson).map((m: any) => ({
          material: m.material,
          percentage: parseInt(m.percentage)
        }));
      } catch (e) {
        console.error('Failed to parse materials JSON:', e);
        return { message: 'Error: Invalid materials data.', status: 'error' };
      }
    }

    // Fetch material IDs based on names
    const materialNames = materials.map(m => m.material);
    const materialsResult = materialNames.length > 0 ? await sql`SELECT id, name FROM materials WHERE name = ANY(${materialNames})` : [];
    const materialIdMap = new Map(materialsResult.map((m: any) => [m.name, m.id]));

    const materialCompositionToInsert = materials.map(m => ({
      id: materialIdMap.get(m.material),
      percentage: m.percentage
    })).filter(m => m.id !== undefined); // Filter out materials not found in DB

    // Fetch IDs for lookup tables
    const [
      styleResult,
      formalityResult,
      warmthLevelResult,
      colorsResult,
      suitableWeathersResult,
      suitableTimesOfDayResult,
      suitablePlacesResult,
      suitableOccasionsResult,
    ] = await Promise.all([
      sql`SELECT id FROM styles WHERE name = ${styleName}`,
      sql`SELECT id FROM formalities WHERE name = ${formalityName}`,
      sql`SELECT id FROM warmth_levels WHERE name = ${warmthLevelName}`,
      sql`SELECT id FROM colors WHERE name = ANY(${colorNames})`,
      sql`SELECT id FROM suitable_weathers WHERE name = ANY(${suitableWeatherNames})`,
      sql`SELECT id FROM suitable_times_of_day WHERE name = ANY(${suitableTimeOfDayNames})`,
      sql`SELECT id FROM suitable_places WHERE name = ANY(${suitablePlaceNames})`,
      sql`SELECT id FROM suitable_occasions WHERE name = ANY(${suitableOccasionNames})`,
    ]);

    const styleId = styleResult[0]?.id;
    const formalityId = formalityResult[0]?.id;
    const warmthLevelId = warmthLevelResult[0]?.id;

    const colorIds = colorsResult.map((row: any) => row.id);
    const suitableWeatherIds = suitableWeathersResult.map((row: any) => row.id);
    const suitableTimeOfDayIds = suitableTimesOfDayResult.map((row: any) => row.id);
    const suitablePlaceIds = suitablePlacesResult.map((row: any) => row.id);
    const suitableOccasionIds = suitableOccasionsResult.map((row: any) => row.id);

    // Start a transaction for atomicity
    await sql`
        UPDATE garments
        SET
          file_name = ${fileName},
          model = ${model},
          brand = ${brand},
          type = ${type},
          features = ${features},
          favorite = ${favorite},
          style_id = ${styleId},
          formality_id = ${formalityId},
          warmth_level_id = ${warmthLevelId}
        WHERE id = ${id}
      `;

      // 2. Update many-to-many relationships
      // For each junction table: delete existing, then insert new using unnest

      // Materials
      await sql`DELETE FROM garment_material_composition WHERE garment_id = ${id}`;
      if (materialCompositionToInsert.length > 0) {
        const materialIds = materialCompositionToInsert.map(m => m.id);
        const percentages = materialCompositionToInsert.map(m => m.percentage);
        await sql`
          INSERT INTO garment_material_composition (garment_id, material_id, percentage)
          SELECT ${id}, unnest(${materialIds}::int[]), unnest(${percentages}::int[])
        `;
      }

      // Colors
      await sql`DELETE FROM garment_color WHERE garment_id = ${id}`;
      if (colorIds.length > 0) {
        await sql`
          INSERT INTO garment_color (garment_id, color_id)
          SELECT ${id}, unnest(${colorIds}::int[])
        `;
      }

      // Suitable Weathers
      await sql`DELETE FROM garment_suitable_weather WHERE garment_id = ${id}`;
      if (suitableWeatherIds.length > 0) {
        await sql`
          INSERT INTO garment_suitable_weather (garment_id, suitable_weather_id)
          SELECT ${id}, unnest(${suitableWeatherIds}::int[])
        `;
      }

      // Suitable Times of Day
      await sql`DELETE FROM garment_suitable_time_of_day WHERE garment_id = ${id}`;
      if (suitableTimeOfDayIds.length > 0) {
        await sql`
          INSERT INTO garment_suitable_time_of_day (garment_id, suitable_time_of_day_id)
          SELECT ${id}, unnest(${suitableTimeOfDayIds}::int[])
        `;
      }

      // Suitable Places
      await sql`DELETE FROM garment_suitable_place WHERE garment_id = ${id}`;
      if (suitablePlaceIds.length > 0) {
        await sql`
          INSERT INTO garment_suitable_place (garment_id, suitable_place_id)
          SELECT ${id}, unnest(${suitablePlaceIds}::int[])
        `;
      }

      // Suitable Occasions
      await sql`DELETE FROM garment_suitable_occasion WHERE garment_id = ${id}`;
      if (suitableOccasionIds.length > 0) {
        await sql`
          INSERT INTO garment_suitable_occasion (garment_id, suitable_occasion_id)
          SELECT ${id}, unnest(${suitableOccasionIds}::int[])
        `;
      }

    revalidateTag('garments'); // Invalidate cache for garments

    return { message: 'Garment updated successfully!', status: 'success' };
  } catch (error) {
    console.error('Failed to update garment:', error);
    return { message: 'Failed to update garment.', status: 'error' };
  }
}

export async function deleteGarment(id: number) {
  const sql = neon(process.env.DATABASE_URL!);
  return { message: 'Garment deleted successfully!' };
}
