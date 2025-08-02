import EditorForm from '@/components/editor-form';

export const metadata = {
  title: "My Wardrobe - New Garment",
};

export default async function AddGarmentPage() {
  return (
    <EditorForm isNewGarmentMode={true} />
  );
}
