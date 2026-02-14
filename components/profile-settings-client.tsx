"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ProfileSettingsClientProps {
  initialDefaultLocation: string;
  initialStyleCatalog: ProfileStyleOption[];
  initialSelectedStyleKeys: string[];
  initialReferences: ProfileReferenceOption[];
}

interface ProfileStyleOption {
  key: string;
  name: string;
  canonicalStyle: string;
  description: string | null;
}

interface ProfileReferenceOption {
  key: string;
  displayName: string;
  sourceName: string | null;
  aliases: string[];
  schemaVersion: number;
  styleBiasTags: string[];
  silhouetteBiasTags: string[];
  materialPrefer: string[];
  materialAvoid: string[];
  formalityBias: string | null;
}

type ProfileSection = "default-location" | "favorite-styles" | "menswear-references";

const STYLE_BIAS_OPTIONS = [
  "sporty",
  "minimalist",
  "preppy",
  "mod",
  "workwear",
  "outdoorsy",
  "vintage",
  "western",
  "classic",
] as const;

const FORMALITY_OPTIONS = [
  "Formal",
  "Business Formal",
  "Business Casual",
  "Elevated Casual",
  "Casual",
  "Technical",
] as const;

const dedupeStyleKeys = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedValue || seen.has(normalizedValue)) continue;
    seen.add(normalizedValue);
    result.push(normalizedValue);
  }
  return result;
};

const parseCommaSeparated = (value: string): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of value.split(",")) {
    const normalized = part.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const toCsv = (values: string[]): string => values.join(", ");

const normalizeReferenceKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

export default function ProfileSettingsClient({
  initialDefaultLocation,
  initialStyleCatalog,
  initialSelectedStyleKeys,
  initialReferences,
}: ProfileSettingsClientProps) {
  const [activeSection, setActiveSection] = useState<ProfileSection>("default-location");
  const [defaultLocation, setDefaultLocation] = useState(initialDefaultLocation);
  const [styleCatalog] = useState(initialStyleCatalog);
  const [selectedStyleKeys, setSelectedStyleKeys] = useState(
    dedupeStyleKeys(initialSelectedStyleKeys)
  );
  const [references, setReferences] = useState<ProfileReferenceOption[]>(initialReferences);

  const [editingReferenceKey, setEditingReferenceKey] = useState<string | null>(null);
  const [referenceDisplayName, setReferenceDisplayName] = useState("");
  const [referenceSourceName, setReferenceSourceName] = useState("");
  const [referenceAliasesInput, setReferenceAliasesInput] = useState("");
  const [referenceStyleBiasTags, setReferenceStyleBiasTags] = useState<string[]>([]);
  const [referenceSilhouetteInput, setReferenceSilhouetteInput] = useState("");
  const [referenceMaterialPreferInput, setReferenceMaterialPreferInput] = useState("");
  const [referenceMaterialAvoidInput, setReferenceMaterialAvoidInput] = useState("");
  const [referenceFormalityBias, setReferenceFormalityBias] = useState("");
  const [referenceSubmitAttempted, setReferenceSubmitAttempted] = useState(false);
  const [isReferenceFormOpen, setIsReferenceFormOpen] = useState(false);
  const [isSavingReference, setIsSavingReference] = useState(false);
  const [isDeletingReference, setIsDeletingReference] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const toggleStyleSelection = (styleKey: string) => {
    setSelectedStyleKeys((current) => {
      const normalizedKey = styleKey.trim().toLowerCase();
      if (!normalizedKey) return current;
      if (current.includes(normalizedKey)) {
        return current.filter((item) => item !== normalizedKey);
      }
      return [...current, normalizedKey];
    });
  };

  const resetReferenceForm = () => {
    setEditingReferenceKey(null);
    setReferenceDisplayName("");
    setReferenceSourceName("");
    setReferenceAliasesInput("");
    setReferenceStyleBiasTags([]);
    setReferenceSilhouetteInput("");
    setReferenceMaterialPreferInput("");
    setReferenceMaterialAvoidInput("");
    setReferenceFormalityBias("");
    setReferenceSubmitAttempted(false);
  };

  const onSave = () => {
    startTransition(async () => {
      try {
        const profileResponse = await fetch("/api/profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            defaultLocation: defaultLocation.trim() ? defaultLocation.trim() : null,
          }),
        });

        if (!profileResponse.ok) {
          const payload = (await profileResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || "Failed to update profile.");
        }

        const stylesResponse = await fetch("/api/profile/styles", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selectedStyleKeys,
          }),
        });

        if (!stylesResponse.ok) {
          const payload = (await stylesResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || "Failed to update profile styles.");
        }

        const profilePayload = (await profileResponse.json()) as { defaultLocation?: string | null };
        const stylesPayload = (await stylesResponse.json()) as { selectedStyleKeys?: string[] };
        setDefaultLocation(profilePayload.defaultLocation ?? "");
        setSelectedStyleKeys(dedupeStyleKeys(stylesPayload.selectedStyleKeys ?? selectedStyleKeys));
        toast.success("Profile updated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update profile.";
        toast.error(message);
      }
    });
  };

  const onEditReference = (reference: ProfileReferenceOption) => {
    setIsReferenceFormOpen(true);
    setEditingReferenceKey(reference.key);
    setReferenceDisplayName(reference.displayName);
    setReferenceSourceName(reference.sourceName ?? "");
    setReferenceAliasesInput(toCsv(reference.aliases));
    setReferenceStyleBiasTags(reference.styleBiasTags);
    setReferenceSilhouetteInput(toCsv(reference.silhouetteBiasTags));
    setReferenceMaterialPreferInput(toCsv(reference.materialPrefer));
    setReferenceMaterialAvoidInput(toCsv(reference.materialAvoid));
    setReferenceFormalityBias(reference.formalityBias ?? "");
    setReferenceSubmitAttempted(false);
  };

  const toggleReferenceStyleTag = (tag: string) => {
    setReferenceStyleBiasTags((current) => {
      if (current.includes(tag)) {
        return current.filter((item) => item !== tag);
      }
      return [...current, tag];
    });
  };

  const onSaveReference = async () => {
    setReferenceSubmitAttempted(true);
    const displayName = referenceDisplayName.trim();
    const sourceName = referenceSourceName.trim();
    const key = editingReferenceKey ?? normalizeReferenceKey(displayName || sourceName);
    const aliases = parseCommaSeparated(referenceAliasesInput);
    const silhouetteBiasTags = parseCommaSeparated(referenceSilhouetteInput);
    const materialPrefer = parseCommaSeparated(referenceMaterialPreferInput);
    const materialAvoid = parseCommaSeparated(referenceMaterialAvoidInput);

    if (!displayName) {
      toast.error("Display name is required.");
      return;
    }

    if (!key) {
      toast.error("Could not derive a valid reference key.");
      return;
    }

    if (referenceStyleBiasTags.length === 0) {
      toast.error("Select at least one style bias tag.");
      return;
    }

    if (materialPrefer.length === 0) {
      toast.error("Add at least one material preference.");
      return;
    }

    if (!referenceFormalityBias.trim()) {
      toast.error("Select a formality bias.");
      return;
    }

    const aliasPayload = aliases.length > 0
      ? aliases
      : [displayName, sourceName, key.replace(/_/g, " "), key].filter(Boolean);

    setIsSavingReference(true);
    try {
      const response = await fetch("/api/profile/references", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reference: {
            key,
            displayName,
            sourceName: sourceName || null,
            aliases: aliasPayload,
            styleBiasTags: referenceStyleBiasTags,
            silhouetteBiasTags,
            materialPrefer,
            materialAvoid,
            formalityBias: referenceFormalityBias.trim(),
            schemaVersion: 1,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        references?: ProfileReferenceOption[];
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save reference profile.");
      }

      if (Array.isArray(payload?.references)) {
        setReferences(payload.references);
      }
      resetReferenceForm();
      setIsReferenceFormOpen(false);
      toast.success("Reference saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save reference profile.";
      toast.error(message);
    } finally {
      setIsSavingReference(false);
    }
  };

  const onDeleteReference = async (reference: ProfileReferenceOption) => {
    const confirmed = window.confirm(`Delete reference \"${reference.displayName}\"?`);
    if (!confirmed) return;

    setIsDeletingReference(reference.key);
    try {
      const response = await fetch("/api/profile/references", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: reference.key }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        references?: ProfileReferenceOption[];
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete reference.");
      }

      if (Array.isArray(payload?.references)) {
        setReferences(payload.references);
      }
      if (editingReferenceKey === reference.key) {
        resetReferenceForm();
        setIsReferenceFormOpen(false);
      }
      toast.success("Reference deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete reference.";
      toast.error(message);
    } finally {
      setIsDeletingReference(null);
    }
  };

  const hasReferenceDisplayName = referenceDisplayName.trim().length > 0;
  const hasReferenceStyleBias = referenceStyleBiasTags.length > 0;
  const hasReferenceMaterialPrefer = parseCommaSeparated(referenceMaterialPreferInput).length > 0;
  const hasReferenceFormalityBias = referenceFormalityBias.trim().length > 0;
  const referenceCompletionCount =
    Number(hasReferenceDisplayName) +
    Number(hasReferenceStyleBias) +
    Number(hasReferenceMaterialPrefer) +
    Number(hasReferenceFormalityBias);
  const canSaveReference =
    hasReferenceDisplayName &&
    hasReferenceStyleBias &&
    hasReferenceMaterialPrefer &&
    hasReferenceFormalityBias &&
    !isSavingReference;

  const openReferenceFormForNew = () => {
    resetReferenceForm();
    setIsReferenceFormOpen(true);
  };

  const closeReferenceForm = () => {
    resetReferenceForm();
    setIsReferenceFormOpen(false);
  };

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-gray-50 px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>User Profile</CardTitle>
            <CardDescription>
              Manage profile defaults used by AI Look.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[190px_minmax(0,1fr)]">
            <nav className="flex gap-2 md:flex-col md:border-r md:pr-4">
              <Button
                type="button"
                variant={activeSection === "default-location" ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => setActiveSection("default-location")}
                disabled={isPending}
              >
                Default Location
              </Button>
              <Button
                type="button"
                variant={activeSection === "favorite-styles" ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => setActiveSection("favorite-styles")}
                disabled={isPending}
              >
                Favorite Styles
              </Button>
              <Button
                type="button"
                variant={activeSection === "menswear-references" ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => setActiveSection("menswear-references")}
                disabled={isPending}
              >
                Menswear References
              </Button>
            </nav>

            <div className="space-y-4">
              {activeSection === "default-location" ? (
                <div className="space-y-2">
                  <Label htmlFor="default-location">Default Location</Label>
                  <p className="text-xs text-muted-foreground">
                    Used for AI Look weather when your prompt does not include a location.
                  </p>
                  <Input
                    id="default-location"
                    placeholder="Example: Barcelona, Spain"
                    value={defaultLocation}
                    onChange={(event) => setDefaultLocation(event.target.value)}
                    maxLength={160}
                  />
                </div>
              ) : null}

              {activeSection === "favorite-styles" ? (
                <div className="space-y-2">
                  <Label>Favorite Styles</Label>
                  <p className="text-xs text-muted-foreground">
                    Selected styles appear in `Add Tool &gt; Style` and are applied as top-priority style directives.
                  </p>
                  {styleCatalog.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Style catalog is empty. Run `scripts/sql/create-profile-style-catalog.sql` to seed it.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {styleCatalog.map((style) => {
                        const checked = selectedStyleKeys.includes(style.key.toLowerCase());
                        return (
                          <label
                            key={style.key}
                            className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={checked}
                              onChange={() => toggleStyleSelection(style.key)}
                              disabled={isPending}
                            />
                            <span className="space-y-1">
                              <span className="block text-sm font-medium text-slate-900">{style.name}</span>
                              {style.description ? (
                                <span className="block text-xs text-muted-foreground">{style.description}</span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              {activeSection === "menswear-references" ? (
                <div className="flex flex-col gap-5">
                  <div className="order-2 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">Saved References</h3>
                        <p className="text-sm text-muted-foreground">{references.length} references saved</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={openReferenceFormForNew}
                        disabled={isSavingReference}
                      >
                        Add New
                      </Button>
                    </div>

                    {references.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No saved references yet.
                      </p>
                    ) : (
                      <div className="grid gap-3">
                        {references.map((reference) => (
                          <div
                            key={reference.key}
                            className={cn(
                              "space-y-3 rounded-md border border-slate-200 bg-white px-3 py-3",
                              editingReferenceKey === reference.key ? "border-slate-900 ring-1 ring-slate-900/15" : ""
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{reference.displayName}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() => onEditReference(reference)}
                                  disabled={isSavingReference || isDeletingReference === reference.key}
                                  aria-label={`Edit ${reference.displayName}`}
                                  title={`Edit ${reference.displayName}`}
                                >
                                  <Pencil />
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() => onDeleteReference(reference)}
                                  disabled={isSavingReference || isDeletingReference === reference.key}
                                  aria-label={
                                    isDeletingReference === reference.key
                                      ? `Deleting ${reference.displayName}`
                                      : `Delete ${reference.displayName}`
                                  }
                                  title={`Delete ${reference.displayName}`}
                                  className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Style Bias</p>
                                {reference.styleBiasTags.length > 0 ? (
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {reference.styleBiasTags.map((tag) => (
                                      <span
                                        key={`${reference.key}-${tag}`}
                                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs text-slate-700">None</p>
                                )}
                              </div>
                              <div>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Formality Bias</p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                    {reference.formalityBias || "None"}
                                  </span>
                                </div>
                              </div>
                            </div>

                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {isReferenceFormOpen ? (
                    <Card className="order-1 gap-3 border-slate-200">
                      <CardHeader className="space-y-1 pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <CardTitle className="text-base">
                              {editingReferenceKey ? "Edit Menswear Reference" : "Add Menswear Reference"}
                            </CardTitle>
                            <CardDescription>
                              Fill required fields first, then expand optional fields if needed.
                            </CardDescription>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={closeReferenceForm}
                            disabled={isSavingReference}
                          >
                            {editingReferenceKey ? "Cancel edit" : "Close"}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Required fields complete: {referenceCompletionCount}/4
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-1">
                          <Label htmlFor="ref-display-name">
                            Display Name <span className="text-red-600">*</span>
                          </Label>
                          <Input
                            id="ref-display-name"
                            value={referenceDisplayName}
                            onChange={(event) => setReferenceDisplayName(event.target.value)}
                            placeholder="Example: Aaron Levine"
                            maxLength={160}
                            disabled={isSavingReference}
                            className={cn(
                              referenceSubmitAttempted && !hasReferenceDisplayName ? "border-red-400 focus-visible:ring-red-300" : ""
                            )}
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label>
                              Style Bias <span className="text-red-600">*</span>
                            </Label>
                            <span className="text-xs text-muted-foreground">
                              {referenceStyleBiasTags.length} selected
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {STYLE_BIAS_OPTIONS.map((styleOption) => {
                              const selected = referenceStyleBiasTags.includes(styleOption);
                              return (
                                <button
                                  key={styleOption}
                                  type="button"
                                  onClick={() => toggleReferenceStyleTag(styleOption)}
                                  disabled={isSavingReference}
                                  className={cn(
                                    "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                                    selected
                                      ? "border-slate-900 bg-slate-900 text-white"
                                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                  )}
                                >
                                  {styleOption}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {referenceSubmitAttempted && (
                          !hasReferenceDisplayName ||
                          !hasReferenceStyleBias ||
                          !hasReferenceMaterialPrefer ||
                          !hasReferenceFormalityBias
                        ) ? (
                          <p className="text-xs text-red-600">
                            Complete all required fields before saving: Display Name, Style Bias, Material Preference, and Formality Bias.
                          </p>
                        ) : null}

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor="ref-material-prefer" className="flex min-h-10 items-end">
                              Material Preference (comma separated) <span className="ml-1 text-red-600">*</span>
                            </Label>
                            <Input
                              id="ref-material-prefer"
                              value={referenceMaterialPreferInput}
                              onChange={(event) => setReferenceMaterialPreferInput(event.target.value)}
                              placeholder="cotton, wool, denim"
                              maxLength={500}
                              disabled={isSavingReference}
                              className={cn(
                                referenceSubmitAttempted && !hasReferenceMaterialPrefer ? "border-red-400 focus-visible:ring-red-300" : ""
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="ref-formality" className="flex min-h-10 items-end">
                              Formality Bias <span className="ml-1 text-red-600">*</span>
                            </Label>
                            <select
                              id="ref-formality"
                              value={referenceFormalityBias}
                              onChange={(event) => setReferenceFormalityBias(event.target.value)}
                              className={cn(
                                "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-1 focus-visible:outline-hidden",
                                referenceSubmitAttempted && !hasReferenceFormalityBias ? "border-red-400 focus-visible:ring-red-300" : ""
                              )}
                              disabled={isSavingReference}
                            >
                              <option value="">None</option>
                              {FORMALITY_OPTIONS.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <Accordion type="single" collapsible className="rounded-md border border-slate-200 px-3">
                          <AccordionItem value="advanced-fields" className="border-b-0">
                            <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                              Advanced Fields (Optional)
                            </AccordionTrigger>
                            <AccordionContent className="space-y-3 pt-1">
                              <div className="space-y-1">
                                <Label htmlFor="ref-source-name">Source Name</Label>
                                <Input
                                  id="ref-source-name"
                                  value={referenceSourceName}
                                  onChange={(event) => setReferenceSourceName(event.target.value)}
                                  placeholder="Optional raw source name"
                                  maxLength={160}
                                  disabled={isSavingReference}
                                />
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor="ref-aliases">Aliases (comma separated)</Label>
                                <Input
                                  id="ref-aliases"
                                  value={referenceAliasesInput}
                                  onChange={(event) => setReferenceAliasesInput(event.target.value)}
                                  placeholder="aaron levine, levine"
                                  maxLength={500}
                                  disabled={isSavingReference}
                                />
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor="ref-silhouette">Silhouette Bias (comma separated)</Label>
                                <Input
                                  id="ref-silhouette"
                                  value={referenceSilhouetteInput}
                                  onChange={(event) => setReferenceSilhouetteInput(event.target.value)}
                                  placeholder="relaxed, draped"
                                  maxLength={500}
                                  disabled={isSavingReference}
                                />
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor="ref-material-avoid">Material Avoid (comma separated)</Label>
                                <Input
                                  id="ref-material-avoid"
                                  value={referenceMaterialAvoidInput}
                                  onChange={(event) => setReferenceMaterialAvoidInput(event.target.value)}
                                  placeholder="polyester, nylon"
                                  maxLength={500}
                                  disabled={isSavingReference}
                                />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={resetReferenceForm}
                            disabled={isSavingReference}
                          >
                            Clear
                          </Button>
                          <Button
                            type="button"
                            onClick={onSaveReference}
                            disabled={!canSaveReference}
                          >
                            {isSavingReference ? "Saving..." : editingReferenceKey ? "Update Reference" : "Save Reference"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              ) : null}

              {activeSection !== "menswear-references" ? (
                <div className="flex justify-end">
                  <Button type="button" disabled={isPending} onClick={onSave}>
                    {isPending ? "Saving..." : "Save Profile"}
                  </Button>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
