import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { isAllowedOrigin } from "@/lib/request-origin";
import {
  deleteManualLookById,
  insertManualLook,
  listManualLooksByOwner,
} from "@/lib/manual-looks";

const saveManualLookSchema = z.object({
  title: z.string().trim().min(1).max(120),
  garmentIds: z.array(z.number().int().positive()).min(2).max(8),
  generatedImageUrl: z.string().url().max(2000),
  context: z.object({
    locationLabel: z.string().trim().min(1).max(160),
    weatherSummary: z.string().trim().min(1).max(320),
    weatherSource: z.enum(["live", "fallback"]),
  }).strict(),
}).strict();

const deleteManualLookSchema = z.object({
  id: z.number().int().positive(),
}).strict();

const dedupeIds = (ids: number[]): number[] => Array.from(new Set(ids));

export async function GET() {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ownerKey = getOwnerKey();
    const looks = await listManualLooksByOwner(ownerKey);
    return NextResponse.json({ looks });
  } catch (error) {
    console.error("Failed to load manual looks:", error);
    return NextResponse.json({ error: "Failed to load manual looks." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }

    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsed = saveManualLookSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid manual look payload." }, { status: 400 });
    }

    const ownerKey = getOwnerKey();
    const garmentIds = dedupeIds(parsed.data.garmentIds);
    if (garmentIds.length < 2 || garmentIds.length > 8) {
      return NextResponse.json({ error: "Manual look must include between 2 and 8 unique garments." }, { status: 400 });
    }

    const savedLook = await insertManualLook({
      ownerKey,
      title: parsed.data.title,
      garmentIds,
      generatedImageUrl: parsed.data.generatedImageUrl,
      locationLabel: parsed.data.context.locationLabel,
      weatherSummary: parsed.data.context.weatherSummary,
      weatherSource: parsed.data.context.weatherSource,
    });

    return NextResponse.json({ ok: true, savedLook });
  } catch (error) {
    console.error("Failed to save manual look:", error);
    return NextResponse.json({ error: "Failed to save manual look." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }

    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsed = deleteManualLookSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid delete payload." }, { status: 400 });
    }

    const ownerKey = getOwnerKey();
    const deleted = await deleteManualLookById({ ownerKey, id: parsed.data.id });
    if (!deleted) {
      return NextResponse.json({ error: "Manual look not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete manual look:", error);
    return NextResponse.json({ error: "Failed to delete manual look." }, { status: 500 });
  }
}
