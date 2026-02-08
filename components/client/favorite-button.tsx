"use client";

import { useState } from 'react';
import { FiHeart } from 'react-icons/fi';
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react"; // Assuming lucide-react is available for spinner
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  isFavorite: boolean;
  onClick: () => Promise<void>; // onClick is now expected to be async
  className?: string;
  showLabel?: boolean;
}

export function FavoriteButton({ isFavorite, onClick, className, showLabel = false }: FavoriteButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    await onClick();
    setIsLoading(false);
  };

  return (
    <Button
      variant={showLabel && isFavorite ? "default" : "outline"}
      size={showLabel ? "default" : "icon"}
      className={cn(showLabel && "justify-center gap-2", className)}
      onClick={handleClick}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <FiHeart
            fill={isFavorite ? 'currentColor' : 'none'}
            className={cn(
              "h-4 w-4",
              isFavorite ? "text-red-500" : "text-slate-600",
              showLabel && isFavorite && "text-white"
            )}
          />
          {showLabel && <span>{isFavorite ? "Favorited" : "Mark as Favorite"}</span>}
        </>
      )}
    </Button>
  );
}
