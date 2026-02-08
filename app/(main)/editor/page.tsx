// app/editor/page.tsx
import EditorForm from "@/components/editor-form";
import EditorFormSkeleton from "@/components/editor-form-skeleton";
import { auth } from "@/lib/auth";
import { getWardrobeData } from "@/lib/wardrobe";
import { sql } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { Suspense } from "react";
import { promises as fs } from "fs";
import path from "path";

const OWNER_EMAIL = (process.env.EDITOR_OWNER_EMAIL)?.toLowerCase();

export const metadata = { title: "My Wardrobe - Editor" };

type SearchParamsRecord = Record<string, string | string[] | undefined>;

const parseGarmentId = (value: string | string[] | undefined): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export default async function EditorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsRecord>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const email = session.user?.email?.toLowerCase();
  if (email !== OWNER_EMAIL) {
    // pick ONE of these:
    // redirect("/");         // send them somewhere safe
    notFound();               // pretend the page doesn't exist
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialGarmentId = parseGarmentId(resolvedSearchParams.garmentId);

  return (
    <Suspense fallback={<EditorFormSkeleton />}>
      <EditorPageContent initialGarmentId={initialGarmentId} />
    </Suspense>
  );
}

async function getInitialEditorData() {
  const [wardrobeData, typesResult, materialsResult, colorsResult, schemaFile] = await Promise.all([
    getWardrobeData({ forceFresh: true }),
    sql`SELECT name FROM types ORDER BY name ASC`,
    sql`SELECT name FROM materials ORDER BY name ASC`,
    sql`SELECT name FROM colors ORDER BY name ASC`,
    fs.readFile(path.join(process.cwd(), "public", "schema.json"), "utf-8"),
  ]);

  return {
    wardrobeData,
    schemaData: JSON.parse(schemaFile),
    editorOptions: {
      types: typesResult.map((row: any) => row.name),
      materials: materialsResult.map((row: any) => row.name),
      colors: colorsResult.map((row: any) => row.name),
    },
  };
}

async function EditorPageContent({ initialGarmentId }: { initialGarmentId: number | null }) {
  const { wardrobeData, schemaData, editorOptions } = await getInitialEditorData();

  return (
    <EditorForm
      initialGarmentId={initialGarmentId}
      initialWardrobeData={wardrobeData}
      initialSchemaData={schemaData}
      initialEditorOptions={editorOptions}
    />
  );
}
