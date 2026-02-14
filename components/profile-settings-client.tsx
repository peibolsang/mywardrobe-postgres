"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface ProfileSettingsClientProps {
  initialDefaultLocation: string;
}

export default function ProfileSettingsClient({ initialDefaultLocation }: ProfileSettingsClientProps) {
  const [defaultLocation, setDefaultLocation] = useState(initialDefaultLocation);
  const [isPending, startTransition] = useTransition();

  const onSave = () => {
    startTransition(async () => {
      try {
        const response = await fetch("/api/profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            defaultLocation: defaultLocation.trim() ? defaultLocation.trim() : null,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || "Failed to update profile.");
        }

        const payload = (await response.json()) as { defaultLocation?: string | null };
        setDefaultLocation(payload.defaultLocation ?? "");
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
              Set your default location so AI Look can fetch weather without requiring place text in every prompt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-location">Default Location</Label>
              <Input
                id="default-location"
                placeholder="Example: Barcelona, Spain"
                value={defaultLocation}
                onChange={(event) => setDefaultLocation(event.target.value)}
                maxLength={160}
              />
              <p className="text-xs text-muted-foreground">
                Used for AI Look weather when your prompt does not include a location.
              </p>
            </div>

            <div className="flex justify-end">
              <Button type="button" disabled={isPending} onClick={onSave}>
                {isPending ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
