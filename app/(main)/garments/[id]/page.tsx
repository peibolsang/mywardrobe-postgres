import { sql } from "@/lib/db";
import { Garment } from "@/lib/types";
import GarmentDetailsClient from "@/components/client/garment-details-client";
import { promises as fs } from 'fs';
import path from 'path';

async function getGarment(id: string): Promise<Garment | null> {
  const garmentResult = await sql`
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
      wl.name AS warmth_level
    FROM garments g
    LEFT JOIN styles s ON g.style_id = s.id
    LEFT JOIN formalities f ON g.formality_id = f.id
    LEFT JOIN warmth_levels wl ON g.warmth_level_id = wl.id
    WHERE g.id = ${id}
  `;

  if (garmentResult.length === 0) {
    return null;
  }

  const garment = garmentResult[0] as Garment;

  // Fetch many-to-many relationships
  const [materials, colors, suitableWeathers, suitableTimesOfDay, suitablePlaces, suitableOccasions] = await Promise.all([
    sql`
      SELECT m.name, gmc.percentage
      FROM garment_material_composition gmc
      JOIN materials m ON gmc.material_id = m.id
      WHERE gmc.garment_id = ${id}
    `,
    sql`
      SELECT c.name
      FROM garment_color gc
      JOIN colors c ON gc.color_id = c.id
      WHERE gc.garment_id = ${id}
    `,
    sql`
      SELECT sw.name
      FROM garment_suitable_weather gsw
      JOIN suitable_weathers sw ON gsw.suitable_weather_id = sw.id
      WHERE gsw.garment_id = ${id}
    `,
    sql`
      SELECT st.name
      FROM garment_suitable_time_of_day gstd
      JOIN suitable_times_of_day st ON gstd.suitable_time_of_day_id = st.id
      WHERE gstd.garment_id = ${id}
    `,
    sql`
      SELECT sp.name
      FROM garment_suitable_place gsp
      JOIN suitable_places sp ON gsp.suitable_place_id = sp.id
      WHERE gsp.garment_id = ${id}
    `,
    sql`
      SELECT so.name
      FROM garment_suitable_occasion gso
      JOIN suitable_occasions so ON gso.suitable_occasion_id = so.id
      WHERE gso.garment_id = ${id}
    `,
  ]);

  garment.material_composition = materials.map((m: any) => ({ material: m.name, percentage: m.percentage }));
  garment.color_palette = colors.map((c: any) => c.name);
  garment.suitable_weather = suitableWeathers.map((sw: any) => sw.name);
  garment.suitable_time_of_day = suitableTimesOfDay.map((st: any) => st.name);
  garment.suitable_places = suitablePlaces.map((sp: any) => sp.name);
  garment.suitable_occasions = suitableOccasions.map((so: any) => so.name);

  return garment;
}

async function getSchema() {
  const schemaPath = path.join(process.cwd(), 'public', 'schema.json');
  const schemaFile = await fs.readFile(schemaPath, 'utf-8');
  return JSON.parse(schemaFile);
}

export const metadata = {
  title: "My Wardrobe - Garment Details",
};

export default async function GarmentPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const garment = await getGarment(params.id);
  const schema = await getSchema();

  if (!garment) {
    return <div className="flex justify-center items-center min-h-screen">Garment not found.</div>;
  }

  return <GarmentDetailsClient garment={garment} schema={schema} />;
}
