
import { Garment } from "@/lib/types";
import GarmentModalClient from "@/components/client/garment-modal-client";
import { neon } from '@neondatabase/serverless';
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

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
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  const params = await paramsPromise;
  const garment = await getGarment(params.id);

  if (!garment) {
    return null; 
  }

  return <GarmentModalClient garment={garment} />;
}
