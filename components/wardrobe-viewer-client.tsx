"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { FiFilter, FiHeart, FiPlus } from 'react-icons/fi';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { cn } from '@/lib/utils';

interface Garment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: any[]; // Simplified for viewer
  color_palette: string[];
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
  favorite?: boolean;
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

interface WardrobeViewerClientProps {
  initialWardrobeData: Garment[];
  initialAvailableFilters: AvailableFilters;
  initialSelectedFilters: Filters;
  initialShowOnlyFavorites: boolean;
}

const emptyFilters = (): Filters => ({
  brand: [],
  type: [],
  color_palette: [],
  style: [],
  material: [],
});

const dedupeValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rawValue of values) {
    const value = String(rawValue ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }

  return deduped;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const AddNewGarmentCard = () => (
  <Link href="/add-garment" passHref>
    <Card className="flex flex-col items-center justify-center text-center relative bg-gray-200 hover:bg-gray-300 transition-colors duration-200 cursor-pointer h-full">
      <CardContent className="flex flex-col items-center justify-center text-center">
        <FiPlus className="text-6xl text-gray-500" />
        <p className="mt-2 text-sm text-gray-600">Add New Garment</p>
      </CardContent>
    </Card>
  </Link>
);

export default function WardrobeViewerClient({
  initialWardrobeData,
  initialAvailableFilters,
  initialSelectedFilters,
  initialShowOnlyFavorites,
}: WardrobeViewerClientProps) {
  const wardrobeData = initialWardrobeData;
  const availableFilters = initialAvailableFilters;
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<Filters>(initialSelectedFilters);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState<boolean>(initialShowOnlyFavorites);
  const selectedFiltersRef = useRef<Filters>(initialSelectedFilters);
  const showOnlyFavoritesRef = useRef<boolean>(initialShowOnlyFavorites);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const getFiltersFromUrl = useCallback(() => {
    const parseFilterValues = (key: keyof Filters): string[] => {
      const values = searchParams.getAll(key);
      if (values.length === 0) return [];
      if (values.length > 1) return dedupeValues(values);

      const singleValue = values[0].trim();
      if (!singleValue.includes(',')) {
        return singleValue ? [singleValue] : [];
      }

      // Backward compatibility with old comma-joined query format.
      if (typeof window !== 'undefined') {
        const encodedKey = encodeURIComponent(key);
        const rawQuery = window.location.search;
        const legacyPattern = new RegExp(`(?:\\?|&)${escapeRegex(encodedKey)}=[^&]*,[^&]*(?:&|$)`);
        const encodedCommaPattern = new RegExp(`(?:\\?|&)${escapeRegex(encodedKey)}=[^&]*%2C[^&]*(?:&|$)`, 'i');

        if (legacyPattern.test(rawQuery) && !encodedCommaPattern.test(rawQuery)) {
          return dedupeValues(singleValue.split(','));
        }
      }

      return singleValue ? [singleValue] : [];
    };

    const filters: Filters = {
      brand: parseFilterValues('brand'),
      type: parseFilterValues('type'),
      color_palette: parseFilterValues('color_palette'),
      style: parseFilterValues('style'),
      material: parseFilterValues('material'),
    };
    const favorites = searchParams.get('favorites') === 'true';
    return { filters, favorites };
  }, [searchParams]);

  useEffect(() => {
    selectedFiltersRef.current = selectedFilters;
  }, [selectedFilters]);

  useEffect(() => {
    showOnlyFavoritesRef.current = showOnlyFavorites;
  }, [showOnlyFavorites]);

  useEffect(() => {
    const { filters, favorites } = getFiltersFromUrl();
    selectedFiltersRef.current = filters;
    showOnlyFavoritesRef.current = favorites;
    setSelectedFilters(filters);
    setShowOnlyFavorites(favorites);
  }, [searchParams, getFiltersFromUrl]);

  const toggleFilterDrawer = () => {
    setIsFilterDrawerOpen(!isFilterDrawerOpen);
  };

  const updateUrl = useCallback((newFilters: Filters, newFavorites: boolean) => {
    const newSearchParams = new URLSearchParams();
    (Object.entries(newFilters) as Array<[keyof Filters, string[]]>).forEach(([key, values]) => {
      values.forEach((value) => newSearchParams.append(key, value));
    });
    if (newFavorites) {
      newSearchParams.set('favorites', 'true');
    }
    const query = newSearchParams.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }, [pathname, router]);

  const toggleShowOnlyFavorites = () => {
    const nextFavorites = !showOnlyFavoritesRef.current;
    showOnlyFavoritesRef.current = nextFavorites;
    setShowOnlyFavorites(nextFavorites);
    updateUrl(selectedFiltersRef.current, nextFavorites);
  };

  const handleClearFilters = () => {
    const resetFilters = emptyFilters();
    selectedFiltersRef.current = resetFilters;
    showOnlyFavoritesRef.current = false;
    setSelectedFilters(resetFilters);
    setShowOnlyFavorites(false);
    updateUrl(resetFilters, false);
  };

  const handleFilterChange = (category: keyof Filters, value: string) => {
    const currentCategoryFilters = selectedFiltersRef.current[category];
    let newCategoryFilters: string[];

    if (currentCategoryFilters.includes(value)) {
      newCategoryFilters = currentCategoryFilters.filter(item => item !== value);
    } else {
      newCategoryFilters = [...currentCategoryFilters, value];
    }

    const newFilters = {
      ...selectedFiltersRef.current,
      [category]: newCategoryFilters,
    };
    selectedFiltersRef.current = newFilters;
    setSelectedFilters(newFilters);
    updateUrl(newFilters, showOnlyFavoritesRef.current);
  };

  const filteredWardrobe = useMemo(() => {
    let wardrobe = wardrobeData;

    if (showOnlyFavorites) {
      wardrobe = wardrobe.filter(garment => garment.favorite);
    }

    if (selectedFilters.brand.length === 0 && selectedFilters.type.length === 0 && selectedFilters.color_palette.length === 0 && selectedFilters.style.length === 0 && selectedFilters.material.length === 0) {
      return wardrobe;
    }

    return wardrobe.filter(garment => {
      const matchesBrand = selectedFilters.brand.length === 0 || selectedFilters.brand.includes(garment.brand);
      const matchesType = selectedFilters.type.length === 0 || selectedFilters.type.includes(garment.type);
      const matchesColor = selectedFilters.color_palette.length === 0 || selectedFilters.color_palette.some(color => garment.color_palette.includes(color));
      const matchesStyle = selectedFilters.style.length === 0 || selectedFilters.style.includes(garment.style);
      const matchesMaterial = selectedFilters.material.length === 0 || selectedFilters.material.some(material => garment.material_composition.some(mc => mc.material === material));
      return matchesBrand && matchesType && matchesColor && matchesStyle && matchesMaterial;
    });
  }, [wardrobeData, selectedFilters, showOnlyFavorites]);

  const isAnyFilterSelected = useMemo(() => {
    const hasCategoryFilters = Object.values(selectedFilters).some(filterArray => filterArray.length > 0);
    return hasCategoryFilters || showOnlyFavorites;
  }, [selectedFilters, showOnlyFavorites]);

  return (
    <div className="min-h-screen bg-gray-100 flex">
      

      {/* Side Navigation Bar (Drawer) */}
      <div className={cn('fixed inset-y-0 left-0 w-1/5 bg-gray-200 border-r border-gray-300 transform transition-transform duration-300 ease-in-out z-20 overflow-y-auto', isFilterDrawerOpen ? 'translate-x-0' : '-translate-x-full')}>
        
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
      <div className={cn('flex-1 p-4 flex flex-col items-center transition-all duration-300 ease-in-out', isFilterDrawerOpen ? 'ml-[20%]' : 'ml-0')}>
        {/* Filter Button */}
        <div className="w-full flex justify-start mb-4 max-w-6xl mx-auto">
          <Button variant="outline" onClick={toggleFilterDrawer}>
            <FiFilter />
          </Button>
          <Button variant="outline" onClick={toggleShowOnlyFavorites} className="ml-2">
            <FiHeart fill={showOnlyFavorites ? 'red' : 'none'} className={cn('transition-colors', showOnlyFavorites ? 'text-red-500' : 'text-gray-500')} />
          </Button>
        </div>
        

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-6 w-full max-w-6xl">
          <AddNewGarmentCard />
          {filteredWardrobe.map((garment) => (
            <Card key={garment.id} className="flex flex-col items-center text-center relative">
              {garment.favorite && (
                <FiHeart fill="red" className="absolute top-4 right-4 text-red-500" />
              )}
              <CardContent className="flex flex-col items-center text-center">
                <div className="flex flex-col items-center justify-start p-4">
                  <Link href={`/garments/${garment.id}`} scroll={false}>
                    <Image
                      key={garment.file_name}
                      src={garment.file_name}
                      alt={garment.model}
                      width={400}
                      height={400}
                      className="cursor-pointer object-contain"
                    />
                  </Link>
                </div>
                <a href={`/garments/${garment.id}`} className="text-sm text-gray-600 hover:underline cursor-pointer">
                  <p>{garment.model} {garment.type} by {garment.brand}</p>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
