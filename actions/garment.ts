'use server';

import { sql, pool } from '@/lib/db';
import { GarmentFormData } from '@/lib/types';
import { revalidateTag } from 'next/cache';
import { put } from '@vercel/blob';

async function getOrCreateLookupId(tableName: string, name: string): Promise<number> {
  let query: string;
  switch (tableName) {
    case 'styles':
      query = `SELECT id FROM styles WHERE name = ${name}`;
      break;
    case 'formalities':
      query = `SELECT id FROM formalities WHERE name = ${name}`;
      break;
    case 'warmth_levels':
      query = `SELECT id FROM warmth_levels WHERE name = ${name}`;
      break;
    case 'suitable_weathers':
      query = `SELECT id FROM suitable_weathers WHERE name = ${name}`;
      break;
    case 'suitable_times_of_day':
      query = `SELECT id FROM suitable_times_of_day WHERE name = ${name}`;
      break;
    case 'suitable_places':
      query = `SELECT id FROM suitable_places WHERE name = ${name}`;
      break;
    case 'suitable_occasions':
      query = `SELECT id FROM suitable_occasions WHERE name = ${name}`;
      break;
    case 'colors':
      query = `SELECT id FROM colors WHERE name = ${name}`;
      break;
    case 'materials':
      query = `SELECT id FROM materials WHERE name = ${name}`;
      break;
    default:
      throw new Error(`Unknown table name: ${tableName}`);
  }

  const result = await sql`${query}` as { id: number }[];

  if (result.length > 0) {
    return result[0].id;
  } else {
    let insertQuery: string;
    switch (tableName) {
      case 'styles':
        insertQuery = `INSERT INTO styles (name) VALUES (${name}) RETURNING id`;
        break;
      case 'formalities':
        insertQuery = `INSERT INTO formalities (name) VALUES (${name}) RETURNING id`;
        break;
      case 'warmth_levels':
        insertQuery = `INSERT INTO warmth_levels (name) VALUES (${name}) RETURNING id`;
        break;
      case 'suitable_weathers':
        insertQuery = `INSERT INTO suitable_weathers (name) VALUES (${name}) RETURNING id`;
        break;
      case 'suitable_times_of_day':
        insertQuery = `INSERT INTO suitable_times_of_day (name) VALUES (${name}) RETURNING id`;
        break;
      case 'suitable_places':
        insertQuery = `INSERT INTO suitable_places (name) VALUES (${name}) RETURNING id`;
        break;
      case 'suitable_occasions':
        insertQuery = `INSERT INTO suitable_occasions (name) VALUES (${name}) RETURNING id`;
        break;
      case 'colors':
        insertQuery = `INSERT INTO colors (name) VALUES (${name}) RETURNING id`;
        break;
      case 'materials':
        insertQuery = `INSERT INTO materials (name) VALUES (${name}) RETURNING id`;
        break;
      default:
        throw new Error(`Unknown table name: ${tableName}`);
    }
    const newResult = await sql`${insertQuery}` as { id: number }[];
    return newResult[0].id;
  }
}

export async function createGarment(prevState: any, formData: FormData) {
  const file = formData.get('file_name') as File;
  let file_name = '';

  if (file && file.size > 0) {
    const blob = await put(file.name, file, { access: 'public' });
    file_name = blob.url;
  }

  const garmentData: GarmentFormData = {
    file_name: file_name,
    model: formData.get('model') as string,
    brand: formData.get('brand') as string,
    type: formData.get('type') as string,
    style: formData.get('style') as string,
    formality: formData.get('formality') as string,
    material_composition: JSON.parse(formData.get('material_composition') as string),
    color_palette: JSON.parse(formData.get('color_palette') as string),
    warmth_level: formData.get('warmth_level') as string,
    suitable_weather: JSON.parse(formData.get('suitable_weather') as string),
    suitable_time_of_day: JSON.parse(formData.get('suitable_time_of_day') as string),
    suitable_places: JSON.parse(formData.get('suitable_places') as string),
    suitable_occasions: JSON.parse(formData.get('suitable_occasions') as string),
    features: formData.get('features') as string,
    favorite: formData.get('favorite') === 'on',
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const style_id = await getOrCreateLookupId('styles', garmentData.style);
    const formality_id = await getOrCreateLookupId('formalities', garmentData.formality);
    const warmth_level_id = await getOrCreateLookupId('warmth_levels', garmentData.warmth_level);

    const garmentRows = await client.query(
      `INSERT INTO garments (file_name, model, brand, type, features, favorite, style_id, formality_id, warmth_level_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [garmentData.file_name, garmentData.model, garmentData.brand, garmentData.type, garmentData.features, garmentData.favorite, style_id, formality_id, warmth_level_id]
    );
    const garment_id = garmentRows.rows[0].id;

    for (const weather of garmentData.suitable_weather) {
      const weather_id = await getOrCreateLookupId('suitable_weathers', weather);
      await client.query(
        `INSERT INTO garment_suitable_weather (garment_id, suitable_weather_id) VALUES ($1, $2)`,
        [garment_id, weather_id]
      );
    }

    for (const time_of_day of garmentData.suitable_time_of_day) {
      const time_of_day_id = await getOrCreateLookupId('suitable_times_of_day', time_of_day);
      await client.query(
        `INSERT INTO garment_suitable_time_of_day (garment_id, suitable_time_of_day_id) VALUES ($1, $2)`,
        [garment_id, time_of_day_id]
      );
    }

    for (const place of garmentData.suitable_places) {
      const place_id = await getOrCreateLookupId('suitable_places', place);
      await client.query(
        `INSERT INTO garment_suitable_place (garment_id, suitable_place_id) VALUES ($1, $2)`,
        [garment_id, place_id]
      );
    }

    for (const occasion of garmentData.suitable_occasions) {
      const occasion_id = await getOrCreateLookupId('suitable_occasions', occasion);
      await client.query(
        `INSERT INTO garment_suitable_occasion (garment_id, suitable_occasion_id) VALUES ($1, $2)`,
        [garment_id, occasion_id]
      );
    }

    for (const color of garmentData.color_palette) {
      const color_id = await getOrCreateLookupId('colors', color);
      await client.query(
        `INSERT INTO garment_color (garment_id, color_id) VALUES ($1, $2)`,
        [garment_id, color_id]
      );
    }

    for (const material_comp of garmentData.material_composition) {
      const material_id = await getOrCreateLookupId('materials', material_comp.material);
      await client.query(
        `INSERT INTO garment_material_composition (garment_id, material_id, percentage) VALUES ($1, $2, $3)`,
        [garment_id, material_id, material_comp.percentage]
      );
    }

    await client.query('COMMIT');
    revalidateTag('garments');
    return { message: 'Garment created successfully!' };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating garment:', error);
    return { message: 'Failed to create garment.' };
  } finally {
    client.release();
  }
}

export async function updateGarment(prevState: any, formData: FormData) {
  const garment_id = parseInt(formData.get('id') as string);
  const file = formData.get('file_name') as File;
  let file_name = formData.get('current_file_name') as string; // Keep current if no new file

  if (file && file.size > 0) {
    const blob = await put(file.name, file, { access: 'public' });
    file_name = blob.url;
  }

  const garmentData: GarmentFormData = {
    id: garment_id,
    file_name: file_name,
    model: formData.get('model') as string,
    brand: formData.get('brand') as string,
    type: formData.get('type') as string,
    style: formData.get('style') as string,
    formality: formData.get('formality') as string,
    material_composition: JSON.parse(formData.get('material_composition') as string),
    color_palette: JSON.parse(formData.get('color_palette') as string),
    warmth_level: formData.get('warmth_level') as string,
    suitable_weather: JSON.parse(formData.get('suitable_weather') as string),
    suitable_time_of_day: JSON.parse(formData.get('suitable_time_of_day') as string),
    suitable_places: JSON.parse(formData.get('suitable_places') as string),
    suitable_occasions: JSON.parse(formData.get('suitable_occasions') as string),
    features: formData.get('features') as string,
    favorite: formData.get('favorite') === 'on',
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const style_id = await getOrCreateLookupId('styles', garmentData.style);
    const formality_id = await getOrCreateLookupId('formalities', garmentData.formality);
    const warmth_level_id = await getOrCreateLookupId('warmth_levels', garmentData.warmth_level);

    await client.query(
      `UPDATE garments
      SET
        file_name = $1,
        model = $2,
        brand = $3,
        type = $4,
        features = $5,
        favorite = $6,
        style_id = $7,
        formality_id = $8,
        warmth_level_id = $9
      WHERE id = $10`,
      [garmentData.file_name, garmentData.model, garmentData.brand, garmentData.type, garmentData.features, garmentData.favorite, style_id, formality_id, warmth_level_id, garment_id]
    );

    // Clear existing many-to-many relationships and re-insert
    await client.query(`DELETE FROM garment_suitable_weather WHERE garment_id = $1`, [garment_id]);
    for (const weather of garmentData.suitable_weather) {
      const weather_id = await getOrCreateLookupId('suitable_weathers', weather);
      await client.query(
        `INSERT INTO garment_suitable_weather (garment_id, suitable_weather_id) VALUES ($1, $2)`,
        [garment_id, weather_id]
      );
    }

    await client.query(`DELETE FROM garment_suitable_time_of_day WHERE garment_id = $1`, [garment_id]);
    for (const time_of_day of garmentData.suitable_time_of_day) {
      const time_of_day_id = await getOrCreateLookupId('suitable_times_of_day', time_of_day);
      await client.query(
        `INSERT INTO garment_suitable_time_of_day (garment_id, suitable_time_of_day_id) VALUES ($1, $2)`,
        [garment_id, time_of_day_id]
      );
    }

    await client.query(`DELETE FROM garment_suitable_place WHERE garment_id = $1`, [garment_id]);
    for (const place of garmentData.suitable_places) {
      const place_id = await getOrCreateLookupId('suitable_places', place);
      await client.query(
        `INSERT INTO garment_suitable_place (garment_id, suitable_place_id) VALUES ($1, $2)`,
        [garment_id, place_id]
      );
    }

    await client.query(`DELETE FROM garment_suitable_occasion WHERE garment_id = $1`, [garment_id]);
    for (const occasion of garmentData.suitable_occasions) {
      const occasion_id = await getOrCreateLookupId('suitable_occasions', occasion);
      await client.query(
        `INSERT INTO garment_suitable_occasion (garment_id, suitable_occasion_id) VALUES ($1, $2)`,
        [garment_id, occasion_id]
      );
    }

    await client.query(`DELETE FROM garment_color WHERE garment_id = $1`, [garment_id]);
    for (const color of garmentData.color_palette) {
      const color_id = await getOrCreateLookupId('colors', color);
      await client.query(
        `INSERT INTO garment_color (garment_id, color_id) VALUES ($1, $2)`,
        [garment_id, color_id]
      );
    }

    await client.query(`DELETE FROM garment_material_composition WHERE garment_id = $1`, [garment_id]);
    for (const material_comp of garmentData.material_composition) {
      const material_id = await getOrCreateLookupId('materials', material_comp.material);
      await client.query(
        `INSERT INTO garment_material_composition (garment_id, material_id, percentage) VALUES ($1, $2, $3)`,
        [garment_id, material_id, material_comp.percentage]
      );
    }

    await client.query('COMMIT');
    revalidateTag('garments');
    return { message: 'Garment updated successfully!' };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating garment:', error);
    return { message: 'Failed to update garment.' };
  } finally {
    client.release();
  }
}

export async function deleteGarment(id: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete from junction tables first (due to foreign key constraints)
    await client.query(`DELETE FROM garment_suitable_weather WHERE garment_id = $1`, [id]);
    await client.query(`DELETE FROM garment_suitable_time_of_day WHERE garment_id = $1`, [id]);
    await client.query(`DELETE FROM garment_suitable_place WHERE garment_id = $1`, [id]);
    await client.query(`DELETE FROM garment_suitable_occasion WHERE garment_id = $1`, [id]);
    await client.query(`DELETE FROM garment_color WHERE garment_id = $1`, [id]);
    await client.query(`DELETE FROM garment_material_composition WHERE garment_id = $1`, [id]);

    // Then delete the garment itself
    await client.query(`DELETE FROM garments WHERE id = $1`, [id]);

    await client.query('COMMIT');
    revalidateTag('garments');
    return { message: 'Garment deleted successfully!' };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting garment:', error);
    return { message: 'Failed to delete garment.' };
  } finally {
    client.release();
  }
}
