"use client";

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

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
  favorite?: boolean;
}

export default function GarmentModal({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const router = useRouter();
  const [garment, setGarment] = useState<Garment | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const fetchGarment = async () => {
      const response = await fetch('/wardrobe.json');
      const data: Garment[] = await response.json();
      const foundGarment = data.find(g => g.id === parseInt(params.id));
      setGarment(foundGarment || null);
    };

    fetchGarment();
  }, [params.id]);

  const onOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      router.back();
    }
  };

  if (!garment) {
    return null; // Or a loading spinner
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-4 overflow-hidden bg-transparent border-none shadow-none">
        <DialogTitle className="sr-only">Garment Image</DialogTitle>
        <DialogDescription className="sr-only">A larger view of the garment image.</DialogDescription>
        <div className="flex justify-center items-center w-full h-full">
          <Image
            src={garment.file_name}
            alt={garment.model}
            width={800}
            height={800}
            objectFit="contain"
            className="max-w-full max-h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
