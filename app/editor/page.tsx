import EditorForm from '../../components/editor-form';

interface MaterialComposition {
  material: string;
  percentage: number;
}

interface Garment {
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: MaterialComposition[];
  color_palette: string[];
  warmth_level: string;
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
}

interface SchemaProperty {
  type: string;
  description: string;
  items?: { type: string; properties?: any; required?: string[]; enum?: string[] };
  properties?: any;
  enum?: string[];
}

interface Schema {
  type: string;
  items: {
    type: string;
    properties: { [key: string]: SchemaProperty };
    required: string[];
  };
}

export default async function EditorPage() {
  let wardrobeData: Garment[] = [];
  let schemaData: Schema | null = null;
  let error: string | null = null;

  try {
    const wardrobeRes = await (await import('../api/wardrobe/route')).GET();
    const schemaRes = await (await import('../api/schema/route')).GET();

    wardrobeData = await wardrobeRes.json();
    schemaData = await schemaRes.json();

  } catch (e: any) {
    error = e.message;
    console.error('Error fetching data in EditorPage:', e);
  }

  if (error) return <div className="flex justify-center items-center min-h-screen text-red-500">Error: {error}</div>;
  if (!wardrobeData || wardrobeData.length === 0) return <div className="flex justify-center items-center min-h-screen">No wardrobe items found.</div>;
  if (!schemaData) return <div className="flex justify-center items-center min-h-screen text-red-500">Error: Schema data not found.</div>;

  return (
    <EditorForm initialWardrobeData={wardrobeData} initialSchemaData={schemaData} />
  );
}