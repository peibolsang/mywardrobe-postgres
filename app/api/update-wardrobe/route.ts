import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const jsonDirectory = path.join(process.cwd(), 'public');
    const filePath = jsonDirectory + '/wardrobe.json';
    const updatedData = await req.json();

    await fs.writeFile(filePath, JSON.stringify(updatedData, null, 2), 'utf8');
    return NextResponse.json({ message: 'Wardrobe data updated successfully' });
  } catch (error) {
    console.error('Failed to write wardrobe.json:', error);
    return NextResponse.json({ error: 'Failed to save wardrobe data' }, { status: 500 });
  }
}
