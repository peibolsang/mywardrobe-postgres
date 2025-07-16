import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const jsonDirectory = path.join(process.cwd(), 'public');
    const fileContents = await fs.readFile(jsonDirectory + '/schema.json', 'utf8');
    return NextResponse.json(JSON.parse(fileContents));
  } catch (error) {
    console.error('Failed to read schema.json:', error);
    return NextResponse.json({ error: 'Failed to load schema data' }, { status: 500 });
  }
}
