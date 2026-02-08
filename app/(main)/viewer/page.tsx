import { Suspense } from 'react';
import WardrobeViewerClient from '@/components/wardrobe-viewer-client';
import WardrobeViewerSkeleton from '@/components/wardrobe-viewer-skeleton';
import { auth } from '@/lib/auth';
import { getWardrobeData } from '@/lib/wardrobe';
import type { Garment } from '@/lib/types';
import { redirect } from 'next/navigation';

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

interface Filters {
  brand: string[];
  type: string[];
  color_palette: string[];
  style: string[];
  material: string[];
}

type SearchParamsRecord = Record<string, string | string[] | undefined>;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const dedupe = (values: string[]): string[] => Array.from(new Set(values));

const parseFilterValues = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) {
    return dedupe(value.map((item) => item.trim()).filter(Boolean));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
};

export default async function WardrobeViewerPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsRecord>;
}) {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialSelectedFilters: Filters = {
    brand: parseFilterValues(resolvedSearchParams.brand),
    type: parseFilterValues(resolvedSearchParams.type),
    color_palette: parseFilterValues(resolvedSearchParams.color_palette),
    style: parseFilterValues(resolvedSearchParams.style),
    material: parseFilterValues(resolvedSearchParams.material),
  };
  const favoritesValue = resolvedSearchParams.favorites;
  const initialShowOnlyFavorites = Array.isArray(favoritesValue)
    ? favoritesValue.includes('true')
    : favoritesValue === 'true';

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
    const wardrobeJson = await getWardrobeData();
    const bodyPartOrder = ['Jacket', 'Sweatshirt', 'Shirt', 'Polo Shirt', 'T-shirt', 'Blazer', 'Selvedge Jeans', 'Jeans', 'Pants', 'Shorts', 'Loafers', 'Sneakers'];

    const sortedWardrobe = [...wardrobeJson].sort((a, b) => {
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
    const uniqueBrands = Array.from(new Set(wardrobeJson.map((g) => g.brand).filter(isNonEmptyString)));
    const uniqueTypes = Array.from(new Set(wardrobeJson.map((g) => g.type).filter(isNonEmptyString)));
    const uniqueColors = Array.from(new Set(wardrobeJson.flatMap((g) => g.color_palette).filter(isNonEmptyString)));
    const uniqueStyles = Array.from(new Set(wardrobeJson.map((g) => g.style).filter(isNonEmptyString)));
    const uniqueMaterials = Array.from(
      new Set(
        wardrobeJson
          .flatMap((g) => g.material_composition.map((mc) => mc.material))
          .filter(isNonEmptyString)
      )
    );

    const brandCounts = wardrobeJson.reduce((acc, garment) => {
      if (!isNonEmptyString(garment.brand)) return acc;
      acc[garment.brand] = (acc[garment.brand] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeCounts = wardrobeJson.reduce((acc, garment) => {
      if (!isNonEmptyString(garment.type)) return acc;
      acc[garment.type] = (acc[garment.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const colorCounts = wardrobeJson.reduce((acc, garment) => {
      garment.color_palette.forEach(color => {
        if (!isNonEmptyString(color)) return;
        acc[color] = (acc[color] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    const styleCounts = wardrobeJson.reduce((acc, garment) => {
      if (!isNonEmptyString(garment.style)) return acc;
      acc[garment.style] = (acc[garment.style] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const materialCounts = wardrobeJson.reduce((acc, garment) => {
      garment.material_composition.forEach(mc => {
        if (!isNonEmptyString(mc.material)) return;
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
      
      <Suspense fallback={<WardrobeViewerSkeleton />}>
        <WardrobeViewerClient
          initialWardrobeData={wardrobeData}
          initialAvailableFilters={availableFilters}
          initialSelectedFilters={initialSelectedFilters}
          initialShowOnlyFavorites={initialShowOnlyFavorites}
        />
      </Suspense>
    </div>
  );
}
