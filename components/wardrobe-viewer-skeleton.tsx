"use client";

import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { FiFilter, FiHeart } from "react-icons/fi";

export default function WardrobeViewerSkeleton() {
  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Main Content Area (Skeleton) */}
      <div className="flex-1 p-4 flex flex-col items-center animate-pulse">
        {/* Filter Buttons (Skeleton) */}
        <div className="w-full flex justify-start mb-4 max-w-6xl mx-auto">
          <Button variant="outline" disabled>
            <FiFilter className="text-gray-400" />
          </Button>
          <Button variant="outline" disabled className="ml-2">
            <FiHeart className="text-gray-400" />
          </Button>
        </div>
        
        {/* Garment Grid (Skeleton) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-6 w-full max-w-6xl">
          {[...Array(9)].map((_, i) => (
            <Card key={i} className="flex flex-col items-center text-center">
              <CardContent className="flex flex-col items-center text-center">
                <div className="flex flex-col items-center justify-start p-4">
                  <div className="w-[400px] h-[400px] bg-gray-300 rounded"></div>
                </div>
                <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
                <div className="h-4 bg-gray-300 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}