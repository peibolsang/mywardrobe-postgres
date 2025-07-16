"use client";

import { Pie, PieChart } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "./ui/chart";

interface StatsChartProps {
  chartConfig: ChartConfig;
  chartData: { name: string; value: number; fill: string }[];
}

export default function StatsChart({ chartConfig, chartData }: StatsChartProps) {
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
