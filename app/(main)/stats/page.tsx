import StatsChart from '@/components/stats-chart';
import { ChartConfig } from '@/components/ui/chart';
import { auth } from '@/lib/auth';
import { getWardrobeData } from '@/lib/wardrobe';
import type { Garment } from '@/lib/types';
import { redirect } from 'next/navigation';

const generateChartConfig = (garmentTypes: string[]): ChartConfig => {
  const config: ChartConfig = {
    garmentType: {
      label: "Garment Type",
    },
  };
  const numTypes = garmentTypes.length;
  garmentTypes.forEach((type, index) => {
    const hue = (360 / numTypes) * index;
    config[type] = {
      label: type,
      color: `hsl(${hue}, 70%, 50%)`,
    };
  });
  return config;
};

export default async function StatsPage() {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  let chartConfig: ChartConfig = {};
  let chartData: { name: string; value: number; fill: string }[] = [];
  let error: string | null = null;

  try {
    const data = await getWardrobeData();

    const garmentTypeCounts: { [key: string]: number } = {};
    data.forEach((item) => {
      garmentTypeCounts[item.type] = (garmentTypeCounts[item.type] || 0) + 1;
    });

    const uniqueGarmentTypes = Object.keys(garmentTypeCounts);
    chartConfig = generateChartConfig(uniqueGarmentTypes);

    chartData = Object.entries(garmentTypeCounts).map(
      ([name, value]) => ({
        name,
        value,
        fill: chartConfig[name]?.color || "hsl(var(--chart-1))", // Fallback color
      })
    );
  } catch (e: any) {
    error = e.message;
    console.error("Error fetching wardrobe data:", e);
  }

  if (error) return <div className="flex justify-center items-center min-h-screen text-red-500">Error: {error}</div>;
  if (chartData.length === 0) return <div className="flex justify-center items-center min-h-screen">No wardrobe data found.</div>;

  return (
    <StatsChart chartConfig={chartConfig} chartData={chartData} />
  );
}
