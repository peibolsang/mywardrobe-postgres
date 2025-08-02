import EditorForm from '@/components/editor-form';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = {
  title: "My Wardrobe - Editor",
};

export default async function EditorPage() {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  return (
    <EditorForm />
  );
}
