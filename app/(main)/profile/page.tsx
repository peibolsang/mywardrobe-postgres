import { auth } from "@/lib/auth";
import { getOwnerKey } from "@/lib/owner";
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
  try {
    const profile = await getUserProfileByOwnerKey(getOwnerKey());
    defaultLocation = profile?.defaultLocation ?? "";
  } catch (error) {
    console.warn("Failed to preload profile default location:", error);
  }

  return <ProfileSettingsClient initialDefaultLocation={defaultLocation} />;
}
