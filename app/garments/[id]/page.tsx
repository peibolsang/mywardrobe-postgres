"use client";

import React, { useEffect, useState } from 'react';
import Image from 'next/image';

interface Garment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: any[];
  color_palette: string[];
  warmth_level: string;
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
}

export default function GarmentPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const [garment, setGarment] = useState<Garment | null>(null);

  useEffect(() => {
    const fetchGarment = async () => {
      const response = await fetch('/wardrobe.json');
      const data: Garment[] = await response.json();
      const foundGarment = data.find(g => g.id === parseInt(params.id));
      setGarment(foundGarment || null);
    };

    fetchGarment();
  }, [params.id]);

  if (!garment) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">{garment.model} by {garment.brand}</h1>
      <div className="relative w-full max-w-2xl h-[600px]">
        <Image
          src={garment.file_name}
          alt={garment.model}
          fill
          style={{ objectFit: "contain" }}
          className="rounded-lg shadow-lg"
        />
      </div>
      <div className="mt-8 text-lg text-gray-700 max-w-2xl text-center">
        <p><strong>Type:</strong> {garment.type}</p>
        <p><strong>Style:</strong> {garment.style}</p>
        <p><strong>Formality:</strong> {garment.formality}</p>
        <p><strong>Color:</strong> {garment.color_palette.join(', ')}</p>
        <p className="mt-4">{garment.features}</p>
      </div>
    </div>
  );
}
