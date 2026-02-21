import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { isAllowedOrigin } from "@/lib/request-origin";
import { upsertUserProfileBodyPhotoUrl } from "@/lib/user-profile";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const sanitizeOwnerKey = (ownerKey: string): string =>
  ownerKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "owner";

const extensionByType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }

    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const rawFile = formData.get("file");
    if (!(rawFile instanceof File)) {
      return NextResponse.json({ error: "Body photo file is required." }, { status: 400 });
    }

    if (!ALLOWED_CONTENT_TYPES.has(rawFile.type)) {
      return NextResponse.json({ error: "Body photo must be JPG, PNG, or WEBP." }, { status: 400 });
    }

    if (rawFile.size <= 0 || rawFile.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "Body photo must be smaller than 10MB." }, { status: 400 });
    }

    const ownerKey = getOwnerKey();
    const ext = extensionByType[rawFile.type] || "jpg";
    const blob = await put(
      `profile/body-photo/${sanitizeOwnerKey(ownerKey)}/${Date.now()}.${ext}`,
      rawFile,
      {
        access: "public",
        addRandomSuffix: true,
        contentType: rawFile.type,
      }
    );

    const profile = await upsertUserProfileBodyPhotoUrl({
      ownerKey,
      bodyPhotoUrl: blob.url,
    });

    return NextResponse.json({
      ok: true,
      bodyPhotoUrl: profile.bodyPhotoUrl,
      updatedAt: profile.updatedAt,
    });
  } catch (error) {
    console.error("Failed to upload profile body photo:", error);
    return NextResponse.json({ error: "Failed to upload body photo." }, { status: 500 });
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

    const ownerKey = getOwnerKey();
    const profile = await upsertUserProfileBodyPhotoUrl({
      ownerKey,
      bodyPhotoUrl: null,
    });

    return NextResponse.json({
      ok: true,
      bodyPhotoUrl: profile.bodyPhotoUrl,
      updatedAt: profile.updatedAt,
    });
  } catch (error) {
    console.error("Failed to remove profile body photo:", error);
    return NextResponse.json({ error: "Failed to remove body photo." }, { status: 500 });
  }
}
