"use client";

import { useState } from 'react';
import { FiHeart } from 'react-icons/fi';
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react"; // Assuming lucide-react is available for spinner

interface FavoriteButtonProps {
  isFavorite: boolean;
  onClick: () => Promise<void>; // onClick is now expected to be async
}

export function FavoriteButton({ isFavorite, onClick }: FavoriteButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    await onClick();
    setIsLoading(false);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-4 right-4 text-gray-400 hover:text-red-500 cursor-pointer"
      onClick={handleClick}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FiHeart fill={isFavorite ? 'red' : 'none'} />
      )}
    </Button>
  );
}
