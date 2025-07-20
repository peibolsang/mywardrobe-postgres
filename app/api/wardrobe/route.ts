import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { unstable_cache } from 'next/cache';

interface Garment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: { material: string; percentage: number }[];
  color_palette: string[];
  warmth_level: string;
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
  favorite: boolean;
}

const getGarments = unstable_cache(
  async () => {
    const sql = neon(`${process.env.DATABASE_URL}`);
    const garments = await sql`
      SELECT
        g.id,
        g.file_name,
        g.model,
        g.brand,
        g.type,
        g.features,
        g.favorite,
        s.name AS style,
        f.name AS formality,
        wl.name AS warmth_level,
        COALESCE(json_agg(DISTINCT jsonb_build_object('material', m.name, 'percentage', gmc.percentage)) FILTER (WHERE m.name IS NOT NULL), '[]') AS material_composition,
        COALESCE(json_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL), '[]') AS color_palette,
        COALESCE(json_agg(DISTINCT sw.name) FILTER (WHERE sw.name IS NOT NULL), '[]') AS suitable_weather,
        COALESCE(json_agg(DISTINCT st.name) FILTER (WHERE st.name IS NOT NULL), '[]') AS suitable_time_of_day,
        COALESCE(json_agg(DISTINCT sp.name) FILTER (WHERE sp.name IS NOT NULL), '[]') AS suitable_places,
        COALESCE(json_agg(DISTINCT so.name) FILTER (WHERE so.name IS NOT NULL), '[]') AS suitable_occasions
      FROM garments g
      LEFT JOIN styles s ON g.style_id = s.id
      LEFT JOIN formalities f ON g.formality_id = f.id
      LEFT JOIN warmth_levels wl ON g.warmth_level_id = wl.id
      LEFT JOIN garment_material_composition gmc ON g.id = gmc.garment_id
      LEFT JOIN materials m ON gmc.material_id = m.id
      LEFT JOIN garment_color gc ON g.id = gc.garment_id
      LEFT JOIN colors c ON gc.color_id = c.id
      LEFT JOIN garment_suitable_weather gsw ON g.id = gsw.garment_id
      LEFT JOIN suitable_weathers sw ON gsw.suitable_weather_id = sw.id
      LEFT JOIN garment_suitable_time_of_day gstd ON g.id = gstd.garment_id
      LEFT JOIN suitable_times_of_day st ON gstd.suitable_time_of_day_id = st.id
      LEFT JOIN garment_suitable_place gsp ON g.id = gsp.garment_id
      LEFT JOIN suitable_places sp ON gsp.suitable_place_id = sp.id
      LEFT JOIN garment_suitable_occasion gso ON g.id = gso.garment_id
      LEFT JOIN suitable_occasions so ON gso.suitable_occasion_id = so.id
      GROUP BY g.id, s.name, f.name, wl.name
      ORDER BY g.id ASC;
    ` as unknown as Garment[];
    return garments;
  },
  ['garments'],
  {
    tags: ['garments'],
  }
);

export async function GET() {
  try {
    const garments = await getGarments();
    return NextResponse.json(garments);
  } catch (error) {
    console.error('Failed to fetch garments:', error);
    return NextResponse.json({ error: 'Failed to load wardrobe data' }, { status: 500 });
  }
}
