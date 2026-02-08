"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

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

export default function AiLookClient() {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiLookResponse | null>(null);

  const handleGenerate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError("Please describe the look you want.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai-look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || "Failed to generate a look.");
        setResult(null);
        return;
      }

      setResult(data as AiLookResponse);
    } catch {
      setError("Unexpected network error while generating the look.");
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setPrompt("");
    setError(null);
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>AI Look Recommender</CardTitle>
            <CardDescription>
              Describe what you need and get one complete look picked strictly from your wardrobe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="space-y-4">
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
                <Button type="button" variant="outline" onClick={handleClear} disabled={isLoading}>
                  Clear
                </Button>
                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
            </form>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>{result.lookName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Accordion type="single" collapsible className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4">
                <AccordionItem value="details" className="border-none">
                  <AccordionTrigger className="text-sm font-medium">
                    Confidence and Intent Details
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm text-slate-700">
                    <p>
                      Confidence: {result.confidence}% (match: {result.matchScore}%, model: {result.modelConfidence}%)
                    </p>
                    {result.interpretedIntent && (
                      <p>
                        Weather: {result.interpretedIntent.weather.join(", ") || "Any"} | Occasion:{" "}
                        {result.interpretedIntent.occasion.join(", ") || "Any"} | Place:{" "}
                        {result.interpretedIntent.place.join(", ") || "Any"} | Time:{" "}
                        {result.interpretedIntent.timeOfDay.join(", ") || "Any"} | Formality:{" "}
                        {result.interpretedIntent.formality || "Any"} | Style:{" "}
                        {result.interpretedIntent.style.join(", ") || "Any"}
                      </p>
                    )}
                    {result.weatherContext && (
                      <p>
                        <span className="font-medium">Live Weather:</span> {result.weatherContext}
                      </p>
                    )}
                    {result.weatherContextStatus === "failed" && !result.weatherContext && (
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
                  {result.lineup.map((garment) => (
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
                <p className="text-sm leading-6 text-slate-800">{result.rationale}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
