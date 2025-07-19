import { sql } from "@/lib/db";
import { Garment } from "@/lib/types";
import GarmentModalClient from "./garment-modal-client";

async function getGarment(id: string): Promise<Garment | null> {
  const garments = await sql<Garment[]>`SELECT * FROM garments WHERE id = ${id}`;
  return garments[0] || null;
}

export default async function GarmentModal({ params }: { params: { id: string } }) {
  const garment = await getGarment(params.id);

  if (!garment) {
    return null; 
  }

  return <GarmentModalClient garment={garment} />;
}
