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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import LookTryOnCards, { type LookDetailsSummary } from "@/components/look-try-on-cards";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clearSelection,
  getSelectionIds,
  MAX_SELECTION_GARMENTS,
  removeSelectionId,
  setSelectionIds,
} from "@/lib/manual-look-selection";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Code2, Copy, Plus, Trash2 } from "lucide-react";

interface LookGarment {
  id: number;
  model: string;
  brand: string;
  type: string;
  file_name: string;
  style?: string;
  styles?: string[];
  formality?: string;
  suitable_places?: string[];
  suitable_occasions?: string[];
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

type AiMode = "single" | "travel" | "selection" | "saved";
type AnchorMode = "strict" | "soft";
type FeedbackVote = "up" | "down";
type FeedbackStatus = "idle" | "submitting" | "submitted" | "error";
type SelectedToolType = "style" | "reference";

interface SelectedToolOption {
  type: SelectedToolType;
  id: string;
}

interface ToolCatalogOption {
  id: string;
  label: string;
}

interface ManualTryOnContext {
  locationLabel: string;
  weatherSummary: string;
  weatherSource: "live" | "fallback";
}

interface ManualTryOnResponse {
  ok: boolean;
  generatedImageUrl: string;
  context: ManualTryOnContext;
}

interface ManualTryOnErrorResponse {
  error?: string;
  errorCode?: string;
}

interface ManualSavedLook {
  id: number;
  ownerKey: string;
  title: string;
  garmentIds: number[];
  generatedImageUrl: string;
  locationLabel: string;
  weatherSummary: string;
  weatherSource: "live" | "fallback";
  createdAt: string;
  updatedAt: string;
}

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

const FORMALITY_SCALE: Record<string, number> = {
  casual: 1,
  "elevated casual": 2,
  technical: 2,
  "business casual": 3,
  "business formal": 4,
  formal: 5,
};

const classifyRoleWeight = (type: string): number => {
  const normalizedType = type.trim().toLowerCase();
  if (!normalizedType) return 1;

  const outerwearTerms = [
    "coat",
    "jacket",
    "blazer",
    "parka",
    "outerwear",
    "trench",
    "overcoat",
    "raincoat",
    "windbreaker",
    "anorak",
    "vest",
    "gilet",
  ];
  if (outerwearTerms.some((term) => normalizedType.includes(term))) {
    return 0.7;
  }

  return 1;
};

const weightedTagConsensus = ({
  garments,
  getTags,
  threshold,
  limit,
}: {
  garments: LookGarment[];
  getTags: (garment: LookGarment) => string[];
  threshold: number;
  limit: number;
}): string[] => {
  const weightedTotals = new Map<string, { label: string; weight: number }>();
  const totalWeight = garments.reduce((acc, garment) => acc + classifyRoleWeight(garment.type), 0);
  if (totalWeight <= 0) return [];

  for (const garment of garments) {
    const garmentWeight = classifyRoleWeight(garment.type);
    const seenInGarment = new Set<string>();
    const tags = getTags(garment);
    for (const rawTag of tags) {
      const label = rawTag.trim();
      if (!label) continue;
      const normalized = label.toLowerCase();
      if (seenInGarment.has(normalized)) continue;
      seenInGarment.add(normalized);

      const existing = weightedTotals.get(normalized);
      if (existing) {
        existing.weight += garmentWeight;
      } else {
        weightedTotals.set(normalized, { label, weight: garmentWeight });
      }
    }
  }

  const ranked = Array.from(weightedTotals.values())
    .map((entry) => ({ label: entry.label, ratio: entry.weight / totalWeight }))
    .sort((a, b) => b.ratio - a.ratio);

  const filtered = ranked.filter((entry) => entry.ratio >= threshold).slice(0, limit).map((entry) => entry.label);
  if (filtered.length > 0) return filtered;
  return ranked.slice(0, 1).map((entry) => entry.label);
};

const weightedFormalityConsensus = (garments: LookGarment[]): string | null => {
  const points: Array<{ score: number; weight: number }> = [];
  const fallbackCounts = new Map<string, number>();

  for (const garment of garments) {
    const rawFormality = (garment.formality ?? "").trim();
    if (!rawFormality) continue;
    const normalized = rawFormality.toLowerCase();
    const weight = classifyRoleWeight(garment.type);
    const score = FORMALITY_SCALE[normalized];
    if (typeof score === "number") {
      points.push({ score, weight });
    }
    fallbackCounts.set(rawFormality, (fallbackCounts.get(rawFormality) ?? 0) + 1);
  }

  if (points.length === 0) {
    const fallback = Array.from(fallbackCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return fallback;
  }

  const totalWeight = points.reduce((acc, point) => acc + point.weight, 0);
  if (totalWeight <= 0) return null;
  const weightedAverage = points.reduce((acc, point) => acc + point.score * point.weight, 0) / totalWeight;

  const closestScale = Object.entries(FORMALITY_SCALE).reduce(
    (best, [label, score]) => {
      const distance = Math.abs(score - weightedAverage);
      if (distance < best.distance) {
        return { label, distance };
      }
      return best;
    },
    { label: "casual", distance: Number.POSITIVE_INFINITY }
  ).label;

  return closestScale
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const summarizeLook = (garments: LookGarment[]): LookDetailsSummary => {
  const styles = weightedTagConsensus({
    garments,
    getTags: (garment) => {
      const styleValues = Array.isArray(garment.styles) && garment.styles.length > 0
        ? garment.styles
        : (garment.style ? [garment.style] : []);
      return styleValues;
    },
    threshold: 0.5,
    limit: 2,
  });

  const suitablePlaces = weightedTagConsensus({
    garments,
    getTags: (garment) => garment.suitable_places ?? [],
    threshold: 0.6,
    limit: 4,
  });

  const suitableOccasions = weightedTagConsensus({
    garments,
    getTags: (garment) => garment.suitable_occasions ?? [],
    threshold: 0.6,
    limit: 4,
  });

  return {
    styles,
    formality: weightedFormalityConsensus(garments),
    suitablePlaces,
    suitableOccasions,
  };
};

export default function AiLookClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeMode, setActiveMode] = useState<AiMode>("saved");

  const [prompt, setPrompt] = useState("");
  const [singleResult, setSingleResult] = useState<SingleLookResponse | null>(null);
  const [anchorGarmentId, setAnchorGarmentId] = useState<number | null>(null);
  const [anchorMode, setAnchorMode] = useState<AnchorMode>("strict");
  const [anchorLabel, setAnchorLabel] = useState<string | null>(null);
  const [styleToolOptions, setStyleToolOptions] = useState<ToolCatalogOption[]>([]);
  const [referenceToolOptions, setReferenceToolOptions] = useState<ToolCatalogOption[]>([]);
  const [selectedTools, setSelectedTools] = useState<SelectedToolOption[]>([]);

  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState<"Vacation" | "Office" | "Customer visit">("Vacation");
  const [travelResult, setTravelResult] = useState<TravelPlanResponse | null>(null);
  const [selectionIds, setSelectionIdsState] = useState<number[]>([]);
  const [selectionGarments, setSelectionGarments] = useState<LookGarment[]>([]);
  const [selectionLoadError, setSelectionLoadError] = useState<string | null>(null);
  const [manualTryOnImageUrl, setManualTryOnImageUrl] = useState<string | null>(null);
  const [manualTryOnContext, setManualTryOnContext] = useState<ManualTryOnContext | null>(null);
  const [manualLookTitle, setManualLookTitle] = useState("");
  const [singleTryOnImageUrl, setSingleTryOnImageUrl] = useState<string | null>(null);
  const [singleTryOnContext, setSingleTryOnContext] = useState<ManualTryOnContext | null>(null);
  const [isSingleTryOnLoading, setIsSingleTryOnLoading] = useState(false);
  const [singleTryOnSaving, setSingleTryOnSaving] = useState(false);
  const [singleTryOnGarmentIds, setSingleTryOnGarmentIds] = useState<number[]>([]);
  const [singleTryOnGarments, setSingleTryOnGarments] = useState<LookGarment[]>([]);
  const [singleTryOnLookTitle, setSingleTryOnLookTitle] = useState("");
  const [savedManualLooks, setSavedManualLooks] = useState<ManualSavedLook[]>([]);
  const [savedLooksLoading, setSavedLooksLoading] = useState(false);
  const [savedLooksError, setSavedLooksError] = useState<string | null>(null);
  const [savedPreviewLookId, setSavedPreviewLookId] = useState<number | null>(null);
  const [savedTabView, setSavedTabView] = useState<"list" | "detail">("list");
  const [savedPreviewLoading, setSavedPreviewLoading] = useState(false);
  const [savedPreviewGarments, setSavedPreviewGarments] = useState<LookGarment[]>([]);
  const [savedPreviewImageUrl, setSavedPreviewImageUrl] = useState<string | null>(null);
  const [savedPreviewContext, setSavedPreviewContext] = useState<ManualTryOnContext | null>(null);
  const [savedPreviewTitle, setSavedPreviewTitle] = useState("");
  const [savedPreviewLoadError, setSavedPreviewLoadError] = useState<string | null>(null);
  const [isSavedLookActionsOpen, setIsSavedLookActionsOpen] = useState(false);
  const [savedLookActionsSearchValue, setSavedLookActionsSearchValue] = useState("");
  const [savedLookActionsDebouncedSearchValue, setSavedLookActionsDebouncedSearchValue] = useState("");
  const [savedLookActionsView, setSavedLookActionsView] = useState<"search" | "export-json">("search");
  const [isSavedLookJsonCopied, setIsSavedLookJsonCopied] = useState(false);
  const [expandedTryOnImageUrl, setExpandedTryOnImageUrl] = useState<string | null>(null);
  const [expandedTryOnImageAlt, setExpandedTryOnImageAlt] = useState("Try-on image");

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
  const isSelectionLoading = isLoading && loadingMode === "selection";
  const primaryLook = singleResult?.primaryLook ?? null;
  const selectionActionBusy = isSelectionLoading || isSingleTryOnLoading;
  const savedTabBusy = selectionActionBusy || savedPreviewLoading;
  const lookDetails = useMemo(() => summarizeLook(selectionGarments), [selectionGarments]);
  const singleTryOnLookDetails = useMemo(() => summarizeLook(singleTryOnGarments), [singleTryOnGarments]);
  const savedPreviewLookDetails = useMemo(() => summarizeLook(savedPreviewGarments), [savedPreviewGarments]);
  const selectedSavedLook = useMemo(
    () => savedManualLooks.find((look) => look.id === savedPreviewLookId) ?? null,
    [savedManualLooks, savedPreviewLookId]
  );

  const getTryOnErrorMessage = (payload: ManualTryOnErrorResponse | null): string => {
    if (payload?.errorCode === "PROFILE_BODY_PHOTO_REQUIRED") {
      return "Upload your full-body photo in Profile before using Try it.";
    }
    return payload?.error || "Failed to generate try-on image.";
  };

  useEffect(() => {
    let isActive = true;
    const loadToolOptions = async () => {
      try {
        const [stylesResponse, referencesResponse] = await Promise.all([
          fetch("/api/profile/styles", { cache: "no-store" }),
          fetch("/api/profile/references", { cache: "no-store" }),
        ]);
        if (!stylesResponse.ok && !referencesResponse.ok) return;

        const stylesPayload = stylesResponse.ok
          ? (await stylesResponse.json()) as {
              selectedStyles?: Array<{ key?: string; name?: string }>;
            }
          : null;
        const selectedStyles = Array.isArray(stylesPayload?.selectedStyles) ? stylesPayload.selectedStyles : [];
        const styleOptions = selectedStyles
          .map((style) => ({
            id: typeof style.key === "string" ? style.key.trim() : "",
            label: typeof style.name === "string" ? style.name.trim() : "",
          }))
          .filter((style) => style.id && style.label);

        const referencesPayload = referencesResponse.ok
          ? (await referencesResponse.json()) as {
              toolOptions?: Array<{ id?: string; label?: string }>;
            }
          : null;
        const references = Array.isArray(referencesPayload?.toolOptions) ? referencesPayload.toolOptions : [];
        const referenceOptions = references
          .map((reference) => ({
            id: typeof reference.id === "string" ? reference.id.trim() : "",
            label: typeof reference.label === "string" ? reference.label.trim() : "",
          }))
          .filter((reference) => reference.id && reference.label);

        if (!isActive) return;
        setStyleToolOptions(styleOptions);
        setReferenceToolOptions(referenceOptions);
      } catch {
        // Keep empty state when profile tool endpoints are unavailable.
      }
    };

    void loadToolOptions();
    return () => {
      isActive = false;
    };
  }, []);

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

  const resolveGarmentsByIds = async (ids: number[]): Promise<LookGarment[]> => {
    const response = await fetch("/api/wardrobe?fresh=1", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load wardrobe.");
    }

    const wardrobe = await response.json() as Array<{
      id: number;
      model: string;
      brand: string;
      type: string;
      file_name: string;
      style: string;
      styles: string[];
      formality: string;
      suitable_places: string[];
      suitable_occasions: string[];
    }>;
    const garmentById = new Map(wardrobe.map((garment) => [garment.id, garment]));
    return ids
      .map((id) => garmentById.get(id))
      .filter((garment): garment is {
        id: number;
        model: string;
        brand: string;
        type: string;
        file_name: string;
        style: string;
        styles: string[];
        formality: string;
        suitable_places: string[];
        suitable_occasions: string[];
      } => Boolean(garment))
      .map((garment) => ({
        id: garment.id,
        model: garment.model,
        brand: garment.brand,
        type: garment.type,
        file_name: garment.file_name,
        style: garment.style,
        styles: Array.isArray(garment.styles) ? garment.styles : [],
        formality: garment.formality ?? "",
        suitable_places: Array.isArray(garment.suitable_places) ? garment.suitable_places : [],
        suitable_occasions: Array.isArray(garment.suitable_occasions) ? garment.suitable_occasions : [],
      }));
  };

  const refreshSelectionFromStorage = async () => {
    const ids = getSelectionIds();
    setSelectionIdsState(ids);
    setSelectionLoadError(null);

    if (ids.length === 0) {
      setSelectionGarments([]);
      return;
    }

    try {
      const resolved = await resolveGarmentsByIds(ids);
      setSelectionGarments(resolved);

      if (resolved.length !== ids.length) {
        const resolvedIds = resolved.map((garment) => garment.id);
        setSelectionIds(resolvedIds);
        setSelectionIdsState(resolvedIds);
      }
    } catch {
      setSelectionLoadError("Could not load selected garments.");
      setSelectionGarments([]);
    }
  };

  const loadSavedManualLooks = async () => {
    setSavedLooksLoading(true);
    setSavedLooksError(null);
    try {
      const response = await fetch("/api/looks/manual/saved", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load saved looks.");
      }
      const payload = (await response.json()) as { looks?: ManualSavedLook[] };
      setSavedManualLooks(Array.isArray(payload.looks) ? payload.looks : []);
    } catch {
      setSavedLooksError("Could not load saved looks.");
      setSavedManualLooks([]);
    } finally {
      setSavedLooksLoading(false);
    }
  };

  useEffect(() => {
    void refreshSelectionFromStorage();
  }, []);

  useEffect(() => {
    if (activeMode !== "selection" && activeMode !== "saved") return;
    if (activeMode === "selection") {
      void refreshSelectionFromStorage();
    }
    void loadSavedManualLooks();
  }, [activeMode]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSavedLookActionsDebouncedSearchValue(savedLookActionsSearchValue);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [savedLookActionsSearchValue]);

  useEffect(() => {
    if (!isSavedLookJsonCopied) return;
    const timeoutId = window.setTimeout(() => {
      setIsSavedLookJsonCopied(false);
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [isSavedLookJsonCopied]);

  useEffect(() => {
    const isSavedDetailMode = activeMode === "saved" && savedTabView === "detail";
    if (!isSavedDetailMode) return;

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      const isTypingTarget = !!target?.closest("input, textarea, select, [contenteditable=\"true\"]");
      if (isTypingTarget) return;
      event.preventDefault();
      setIsSavedLookActionsOpen((previous) => !previous);
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeMode, savedTabView]);

  useEffect(() => {
    if (!isSavedLookActionsOpen) return;
    if (savedLookActionsView !== "search") return;

    const handleActionHotkeys = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (savedLookActionsSearchValue.trim().length > 0) return;
      if (event.key !== "J") return;
      event.preventDefault();
      setSavedLookActionsView("export-json");
      setSavedLookActionsSearchValue("");
      setIsSavedLookJsonCopied(false);
    };

    window.addEventListener("keydown", handleActionHotkeys);
    return () => window.removeEventListener("keydown", handleActionHotkeys);
  }, [isSavedLookActionsOpen, savedLookActionsSearchValue, savedLookActionsView]);

  useEffect(() => {
    if (activeMode === "saved" && savedTabView === "detail") return;
    setIsSavedLookActionsOpen(false);
    setSavedLookActionsSearchValue("");
    setSavedLookActionsView("search");
    setIsSavedLookJsonCopied(false);
  }, [activeMode, savedTabView]);

  const handleClearAnchor = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("anchorGarmentId");
    nextParams.delete("anchorMode");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  };

  const handleAddTool = (type: SelectedToolType, id: string) => {
    if (!id) return;
    setSelectedTools((current) => {
      if (current.some((tool) => tool.type === type && tool.id === id)) {
        return current;
      }
      return [...current, { type, id }];
    });
  };

  const handleRemoveTool = (toolToRemove: SelectedToolOption) => {
    setSelectedTools((current) =>
      current.filter((tool) => !(tool.type === toolToRemove.type && tool.id === toolToRemove.id))
    );
  };

  const getToolOptionLabel = (tool: SelectedToolOption): string => {
    const options = tool.type === "style" ? styleToolOptions : referenceToolOptions;
    const match = options.find((option) => option.id === tool.id);
    const typeLabel = tool.type === "style" ? "Style" : "Reference";
    return match ? `${typeLabel}: ${match.label}` : `${typeLabel}: ${tool.id}`;
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
      const response = await fetch("/api/looks/feedback", {
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
    setSingleTryOnImageUrl(null);
    setSingleTryOnContext(null);
    setSingleTryOnGarmentIds([]);
    setSingleTryOnGarments([]);
    setSingleTryOnLookTitle("");

    try {
      const payload: {
        prompt: string;
        anchorGarmentId?: number;
        anchorMode?: AnchorMode;
        selectedTools?: SelectedToolOption[];
      } = { prompt: trimmedPrompt };
      if (anchorGarmentId != null) {
        payload.anchorGarmentId = anchorGarmentId;
        payload.anchorMode = anchorMode;
      }
      if (selectedTools.length > 0) {
        payload.selectedTools = selectedTools;
      }
      const response = await fetch("/api/looks", {
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
      const response = await fetch("/api/looks", {
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

  const handleRemoveFromSelection = (garmentId: number) => {
    removeSelectionId(garmentId);
    setManualTryOnImageUrl(null);
    setManualTryOnContext(null);
    void refreshSelectionFromStorage();
  };

  const handleClearSelection = () => {
    clearSelection();
    setSelectionIdsState([]);
    setSelectionGarments([]);
    setManualTryOnImageUrl(null);
    setManualTryOnContext(null);
    setManualLookTitle("");
    setSelectionLoadError(null);
  };

  const handleTryOnSelection = async () => {
    if (selectionIds.length < 2 || selectionIds.length > MAX_SELECTION_GARMENTS) {
      setError(`Selection must include 2 to ${MAX_SELECTION_GARMENTS} garments.`);
      return;
    }

    setIsLoading(true);
    setLoadingMode("selection");
    setError(null);
    setManualTryOnImageUrl(null);
    setManualTryOnContext(null);

    try {
      const response = await fetch("/api/looks/manual/try-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garmentIds: selectionIds,
        }),
      });

      const payload = await response.json() as ManualTryOnErrorResponse & Partial<ManualTryOnResponse>;
      if (!response.ok) {
        setError(getTryOnErrorMessage(payload));
        return;
      }

      if (!payload.generatedImageUrl || !payload.context) {
        setError("Try-on response was incomplete.");
        return;
      }

      setManualTryOnImageUrl(payload.generatedImageUrl);
      setManualTryOnContext(payload.context);
      if (!manualLookTitle.trim()) {
        setManualLookTitle(`Manual Look - ${new Date().toISOString().slice(0, 10)}`);
      }
    } catch {
      setError("Unexpected network error while generating the try-on image.");
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleTryOnSingleLook = async () => {
    if (!primaryLook || primaryLook.lineup.length < 2) {
      setError("Generate a look first before trying it on.");
      return;
    }

    const lineupIds = primaryLook.lineup.map((garment) => garment.id);
    setIsSingleTryOnLoading(true);
    setError(null);
    setSingleTryOnImageUrl(null);
    setSingleTryOnContext(null);
    setSingleTryOnGarmentIds(lineupIds);
    setSingleTryOnLookTitle(primaryLook.lookName || `Look - ${new Date().toISOString().slice(0, 10)}`);

    try {
      try {
        const resolved = await resolveGarmentsByIds(lineupIds);
        setSingleTryOnGarments(resolved);
      } catch {
        setSingleTryOnGarments([]);
      }

      const response = await fetch("/api/looks/manual/try-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garmentIds: lineupIds,
        }),
      });

      const payload = await response.json() as ManualTryOnErrorResponse & Partial<ManualTryOnResponse>;
      if (!response.ok) {
        setError(getTryOnErrorMessage(payload));
        return;
      }

      if (!payload.generatedImageUrl || !payload.context) {
        setError("Try-on response was incomplete.");
        return;
      }

      setSingleTryOnImageUrl(payload.generatedImageUrl);
      setSingleTryOnContext(payload.context);
    } catch {
      setError("Unexpected network error while generating the try-on image.");
    } finally {
      setIsSingleTryOnLoading(false);
    }
  };

  const handleSaveSingleTryOnLook = async () => {
    if (!singleTryOnImageUrl || !singleTryOnContext) {
      setError("Generate a try-on image before saving.");
      return;
    }
    if (singleTryOnGarmentIds.length < 2 || singleTryOnGarmentIds.length > MAX_SELECTION_GARMENTS) {
      setError(`Try-on look must include 2 to ${MAX_SELECTION_GARMENTS} garments before saving.`);
      return;
    }

    const title = singleTryOnLookTitle.trim() || `Look - ${new Date().toISOString().slice(0, 10)}`;
    setSingleTryOnSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/looks/manual/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          garmentIds: singleTryOnGarmentIds,
          generatedImageUrl: singleTryOnImageUrl,
          context: singleTryOnContext,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Failed to save look.");
        return;
      }

      toast.success("Look saved.");
      await loadSavedManualLooks();
    } catch {
      setError("Unexpected network error while saving look.");
    } finally {
      setSingleTryOnSaving(false);
    }
  };

  const handleSaveManualLook = async () => {
    if (!manualTryOnImageUrl || !manualTryOnContext) {
      setError("Generate a try-on image before saving.");
      return;
    }
    if (selectionIds.length < 2 || selectionIds.length > MAX_SELECTION_GARMENTS) {
      setError(`Selection must include 2 to ${MAX_SELECTION_GARMENTS} garments before saving.`);
      return;
    }

    const title = manualLookTitle.trim() || `Manual Look - ${new Date().toISOString().slice(0, 10)}`;
    setIsLoading(true);
    setLoadingMode("selection");
    setError(null);

    try {
      const response = await fetch("/api/looks/manual/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          garmentIds: selectionIds,
          generatedImageUrl: manualTryOnImageUrl,
          context: manualTryOnContext,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Failed to save manual look.");
        return;
      }

      toast.success("Manual look saved.");
      await loadSavedManualLooks();
      handleClearSelection();
    } catch {
      setError("Unexpected network error while saving manual look.");
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleSaveSavedPreviewLook = async () => {
    if (!savedPreviewImageUrl || !savedPreviewContext) {
      setError("Load a saved look preview before saving.");
      return;
    }
    const garmentIds = savedPreviewGarments.map((garment) => garment.id);
    if (garmentIds.length < 2 || garmentIds.length > MAX_SELECTION_GARMENTS) {
      setError(`Saved preview must include 2 to ${MAX_SELECTION_GARMENTS} garments before saving.`);
      return;
    }

    const title = savedPreviewTitle.trim() || `Manual Look - ${new Date().toISOString().slice(0, 10)}`;
    setIsLoading(true);
    setLoadingMode("selection");
    setError(null);

    try {
      const response = await fetch("/api/looks/manual/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          garmentIds,
          generatedImageUrl: savedPreviewImageUrl,
          context: savedPreviewContext,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Failed to save loaded look.");
        return;
      }

      toast.success("Saved look updated as a new entry.");
      await loadSavedManualLooks();
    } catch {
      setError("Unexpected network error while saving loaded look.");
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleDeleteSavedLook = async (id: number) => {
    setIsLoading(true);
    setLoadingMode("selection");
    setError(null);
    try {
      const response = await fetch("/api/looks/manual/saved", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Failed to delete saved look.");
        return;
      }

      toast.success("Saved look deleted.");
      if (savedPreviewLookId === id) {
        setSavedPreviewLookId(null);
        setSavedPreviewGarments([]);
        setSavedPreviewImageUrl(null);
        setSavedPreviewContext(null);
        setSavedPreviewTitle("");
      }
      await loadSavedManualLooks();
    } catch {
      setError("Unexpected network error while deleting saved look.");
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleLoadSavedLookPreview = async (savedLook: ManualSavedLook) => {
    setSavedTabView("detail");
    setSavedPreviewLoading(true);
    setSavedPreviewLoadError(null);
    setSavedPreviewGarments([]);
    setSavedPreviewLookId(savedLook.id);
    setSavedPreviewImageUrl(savedLook.generatedImageUrl);
    setSavedPreviewContext({
      locationLabel: savedLook.locationLabel,
      weatherSummary: savedLook.weatherSummary,
      weatherSource: savedLook.weatherSource,
    });
    setSavedPreviewTitle(savedLook.title);

    const nextIds = savedLook.garmentIds.slice(0, MAX_SELECTION_GARMENTS);
    try {
      const resolved = await resolveGarmentsByIds(nextIds);
      setSavedPreviewGarments(resolved);
      if (resolved.length !== nextIds.length) {
        setSavedPreviewLoadError("Some garments in this saved look are no longer available.");
      }
    } catch {
      setSavedPreviewGarments([]);
      setSavedPreviewLoadError("Could not load saved look preview garments.");
    } finally {
      setSavedPreviewLoading(false);
    }
  };

  const handleBackToSavedLooksList = () => {
    setSavedTabView("list");
    setSavedPreviewLoadError(null);
  };

  const handleClearSingle = () => {
    setPrompt("");
    setSelectedTools([]);
    setError(null);
    setSingleResult(null);
    setSingleFeedbackVote(null);
    setSingleFeedbackReason("");
    setSingleFeedbackStatus("idle");
    setSingleTryOnImageUrl(null);
    setSingleTryOnContext(null);
    setSingleTryOnGarmentIds([]);
    setSingleTryOnGarments([]);
    setSingleTryOnLookTitle("");
  };

  const openTryOnImageModal = (imageUrl: string, alt: string) => {
    setExpandedTryOnImageUrl(imageUrl);
    setExpandedTryOnImageAlt(alt);
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

  const handleOpenSavedLookJson = () => {
    setSavedLookActionsView("export-json");
    setSavedLookActionsSearchValue("");
    setIsSavedLookJsonCopied(false);
  };

  const handleBackToSavedLookActionSearch = () => {
    setSavedLookActionsView("search");
    setSavedLookActionsSearchValue("");
    setIsSavedLookJsonCopied(false);
  };

  const savedLookExportJson = useMemo(() => {
    const garmentIds = savedPreviewGarments.map((garment) => garment.id);
    const fallbackGarmentIds = selectedSavedLook?.garmentIds ?? [];
    const context = savedPreviewContext
      ? {
          locationLabel: savedPreviewContext.locationLabel,
          weatherSummary: savedPreviewContext.weatherSummary,
          weatherSource: savedPreviewContext.weatherSource,
        }
      : selectedSavedLook
        ? {
            locationLabel: selectedSavedLook.locationLabel,
            weatherSummary: selectedSavedLook.weatherSummary,
            weatherSource: selectedSavedLook.weatherSource,
          }
        : null;

    return JSON.stringify(
      {
        id: selectedSavedLook?.id ?? savedPreviewLookId ?? null,
        title: savedPreviewTitle || selectedSavedLook?.title || "",
        garmentIds: garmentIds.length > 0 ? garmentIds : fallbackGarmentIds,
        garments: savedPreviewGarments.map((garment) => ({
          id: garment.id,
          model: garment.model,
          brand: garment.brand,
          type: garment.type,
          file_name: garment.file_name,
        })),
        generatedImageUrl: savedPreviewImageUrl || selectedSavedLook?.generatedImageUrl || "",
        context,
        createdAt: selectedSavedLook?.createdAt ?? null,
        updatedAt: selectedSavedLook?.updatedAt ?? null,
      },
      null,
      2
    );
  }, [
    savedPreviewGarments,
    savedPreviewContext,
    savedPreviewImageUrl,
    savedPreviewLookId,
    savedPreviewTitle,
    selectedSavedLook,
  ]);

  const handleCopySavedLookJson = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(savedLookExportJson);
      } else if (typeof document !== "undefined") {
        const tempArea = document.createElement("textarea");
        tempArea.value = savedLookExportJson;
        tempArea.setAttribute("readonly", "true");
        tempArea.style.position = "absolute";
        tempArea.style.left = "-9999px";
        document.body.appendChild(tempArea);
        tempArea.select();
        document.execCommand("copy");
        document.body.removeChild(tempArea);
      }
      setIsSavedLookJsonCopied(true);
    } catch (copyError) {
      console.error("Failed to copy saved look JSON:", copyError);
      toast.error("Failed to copy saved look JSON.");
    }
  };

  const savedLookActionQuery = savedLookActionsDebouncedSearchValue.trim().toLowerCase();
  const showSavedLookActionThresholdHint =
    savedLookActionsSearchValue.trim().length > 0 && savedLookActionsSearchValue.trim().length < 2;
  const showExportLookJsonAction =
    !savedLookActionQuery ||
    (savedLookActionQuery.length >= 2 &&
      "export look to json saved look json".includes(savedLookActionQuery));
  const showSavedLookNoActionsFound = !showSavedLookActionThresholdHint && !showExportLookJsonAction;
  const showMainPanelCardShell = !(activeMode === "saved" && savedTabView === "list");

  return (
    <div className="min-h-[calc(100vh-4rem)] min-h-[calc(100dvh-4rem)] bg-slate-100 p-4 md:p-6">
      <CommandDialog
        open={isSavedLookActionsOpen}
        onOpenChange={(open) => {
          setIsSavedLookActionsOpen(open);
          if (!open) {
            setSavedLookActionsSearchValue("");
            setSavedLookActionsView("search");
            setIsSavedLookJsonCopied(false);
          }
        }}
        title="Saved Look Actions"
        description="Run actions for this saved look."
        className="max-w-md"
      >
        {savedLookActionsView === "search" ? (
          <>
            <CommandInput
              placeholder="Search actions... (J = Export JSON)"
              value={savedLookActionsSearchValue}
              onValueChange={setSavedLookActionsSearchValue}
            />
            <CommandList>
              {showSavedLookActionThresholdHint ? (
                <p className="py-6 text-center text-sm text-gray-600">Type at least 2 characters</p>
              ) : (
                <CommandEmpty>No actions found</CommandEmpty>
              )}
              {showExportLookJsonAction ? (
                <CommandGroup heading="Actions">
                  <CommandItem
                    value="Export Look to JSON"
                    keywords={["export", "look", "json", "saved"]}
                    onSelect={handleOpenSavedLookJson}
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="inline-flex min-w-0 items-center gap-2 text-sm text-gray-800">
                        <Code2 className="size-4 shrink-0 text-gray-500" />
                        <span className="truncate">Export Look to JSON</span>
                      </span>
                      <span className="rounded-md border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        J
                      </span>
                    </div>
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {showSavedLookNoActionsFound && null}
            </CommandList>
          </>
        ) : (
          <div className="h-[300px] bg-gray-50 p-3">
            <div className="flex h-full flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleBackToSavedLookActionSearch}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  aria-label="Back to action search"
                  title="Back"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopySavedLookJson()}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  aria-label="Copy saved look JSON to clipboard"
                  title="Copy"
                >
                  <Copy className="size-3.5" />
                  {isSavedLookJsonCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <textarea
                readOnly
                value={savedLookExportJson}
                className="min-h-0 w-full flex-1 resize-y rounded-md border border-gray-300 bg-white p-2 font-mono text-xs text-gray-800"
                aria-label="Saved look JSON export"
              />
            </div>
          </div>
        )}
      </CommandDialog>

      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="border-b border-slate-300">
          <div role="tablist" aria-label="Looks modes" className="flex items-end gap-6">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "saved"}
              aria-controls="looks-main-panel"
              className={cn(
                "-mb-px border-b-2 border-transparent px-1 py-2 text-sm font-medium transition",
                activeMode === "saved"
                  ? "border-slate-900 text-slate-900"
                  : "text-slate-600 hover:text-slate-900"
              )}
              onClick={() => {
                setActiveMode("saved");
                setError(null);
              }}
            >
              Favorite Looks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "single"}
              aria-controls="looks-main-panel"
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
              Create New Look
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "selection"}
              aria-controls="looks-main-panel"
              className={cn(
                "-mb-px border-b-2 border-transparent px-1 py-2 text-sm font-medium transition",
                activeMode === "selection"
                  ? "border-slate-900 text-slate-900"
                  : "text-slate-600 hover:text-slate-900"
              )}
              onClick={() => {
                setActiveMode("selection");
                setError(null);
              }}
            >
              Changing Room
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "travel"}
              aria-controls="looks-main-panel"
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

        <div
          id="looks-main-panel"
          role="tabpanel"
          className={cn(
            "space-y-4",
            showMainPanelCardShell && "rounded-lg border bg-white p-6"
          )}
        >

            {activeMode === "single" ? (
              <form onSubmit={handleGenerateSingle} className="space-y-3">
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-full p-0"
                          aria-label="Add tool"
                          disabled={isLoading}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        {styleToolOptions.length === 0 ? (
                          <DropdownMenuItem disabled>Style</DropdownMenuItem>
                        ) : (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Style</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {styleToolOptions.map((option) => (
                                <DropdownMenuItem
                                  key={`style-tool-${option.id}`}
                                  onClick={() => handleAddTool("style", option.id)}
                                >
                                  {option.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        {referenceToolOptions.length === 0 ? (
                          <DropdownMenuItem disabled>Reference</DropdownMenuItem>
                        ) : (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Reference</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {referenceToolOptions.map((option) => (
                                <DropdownMenuItem
                                  key={`reference-tool-${option.id}`}
                                  onClick={() => handleAddTool("reference", option.id)}
                                >
                                  {option.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {selectedTools.map((tool) => (
                      <span
                        key={`${tool.type}:${tool.id}`}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs text-slate-700"
                      >
                        {getToolOptionLabel(tool)}
                        <button
                          type="button"
                          className="text-slate-500 hover:text-slate-900"
                          onClick={() => handleRemoveTool(tool)}
                          disabled={isLoading}
                          aria-label={`Remove ${getToolOptionLabel(tool)}`}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    {primaryLook ? (
                      <Button type="button" variant="outline" onClick={handleClearSingle} disabled={isLoading}>
                        Clear
                      </Button>
                    ) : null}
                    <Button type="submit" disabled={isLoading}>
                      {isLoading ? "Generating..." : "Generate Look"}
                    </Button>
                  </div>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
              </form>
            ) : activeMode === "travel" ? (
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

                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="outline" onClick={handleClearTravel} disabled={isLoading}>
                    Clear
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? "Building Plan..." : "Generate Travel Plan"}
                  </Button>
                  {(error || travelDateError) && <p className="text-sm text-red-600">{error || travelDateError}</p>}
                </div>
              </form>
            ) : activeMode === "selection" ? (
              <div className="space-y-5">
                {selectionLoadError && <p className="text-sm text-red-600">{selectionLoadError}</p>}
                {error && <p className="text-sm text-red-600">{error}</p>}

                {selectionGarments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
                    No garments selected yet. Open a garment, press `Cmd/Ctrl+K`, and use <span className="font-medium">Add To Changing Room</span>.
                  </div>
                ) : (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                      The Lineup ({selectionGarments.length}/{MAX_SELECTION_GARMENTS})
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {selectionGarments.map((garment) => (
                        <div
                          key={garment.id}
                          className="rounded-lg border bg-white p-3"
                        >
                          <div className="flex items-center gap-3">
                            <Link href={`/garments/${garment.id}`} className="relative h-20 w-20 overflow-hidden rounded-md bg-slate-100">
                              <Image
                                src={garment.file_name || "/placeholder.png"}
                                alt={`${garment.brand} ${garment.model}`}
                                fill
                                sizes="80px"
                                className="object-cover"
                              />
                            </Link>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-slate-900">{garment.model}</p>
                              <p className="truncate text-sm text-slate-700">{garment.brand}</p>
                              <p className="truncate text-xs uppercase tracking-wide text-slate-500">{garment.type}</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemoveFromSelection(garment.id)}
                              disabled={selectionActionBusy}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleClearSelection}
                        disabled={selectionActionBusy || selectionIds.length === 0}
                      >
                        Clear Selection
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void handleTryOnSelection()}
                        disabled={selectionActionBusy || selectionIds.length < 2 || selectionIds.length > MAX_SELECTION_GARMENTS}
                      >
                        {isSelectionLoading ? "Generating..." : "Try on me"}
                      </Button>
                    </div>
                  </div>
                )}

                {manualTryOnImageUrl && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Try-on Result</h3>
                    <LookTryOnCards
                      imageUrl={manualTryOnImageUrl}
                      imageAlt="Generated manual look try-on"
                      details={lookDetails}
                      lookTitle={manualLookTitle}
                      onLookTitleChange={setManualLookTitle}
                      onSave={() => void handleSaveManualLook()}
                      saveDisabled={selectionActionBusy || selectionIds.length < 2}
                      saveLabel={isSelectionLoading ? "Saving..." : "Save Look"}
                      onOpenImage={openTryOnImageModal}
                    />
                  </div>
                )}

              </div>
            ) : (
              <div className="space-y-3">
                {savedTabView === "list" ? (
                  <div className="flex items-center justify-between gap-2">
                    {savedLooksLoading && <span className="text-xs text-slate-500">Loading...</span>}
                  </div>
                ) : null}
                {savedLooksError && <p className="text-sm text-red-600">{savedLooksError}</p>}
                {savedPreviewLoadError && <p className="text-sm text-red-600">{savedPreviewLoadError}</p>}
                {error && <p className="text-sm text-red-600">{error}</p>}
                {savedTabView === "list" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setActiveMode("single")}
                      className="group flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-8 text-center transition hover:border-slate-400 hover:bg-slate-50"
                      aria-label="Add new look"
                    >
                      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-white text-2xl leading-none text-slate-700 transition group-hover:border-slate-500 group-hover:text-slate-900">
                        +
                      </span>
                      <p className="text-sm font-semibold text-slate-900">Add New Look</p>
                    </button>

                    {savedLooksLoading
                      ? Array.from({ length: 5 }).map((_, index) => (
                          <div key={`favorite-look-card-skeleton-${index}`} className="rounded-lg border bg-white px-3 py-7">
                            <Skeleton className="mx-auto aspect-[3/4] w-[86%] rounded-md" />
                            <div className="mt-3 flex justify-center">
                              <Skeleton className="h-4 w-40" />
                            </div>
                          </div>
                        ))
                      : savedManualLooks.map((savedLook) => (
                          <div key={savedLook.id} className="rounded-lg border bg-white px-3 py-7">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => openTryOnImageModal(savedLook.generatedImageUrl, savedLook.title)}
                                className="relative mx-auto block aspect-[3/4] w-[86%] cursor-zoom-in overflow-hidden rounded-md bg-slate-100"
                                aria-label={`Open ${savedLook.title} in full size`}
                              >
                                <Image
                                  src={savedLook.generatedImageUrl}
                                  alt={savedLook.title}
                                  fill
                                  sizes="(max-width: 1024px) 50vw, 33vw"
                                  className="object-cover"
                                />
                              </button>
                            </div>

                            <div className="mt-3 text-center">
                              <button
                                type="button"
                                onClick={() => void handleLoadSavedLookPreview(savedLook)}
                                className="max-w-full cursor-pointer truncate text-sm font-normal text-slate-900 hover:underline disabled:cursor-not-allowed"
                                disabled={savedTabBusy}
                              >
                                {savedLook.title}
                              </button>
                            </div>
                          </div>
                        ))}
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={handleBackToSavedLooksList}
                        className="text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline"
                      >
                        &larr; Back to Favorite Looks
                      </button>
                      {savedPreviewLoading ? <span className="text-xs text-slate-500">Loading preview...</span> : null}
                    </div>
                    {savedPreviewLoading ? (
                      <div className="space-y-5">
                        <div>
                          <div className="mb-2">
                            <Skeleton className="h-4 w-36" />
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            {Array.from({ length: 4 }).map((_, index) => (
                              <div key={`saved-lineup-skeleton-${index}`} className="rounded-lg border bg-white p-3">
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

                        <div className="space-y-3">
                          <Skeleton className="h-4 w-28" />
                          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1fr)]">
                            <div className="rounded-lg border bg-white p-3">
                              <Skeleton className="h-[440px] w-full rounded-md" />
                            </div>
                            <div className="rounded-lg border bg-white p-4">
                              <div className="space-y-4">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-4 w-16" />
                                <div className="flex flex-wrap gap-2">
                                  <Skeleton className="h-6 w-20 rounded-full" />
                                  <Skeleton className="h-6 w-24 rounded-full" />
                                </div>
                                <Skeleton className="h-4 w-20" />
                                <div className="flex flex-wrap gap-2">
                                  <Skeleton className="h-6 w-28 rounded-full" />
                                </div>
                                <Skeleton className="h-4 w-28" />
                                <div className="flex flex-wrap gap-2">
                                  <Skeleton className="h-6 w-36 rounded-full" />
                                  <Skeleton className="h-6 w-32 rounded-full" />
                                </div>
                                <Skeleton className="h-4 w-32" />
                                <div className="flex flex-wrap gap-2">
                                  <Skeleton className="h-6 w-40 rounded-full" />
                                  <Skeleton className="h-6 w-28 rounded-full" />
                                </div>
                              </div>
                            </div>
                            <div className="rounded-lg border bg-white p-4">
                              <div className="space-y-3">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-9 w-full rounded-md" />
                                <Skeleton className="h-10 w-full rounded-md" />
                                <Skeleton className="h-10 w-full rounded-md" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                            The Lineup ({savedPreviewGarments.length}/{MAX_SELECTION_GARMENTS})
                          </h3>
                          <div className="grid gap-3 md:grid-cols-2">
                            {savedPreviewGarments.map((garment) => (
                              <div
                                key={`saved-tab-lineup-${garment.id}`}
                                className="rounded-lg border bg-white p-3"
                              >
                                <div className="flex items-center gap-3">
                                  <Link href={`/garments/${garment.id}`} className="relative h-20 w-20 overflow-hidden rounded-md bg-slate-100">
                                    <Image
                                      src={garment.file_name || "/placeholder.png"}
                                      alt={`${garment.brand} ${garment.model}`}
                                      fill
                                      sizes="80px"
                                      className="object-cover"
                                    />
                                  </Link>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-slate-900">{garment.model}</p>
                                    <p className="truncate text-sm text-slate-700">{garment.brand}</p>
                                    <p className="truncate text-xs uppercase tracking-wide text-slate-500">{garment.type}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {savedPreviewImageUrl && (
                          <div className="space-y-3">
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Try-on Result</h3>
                            <LookTryOnCards
                              imageUrl={savedPreviewImageUrl}
                              imageAlt={savedPreviewTitle || "Saved look try-on preview"}
                              details={savedPreviewLookDetails}
                              lookTitle={savedPreviewTitle}
                              onLookTitleChange={setSavedPreviewTitle}
                              onSave={() => void handleSaveSavedPreviewLook()}
                              saveDisabled={
                                savedTabBusy ||
                                !savedPreviewImageUrl ||
                                !savedPreviewContext ||
                                savedPreviewGarments.length < 2
                              }
                              saveLabel={isSelectionLoading ? "Saving..." : "Save Look"}
                              onSecondaryAction={
                                savedPreviewLookId != null
                                  ? () => void handleDeleteSavedLook(savedPreviewLookId)
                                  : undefined
                              }
                              secondaryActionDisabled={savedTabBusy || savedPreviewLookId == null}
                              secondaryActionLabel={isSelectionLoading ? "Deleting..." : "Delete Look"}
                              secondaryActionClassName="w-full border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                              onOpenImage={openTryOnImageModal}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>

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

              <div className="space-y-3 rounded-lg border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Try-on Preview</h3>
                  <Button
                    type="button"
                    onClick={() => void handleTryOnSingleLook()}
                    disabled={isSingleTryOnLoading}
                  >
                    {isSingleTryOnLoading ? "Generating..." : "Try on me"}
                  </Button>
                </div>
                {singleTryOnImageUrl ? (
                  <LookTryOnCards
                    imageUrl={singleTryOnImageUrl}
                    imageAlt="Generated try-on preview"
                    details={singleTryOnLookDetails}
                    lookTitle={singleTryOnLookTitle}
                    onLookTitleChange={setSingleTryOnLookTitle}
                    onSave={() => void handleSaveSingleTryOnLook()}
                    saveDisabled={
                      isSingleTryOnLoading ||
                      singleTryOnSaving ||
                      !singleTryOnImageUrl ||
                      !singleTryOnContext ||
                      singleTryOnGarmentIds.length < 2
                    }
                    saveLabel={singleTryOnSaving ? "Saving..." : "Save Look"}
                    onOpenImage={openTryOnImageModal}
                  />
                ) : (
                  <p className="text-sm text-slate-600">
                    Generate a preview to see this Expert lineup on your profile body photo.
                  </p>
                )}
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

      <Dialog open={Boolean(expandedTryOnImageUrl)} onOpenChange={(open) => {
        if (!open) setExpandedTryOnImageUrl(null);
      }}>
        <DialogContent
          className="w-auto max-w-[90vw] border-none bg-transparent p-0 shadow-none sm:max-w-[90vw]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Try-on image full size</DialogTitle>
          <DialogDescription className="sr-only">
            Full-size try-on image preview.
          </DialogDescription>
          {expandedTryOnImageUrl ? (
            <div className="flex max-h-[88vh] items-center justify-center">
              <img
                src={expandedTryOnImageUrl}
                alt={expandedTryOnImageAlt}
                width={1024}
                height={1536}
                className="max-h-[88vh] w-auto max-w-[90vw] rounded-md object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
