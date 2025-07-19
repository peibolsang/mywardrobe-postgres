import { sql } from "@/lib/db";
import { Garment } from "@/lib/types";
import GarmentDetailsClient from "./garment-details-client";
import { promises as fs } from 'fs';
import path from 'path';

async function getGarment(id: string): Promise<Garment | null> {
  const garments = await sql`SELECT * FROM garments WHERE id = ${id}`;
  return (garments[0] as Garment) || null;
}

async function getSchema() {
  const schemaPath = path.join(process.cwd(), 'public', 'schema.json');
  const schemaFile = await fs.readFile(schemaPath, 'utf-8');
  return JSON.parse(schemaFile);
}

export default async function GarmentPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const garment = await getGarment(params.id);
  const schema = await getSchema();

  if (!garment) {
    return <div className="flex justify-center items-center min-h-screen">Garment not found.</div>;
  }

  return <GarmentDetailsClient garment={garment} schema={schema} />;
}
