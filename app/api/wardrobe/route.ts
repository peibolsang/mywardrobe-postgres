import { NextResponse } from 'next/server';
import { getWardrobeData } from '@/lib/wardrobe';
import { isOwnerSession } from '@/lib/owner';

export async function GET(request: Request) {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const forceFresh = new URL(request.url).searchParams.get('fresh') === '1';
    const garments = await getWardrobeData({ forceFresh });
    return NextResponse.json(garments);
  } catch (error) {
    console.error('Failed to fetch garments:', error);
    return NextResponse.json({ error: 'Failed to load wardrobe data' }, { status: 500 });
  }
}
