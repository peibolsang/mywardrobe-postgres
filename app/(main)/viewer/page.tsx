import { Suspense } from 'react';
import WardrobeViewerClient from '@/components/wardrobe-viewer-client';
import WardrobeViewerSkeleton from '@/components/wardrobe-viewer-skeleton';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

interface Garment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: any[]; // Simplified for viewer
  color_palette: string[];
  warmth_level: string;
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
  favorite?: boolean;
}

interface AvailableFilterOption {
  value: string;
  count: number;
}

interface AvailableFilters {
  brand: AvailableFilterOption[];
  type: AvailableFilterOption[];
  color_palette: AvailableFilterOption[];
  style: AvailableFilterOption[];
  material: AvailableFilterOption[];
}

export default async function WardrobeViewerPage() {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  let wardrobeData: Garment[] = [];
  let availableFilters: AvailableFilters = {
    brand: [],
    type: [],
    color_palette: [],
    style: [],
    material: [],
  };
  let error: string | null = null;

  try {
    const wardrobeRes = await (await import('@/app/api/wardrobe/route')).GET();

    const wardrobeJson: Garment[] = await wardrobeRes.json();
    const bodyPartOrder = ['Jacket', 'Sweatshirt', 'Shirt', 'Polo Shirt', 'T-shirt', 'Blazer', 'Selvedge Jeans', 'Jeans', 'Pants', 'Shorts', 'Loafers', 'Sneakers'];

    const sortedWardrobe = wardrobeJson.sort((a, b) => {
      const indexA = bodyPartOrder.indexOf(a.type);
      const indexB = bodyPartOrder.indexOf(b.type);

      // Handle types not in the defined order (place them at the end)
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;

      return indexA - indexB;
    });
    wardrobeData = sortedWardrobe;

    // Extract unique filter values
    const uniqueBrands = Array.from(new Set(wardrobeJson.map(g => g.brand)));
    const uniqueTypes = Array.from(new Set(wardrobeJson.map(g => g.type)));
    const uniqueColors = Array.from(new Set(wardrobeJson.flatMap(g => g.color_palette)));
    const uniqueStyles = Array.from(new Set(wardrobeJson.map(g => g.style)));
    const uniqueMaterials = Array.from(new Set(wardrobeJson.flatMap(g => g.material_composition.map(mc => mc.material))));

    const brandCounts = wardrobeJson.reduce((acc, garment) => {
      acc[garment.brand] = (acc[garment.brand] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeCounts = wardrobeJson.reduce((acc, garment) => {
      acc[garment.type] = (acc[garment.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const colorCounts = wardrobeJson.reduce((acc, garment) => {
      garment.color_palette.forEach(color => {
        acc[color] = (acc[color] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    const styleCounts = wardrobeJson.reduce((acc, garment) => {
      acc[garment.style] = (acc[garment.style] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const materialCounts = wardrobeJson.reduce((acc, garment) => {
      garment.material_composition.forEach(mc => {
        acc[mc.material] = (acc[mc.material] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    availableFilters = {
      brand: uniqueBrands.sort().map(b => ({ value: b, count: brandCounts[b] })),
      type: uniqueTypes.sort().map(t => ({ value: t, count: typeCounts[t] })),
      color_palette: uniqueColors.sort().map(c => ({ value: c, count: colorCounts[c] })),
      style: uniqueStyles.sort().map(s => ({ value: s, count: styleCounts[s] })),
      material: uniqueMaterials.sort().map(m => ({ value: m, count: materialCounts[m] })),
    };

  } catch (e: any) {
    error = e.message;
    console.error('Error fetching data in WardrobeViewerPage:', e);
  }

  if (error) return <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 relative text-red-500">Error: {error}</div>;
  if (wardrobeData.length === 0) return <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 relative">No wardrobe items found.</div>;

  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-10">
        <a href="/add-garment">
          <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 cursor-pointer">
            Add New Garment
          </button>
        </a>
      </div>
      <Suspense fallback={<WardrobeViewerSkeleton />}>
        <WardrobeViewerClient initialWardrobeData={wardrobeData} initialAvailableFilters={availableFilters} />
      </Suspense>
    </div>
  );
}