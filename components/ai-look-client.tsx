"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LookGarment {
  id: number;
  model: string;
  brand: string;
  type: string;
  file_name: string;
}

interface AiLookResponse {
  lookName: string;
  lineup: LookGarment[];
  rationale: string;
  confidence: number;
  modelConfidence: number;
  matchScore: number;
  interpretedIntent?: {
    weather: string[];
    occasion: string[];
    place: string[];
    timeOfDay: string[];
    formality: string | null;
    style: string[];
    notes?: string;
  };
  weatherContext?: string | null;
  weatherContextStatus?: "not_requested" | "location_detected" | "fetched" | "failed";
}

interface TravelDayResult {
  date: string;
  lookName: string;
  lineup: LookGarment[];
  rationale: string;
  confidence: number;
  modelConfidence: number;
  matchScore: number;
  weatherContext: string;
  weatherStatus: "forecast" | "seasonal" | "failed";
  reusedGarmentIds: number[];
  interpretedIntent?: {
    weather: string[];
    occasion: string[];
    place: string[];
    timeOfDay: string[];
    formality: string | null;
    style: string[];
    notes?: string;
  };
}

interface TravelSkippedDay {
  date: string;
  reason: string;
  weatherContext: string;
  weatherStatus: "forecast" | "seasonal" | "failed";
}

interface TravelPlanResponse {
  mode: "travel";
  destination: string;
  reason: "Vacation" | "Office" | "Customer visit";
  startDate: string;
  endDate: string;
  days: TravelDayResult[];
  skippedDays: TravelSkippedDay[];
  summary: {
    requestedDays: number;
    generatedLooks: number;
    skippedDays: number;
  };
}

type AiMode = "single" | "travel";

export default function AiLookClient() {
  const [activeMode, setActiveMode] = useState<AiMode>("single");

  const [prompt, setPrompt] = useState("");
  const [singleResult, setSingleResult] = useState<AiLookResponse | null>(null);

  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState<"Vacation" | "Office" | "Customer visit">("Vacation");
  const [travelResult, setTravelResult] = useState<TravelPlanResponse | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<AiMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const travelDateError = useMemo(() => {
    if (!startDate || !endDate) return null;
    if (new Date(`${startDate}T00:00:00.000Z`) > new Date(`${endDate}T00:00:00.000Z`)) {
      return "End date must be on or after start date.";
    }
    return null;
  }, [startDate, endDate]);

  const requestedTravelDays = useMemo(() => {
    if (!startDate || !endDate) return 1;
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 1;
    const DAY_MS = 24 * 60 * 60 * 1000;
    return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  }, [startDate, endDate]);

  const isSingleLoading = isLoading && loadingMode === "single";
  const isTravelLoading = isLoading && loadingMode === "travel";

  const handleGenerateSingle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError("Please describe the look you want.");
      return;
    }

    setIsLoading(true);
    setLoadingMode("single");
    setError(null);
    setSingleResult(null);
    setTravelResult(null);

    try {
      const response = await fetch("/api/ai-look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || "Failed to generate a look.");
        setSingleResult(null);
        return;
      }

      setSingleResult(data as AiLookResponse);
      setTravelResult(null);
    } catch {
      setError("Unexpected network error while generating the look.");
      setSingleResult(null);
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleGenerateTravel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!destination.trim()) {
      setError("Please provide a destination.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Please select a start and end date.");
      return;
    }
    if (travelDateError) {
      setError(travelDateError);
      return;
    }

    setIsLoading(true);
    setLoadingMode("travel");
    setError(null);
    setTravelResult(null);
    setSingleResult(null);

    try {
      const response = await fetch("/api/ai-look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "travel",
          destination: destination.trim(),
          startDate,
          endDate,
          reason,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || "Failed to generate travel packing looks.");
        setTravelResult(null);
        return;
      }

      setTravelResult(data as TravelPlanResponse);
      setSingleResult(null);
    } catch {
      setError("Unexpected network error while generating travel looks.");
      setTravelResult(null);
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleClearSingle = () => {
    setPrompt("");
    setError(null);
    setSingleResult(null);
  };

  const handleClearTravel = () => {
    setDestination("");
    setStartDate("");
    setEndDate("");
    setReason("Vacation");
    setError(null);
    setTravelResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="border-b border-slate-300">
          <div role="tablist" aria-label="AI look modes" className="flex items-end gap-6">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "single"}
              aria-controls="ai-look-main-panel"
              className={cn(
                "-mb-px border-b-2 border-transparent px-1 py-2 text-sm font-medium transition",
                activeMode === "single"
                  ? "border-slate-900 text-slate-900"
                  : "text-slate-600 hover:text-slate-900"
              )}
              onClick={() => {
                setActiveMode("single");
                setError(null);
              }}
            >
              AI Look
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "travel"}
              aria-controls="ai-look-main-panel"
              className={cn(
                "-mb-px border-b-2 border-transparent px-1 py-2 text-sm font-medium transition",
                activeMode === "travel"
                  ? "border-slate-900 text-slate-900"
                  : "text-slate-600 hover:text-slate-900"
              )}
              onClick={() => {
                setActiveMode("travel");
                setError(null);
              }}
            >
              Pack for Travel
            </button>
          </div>
        </div>

        <Card>
          <CardContent id="ai-look-main-panel" role="tabpanel" className="space-y-4">

            {activeMode === "single" ? (
              <form onSubmit={handleGenerateSingle} className="space-y-4">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: I need a smart casual look for a cool evening dinner in the city."
                  className="min-h-28"
                />
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? "Generating..." : "Generate Look"}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleClearSingle} disabled={isLoading}>
                    Clear
                  </Button>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
              </form>
            ) : (
              <form onSubmit={handleGenerateTravel} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Destination</p>
                    <Input
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      placeholder="Example: Tokyo, Japan"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Reason</p>
                    <select
                      value={reason}
                      onChange={(event) => setReason(event.target.value as "Vacation" | "Office" | "Customer visit")}
                      className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:outline-hidden"
                    >
                      <option value="Vacation">Vacation</option>
                      <option value="Office">Office</option>
                      <option value="Customer visit">Customer visit</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Start Date</p>
                    <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">End Date</p>
                    <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? "Building Plan..." : "Generate Travel Plan"}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleClearTravel} disabled={isLoading}>
                    Clear
                  </Button>
                  {(error || travelDateError) && <p className="text-sm text-red-600">{error || travelDateError}</p>}
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {activeMode === "single" && isSingleLoading && (
          <Card>
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-7 w-72" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <Skeleton className="h-5 w-56" />
              </div>

              <div>
                <div className="mb-2">
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={`single-look-skeleton-${index}`} className="rounded-lg border bg-white p-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-20 w-20 rounded-md" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-4 w-1/2" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2">
                  <Skeleton className="h-4 w-20" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-10/12" />
                  <Skeleton className="h-4 w-9/12" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {activeMode === "single" && singleResult && !isSingleLoading && (
          <Card>
            <CardHeader>
              <CardTitle>{singleResult.lookName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Accordion type="single" collapsible className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4">
                <AccordionItem value="details" className="border-none">
                  <AccordionTrigger className="text-sm font-medium">
                    Confidence and Intent Details
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm text-slate-700">
                    <p>
                      Confidence: {singleResult.confidence}% (match: {singleResult.matchScore}%, model: {singleResult.modelConfidence}%)
                    </p>
                    {singleResult.interpretedIntent && (
                      <p>
                        Weather: {singleResult.interpretedIntent.weather.join(", ") || "Any"} | Occasion:{" "}
                        {singleResult.interpretedIntent.occasion.join(", ") || "Any"} | Place:{" "}
                        {singleResult.interpretedIntent.place.join(", ") || "Any"} | Time:{" "}
                        {singleResult.interpretedIntent.timeOfDay.join(", ") || "Any"} | Formality:{" "}
                        {singleResult.interpretedIntent.formality || "Any"} | Style:{" "}
                        {singleResult.interpretedIntent.style.join(", ") || "Any"}
                      </p>
                    )}
                    {singleResult.weatherContext && (
                      <p>
                        <span className="font-medium">Live Weather:</span> {singleResult.weatherContext}
                      </p>
                    )}
                    {singleResult.weatherContextStatus === "failed" && !singleResult.weatherContext && (
                      <p>
                        <span className="font-medium">Live Weather:</span> unavailable (location detected, but weather fetch failed).
                      </p>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">The Lineup</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {singleResult.lineup.map((garment) => (
                    <Link
                      key={garment.id}
                      href={`/garments/${garment.id}`}
                      className="group rounded-lg border bg-white p-3 transition hover:border-slate-400"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative h-20 w-20 overflow-hidden rounded-md bg-slate-100">
                          <Image
                            src={garment.file_name || "/placeholder.png"}
                            alt={`${garment.brand} ${garment.model}`}
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{garment.model}</p>
                          <p className="truncate text-sm text-slate-700">{garment.brand}</p>
                          <p className="truncate text-xs uppercase tracking-wide text-slate-500">{garment.type}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Rationale</h3>
                <p className="text-sm leading-6 text-slate-800">{singleResult.rationale}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {activeMode === "travel" && isTravelLoading && (
          <Card>
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-7 w-64" />
              </CardTitle>
              <CardDescription>
                <Skeleton className="h-4 w-72" />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <Skeleton className="h-5 w-36" />
              </div>

              <div className="space-y-3">
                {Array.from({ length: requestedTravelDays }).map((_, index) => (
                  <div key={`travel-day-skeleton-${index}`} className="rounded-lg border bg-white p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Skeleton className="h-5 w-64" />
                      <Skeleton className="h-4 w-40" />
                    </div>

                    <div className="mb-3 space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-11/12" />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {Array.from({ length: 4 }).map((__, garmentIndex) => (
                        <div key={`travel-day-skeleton-${index}-garment-${garmentIndex}`} className="rounded-lg border bg-white p-3">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-20 w-20 rounded-md" />
                            <div className="min-w-0 flex-1 space-y-2">
                              <Skeleton className="h-4 w-3/4" />
                              <Skeleton className="h-4 w-1/2" />
                              <Skeleton className="h-3 w-1/3" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-11/12" />
                      <Skeleton className="h-4 w-10/12" />
                      <Skeleton className="h-4 w-9/12" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeMode === "travel" && travelResult && !isTravelLoading && (
          <Card>
            <CardHeader>
              <CardTitle>Travel Plan for {travelResult.destination}</CardTitle>
              <CardDescription>
                {travelResult.startDate} to {travelResult.endDate} · {travelResult.reason} · {travelResult.summary.generatedLooks}/
                {travelResult.summary.requestedDays} looks generated
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Accordion type="single" collapsible className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4">
                <AccordionItem value="travel-details" className="border-none">
                  <AccordionTrigger className="text-sm font-medium">Plan Summary</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm text-slate-700">
                    <p>Requested days: {travelResult.summary.requestedDays}</p>
                    <p>Generated looks: {travelResult.summary.generatedLooks}</p>
                    <p>Skipped days: {travelResult.summary.skippedDays}</p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="space-y-3">
                {travelResult.days.map((day) => (
                  <div key={day.date} className="rounded-lg border bg-white p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{day.date} · {day.lookName}</p>
                      <p className="text-xs text-slate-500">
                        Confidence {day.confidence}% ({day.weatherStatus})
                      </p>
                    </div>
                    <p className="mb-3 text-sm text-slate-700">{day.weatherContext}</p>

                    <div className="grid gap-3 md:grid-cols-2">
                      {day.lineup.map((garment) => (
                        <Link
                          key={`${day.date}-${garment.id}`}
                          href={`/garments/${garment.id}`}
                          className={cn(
                            "group rounded-lg border bg-white p-3 transition hover:border-slate-400",
                            day.reusedGarmentIds.includes(garment.id) && "border-slate-400"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="relative h-20 w-20 overflow-hidden rounded-md bg-slate-100">
                              <Image
                                src={garment.file_name || "/placeholder.png"}
                                alt={`${garment.brand} ${garment.model}`}
                                fill
                                sizes="80px"
                                className="object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{garment.model}</p>
                              <p className="truncate text-sm text-slate-700">{garment.brand}</p>
                              <p className="truncate text-xs uppercase tracking-wide text-slate-500">{garment.type}</p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>

                    <p className="mt-3 text-sm text-slate-800">{day.rationale}</p>
                  </div>
                ))}
              </div>

              {travelResult.skippedDays.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-700">Skipped Days</h3>
                  <div className="space-y-2">
                    {travelResult.skippedDays.map((day) => (
                      <div key={`skipped-${day.date}`} className="text-sm text-red-800">
                        <p className="font-medium">{day.date}: {day.reason}</p>
                        <p className="text-red-700">{day.weatherContext}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
