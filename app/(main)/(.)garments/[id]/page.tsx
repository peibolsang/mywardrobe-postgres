
import { Garment } from "@/lib/types";
import GarmentModalClient from "@/components/client/garment-modal-client";
import { neon } from '@neondatabase/serverless';

async function getGarment(id: string): Promise<Garment | null> {
  const sql = neon(process.env.DATABASE_URL!);
  const garments = await sql`
    SELECT
      g.id,
      g.file_name,
      g.model,
      g.brand,
      t.name AS type,
      g.features,
      g.favorite
    FROM garments g
    LEFT JOIN types t ON g.type_id = t.id
    WHERE g.id = ${id}
  `;
  return (garments[0] as Garment) || null;
}

export default async function GarmentModal({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const garment = await getGarment(params.id);

  if (!garment) {
    return null; 
  }

  return <GarmentModalClient garment={garment} />;
}
