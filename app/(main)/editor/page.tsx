// app/editor/page.tsx
import EditorForm from "@/components/editor-form";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";

const OWNER_EMAIL = (process.env.EDITOR_OWNER_EMAIL)?.toLowerCase();

export const metadata = { title: "My Wardrobe - Editor" };

export default async function EditorPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const email = session.user?.email?.toLowerCase();
  if (email !== OWNER_EMAIL) {
    // pick ONE of these:
    // redirect("/");         // send them somewhere safe
    notFound();               // pretend the page doesn't exist
  }

  return <EditorForm />;
}
