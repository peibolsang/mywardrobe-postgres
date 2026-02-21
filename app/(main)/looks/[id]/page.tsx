import AiLookClient from "@/components/ai-look-client";
import { auth } from "@/lib/auth";
import { getManualLookById } from "@/lib/manual-looks";
import { getOwnerKey } from "@/lib/owner";
import { notFound, redirect } from "next/navigation";

interface LooksSavedDetailPageProps {
  params: Promise<{ id: string }>;
}

export const metadata = {
  title: "My Wardrobe - Favorite Look",
};

export default async function LooksSavedDetailPage({ params }: LooksSavedDetailPageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const ownerEmail = process.env.EDITOR_OWNER_EMAIL?.toLowerCase();
  const email = session.user?.email?.toLowerCase();
  if (email !== ownerEmail) {
    notFound();
  }

  const { id: rawId } = await params;
  const lookId = Number(rawId);
  if (!Number.isInteger(lookId) || lookId <= 0) {
    notFound();
  }

  const ownerKey = getOwnerKey();
  const look = await getManualLookById({ ownerKey, id: lookId });
  if (!look) {
    notFound();
  }

  return <AiLookClient initialSavedLookId={look.id} />;
}
