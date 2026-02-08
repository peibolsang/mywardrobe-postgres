import AiLookClient from "@/components/ai-look-client";
import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";

export const metadata = {
  title: "My Wardrobe - AI Look",
};

export default async function AiLookPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const ownerEmail = process.env.EDITOR_OWNER_EMAIL?.toLowerCase();
  const email = session.user?.email?.toLowerCase();
  if (email !== ownerEmail) {
    notFound();
  }

  return <AiLookClient />;
}
