'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Garment } from '@/lib/types';

export default function GarmentModalClient({ garment }: { garment: Garment }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);

  const onOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      router.back();
    }
  };

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
