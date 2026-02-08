import EditorForm from '@/components/editor-form';
import EditorFormSkeleton from '@/components/editor-form-skeleton';
import { getWardrobeData } from '@/lib/wardrobe';
import { sql } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Suspense } from 'react';
import { promises as fs } from "fs";
import path from "path";

export const metadata = {
  title: "My Wardrobe - New Garment",
};

export default async function AddGarmentPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const ownerEmail = process.env.EDITOR_OWNER_EMAIL?.toLowerCase();
  const email = session.user?.email?.toLowerCase();
  if (email !== ownerEmail) {
    notFound();
  }

  return (
    <Suspense fallback={<EditorFormSkeleton />}>
      <AddGarmentPageContent />
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

async function AddGarmentPageContent() {
  const { wardrobeData, schemaData, editorOptions } = await getInitialEditorData();

  return (
    <EditorForm
      isNewGarmentMode={true}
      initialWardrobeData={wardrobeData}
      initialSchemaData={schemaData}
      initialEditorOptions={editorOptions}
    />
  );
}
