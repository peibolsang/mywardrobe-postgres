import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CircleHelp } from "lucide-react";

interface CoverageOption {
  name: string;
  count: number;
  percentage: number;
}

interface CoverageSection {
  label: string;
  coveredCount: number;
  totalOptions: number;
  options: CoverageOption[];
}

interface GapAlert {
  area: string;
  option: string;
  count: number;
  percentage: number;
  severity: "missing" | "critical-low" | "low";
}

interface HeatmapData {
  weathers: string[];
  occasions: string[];
  counts: Record<string, Record<string, number>>;
}

interface MaterialExposureRow {
  name: string;
  weightedShare: number;
  garmentCount: number;
}

interface WardrobeStatsV1Props {
  totalGarments: number;
  favoriteGarments: number;
  garmentTypeBreakdown: { name: string; count: number; percentage: number }[];
  coverage: CoverageSection[];
  gapAlerts: GapAlert[];
  heatmap: HeatmapData;
  sparseCombos: { occasion: string; weather: string; count: number }[];
  materialExposure: MaterialExposureRow[];
}

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const severityStyles: Record<GapAlert["severity"], string> = {
  missing: "bg-red-50 text-red-700 border-red-200",
  "critical-low": "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

const coverageBarClass = (percentage: number): string => {
  if (percentage === 0) return "bg-red-400";
  if (percentage < 15) return "bg-amber-400";
  if (percentage < 30) return "bg-yellow-400";
  return "bg-emerald-500";
};

const heatCellClass = (count: number): string => {
  if (count === 0) return "bg-red-50 text-red-700";
  if (count === 1) return "bg-amber-50 text-amber-700";
  if (count <= 3) return "bg-yellow-50 text-yellow-700";
  return "bg-emerald-50 text-emerald-700";
};

export default function WardrobeStatsV1({
  totalGarments,
  favoriteGarments,
  garmentTypeBreakdown,
  coverage,
  gapAlerts,
  heatmap,
  sparseCombos,
  materialExposure,
}: WardrobeStatsV1Props) {
  const HeaderWithTooltip = ({ title, help }: { title: string; help: string }) => (
    <span className="inline-flex items-center gap-2">
      <span>{title}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded-full"
            aria-label={`${title} explanation`}
          >
            <CircleHelp className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{help}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  );

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <HeaderWithTooltip
                title="Wardrobe Stats v1"
                help="Actionable wardrobe analytics for balance, context coverage, and favorite-item behavior."
              />
            </CardTitle>
            <CardDescription>
              Decision-focused analytics for coverage, context readiness, and favorite-item bias.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Total Garments</p>
              <p className="mt-1 text-2xl font-semibold">{totalGarments}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Favorites</p>
              <p className="mt-1 text-2xl font-semibold">{favoriteGarments}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Favorite Ratio</p>
              <p className="mt-1 text-2xl font-semibold">
                {totalGarments > 0 ? formatPercent((favoriteGarments / totalGarments) * 100) : "0.0%"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <HeaderWithTooltip
                title="Garment Type Share"
                help="Percentage distribution of garments by type. Higher percentages indicate your closet is concentrated in that type."
              />
            </CardTitle>
            <CardDescription>
              At-a-glance composition of what garment types you own.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {garmentTypeBreakdown.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground">
                    {item.count} ({formatPercent(item.percentage)})
                  </span>
                </div>
                <div className="h-2 rounded bg-muted">
                  <div
                    className="h-2 rounded bg-sky-500"
                    style={{ width: `${Math.min(item.percentage, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <HeaderWithTooltip
                title="Coverage and Gaps"
                help="Shows whether each weather, occasion, place, and time bucket is represented by at least one garment, and flags sparse areas."
              />
            </CardTitle>
            <CardDescription>
              How well your wardrobe covers weather, occasion, place, and time-of-day contexts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {coverage.map((section) => (
                <div key={section.label} className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-medium">{section.label}</p>
                    <p className="text-muted-foreground text-sm">
                      {section.coveredCount}/{section.totalOptions} covered
                    </p>
                  </div>
                  <div className="space-y-2">
                    {section.options.slice(0, 6).map((option) => (
                      <div key={`${section.label}-${option.name}`} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="truncate pr-2">{option.name}</span>
                          <span className="text-muted-foreground">
                            {option.count} ({formatPercent(option.percentage)})
                          </span>
                        </div>
                        <div className="h-2 rounded bg-muted">
                          <div
                            className={`h-2 rounded ${coverageBarClass(option.percentage)}`}
                            style={{ width: `${Math.min(option.percentage, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-2 font-medium">
                <HeaderWithTooltip
                  title="Gap Alerts"
                  help="Prioritized low-coverage categories. Missing means no garments, critical-low means one garment, low means weak percentage coverage."
                />
              </div>
              {gapAlerts.length === 0 ? (
                <p className="text-muted-foreground text-sm">No low-coverage gaps detected.</p>
              ) : (
                <div className="space-y-2">
                  {gapAlerts.map((gap) => (
                    <div
                      key={`${gap.area}-${gap.option}`}
                      className={`rounded-md border px-3 py-2 text-sm ${severityStyles[gap.severity]}`}
                    >
                      <span className="font-medium">{gap.area}:</span> {gap.option} - {gap.count} item(s),{" "}
                      {formatPercent(gap.percentage)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <HeaderWithTooltip
                title="Occasion x Weather Readiness"
                help="Heatmap count of garments suitable for each occasion-weather combination to reveal contextual readiness."
              />
            </CardTitle>
            <CardDescription>
              Number of garments available for each context combination.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="bg-muted/60 sticky left-0 border p-2 text-left font-semibold">Occasion</th>
                    {heatmap.weathers.map((weather) => (
                      <th key={weather} className="border bg-muted/40 p-2 text-center font-medium">
                        {weather}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.occasions.map((occasion) => (
                    <tr key={occasion}>
                      <td className="bg-background sticky left-0 border p-2 font-medium">{occasion}</td>
                      {heatmap.weathers.map((weather) => {
                        const count = heatmap.counts[occasion]?.[weather] ?? 0;
                        return (
                          <td key={`${occasion}-${weather}`} className={`border p-2 text-center ${heatCellClass(count)}`}>
                            {count}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="mb-2 font-medium">
                <HeaderWithTooltip
                  title="Sparsest Combinations"
                  help="Lowest-count occasion-weather pairs, useful for identifying where one purchase could improve coverage most."
                />
              </div>
              {sparseCombos.length === 0 ? (
                <p className="text-muted-foreground text-sm">No sparse combinations found.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {sparseCombos.map((combo) => (
                    <div
                      key={`${combo.occasion}-${combo.weather}`}
                      className="rounded-md border bg-amber-50 px-3 py-2 text-sm text-amber-800"
                    >
                      {combo.occasion} x {combo.weather}: {combo.count} item(s)
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <HeaderWithTooltip
                title="Material-Weighted Composition"
                help="Uses material percentages from each garment composition, then normalizes across the full wardrobe to show true fabric exposure."
              />
            </CardTitle>
            <CardDescription>
              Weighted share of materials across your closet, not just presence/absence counts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {materialExposure.length === 0 ? (
              <p className="text-muted-foreground text-sm">No material composition data available.</p>
            ) : (
              materialExposure.map((row) => (
                <div key={row.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground">
                      {formatPercent(row.weightedShare)} ({row.garmentCount} garments)
                    </span>
                  </div>
                  <div className="h-2 rounded bg-muted">
                    <div
                      className="h-2 rounded bg-indigo-500"
                      style={{ width: `${Math.min(row.weightedShare, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
