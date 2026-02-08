'use client';
import { useState } from 'react';
import { FiHeart } from 'react-icons/fi';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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

const colorMap: Record<string, string> = {
  'blue chambray': '#A7BCCB',
  'blue denim': '#3B5B7D',
  bone: '#E0D8C7',
  charcoal: '#36454F',
  corduroy: '#625741',
  'dark brown': '#654321',
  gum: '#8A7B6B',
  'heather grey': '#B0B0B0',
  'medium wash blue': '#5D8AA8',
  'off-white': '#F5F5DC',
  'olive green': '#6B8E23',
  'raw indigo': '#3F4B6B',
  russet: '#80461B',
  'sage green': '#9DC183',
  'washed grey': '#A8A8A8',
};

export default function GarmentDetailsClient({ garment, schema }: { garment: Garment; schema: Schema }) {
  const [isImageOpen, setIsImageOpen] = useState(false);
  const schemaProperties = schema.items.properties;

  const joinOrFallback = (values: string[] | undefined, fallback: string) =>
    Array.isArray(values) && values.length > 0 ? values.join(', ') : fallback;

  const sortedMaterials = [...(garment.material_composition ?? [])].sort((a, b) => b.percentage - a.percentage);
  const colors = garment.color_palette ?? [];
  const primaryMaterial = sortedMaterials[0]?.material ?? 'Material N/A';

  return (
    <div className="box-border min-h-[calc(100dvh-65px)] bg-slate-100 p-4 md:p-6">
      <div className="mx-auto mb-4 w-full max-w-6xl">
        <Link href="/viewer" className="text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline">
          &larr; Back to Wardrobe
        </Link>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-20">
          <CardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-2xl">{garment.model}</CardTitle>
              {garment.favorite && <FiHeart fill="red" className="text-xl text-red-500" />}
            </div>
            <p className="text-sm text-slate-600">{garment.type} by {garment.brand}</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-white">{primaryMaterial}</span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">{garment.style || 'Style N/A'}</span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">{garment.formality || 'Formality N/A'}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-xl p-1">
              {garment.file_name ? (
                <>
                  <button
                    type="button"
                    className="block w-full cursor-zoom-in"
                    onClick={() => setIsImageOpen(true)}
                    aria-label={`Open larger image for ${garment.model}`}
                  >
                    <Image
                      src={garment.file_name}
                      alt={garment.model}
                      width={700}
                      height={700}
                      className="h-auto w-full object-contain"
                    />
                  </button>
                  <Dialog open={isImageOpen} onOpenChange={setIsImageOpen}>
                    <DialogContent className="max-w-[90vw] border-none bg-transparent p-0 shadow-none sm:max-w-[90vw]">
                      <DialogTitle className="sr-only">{garment.model} image preview</DialogTitle>
                      <DialogDescription className="sr-only">
                        Enlarged view of the garment image.
                      </DialogDescription>
                      <div className="flex max-h-[88vh] items-center justify-center">
                        <Image
                          src={garment.file_name}
                          alt={garment.model}
                          width={1400}
                          height={1400}
                          className="max-h-[88vh] w-auto max-w-[90vw] object-contain"
                        />
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              ) : (
                <div className="flex h-56 items-center justify-center rounded-lg border border-dashed text-sm text-slate-500">
                  No image available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">Model</Label>
                <p className="text-slate-900">{garment.model || 'Not set yet'}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">Brand</Label>
                <p className="text-slate-900">{garment.brand || 'Not set yet'}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">Type</Label>
                <p className="text-slate-900">{garment.type || 'Not set yet'}</p>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs uppercase tracking-wide text-slate-500">Features</Label>
                <p className="whitespace-pre-wrap text-slate-900">{garment.features || 'No features described yet.'}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Style & Formality</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">Style</Label>
                <p className="text-slate-900">{garment.style || 'Not set yet'}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">Formality</Label>
                <p className="text-slate-900">{garment.formality || 'Not set yet'}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Material & Color</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="mb-3 block text-xs uppercase tracking-wide text-slate-500">
                  Material Composition
                </Label>
                {sortedMaterials.length > 0 ? (
                  <div className="space-y-3">
                    {sortedMaterials.map((material: MaterialComposition) => (
                      <div key={`${material.material}-${material.percentage}`} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-900">{material.material}</span>
                          <span className="text-slate-600">{material.percentage}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200">
                          <div
                            className="h-2 rounded-full bg-slate-700"
                            style={{ width: `${Math.max(0, Math.min(material.percentage, 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No material composition assigned yet.</p>
                )}
              </div>

              <div>
                <Label className="mb-3 block text-xs uppercase tracking-wide text-slate-500">Color Palette</Label>
                {colors.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {colors.map((color) => (
                      <span
                        key={color}
                        className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-sm text-slate-800"
                      >
                        <span
                          className="h-3 w-3 rounded-full border border-slate-300"
                          style={{ backgroundColor: colorMap[color.toLowerCase()] || color.toLowerCase() }}
                        />
                        {color}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No colors assigned yet.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Suitability</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">
                  {schemaProperties.suitable_weather?.description ? 'Best For Weather' : 'Suitable Weather'}
                </Label>
                <p className="text-slate-900">{joinOrFallback(garment.suitable_weather, 'No weather profile assigned yet.')}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">
                  {schemaProperties.suitable_time_of_day?.description ? 'Best Time Of Day' : 'Suitable Time Of Day'}
                </Label>
                <p className="text-slate-900">{joinOrFallback(garment.suitable_time_of_day, 'No time-of-day profile assigned yet.')}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">Best Places</Label>
                <p className="text-slate-900">{joinOrFallback(garment.suitable_places, 'No places assigned yet.')}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-slate-500">Best Occasions</Label>
                <p className="text-slate-900">{joinOrFallback(garment.suitable_occasions, 'No occasions assigned yet.')}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
