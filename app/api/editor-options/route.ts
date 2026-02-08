import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { isOwnerSession } from '@/lib/owner';

export async function GET() {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const [typesResult, materialsResult, colorsResult] = await Promise.all([
      sql`
        SELECT name
        FROM types
        ORDER BY name ASC
      `,
      sql`
        SELECT name
        FROM materials
        ORDER BY name ASC
      `,
      sql`
        SELECT name
        FROM colors
        ORDER BY name ASC
      `,
    ]);

    return NextResponse.json({
      types: typesResult.map((row: any) => row.name),
      materials: materialsResult.map((row: any) => row.name),
      colors: colorsResult.map((row: any) => row.name),
    });
  } catch (error) {
    console.error('Failed to fetch editor options:', error);
    return NextResponse.json({ error: 'Failed to load editor options' }, { status: 500 });
  }
}
