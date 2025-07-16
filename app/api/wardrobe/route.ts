import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const jsonDirectory = path.join(process.cwd(), 'public');
    const fileContents = await fs.readFile(jsonDirectory + '/wardrobe.json', 'utf8');
    return NextResponse.json(JSON.parse(fileContents));
  } catch (error) {
    console.error('Failed to read wardrobe.json:', error);
    return NextResponse.json({ error: 'Failed to load wardrobe data' }, { status: 500 });
  }
}
