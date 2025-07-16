"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { FiFilter } from 'react-icons/fi';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';

interface Garment {
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: any[]; // Simplified for viewer
  color_palette: string[];
  warmth_level: string;
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
}

interface Filters {
  brand: string[];
  type: string[];
  color_palette: string[];
  style: string[];
  material: string[];
}

interface AvailableFilterOption {
  value: string;
  count: number;
}

interface AvailableFilters {
  brand: AvailableFilterOption[];
  type: AvailableFilterOption[];
  color_palette: AvailableFilterOption[];
  style: AvailableFilterOption[];
  material: AvailableFilterOption[];
}

const emojiMap: { [key: string]: string } = {
  "Sweatshirt": "👕",
  "Shorts": "🩳",
  "Sneakers": "👟",
  "Loafers": "👞",
  "Selvedge Jeans": "👖",
  "Shirt": "👔",
  "Jeans": "👖",
  "Pants": "👖",
  "Polo Shirt": "👕",
  "T-shirt": "👕",
  "Blazer": "🧥",
  "Jacket": "🧥",
};

const colorMap: { [key: string]: string } = {
  "blue chambray": "#A7BCCB",
  "blue denim": "#3B5B7D",
  "bone": "#E0D8C7",
  "charcoal": "#36454F",
  "corduroy": "#625741", // A typical corduroy brown
  "dark brown": "#654321",
  "gum": "#8A7B6B",
  "heather grey": "#B0B0B0",
  "medium wash blue": "#5D8AA8",
  "off-white": "#F5F5DC",
  "olive green": "#6B8E23",
  "raw indigo": "#3F4B6B",
  "russet": "#80461B",
  "sage green": "#9DC183",
  "washed grey": "#A8A8A8",
  // Add any other non-standard colors here
};

export default function WardrobeViewerPage() {
  const [wardrobeData, setWardrobeData] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  const toggleFilterDrawer = () => {
    setIsFilterDrawerOpen(!isFilterDrawerOpen);
  };

  const handleClearFilters = () => {
    setSelectedFilters({
      brand: [],
      type: [],
      color_palette: [],
      style: [],
      material: [],
    });
  };
  const [selectedFilters, setSelectedFilters] = useState<Filters>({
    brand: [],
    type: [],
    color_palette: [],
    style: [],
    material: [],
  });
  const [availableFilters, setAvailableFilters] = useState<AvailableFilters>({
    brand: [],
    type: [],
    color_palette: [],
    style: [],
    material: [],
  });

  useEffect(() => {
    async function fetchData() {
      try {
        const wardrobeRes = await fetch('/api/wardrobe');

        if (!wardrobeRes.ok) throw new Error(`HTTP error! status: ${wardrobeRes.status} from /api/wardrobe`);

        const wardrobeJson: Garment[] = await wardrobeRes.json();
        const bodyPartOrder = ['Jacket', 'Sweatshirt', 'Shirt', 'Polo Shirt', 'T-shirt', 'Blazer', 'Selvedge Jeans', 'Jeans', 'Pants', 'Shorts', 'Loafers', 'Sneakers'];

        const sortedWardrobe = wardrobeJson.sort((a, b) => {
          const indexA = bodyPartOrder.indexOf(a.type);
          const indexB = bodyPartOrder.indexOf(b.type);

          // Handle types not in the defined order (place them at the end)
          if (indexA === -1 && indexB === -1) return 0;
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;

          return indexA - indexB;
        });
        setWardrobeData(sortedWardrobe);

        // Extract unique filter values
        const uniqueBrands = Array.from(new Set(wardrobeJson.map(g => g.brand)));
        const uniqueTypes = Array.from(new Set(wardrobeJson.map(g => g.type)));
        const uniqueColors = Array.from(new Set(wardrobeJson.flatMap(g => g.color_palette)));
        const uniqueStyles = Array.from(new Set(wardrobeJson.map(g => g.style)));
        const uniqueMaterials = Array.from(new Set(wardrobeJson.flatMap(g => g.material_composition.map(mc => mc.material))));

        const brandCounts = wardrobeJson.reduce((acc, garment) => {
          acc[garment.brand] = (acc[garment.brand] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const typeCounts = wardrobeJson.reduce((acc, garment) => {
          acc[garment.type] = (acc[garment.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const colorCounts = wardrobeJson.reduce((acc, garment) => {
          garment.color_palette.forEach(color => {
            acc[color] = (acc[color] || 0) + 1;
          });
          return acc;
        }, {} as Record<string, number>);

        const styleCounts = wardrobeJson.reduce((acc, garment) => {
          acc[garment.style] = (acc[garment.style] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const materialCounts = wardrobeJson.reduce((acc, garment) => {
          garment.material_composition.forEach(mc => {
            acc[mc.material] = (acc[mc.material] || 0) + 1;
          });
          return acc;
        }, {} as Record<string, number>);

        setAvailableFilters({
          brand: uniqueBrands.sort().map(b => ({ value: b, count: brandCounts[b] })),
          type: uniqueTypes.sort().map(t => ({ value: t, count: typeCounts[t] })),
          color_palette: uniqueColors.sort().map(c => ({ value: c, count: colorCounts[c] })),
          style: uniqueStyles.sort().map(s => ({ value: s, count: styleCounts[s] })),
          material: uniqueMaterials.sort().map(m => ({ value: m, count: materialCounts[m] })),
        });

      } catch (e: any) {
        setError(e.message);
        console.error('Error fetching data:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleFilterChange = (category: keyof Filters, value: string) => {
    setSelectedFilters(prevFilters => {
      const currentCategoryFilters = prevFilters[category];
      if (currentCategoryFilters.includes(value)) {
        // Remove filter
        return {
          ...prevFilters,
          [category]: currentCategoryFilters.filter(item => item !== value),
        };
      } else {
        // Add filter
        return {
          ...prevFilters,
          [category]: [...currentCategoryFilters, value],
        };
      }
    });
  };

  const filteredWardrobe = useMemo(() => {
    if (selectedFilters.brand.length === 0 && selectedFilters.type.length === 0 && selectedFilters.color_palette.length === 0 && selectedFilters.style.length === 0 && selectedFilters.material.length === 0) {
      return wardrobeData;
    }

    return wardrobeData.filter(garment => {
      const matchesBrand = selectedFilters.brand.length === 0 || selectedFilters.brand.includes(garment.brand);
      const matchesType = selectedFilters.type.length === 0 || selectedFilters.type.includes(garment.type);
      const matchesColor = selectedFilters.color_palette.length === 0 || selectedFilters.color_palette.some(color => garment.color_palette.includes(color));
      const matchesStyle = selectedFilters.style.length === 0 || selectedFilters.style.includes(garment.style);
      const matchesMaterial = selectedFilters.material.length === 0 || selectedFilters.material.some(material => garment.material_composition.some(mc => mc.material === material));
      return matchesBrand && matchesType && matchesColor && matchesStyle && matchesMaterial;
    });
  }, [wardrobeData, selectedFilters]);

  const isAnyFilterSelected = useMemo(() => {
    return Object.values(selectedFilters).some(filterArray => filterArray.length > 0);
  }, [selectedFilters]);

  if (loading) return <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 relative">Loading...</div>;
  if (error) return <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 relative text-red-500">Error: {error}</div>;
  if (wardrobeData.length === 0) return <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 relative">No wardrobe items found.</div>;

  return (
    <div className="min-h-screen bg-gray-100 flex">
      

      {/* Side Navigation Bar (Drawer) */}
      <div className={`fixed inset-y-0 left-0 w-1/5 bg-gray-200 border-r border-gray-300 transform transition-transform duration-300 ease-in-out ${isFilterDrawerOpen ? 'translate-x-0' : '-translate-x-full'} z-20 overflow-y-auto`}>
        
        <div className="px-4 mb-4 mt-4" style={{ minHeight: '40px' }}> {/* Approximate height of the button */}
          {isAnyFilterSelected && (
            <Button variant="secondary" onClick={handleClearFilters} className="w-full">
              Clear Filters
            </Button>
          )}
        </div>
        <Accordion type="multiple" className="w-full px-4">
          {Object.entries(availableFilters).map(([category, values]) => (
            <AccordionItem key={category} value={category}>
              <AccordionTrigger className="capitalize">
                {category === 'color_palette' ? 'Color' : category === 'material' ? 'Material' : category}
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col space-y-2">
                  {values.map((filterOption: AvailableFilterOption) => (
                    <Button
                      key={filterOption.value}
                      variant={selectedFilters[category as keyof Filters].includes(filterOption.value) ? "default" : "outline"}
                      onClick={() => handleFilterChange(category as keyof Filters, filterOption.value)}
                      className="justify-between"
                    >
                      <span>
                        {category === 'color_palette' && (
                          <div
                            className="inline-block w-4 h-4 rounded-full mr-2 border border-gray-300"
                            style={{ backgroundColor: colorMap[filterOption.value] || filterOption.value.toLowerCase().replace(/ /g, '') }}
                          />
                        )}
                        {category === 'type' && emojiMap[filterOption.value] && (
                          <span className="mr-2">{emojiMap[filterOption.value]}</span>
                        )}
                        {filterOption.value}
                      </span>
                      <span className="ml-2 text-gray-500">({filterOption.count})</span>
                    </Button>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* Main Content Area */}
      <div className={`flex-1 p-4 flex flex-col items-center transition-all duration-300 ease-in-out ${isFilterDrawerOpen ? 'ml-[20%]' : 'ml-0'}`}>
        {/* Filter Button */}
        <div className="w-full flex justify-start mb-4 max-w-6xl mx-auto">
          <Button variant="outline" onClick={toggleFilterDrawer}>
            <FiFilter />
          </Button>
        </div>
        

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-6 w-full max-w-6xl">
          {filteredWardrobe.map((garment) => (
            <Card key={garment.file_name} className="flex flex-col items-center text-center">
              <CardContent className="flex flex-col items-center text-center">
                <div className="flex flex-col items-center justify-start p-4">
                  <Image
                    key={garment.file_name}
                    src={garment.file_name}
                    alt={garment.model}
                    width={400}
                    height={400}
                    objectFit="contain"
                  />
                </div>
                <p className="text-sm text-gray-600">{garment.model} {garment.type} by {garment.brand}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
