"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Command as CommandPrimitive } from 'cmdk';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { FiFilter, FiHeart, FiPlus, FiSearch } from 'react-icons/fi';
import { ArrowLeft, CloudSun, Copy, Flower2, Leaf, Search, Snowflake, Sun } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from './ui/command';
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

type SeasonFilter = 'winter' | 'summer' | 'fall' | 'spring';
type PaletteView = 'search' | 'export-json';

const seasonQuickFilters: Array<{
  value: SeasonFilter;
  label: string;
  Icon: typeof Snowflake;
}> = [
  { value: 'winter', label: 'Winter Clothes', Icon: Snowflake },
  { value: 'summer', label: 'Summer Clothes', Icon: Sun },
  { value: 'fall', label: 'Fall Clothes', Icon: Leaf },
  { value: 'spring', label: 'Spring Clothes', Icon: Flower2 },
];

const seasonWeatherMap: Record<SeasonFilter, string[]> = {
  winter: ['all season', 'cold', 'cool'],
  summer: ['all season', 'hot', 'warm'],
  fall: ['all season', 'cool', 'mild', 'warm'],
  spring: ['all season', 'cool', 'mild', 'warm'],
};

const isSeasonFilter = (value: string | null): value is SeasonFilter =>
  value === 'winter' || value === 'summer' || value === 'fall' || value === 'spring';

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

const highlightQuery = (text: string, rawQuery: string) => {
  const query = rawQuery.trim();
  if (!query || query.length < 2) return text;

  const regex = new RegExp(`(${escapeRegex(query)})`, 'ig');
  const parts = text.split(regex);

  return parts.map((part, index) => (
    part.toLowerCase() === query.toLowerCase() ? (
      <span key={`${part}-${index}`} className="rounded bg-yellow-200 px-0.5 text-gray-900">
        {part}
      </span>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  ));
};

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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearchValue, setDebouncedSearchValue] = useState('');
  const [paletteView, setPaletteView] = useState<PaletteView>('search');
  const [isJsonCopied, setIsJsonCopied] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<Filters>(initialSelectedFilters);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState<boolean>(initialShowOnlyFavorites);
  const [selectedSeason, setSelectedSeason] = useState<SeasonFilter | null>(null);
  const selectedFiltersRef = useRef<Filters>(initialSelectedFilters);
  const showOnlyFavoritesRef = useRef<boolean>(initialShowOnlyFavorites);
  const selectedSeasonRef = useRef<SeasonFilter | null>(null);

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
    const rawSeason = searchParams.get('season')?.trim().toLowerCase() ?? null;
    const season = isSeasonFilter(rawSeason) ? rawSeason : null;
    return { filters, favorites, season };
  }, [searchParams]);

  useEffect(() => {
    selectedFiltersRef.current = selectedFilters;
  }, [selectedFilters]);

  useEffect(() => {
    showOnlyFavoritesRef.current = showOnlyFavorites;
  }, [showOnlyFavorites]);

  useEffect(() => {
    selectedSeasonRef.current = selectedSeason;
  }, [selectedSeason]);

  useEffect(() => {
    const { filters, favorites, season } = getFiltersFromUrl();
    selectedFiltersRef.current = filters;
    showOnlyFavoritesRef.current = favorites;
    selectedSeasonRef.current = season;
    setSelectedFilters(filters);
    setShowOnlyFavorites(favorites);
    setSelectedSeason(season);
  }, [searchParams, getFiltersFromUrl]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return;

      const target = event.target as HTMLElement | null;
      const isTypingTarget = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if (isTypingTarget) return;

      event.preventDefault();
      setIsSearchOpen((prev) => !prev);
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  useEffect(() => {
    if (!isSearchOpen) return;

    const handlePaletteShortcut = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Export shortcut is uppercase "J" only.
      if (event.key !== 'J') return;
      if (searchValue.trim().length > 0) return;

      event.preventDefault();
      setPaletteView('export-json');
    };

    window.addEventListener('keydown', handlePaletteShortcut);
    return () => window.removeEventListener('keydown', handlePaletteShortcut);
  }, [isSearchOpen, searchValue]);

  useEffect(() => {
    if (!isJsonCopied) return;
    const timeoutId = window.setTimeout(() => {
      setIsJsonCopied(false);
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [isJsonCopied]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchValue(searchValue);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [searchValue]);

  const toggleFilterDrawer = () => {
    setIsFilterDrawerOpen(!isFilterDrawerOpen);
  };

  const updateUrl = useCallback((newFilters: Filters, newFavorites: boolean, newSeason: SeasonFilter | null) => {
    const newSearchParams = new URLSearchParams();
    (Object.entries(newFilters) as Array<[keyof Filters, string[]]>).forEach(([key, values]) => {
      values.forEach((value) => newSearchParams.append(key, value));
    });
    if (newFavorites) {
      newSearchParams.set('favorites', 'true');
    }
    if (newSeason) {
      newSearchParams.set('season', newSeason);
    }
    const query = newSearchParams.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }, [pathname, router]);

  const toggleShowOnlyFavorites = () => {
    const nextFavorites = !showOnlyFavoritesRef.current;
    showOnlyFavoritesRef.current = nextFavorites;
    setShowOnlyFavorites(nextFavorites);
    updateUrl(selectedFiltersRef.current, nextFavorites, selectedSeasonRef.current);
  };

  const handleClearFilters = () => {
    const resetFilters = emptyFilters();
    selectedFiltersRef.current = resetFilters;
    showOnlyFavoritesRef.current = false;
    selectedSeasonRef.current = null;
    setSelectedFilters(resetFilters);
    setShowOnlyFavorites(false);
    setSelectedSeason(null);
    updateUrl(resetFilters, false, null);
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
    updateUrl(newFilters, showOnlyFavoritesRef.current, selectedSeasonRef.current);
  };

  const handleSeasonToggle = (season: SeasonFilter) => {
    const nextSeason = selectedSeasonRef.current === season ? null : season;
    selectedSeasonRef.current = nextSeason;
    setSelectedSeason(nextSeason);
    updateUrl(selectedFiltersRef.current, showOnlyFavoritesRef.current, nextSeason);
  };

  const filteredWardrobe = useMemo(() => {
    let wardrobe = wardrobeData;

    if (showOnlyFavorites) {
      wardrobe = wardrobe.filter(garment => garment.favorite);
    }

    if (selectedSeason) {
      const allowedWeather = new Set(seasonWeatherMap[selectedSeason]);
      wardrobe = wardrobe.filter((garment) =>
        (garment.suitable_weather ?? []).some((weather) =>
          allowedWeather.has(weather.trim().toLowerCase())
        )
      );
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
  }, [wardrobeData, selectedFilters, showOnlyFavorites, selectedSeason]);

  const isAnyFilterSelected = useMemo(() => {
    const hasCategoryFilters = Object.values(selectedFilters).some(filterArray => filterArray.length > 0);
    return hasCategoryFilters || showOnlyFavorites || selectedSeason !== null;
  }, [selectedFilters, showOnlyFavorites, selectedSeason]);

  const searchResults = useMemo(() => {
    const query = debouncedSearchValue.trim().toLowerCase();
    if (!query) return wardrobeData;
    if (query.length < 2) return [];

    return wardrobeData.filter((garment) =>
      [garment.model, garment.type, garment.brand].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [debouncedSearchValue, wardrobeData]);

  const showSearchThresholdHint = searchValue.trim().length > 0 && searchValue.trim().length < 2;
  const wardrobeExportJson = useMemo(
    () => JSON.stringify(wardrobeData, null, 2),
    [wardrobeData]
  );

  const handleSelectGarment = (garmentId: number) => {
    setIsSearchOpen(false);
    setSearchValue('');
    window.location.assign(`/garments/${garmentId}`);
  };

  const handleExportWardrobeJson = () => {
    setPaletteView('export-json');
    setSearchValue('');
    setIsJsonCopied(false);
  };

  const handleBackToSearch = () => {
    setPaletteView('search');
    setSearchValue('');
    setIsJsonCopied(false);
  };

  const handleCopyWardrobeJson = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(wardrobeExportJson);
      } else if (typeof document !== 'undefined') {
        const tempArea = document.createElement('textarea');
        tempArea.value = wardrobeExportJson;
        tempArea.setAttribute('readonly', 'true');
        tempArea.style.position = 'absolute';
        tempArea.style.left = '-9999px';
        document.body.appendChild(tempArea);
        tempArea.select();
        document.execCommand('copy');
        document.body.removeChild(tempArea);
      }
      setIsJsonCopied(true);
    } catch (error) {
      console.error('Failed to copy wardrobe JSON:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex">
      <CommandDialog
        open={isSearchOpen}
        onOpenChange={(open) => {
          setIsSearchOpen(open);
          if (!open) {
            setSearchValue('');
            setPaletteView('search');
            setIsJsonCopied(false);
          }
        }}
        title="Search Garments"
        description="Search garments by model, type, or brand."
        className="max-w-2xl p-0"
      >
        <div
          data-slot="command-input-wrapper"
          className="flex h-12 items-center gap-2 border-b px-3"
        >
          {paletteView === 'export-json' && (
            <button
              type="button"
              onClick={handleBackToSearch}
              className="inline-flex size-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              aria-label="Back to command search"
              title="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          {paletteView === 'export-json' ? (
            <span className="text-sm font-medium text-gray-600">Back to search</span>
          ) : (
            <>
              <Search className="size-4 shrink-0 opacity-50" />
              <CommandPrimitive.Input
                data-slot="command-input"
                className="placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                value={searchValue}
                onValueChange={setSearchValue}
                placeholder="Search by model, type, or brand..."
              />
            </>
          )}
        </div>
        {paletteView === 'search' ? (
          <CommandList>
            {showSearchThresholdHint ? (
              <p className="py-6 text-center text-sm text-gray-600">Type at least 2 characters</p>
            ) : (
              <CommandEmpty>No garments found</CommandEmpty>
            )}
            <CommandGroup heading="Actions">
              <CommandItem
                value="Export Wardrobe as JSON"
                onSelect={handleExportWardrobeJson}
                className="py-2"
              >
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="truncate text-sm text-gray-800">Export Wardrobe as JSON</span>
                  <span className="rounded-md border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    J
                  </span>
                </div>
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Garments">
              {searchResults.map((garment) => (
                <CommandItem
                  key={garment.id}
                  value={`${garment.model} ${garment.type} ${garment.brand}`}
                  onSelect={() => handleSelectGarment(garment.id)}
                  className="py-2"
                >
                  <div className="relative h-10 w-10 overflow-hidden rounded-md border bg-gray-100">
                    <Image
                      src={garment.file_name || '/placeholder.png'}
                      alt={`${garment.model} ${garment.type} by ${garment.brand}`}
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  </div>
                  <p className="truncate text-sm text-gray-800">
                    {highlightQuery(garment.model, debouncedSearchValue)} {highlightQuery(garment.type, debouncedSearchValue)} by {highlightQuery(garment.brand, debouncedSearchValue)}
                  </p>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        ) : (
          <div className="h-[300px] bg-gray-50 p-3">
            <div className="flex h-full flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-600">Wardrobe JSON</p>
                <button
                  type="button"
                  onClick={handleCopyWardrobeJson}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  aria-label="Copy wardrobe JSON to clipboard"
                  title="Copy"
                >
                  <Copy className="size-3.5" />
                  {isJsonCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                readOnly
                value={wardrobeExportJson}
                className="min-h-0 w-full flex-1 resize-y rounded-md border border-gray-300 bg-white p-2 font-mono text-xs text-gray-800"
                aria-label="Wardrobe JSON export"
              />
            </div>
          </div>
        )}
      </CommandDialog>
      

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
        <div className="w-full flex flex-wrap justify-start gap-2 mb-4 max-w-6xl mx-auto">
          <Button variant="outline" onClick={() => setIsSearchOpen(true)} aria-label="Search garments (Cmd/Ctrl+K)" title="Search (Cmd/Ctrl+K)">
            <FiSearch />
          </Button>
          <Button variant="outline" onClick={toggleFilterDrawer}>
            <FiFilter />
          </Button>
          <Button variant="outline" onClick={toggleShowOnlyFavorites}>
            <FiHeart fill={showOnlyFavorites ? 'red' : 'none'} className={cn('transition-colors', showOnlyFavorites ? 'text-red-500' : 'text-gray-500')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={selectedSeason ? 'default' : 'outline'} aria-label="Season filter" title="Season filter">
                <CloudSun className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-12">
              {seasonQuickFilters.map((seasonFilter) => (
                <DropdownMenuItem
                  key={seasonFilter.value}
                  onClick={() => handleSeasonToggle(seasonFilter.value)}
                  className={cn(
                    'justify-center',
                    selectedSeason === seasonFilter.value &&
                      'bg-slate-900 text-white hover:bg-slate-900 focus:bg-slate-900'
                  )}
                  aria-label={seasonFilter.label}
                  title={seasonFilter.label}
                >
                  <seasonFilter.Icon
                    className={cn(
                      'h-4 w-4',
                      selectedSeason === seasonFilter.value ? 'text-white' : 'text-muted-foreground'
                    )}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
