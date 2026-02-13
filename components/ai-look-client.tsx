"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface LookGarment {
  id: number;
  model: string;
  brand: string;
  type: string;
  file_name: string;
}

interface WeatherProfile {
  tempBand: "cold" | "cool" | "mild" | "warm" | "hot";
  precipitationLevel: "none" | "light" | "moderate" | "heavy";
  precipitationType: "none" | "rain" | "snow" | "mixed";
  windBand: "calm" | "breezy" | "windy";
  humidityBand: "dry" | "normal" | "humid";
  wetSurfaceRisk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
}

interface DerivedProfile {
  formality: string | null;
  style: string[];
  materialTargets: {
    prefer: string[];
    avoid: string[];
  };
}

interface SingleLookResult {
  lookName: string;
  lineupSignature: string;
  lineup: LookGarment[];
  rationale: string;
  confidence: number;
  modelConfidence: number;
  matchScore: number;
}

interface SingleLookResponse {
  mode: "single";
  requestFingerprint: string;
  primaryLook: SingleLookResult;
  weatherProfile?: WeatherProfile;
  derivedProfile?: DerivedProfile;
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
  lineupSignature: string;
  lineup: LookGarment[];
  rationale: string;
  confidence: number;
  modelConfidence: number;
  matchScore: number;
  weatherContext: string;
  weatherStatus: "forecast" | "seasonal" | "failed";
  weatherProfile?: WeatherProfile;
  derivedProfile?: DerivedProfile;
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
  requestFingerprint: string;
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
type AnchorMode = "strict" | "soft";
type FeedbackVote = "up" | "down";
type FeedbackStatus = "idle" | "submitting" | "submitted" | "error";

const isValidSingleLookResult = (value: unknown): value is SingleLookResult => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.lookName === "string" &&
    typeof record.lineupSignature === "string" &&
    Array.isArray(record.lineup) &&
    typeof record.rationale === "string" &&
    typeof record.confidence === "number" &&
    typeof record.modelConfidence === "number" &&
    typeof record.matchScore === "number"
  );
};

const parseSingleLookResponse = (value: unknown): SingleLookResponse | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.mode !== "single" || !isValidSingleLookResult(record.primaryLook)) return null;

  return {
    mode: "single",
    requestFingerprint: typeof record.requestFingerprint === "string" ? record.requestFingerprint : "",
    primaryLook: record.primaryLook,
    weatherProfile:
      record.weatherProfile && typeof record.weatherProfile === "object"
        ? (record.weatherProfile as WeatherProfile)
        : undefined,
    derivedProfile:
      record.derivedProfile && typeof record.derivedProfile === "object"
        ? (record.derivedProfile as DerivedProfile)
        : undefined,
    interpretedIntent:
      record.interpretedIntent && typeof record.interpretedIntent === "object"
        ? (record.interpretedIntent as SingleLookResponse["interpretedIntent"])
        : undefined,
    weatherContext: typeof record.weatherContext === "string" ? record.weatherContext : null,
    weatherContextStatus:
      record.weatherContextStatus === "not_requested" ||
      record.weatherContextStatus === "location_detected" ||
      record.weatherContextStatus === "fetched" ||
      record.weatherContextStatus === "failed"
        ? record.weatherContextStatus
        : undefined,
  };
};

export default function AiLookClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeMode, setActiveMode] = useState<AiMode>("single");

  const [prompt, setPrompt] = useState("");
  const [singleResult, setSingleResult] = useState<SingleLookResponse | null>(null);
  const [anchorGarmentId, setAnchorGarmentId] = useState<number | null>(null);
  const [anchorMode, setAnchorMode] = useState<AnchorMode>("strict");
  const [anchorLabel, setAnchorLabel] = useState<string | null>(null);

  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState<"Vacation" | "Office" | "Customer visit">("Vacation");
  const [travelResult, setTravelResult] = useState<TravelPlanResponse | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<AiMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [singleFeedbackVote, setSingleFeedbackVote] = useState<FeedbackVote | null>(null);
  const [singleFeedbackReason, setSingleFeedbackReason] = useState("");
  const [singleFeedbackStatus, setSingleFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [travelFeedbackVotes, setTravelFeedbackVotes] = useState<Record<string, FeedbackVote | null>>({});
  const [travelFeedbackReasons, setTravelFeedbackReasons] = useState<Record<string, string>>({});
  const [travelFeedbackStatuses, setTravelFeedbackStatuses] = useState<Record<string, FeedbackStatus>>({});

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
  const primaryLook = singleResult?.primaryLook ?? null;

  useEffect(() => {
    const rawAnchorId = searchParams.get("anchorGarmentId");
    const parsedAnchorId = rawAnchorId ? Number(rawAnchorId) : null;
    const nextAnchorId =
      parsedAnchorId != null && Number.isInteger(parsedAnchorId) && parsedAnchorId > 0
        ? parsedAnchorId
        : null;
    const rawAnchorMode = searchParams.get("anchorMode");
    const nextAnchorMode: AnchorMode = rawAnchorMode === "soft" ? "soft" : "strict";
    setAnchorGarmentId(nextAnchorId);
    setAnchorMode(nextAnchorMode);
  }, [searchParams]);

  useEffect(() => {
    let isActive = true;
    if (anchorGarmentId == null) {
      setAnchorLabel(null);
      return () => {
        isActive = false;
      };
    }

    setAnchorLabel(`Garment #${anchorGarmentId}`);
    const fetchAnchorLabel = async () => {
      try {
        const response = await fetch("/api/wardrobe?fresh=1", { cache: "no-store" });
        if (!response.ok) return;
        const wardrobe = await response.json() as Array<{ id: number; model: string; brand: string; type: string }>;
        if (!isActive) return;
        const anchorGarment = wardrobe.find((garment) => garment.id === anchorGarmentId);
        if (anchorGarment) {
          setAnchorLabel(`${anchorGarment.model} — ${anchorGarment.brand} (${anchorGarment.type})`);
        }
      } catch {
        // Leave fallback label.
      }
    };

    void fetchAnchorLabel();
    return () => {
      isActive = false;
    };
  }, [anchorGarmentId]);

  const handleClearAnchor = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("anchorGarmentId");
    nextParams.delete("anchorMode");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  };

  const submitFeedback = async ({
    mode,
    requestFingerprint,
    lineupSignature,
    garmentIds,
    vote,
    reasonText,
    weatherProfile,
    derivedProfile,
  }: {
    mode: "single" | "travel";
    requestFingerprint: string;
    lineupSignature: string;
    garmentIds: number[];
    vote: FeedbackVote;
    reasonText?: string;
    weatherProfile?: WeatherProfile;
    derivedProfile?: DerivedProfile;
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/ai-look/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          requestFingerprint,
          lineupSignature,
          garmentIds,
          vote,
          reasonText: reasonText?.trim() || undefined,
          weatherProfile,
          derivedProfile,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { ok: false, error: data?.error || "Failed to save feedback." };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error while submitting feedback." };
    }
  };

  const handleSingleFeedbackVote = async (vote: FeedbackVote) => {
    if (!singleResult?.primaryLook) return;
    if (singleFeedbackStatus === "submitted") return;
    setSingleFeedbackVote(vote);

    if (vote === "down") {
      setSingleFeedbackStatus("idle");
      return;
    }

    setSingleFeedbackStatus("submitting");
    const feedback = await submitFeedback({
      mode: "single",
      requestFingerprint: singleResult.requestFingerprint,
      lineupSignature: singleResult.primaryLook.lineupSignature,
      garmentIds: singleResult.primaryLook.lineup.map((garment) => garment.id),
      vote,
      weatherProfile: singleResult.weatherProfile,
      derivedProfile: singleResult.derivedProfile,
    });
    if (feedback.ok) {
      setSingleFeedbackStatus("submitted");
      toast.success("Thanks — feedback saved.");
      return;
    }
    setSingleFeedbackStatus("error");
    toast.error(feedback.error || "Failed to save feedback.");
  };

  const handleSubmitSingleDownvote = async () => {
    if (!singleResult?.primaryLook) return;
    if (singleFeedbackStatus === "submitted") return;
    const reasonText = singleFeedbackReason.trim();
    if (!reasonText) {
      setSingleFeedbackStatus("error");
      toast.error("Please add what went wrong.");
      return;
    }

    setSingleFeedbackStatus("submitting");
    const feedback = await submitFeedback({
      mode: "single",
      requestFingerprint: singleResult.requestFingerprint,
      lineupSignature: singleResult.primaryLook.lineupSignature,
      garmentIds: singleResult.primaryLook.lineup.map((garment) => garment.id),
      vote: "down",
      reasonText,
      weatherProfile: singleResult.weatherProfile,
      derivedProfile: singleResult.derivedProfile,
    });
    if (feedback.ok) {
      setSingleFeedbackStatus("submitted");
      toast.success("Thanks — feedback saved.");
      return;
    }
    setSingleFeedbackStatus("error");
    toast.error(feedback.error || "Failed to save feedback.");
  };

  const handleTravelFeedbackVote = async (day: TravelDayResult, vote: FeedbackVote) => {
    if (!travelResult) return;
    const key = `${day.date}:${day.lineupSignature}`;
    if (travelFeedbackStatuses[key] === "submitted") return;
    setTravelFeedbackVotes((current) => ({ ...current, [key]: vote }));

    if (vote === "down") {
      setTravelFeedbackStatuses((current) => ({ ...current, [key]: "idle" }));
      return;
    }

    setTravelFeedbackStatuses((current) => ({ ...current, [key]: "submitting" }));
    const feedback = await submitFeedback({
      mode: "travel",
      requestFingerprint: travelResult.requestFingerprint,
      lineupSignature: day.lineupSignature,
      garmentIds: day.lineup.map((garment) => garment.id),
      vote,
      weatherProfile: day.weatherProfile,
      derivedProfile: day.derivedProfile,
    });
    if (feedback.ok) {
      setTravelFeedbackStatuses((current) => ({ ...current, [key]: "submitted" }));
      toast.success("Thanks — feedback saved.");
      return;
    }
    setTravelFeedbackStatuses((current) => ({ ...current, [key]: "error" }));
    toast.error(feedback.error || "Failed to save feedback.");
  };

  const handleSubmitTravelDownvote = async (day: TravelDayResult) => {
    if (!travelResult) return;
    const key = `${day.date}:${day.lineupSignature}`;
    if (travelFeedbackStatuses[key] === "submitted") return;
    const reasonText = (travelFeedbackReasons[key] || "").trim();
    if (!reasonText) {
      setTravelFeedbackStatuses((current) => ({ ...current, [key]: "error" }));
      toast.error("Please add what went wrong.");
      return;
    }

    setTravelFeedbackStatuses((current) => ({ ...current, [key]: "submitting" }));
    const feedback = await submitFeedback({
      mode: "travel",
      requestFingerprint: travelResult.requestFingerprint,
      lineupSignature: day.lineupSignature,
      garmentIds: day.lineup.map((garment) => garment.id),
      vote: "down",
      reasonText,
      weatherProfile: day.weatherProfile,
      derivedProfile: day.derivedProfile,
    });
    if (feedback.ok) {
      setTravelFeedbackStatuses((current) => ({ ...current, [key]: "submitted" }));
      toast.success("Thanks — feedback saved.");
      return;
    }
    setTravelFeedbackStatuses((current) => ({ ...current, [key]: "error" }));
    toast.error(feedback.error || "Failed to save feedback.");
  };

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
    setSingleFeedbackVote(null);
    setSingleFeedbackReason("");
    setSingleFeedbackStatus("idle");

    try {
      const payload: {
        prompt: string;
        anchorGarmentId?: number;
        anchorMode?: AnchorMode;
      } = { prompt: trimmedPrompt };
      if (anchorGarmentId != null) {
        payload.anchorGarmentId = anchorGarmentId;
        payload.anchorMode = anchorMode;
      }
      const response = await fetch("/api/ai-look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || "Failed to generate a look.");
        setSingleResult(null);
        return;
      }

      const parsed = parseSingleLookResponse(data);
      if (!parsed) {
        setError("No look was generated. Please refine your prompt.");
        setSingleResult(null);
        return;
      }

      setSingleResult(parsed);
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
    setTravelFeedbackVotes({});
    setTravelFeedbackReasons({});
    setTravelFeedbackStatuses({});

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
    setSingleFeedbackVote(null);
    setSingleFeedbackReason("");
    setSingleFeedbackStatus("idle");
  };

  const handleClearTravel = () => {
    setDestination("");
    setStartDate("");
    setEndDate("");
    setReason("Vacation");
    setError(null);
    setTravelResult(null);
    setTravelFeedbackVotes({});
    setTravelFeedbackReasons({});
    setTravelFeedbackStatuses({});
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] min-h-[calc(100dvh-4rem)] bg-slate-100 p-4 md:p-6">
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
                {anchorGarmentId != null && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-sm text-slate-800">
                      <span className="font-medium">Anchored on:</span>{" "}
                      {anchorLabel ?? `Garment #${anchorGarmentId}`} ({anchorMode})
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={handleClearAnchor} disabled={isLoading}>
                      Clear anchor
                    </Button>
                  </div>
                )}
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
              <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
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

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3">
                  <Skeleton className="h-4 w-52" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-9 w-28" />
                  <Skeleton className="h-9 w-28" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {activeMode === "single" && singleResult && primaryLook && !isSingleLoading && (
          <Card>
            <CardHeader>
              <CardTitle>{primaryLook.lookName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Accordion type="single" collapsible className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4">
                <AccordionItem value="details" className="border-none">
                  <AccordionTrigger className="text-sm font-medium">
                    Confidence and Intent Details
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm text-slate-700">
                    <p>
                      Confidence: {primaryLook.confidence}% (match: {primaryLook.matchScore}%, model: {primaryLook.modelConfidence}%)
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
                  {primaryLook.lineup.map((garment) => (
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
                <p className="text-sm leading-6 text-slate-800">{primaryLook.rationale}</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-sm font-medium text-slate-800">Was this recommendation useful?</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={singleFeedbackVote === "up"}
                    className={cn(
                      "bg-transparent",
                      singleFeedbackVote === "up" && "border-slate-600 text-slate-900 ring-1 ring-slate-300"
                    )}
                    disabled={singleFeedbackStatus === "submitting" || singleFeedbackStatus === "submitted"}
                    onClick={() => void handleSingleFeedbackVote("up")}
                  >
                    {singleFeedbackVote === "up" ? "✓ Thumbs up" : "👍 Thumbs up"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={singleFeedbackVote === "down"}
                    className={cn(
                      "bg-transparent",
                      singleFeedbackVote === "down" && "border-slate-600 text-slate-900 ring-1 ring-slate-300"
                    )}
                    disabled={singleFeedbackStatus === "submitting" || singleFeedbackStatus === "submitted"}
                    onClick={() => void handleSingleFeedbackVote("down")}
                  >
                    {singleFeedbackVote === "down" ? "✓ Thumbs down" : "👎 Thumbs down"}
                  </Button>
                </div>
                {singleFeedbackVote === "down" && (
                  <div className="mt-3">
                    <Textarea
                      value={singleFeedbackReason}
                      onChange={(event) => setSingleFeedbackReason(event.target.value)}
                      placeholder="Example: Context (light rain, 6°C, city, all day) | Issue (tweed overcoat not rain-ready) | Change (use water-resistant/technical outerwear) | Keep (boots + elevated-casual style)."
                      className="min-h-20 bg-white"
                      disabled={singleFeedbackStatus === "submitted"}
                    />
                    <div className="mt-4 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={singleFeedbackStatus === "submitting" || singleFeedbackStatus === "submitted"}
                        onClick={() => void handleSubmitSingleDownvote()}
                      >
                        {singleFeedbackStatus === "submitting" ? "Sending..." : "Send feedback"}
                      </Button>
                    </div>
                  </div>
                )}
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
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
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

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-3">
                        <Skeleton className="h-4 w-44" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Skeleton className="h-9 w-28" />
                        <Skeleton className="h-9 w-28" />
                      </div>
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

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-2 text-sm font-medium text-slate-800">Was this day look useful?</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-pressed={travelFeedbackVotes[`${day.date}:${day.lineupSignature}`] === "up"}
                          className={cn(
                            "bg-transparent",
                            travelFeedbackVotes[`${day.date}:${day.lineupSignature}`] === "up" &&
                              "border-slate-600 text-slate-900 ring-1 ring-slate-300"
                          )}
                          disabled={
                            travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitting" ||
                            travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitted"
                          }
                          onClick={() => void handleTravelFeedbackVote(day, "up")}
                        >
                          {travelFeedbackVotes[`${day.date}:${day.lineupSignature}`] === "up" ? "✓ Thumbs up" : "👍 Thumbs up"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-pressed={travelFeedbackVotes[`${day.date}:${day.lineupSignature}`] === "down"}
                          className={cn(
                            "bg-transparent",
                            travelFeedbackVotes[`${day.date}:${day.lineupSignature}`] === "down" &&
                              "border-slate-600 text-slate-900 ring-1 ring-slate-300"
                          )}
                          disabled={
                            travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitting" ||
                            travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitted"
                          }
                          onClick={() => void handleTravelFeedbackVote(day, "down")}
                        >
                          {travelFeedbackVotes[`${day.date}:${day.lineupSignature}`] === "down"
                            ? "✓ Thumbs down"
                            : "👎 Thumbs down"}
                        </Button>
                      </div>
                      {travelFeedbackVotes[`${day.date}:${day.lineupSignature}`] === "down" && (
                        <div className="mt-3">
                          <Textarea
                            value={travelFeedbackReasons[`${day.date}:${day.lineupSignature}`] || ""}
                            onChange={(event) =>
                              setTravelFeedbackReasons((current) => ({
                                ...current,
                                [`${day.date}:${day.lineupSignature}`]: event.target.value,
                              }))
                            }
                            placeholder="Example: Context (light rain, 6°C, city, all day) | Issue (outerwear not rain-ready) | Change (use water-resistant/technical outerwear) | Keep (boots + silhouette)."
                            className="min-h-20 bg-white"
                            disabled={travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitted"}
                          />
                          <div className="mt-4 flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              disabled={
                                travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitting" ||
                                travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitted"
                              }
                              onClick={() => void handleSubmitTravelDownvote(day)}
                            >
                              {travelFeedbackStatuses[`${day.date}:${day.lineupSignature}`] === "submitting"
                                ? "Sending..."
                                : "Send feedback"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
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
