import { NextResponse } from "next/server";
import { z } from "zod";

import { isOwnerSession, getOwnerKey } from "@/lib/owner";
import { isAllowedOrigin } from "@/lib/request-origin";
import { getUserProfileByOwnerKey, upsertUserProfileDefaultLocation } from "@/lib/user-profile";

const profileUpdateSchema = z.object({
  defaultLocation: z.string().trim().max(160).nullable(),
}).strict();

export async function GET() {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ownerKey = getOwnerKey();
    const profile = await getUserProfileByOwnerKey(ownerKey);

    return NextResponse.json({
      defaultLocation: profile?.defaultLocation ?? null,
      updatedAt: profile?.updatedAt ?? null,
    });
  } catch (error) {
    console.error("Failed to load profile:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
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
    const parsed = profileUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid profile payload" }, { status: 400 });
    }

    const ownerKey = getOwnerKey();
    const profile = await upsertUserProfileDefaultLocation({
      ownerKey,
      defaultLocation: parsed.data.defaultLocation,
    });

    return NextResponse.json({
      ok: true,
      defaultLocation: profile.defaultLocation,
      updatedAt: profile.updatedAt,
    });
  } catch (error) {
    console.error("Failed to update profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
