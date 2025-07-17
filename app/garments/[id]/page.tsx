'use client';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';

interface MaterialComposition {
  material: string;
  percentage: number;
}

interface Garment {
  id: number;
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
  favorite?: boolean;
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

export default function GarmentPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const [garment, setGarment] = useState<Garment | null>(null);
  const [schemaData, setSchemaData] = useState<Schema | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const wardrobeRes = await fetch('/wardrobe.json');
      const wardrobeData: Garment[] = await wardrobeRes.json();
      const foundGarment = wardrobeData.find(g => g.id === parseInt(params.id));
      setGarment(foundGarment || null);

      const schemaRes = await fetch('/schema.json');
      const schemaJson: Schema = await schemaRes.json();
      setSchemaData(schemaJson);
    };

    fetchData();
  }, [params.id]);

  const renderReadOnlyField = (key: string, prop: SchemaProperty, value: any) => {
    const labelText = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    let displayValue;
    if (key === 'material_composition') {
      displayValue = (value as MaterialComposition[]).map(mc => `${mc.material} (${mc.percentage}%)`).join(', ');
    } else if (Array.isArray(value)) {
      displayValue = value.join(', ');
    } else {
      displayValue = value;
    }

    return (
      <div className="mb-4">
        <Label className="mb-1 block text-sm font-medium text-gray-700">{labelText}:</Label>
        <p className="text-gray-900">{displayValue || 'N/A'}</p>
      </div>
    );
  };

  if (!garment || !schemaData) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  const schemaProperties = schemaData.items.properties;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4">
       <div className="w-full max-w-5xl mb-4">
        <Link href="/viewer" className="text-blue-500 hover:underline">
          &larr; Back to My Wardrobe
        </Link>
      </div>
      <Card className="w-full max-w-5xl">
        <CardHeader>
          <CardTitle className="text-center text-2xl">{garment.model} {garment.type}, by {garment.brand}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="md:w-1/2 flex flex-col items-center justify-start p-4">
              {garment.file_name && (
                <Image
                  src={garment.file_name}
                  alt={garment.model}
                  width={400}
                  height={400}
                  objectFit="contain"
                />
              )}
            </div>

            <div className="md:w-1/2 p-4">
              <Accordion type="multiple" className="w-full">
                <AccordionItem value="basic-info">
                  <AccordionTrigger>Basic Information</AccordionTrigger>
                  <AccordionContent>
                    {renderReadOnlyField('model', schemaProperties.model, garment.model)}
                    {renderReadOnlyField('brand', schemaProperties.brand, garment.brand)}
                    {renderReadOnlyField('type', schemaProperties.type, garment.type)}
                    {renderReadOnlyField('features', schemaProperties.features, garment.features)}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="style-formality">
                  <AccordionTrigger>Style & Formality</AccordionTrigger>
                  <AccordionContent>
                    {renderReadOnlyField('style', schemaProperties.style, garment.style)}
                    {renderReadOnlyField('formality', schemaProperties.formality, garment.formality)}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="material-color">
                  <AccordionTrigger>Material & Color</AccordionTrigger>
                  <AccordionContent>
                    {renderReadOnlyField('material_composition', schemaProperties.material_composition, garment.material_composition)}
                    {renderReadOnlyField('color_palette', schemaProperties.color_palette, garment.color_palette)}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="suitability">
                  <AccordionTrigger>Suitability</AccordionTrigger>
                  <AccordionContent>
                    {renderReadOnlyField('warmth_level', schemaProperties.warmth_level, garment.warmth_level)}
                    {renderReadOnlyField('suitable_weather', schemaProperties.suitable_weather, garment.suitable_weather)}
                    {renderReadOnlyField('suitable_time_of_day', schemaProperties.suitable_time_of_day, garment.suitable_time_of_day)}
                    {renderReadOnlyField('suitable_places', schemaProperties.suitable_places, garment.suitable_places)}
                    {renderReadOnlyField('suitable_occasions', schemaProperties.suitable_occasions, garment.suitable_occasions)}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}