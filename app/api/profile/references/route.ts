import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { isAllowedOrigin } from "@/lib/request-origin";
import {
  deactivateUserProfileReferenceByKey,
  getUserProfileActiveReferences,
  getUserProfileReferenceToolOptions,
  upsertUserProfileReference,
} from "@/lib/profile-references";

const referenceUpsertSchema = z.object({
  key: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(160),
  sourceName: z.string().trim().max(160).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).min(1).max(48),
  styleBiasTags: z.array(z.string().trim().min(1).max(80)).min(1).max(16),
  silhouetteBiasTags: z.array(z.string().trim().min(1).max(80)).max(16),
  materialPrefer: z.array(z.string().trim().min(1).max(120)).max(24),
  materialAvoid: z.array(z.string().trim().min(1).max(120)).max(24),
  formalityBias: z.string().trim().min(1).max(80).nullable().optional(),
  schemaVersion: z.number().int().min(1).max(50).optional(),
  referencePayload: z.unknown().optional(),
}).strict();

const upsertReferenceRequestSchema = z.object({
  reference: referenceUpsertSchema,
}).strict();

const deleteReferenceRequestSchema = z.object({
  key: z.string().trim().min(1).max(120),
}).strict();

export async function GET() {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ownerKey = getOwnerKey();
    const [references, toolOptions] = await Promise.all([
      getUserProfileActiveReferences(ownerKey),
      getUserProfileReferenceToolOptions(ownerKey),
    ]);

    return NextResponse.json({
      references,
      toolOptions,
    });
  } catch (error) {
    console.error("Failed to load profile references:", error);
    return NextResponse.json({ error: "Failed to load profile references" }, { status: 500 });
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
    const parsed = upsertReferenceRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid profile references payload" }, { status: 400 });
    }

    const ownerKey = getOwnerKey();
    const savedReference = await upsertUserProfileReference({
      ownerKey,
      reference: parsed.data.reference,
    });
    if (!savedReference) {
      return NextResponse.json({ error: "Invalid reference data" }, { status: 400 });
    }

    const [references, toolOptions] = await Promise.all([
      getUserProfileActiveReferences(ownerKey),
      getUserProfileReferenceToolOptions(ownerKey),
    ]);

    return NextResponse.json({
      ok: true,
      savedReference,
      references,
      toolOptions,
    });
  } catch (error) {
    console.error("Failed to upsert profile reference:", error);
    return NextResponse.json({ error: "Failed to update profile reference" }, { status: 500 });
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
    const parsed = deleteReferenceRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid delete payload" }, { status: 400 });
    }

    const ownerKey = getOwnerKey();
    const deleted = await deactivateUserProfileReferenceByKey({
      ownerKey,
      key: parsed.data.key,
    });
    if (!deleted) {
      return NextResponse.json({ error: "Reference not found" }, { status: 404 });
    }

    const [references, toolOptions] = await Promise.all([
      getUserProfileActiveReferences(ownerKey),
      getUserProfileReferenceToolOptions(ownerKey),
    ]);

    return NextResponse.json({
      ok: true,
      references,
      toolOptions,
    });
  } catch (error) {
    console.error("Failed to delete profile reference:", error);
    return NextResponse.json({ error: "Failed to delete profile reference" }, { status: 500 });
  }
}
