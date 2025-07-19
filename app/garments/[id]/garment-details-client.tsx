'use client';
import { FiHeart } from 'react-icons/fi';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { Garment, MaterialComposition } from '@/lib/types';

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

export default function GarmentDetailsClient({ garment, schema }: { garment: Garment; schema: Schema }) {
  const renderReadOnlyField = (key: string, prop: SchemaProperty, value: any) => {
    const labelText = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    let displayValue;
    if (key === 'material_composition' && Array.isArray(value)) {
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

  const schemaProperties = schema.items.properties;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4">
       <div className="w-full max-w-5xl mb-4">
        <Link href="/viewer" className="text-blue-500 hover:underline">
          &larr; Back to My Wardrobe
        </Link>
      </div>
      <Card className="w-full max-w-5xl relative">
        {garment.favorite && (
          <FiHeart fill="red" className="absolute top-4 right-4 text-red-500 text-2xl" />
        )}
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
