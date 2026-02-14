import { auth } from "@/lib/auth";
import { getOwnerKey } from "@/lib/owner";
import { getActiveStyleCatalogOptions, getUserProfileSelectedStyles } from "@/lib/profile-styles";
import { getUserProfileByOwnerKey } from "@/lib/user-profile";
import { notFound, redirect } from "next/navigation";

import ProfileSettingsClient from "@/components/profile-settings-client";

export const metadata = {
  title: "My Wardrobe - Profile",
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect("/login");

  const ownerEmail = process.env.EDITOR_OWNER_EMAIL?.toLowerCase();
  const email = session.user?.email?.toLowerCase();
  if (email !== ownerEmail) {
    notFound();
  }

  let defaultLocation = "";
  let styleCatalog: Array<{
    key: string;
    name: string;
    canonicalStyle: string;
    description: string | null;
  }> = [];
  let selectedStyleKeys: string[] = [];
  try {
    const ownerKey = getOwnerKey();
    const [profile, catalog, selectedStyles] = await Promise.all([
      getUserProfileByOwnerKey(ownerKey),
      getActiveStyleCatalogOptions(),
      getUserProfileSelectedStyles(ownerKey),
    ]);
    defaultLocation = profile?.defaultLocation ?? "";
    styleCatalog = catalog;
    selectedStyleKeys = selectedStyles.map((style) => style.key);
  } catch (error) {
    console.warn("Failed to preload profile settings:", error);
  }

  return (
    <ProfileSettingsClient
      initialDefaultLocation={defaultLocation}
      initialStyleCatalog={styleCatalog}
      initialSelectedStyleKeys={selectedStyleKeys}
    />
  );
}
