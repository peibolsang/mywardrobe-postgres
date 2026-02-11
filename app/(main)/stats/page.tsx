import WardrobeStatsV1 from "@/components/wardrobe-stats-v1";
import { auth } from "@/lib/auth";
import type { Garment } from "@/lib/types";
import { getWardrobeData } from "@/lib/wardrobe";
import schema from "@/public/schema.json";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SchemaItems = {
  properties?: {
    suitable_weather?: { items?: { enum?: string[] } };
    suitable_occasions?: { items?: { enum?: string[] } };
    suitable_places?: { items?: { enum?: string[] } };
    suitable_time_of_day?: { items?: { enum?: string[] } };
  };
};

const SCHEMA_ITEMS = (schema?.items ?? {}) as SchemaItems;

const normalize = (value: unknown): string => String(value ?? "").trim();

const extractOptions = (values: string[]): string[] =>
  Array.from(new Set(values.map(normalize).filter(Boolean)));

const toPercent = (part: number, whole: number): number =>
  whole > 0 ? (part / whole) * 100 : 0;

const countBy = (items: Garment[], pick: (item: Garment) => string): Record<string, number> =>
  items.reduce<Record<string, number>>((acc, item) => {
    const key = normalize(pick(item));
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

export default async function StatsPage() {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }

  let wardrobeData: Garment[] = [];
  let error: string | null = null;

  try {
    wardrobeData = await getWardrobeData({ forceFresh: true });
  } catch (e: any) {
    error = e.message;
    console.error("Error fetching wardrobe data:", e);
  }

  if (error) {
    return <div className="flex justify-center items-center min-h-screen text-red-500">Error: {error}</div>;
  }

  if (wardrobeData.length === 0) {
    return <div className="flex justify-center items-center min-h-screen">No wardrobe data found.</div>;
  }

  const totalGarments = wardrobeData.length;
  const favoriteGarments = wardrobeData.filter((garment) => Boolean(garment.favorite)).length;
  const garmentTypeCounts = countBy(wardrobeData, (garment) => garment.type);
  const garmentTypeBreakdown = Object.entries(garmentTypeCounts)
    .map(([name, count]) => ({
      name,
      count,
      percentage: toPercent(count, totalGarments),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const weatherOptions = extractOptions(
    SCHEMA_ITEMS.properties?.suitable_weather?.items?.enum ??
      wardrobeData.flatMap((garment) => garment.suitable_weather ?? [])
  );
  const occasionOptions = extractOptions(
    SCHEMA_ITEMS.properties?.suitable_occasions?.items?.enum ??
      wardrobeData.flatMap((garment) => garment.suitable_occasions ?? [])
  );
  const placeOptions = extractOptions(
    SCHEMA_ITEMS.properties?.suitable_places?.items?.enum ??
      wardrobeData.flatMap((garment) => garment.suitable_places ?? [])
  );
  const timeOptions = extractOptions(
    SCHEMA_ITEMS.properties?.suitable_time_of_day?.items?.enum ??
      wardrobeData.flatMap((garment) => garment.suitable_time_of_day ?? [])
  );

  const buildCoverage = (label: string, options: string[], pick: (garment: Garment) => string[]) => {
    const counts = options.reduce<Record<string, number>>((acc, option) => {
      acc[option] = 0;
      return acc;
    }, {});

    wardrobeData.forEach((garment) => {
      const values = new Set(pick(garment).map(normalize).filter(Boolean));
      values.forEach((value) => {
        if (counts[value] !== undefined) {
          counts[value] += 1;
        }
      });
    });

    const rows = Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
        percentage: toPercent(count, totalGarments),
      }))
      .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));

    return {
      label,
      coveredCount: rows.filter((row) => row.count > 0).length,
      totalOptions: options.length,
      options: rows,
    };
  };

  const coverage = [
    buildCoverage("Weather", weatherOptions, (garment) => garment.suitable_weather ?? []),
    buildCoverage("Occasion", occasionOptions, (garment) => garment.suitable_occasions ?? []),
    buildCoverage("Place", placeOptions, (garment) => garment.suitable_places ?? []),
    buildCoverage("Time of Day", timeOptions, (garment) => garment.suitable_time_of_day ?? []),
  ];

  const gapAlerts = coverage
    .flatMap((section) =>
      section.options.map((option) => ({
        area: section.label,
        option: option.name,
        count: option.count,
        percentage: option.percentage,
        severity:
          option.count === 0
            ? ("missing" as const)
            : option.count === 1
              ? ("critical-low" as const)
              : ("low" as const),
      }))
    )
    .filter((row) => row.count <= 1 || row.percentage < 15)
    .sort((a, b) => a.count - b.count || a.percentage - b.percentage || a.option.localeCompare(b.option))
    .slice(0, 8);

  const heatmapCounts = occasionOptions.reduce<Record<string, Record<string, number>>>((acc, occasion) => {
    acc[occasion] = weatherOptions.reduce<Record<string, number>>((weatherAcc, weather) => {
      weatherAcc[weather] = 0;
      return weatherAcc;
    }, {});
    return acc;
  }, {});

  wardrobeData.forEach((garment) => {
    const garmentOccasions = new Set((garment.suitable_occasions ?? []).map(normalize).filter(Boolean));
    const garmentWeathers = new Set((garment.suitable_weather ?? []).map(normalize).filter(Boolean));

    garmentOccasions.forEach((occasion) => {
      if (!heatmapCounts[occasion]) return;
      garmentWeathers.forEach((weather) => {
        if (heatmapCounts[occasion][weather] !== undefined) {
          heatmapCounts[occasion][weather] += 1;
        }
      });
    });
  });

  const sparseCombos = occasionOptions
    .flatMap((occasion) =>
      weatherOptions.map((weather) => ({
        occasion,
        weather,
        count: heatmapCounts[occasion]?.[weather] ?? 0,
      }))
    )
    .filter((row) => row.count <= 1)
    .sort((a, b) => a.count - b.count || a.occasion.localeCompare(b.occasion))
    .slice(0, 10);

  const materialTotals = wardrobeData.reduce<Record<string, number>>((acc, garment) => {
    garment.material_composition.forEach((entry) => {
      const material = normalize(entry.material);
      const percentage = Number(entry.percentage || 0);
      if (!material || percentage <= 0) return;
      acc[material] = (acc[material] || 0) + percentage;
    });
    return acc;
  }, {});

  const materialGarmentCounts = wardrobeData.reduce<Record<string, number>>((acc, garment) => {
    const uniqueMaterials = new Set(
      garment.material_composition.map((entry) => normalize(entry.material)).filter(Boolean)
    );
    uniqueMaterials.forEach((material) => {
      acc[material] = (acc[material] || 0) + 1;
    });
    return acc;
  }, {});

  const totalMaterialPoints = Object.values(materialTotals).reduce((sum, value) => sum + value, 0);
  const materialExposure = Object.entries(materialTotals)
    .map(([name, totalPoints]) => ({
      name,
      weightedShare: toPercent(totalPoints, totalMaterialPoints),
      garmentCount: materialGarmentCounts[name] || 0,
    }))
    .sort((a, b) => b.weightedShare - a.weightedShare || a.name.localeCompare(b.name))
    .slice(0, 12);

  return (
    <WardrobeStatsV1
      totalGarments={totalGarments}
      favoriteGarments={favoriteGarments}
      garmentTypeBreakdown={garmentTypeBreakdown}
      coverage={coverage}
      gapAlerts={gapAlerts}
      heatmap={{
        weathers: weatherOptions,
        occasions: occasionOptions,
        counts: heatmapCounts,
      }}
      sparseCombos={sparseCombos}
      materialExposure={materialExposure}
    />
  );
}
