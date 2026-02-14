import { NextResponse } from "next/server";

import { getOwnerKey, isOwnerSession } from "@/lib/owner";
import { getActiveReferenceDirectiveCatalog } from "@/lib/profile-references";

export async function GET() {
  try {
    if (!(await isOwnerSession())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ownerKey = getOwnerKey();
    const catalog = await getActiveReferenceDirectiveCatalog(ownerKey);

    return NextResponse.json({
      count: catalog.length,
      catalog,
    });
  } catch (error) {
    console.error("Failed to load profile reference catalog:", error);
    return NextResponse.json({ error: "Failed to load profile reference catalog" }, { status: 500 });
  }
}
