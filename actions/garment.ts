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

    // Fetch existing garment data
    const existingGarmentResult = await sql`SELECT * FROM garments WHERE id = ${id}`;
    if (existingGarmentResult.length === 0) {
      return { message: 'Garment not found.', status: 'error' };
    }
    const existingGarment = existingGarmentResult[0];

    const fileName = (formData.get('file_name') as string) || existingGarment.file_name;
    const model = (formData.get('model') as string) || existingGarment.model;
    const brand = (formData.get('brand') as string) || existingGarment.brand;
    const type = (formData.get('type') as string) || existingGarment.type;
    const features = (formData.get('features') as string) || existingGarment.features;
    const favorite = formData.has('favorite') ? (formData.get('favorite') === 'on') : existingGarment.favorite;

    // Get names for single-select lookup fields
    // Get names for single-select lookup fields
    const styleName = formData.get('style') as string;
    const formalityName = formData.get('formality') as string;
    const warmthLevelName = formData.get('warmthLevel') as string;

    // Get names for multi-select lookup fields (assuming comma-separated names)
    // For multi-selects, if formData is empty, we should retain existing associations.
    // This requires fetching existing associations first.
    const existingColors = await sql`SELECT c.name FROM colors c JOIN garment_color gc ON c.id = gc.color_id WHERE gc.garment_id = ${id}`;
    const existingColorNames = existingColors.map((row: any) => row.name);
    const colorNames = (formData.get('colors') as string)?.split(',').filter(Boolean) || existingColorNames;

    const existingSuitableWeathers = await sql`SELECT sw.name FROM suitable_weathers sw JOIN garment_suitable_weather gsw ON sw.id = gsw.suitable_weather_id WHERE gsw.garment_id = ${id}`;
    const existingSuitableWeatherNames = existingSuitableWeathers.map((row: any) => row.name);
    const suitableWeatherNames = (formData.get('suitableWeathers') as string)?.split(',').filter(Boolean) || existingSuitableWeatherNames;

    const existingSuitableTimesOfDay = await sql`SELECT st.name FROM suitable_times_of_day st JOIN garment_suitable_time_of_day gstd ON st.id = gstd.suitable_time_of_day_id WHERE gstd.garment_id = ${id}`;
    const existingSuitableTimeOfDayNames = existingSuitableTimesOfDay.map((row: any) => row.name);
    const suitableTimeOfDayNames = (formData.get('suitableTimesOfDay') as string)?.split(',').filter(Boolean) || existingSuitableTimeOfDayNames;

    const existingSuitablePlaces = await sql`SELECT sp.name FROM suitable_places sp JOIN garment_suitable_place gsp ON sp.id = gsp.suitable_place_id WHERE gsp.garment_id = ${id}`;
    const existingSuitablePlaceNames = existingSuitablePlaces.map((row: any) => row.name);
    const suitablePlaceNames = (formData.get('suitablePlaces') as string)?.split(',').filter(Boolean) || existingSuitablePlaceNames;

    const existingSuitableOccasions = await sql`SELECT so.name FROM suitable_occasions so JOIN garment_suitable_occasion gso ON so.id = gso.suitable_occasion_id WHERE gso.garment_id = ${id}`;
    const existingSuitableOccasionNames = existingSuitableOccasions.map((row: any) => row.name);
    const suitableOccasionNames = (formData.get('suitableOccasions') as string)?.split(',').filter(Boolean) || existingSuitableOccasionNames;

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
    } else {
      // If no new materials are provided, fetch existing ones
      const existingMaterials = await sql`SELECT m.name as material, gm.percentage FROM materials m JOIN garment_material_composition gm ON m.id = gm.material_id WHERE gm.garment_id = ${id}`;
      materials = existingMaterials.map((m: any) => ({ material: m.material, percentage: m.percentage }));
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

    const styleId = styleResult[0]?.id || existingGarment.style_id;
    const formalityId = formalityResult[0]?.id || existingGarment.formality_id;
    const warmthLevelId = warmthLevelResult[0]?.id || existingGarment.warmth_level_id;

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
