"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface ProfileSettingsClientProps {
  initialDefaultLocation: string;
  initialStyleCatalog: ProfileStyleOption[];
  initialSelectedStyleKeys: string[];
}

interface ProfileStyleOption {
  key: string;
  name: string;
  canonicalStyle: string;
  description: string | null;
}

type ProfileSection = "default-location" | "favorite-styles";

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

export default function ProfileSettingsClient({
  initialDefaultLocation,
  initialStyleCatalog,
  initialSelectedStyleKeys,
}: ProfileSettingsClientProps) {
  const [activeSection, setActiveSection] = useState<ProfileSection>("default-location");
  const [defaultLocation, setDefaultLocation] = useState(initialDefaultLocation);
  const [styleCatalog] = useState(initialStyleCatalog);
  const [selectedStyleKeys, setSelectedStyleKeys] = useState(
    dedupeStyleKeys(initialSelectedStyleKeys)
  );
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
              ) : (
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
              )}

              <div className="flex justify-end">
                <Button type="button" disabled={isPending} onClick={onSave}>
                  {isPending ? "Saving..." : "Save Profile"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
