import EditorForm from '@/components/editor-form';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

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
    <EditorForm isNewGarmentMode={true} />
  );
}
