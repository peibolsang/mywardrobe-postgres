import { sql } from "@/lib/db";
import { Garment } from "@/lib/types";
import GarmentDetailsClient from "@/components/client/garment-details-client";
import { isOwnerSession } from "@/lib/owner";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { promises as fs } from 'fs';
import path from 'path';

async function getGarment(id: string): Promise<Garment | null> {
  const garmentResult = await sql`
    SELECT
      g.id,
      g.file_name,
      g.model,
      g.brand,
      t.name AS type,
      g.features,
      g.favorite,
      COALESCE(
        s.name,
        (
          SELECT s2.name
          FROM garment_style gs2
          JOIN styles s2 ON s2.id = gs2.style_id
          WHERE gs2.garment_id = g.id
          ORDER BY gs2.style_id
          LIMIT 1
        ),
        ''
      ) AS style,
      f.name AS formality
    FROM garments g
    LEFT JOIN types t ON g.type_id = t.id
    LEFT JOIN styles s ON g.style_id = s.id
    LEFT JOIN formalities f ON g.formality_id = f.id
    WHERE g.id = ${id}
  `;

  if (garmentResult.length === 0) {
    return null;
  }

  const garment = garmentResult[0] as Garment;

  // Fetch many-to-many relationships
  const [materials, colors, suitableWeathers, suitableTimesOfDay, suitablePlaces, suitableOccasions, styles] = await Promise.all([
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
    sql`
      SELECT s.name
      FROM garment_style gs
      JOIN styles s ON gs.style_id = s.id
      WHERE gs.garment_id = ${id}
      ORDER BY gs.style_id ASC
    `,
  ]);

  garment.material_composition = materials.map((m: any) => ({ material: m.name, percentage: m.percentage }));
  garment.color_palette = colors.map((c: any) => c.name);
  garment.suitable_weather = suitableWeathers.map((sw: any) => sw.name);
  garment.suitable_time_of_day = suitableTimesOfDay.map((st: any) => st.name);
  garment.suitable_places = suitablePlaces.map((sp: any) => sp.name);
  garment.suitable_occasions = suitableOccasions.map((so: any) => so.name);
  garment.styles = styles.map((st: any) => st.name);
  if (garment.styles.length === 0 && garment.style) {
    garment.styles = [garment.style];
  }
  garment.style = garment.styles[0] ?? garment.style ?? "";

  return garment;
}

async function getAdjacentGarmentIds(id: number): Promise<{ previousGarmentId: number | null; nextGarmentId: number | null }> {
  const result = await sql`
    SELECT
      (
        SELECT g_prev.id
        FROM garments g_prev
        WHERE g_prev.id < ${id}
        ORDER BY g_prev.id DESC
        LIMIT 1
      ) AS previous_id,
      (
        SELECT g_next.id
        FROM garments g_next
        WHERE g_next.id > ${id}
        ORDER BY g_next.id ASC
        LIMIT 1
      ) AS next_id
  `;

  const row = result[0] as { previous_id?: number | null; next_id?: number | null } | undefined;
  return {
    previousGarmentId: typeof row?.previous_id === "number" ? row.previous_id : null,
    nextGarmentId: typeof row?.next_id === "number" ? row.next_id : null,
  };
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
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  const params = await paramsPromise;
  const garment = await getGarment(params.id);
  const schema = await getSchema();
  const canEdit = await isOwnerSession();

  if (!garment) {
    return <div className="flex justify-center items-center min-h-screen">Garment not found.</div>;
  }

  const garmentId = Number(params.id);
  const { previousGarmentId, nextGarmentId } = Number.isInteger(garmentId)
    ? await getAdjacentGarmentIds(garmentId)
    : { previousGarmentId: null, nextGarmentId: null };

  return (
    <GarmentDetailsClient
      garment={garment}
      schema={schema}
      canEdit={canEdit}
      previousGarmentId={previousGarmentId}
      nextGarmentId={nextGarmentId}
    />
  );
}
