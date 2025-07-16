"use client";

import { useEffect, useState } from "react";
import { Pie, PieChart } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface Garment {
  type: string;
  // ... other properties
}

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

export default function StatsPage() {
  const [chartConfig, setChartConfig] = useState<ChartConfig>({});
  const [chartData, setChartData] = useState<
    { name: string; value: number; fill: string }[]
  >([]);

  useEffect(() => {
    const fetchWardrobeData = async () => {
      try {
        const response = await fetch("/wardrobe.json");
        const data: Garment[] = await response.json();

        const garmentTypeCounts: { [key: string]: number } = {};
        data.forEach((item) => {
          garmentTypeCounts[item.type] = (garmentTypeCounts[item.type] || 0) + 1;
        });

        const uniqueGarmentTypes = Object.keys(garmentTypeCounts);
        const newChartConfig = generateChartConfig(uniqueGarmentTypes);
        setChartConfig(newChartConfig);

        const processedChartData = Object.entries(garmentTypeCounts).map(
          ([name, value]) => ({
            name,
            value,
            fill: newChartConfig[name]?.color || "hsl(var(--chart-1))", // Fallback color
          })
        );
        setChartData(processedChartData);
      } catch (error) {
        console.error("Error fetching wardrobe data:", error);
      }
    };

    fetchWardrobeData();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      {chartData.length > 0 ? (
        <ChartContainer config={chartConfig} className="min-h-[900px] min-w-[900px] mt-[-80px]">
          <PieChart>
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={50}
              outerRadius={300}
              strokeWidth={5}
              label={({ name, value, percent, cx, cy, midAngle, outerRadius }) => {
                const RADIAN = Math.PI / 180;
                const radius = outerRadius * 1.2;
                const x = cx + radius * Math.cos(-midAngle * RADIAN);
                const y = cy + radius * Math.sin(-midAngle * RADIAN);
                return (
                  <text
                    x={x}
                    y={y}
                    fill="black"
                    textAnchor={x > cx ? 'start' : 'end'}
                    dominantBaseline="central"
                    style={{ fontSize: '16px' }}
                  >
                    {`${name} (${(percent * 100).toFixed(0)}%)`}
                  </text>
                );
              }}
            />
          </PieChart>
        </ChartContainer>
      ) : (
        <p>Loading wardrobe data...</p>
      )}
    </div>
  );
}
