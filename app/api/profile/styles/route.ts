import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { isAllowedOrigin } from "@/lib/request-origin";
import {
  getActiveStyleCatalogOptions,
  getUserProfileSelectedStyles,
  replaceUserProfileSelectedStyleKeys,
} from "@/lib/profile-styles";

const updateProfileStylesSchema = z.object({
  selectedStyleKeys: z.array(z.string().trim().min(1).max(80)).max(24),
}).strict();

export async function GET() {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ownerKey = getOwnerKey();
    const [catalog, selectedStyles] = await Promise.all([
      getActiveStyleCatalogOptions(),
      getUserProfileSelectedStyles(ownerKey),
    ]);

    return NextResponse.json({
      catalog,
      selectedStyles,
      selectedStyleKeys: selectedStyles.map((style) => style.key),
    });
  } catch (error) {
    console.error("Failed to load profile styles:", error);
    return NextResponse.json({ error: "Failed to load profile styles" }, { status: 500 });
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
    const parsed = updateProfileStylesSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid profile styles payload" }, { status: 400 });
    }

    const ownerKey = getOwnerKey();
    const selectedStyles = await replaceUserProfileSelectedStyleKeys({
      ownerKey,
      styleKeys: parsed.data.selectedStyleKeys,
    });

    return NextResponse.json({
      ok: true,
      selectedStyles,
      selectedStyleKeys: selectedStyles.map((style) => style.key),
    });
  } catch (error) {
    console.error("Failed to update profile styles:", error);
    return NextResponse.json({ error: "Failed to update profile styles" }, { status: 500 });
  }
}
