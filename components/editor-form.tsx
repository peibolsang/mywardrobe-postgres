"use client";

import { FavoriteButton } from './client/favorite-button';
import { useState, useEffect, useRef, useTransition, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import Image from 'next/image';
import Link from 'next/link';
import { Toaster } from '../components/ui/sonner';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { MultiSelect } from '../components/ui/multi-select';
import { CreatableCombobox } from '../components/ui/creatable-combobox';
import { CreatableMultiSelect } from '../components/ui/creatable-multi-select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
import { cn } from '../lib/utils';
import { createGarment, updateGarment, deleteGarment } from '@/actions/garment'; // Import Server Actions
import { useActionState } from 'react'; // Import new React 19 hooks
import { SubmitButton } from './client/submit-button';
import { GarmentFormData, MaterialComposition } from '@/lib/types'; // Import GarmentFormData and MaterialComposition

// Updated Garment interface to match the normalized schema output
interface Garment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string; // Now a string name from lookup
  formality: string; // Now a string name from lookup
  material_composition: { material: string; percentage: number }[];
  color_palette: string[];
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
  favorite: boolean;
}

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

// Removed initialWardrobeData and initialSchemaData from props
interface EditorFormProps {
  isNewGarmentMode?: boolean; // Optional prop to indicate new garment mode
}

interface EditorOptionsResponse {
  types: string[];
  materials: string[];
  colors: string[];
}

const normalizeOptionValue = (value: string) => value.trim().toLowerCase();

const mergeUniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const rawValue of values) {
    const value = String(rawValue ?? '').trim();
    if (!value) continue;

    const key = normalizeOptionValue(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }

  return merged.sort((a, b) => a.localeCompare(b));
};

export default function EditorForm({ isNewGarmentMode: isNewGarmentModeProp = false }: EditorFormProps) {
  const [wardrobeData, setWardrobeData] = useState<Garment[]>([]); // Initialize as empty
  const [schemaData, setSchemaData] = useState<Schema | null>(null); // Initialize as null
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [materialOptions, setMaterialOptions] = useState<string[]>([]);
  const [colorOptions, setColorOptions] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [formData, setFormData] = useState<GarmentFormData | null>(null); // Use GarmentFormData for form state
  const inputFileRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  const isNewGarmentMode = isNewGarmentModeProp;
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);

  // useActionState for form submission feedback
  const [createState, createFormAction] = useActionState(createGarment, { message: '', status: '' });
  const [updateState, updateFormAction] = useActionState(updateGarment, { message: '', status: '' });

  const fetchFreshWardrobe = useCallback(async (): Promise<Garment[]> => {
    const response = await fetch('/api/wardrobe?fresh=1', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to fetch wardrobe data');
    }
    return response.json() as Promise<Garment[]>;
  }, []);

  const fetchEditorOptions = useCallback(async (): Promise<EditorOptionsResponse> => {
    const response = await fetch('/api/editor-options', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to fetch editor options');
    }
    return response.json() as Promise<EditorOptionsResponse>;
  }, []);
  

  // Handle toast messages from Server Actions
  useEffect(() => {
    if (createState.message) {
      if (createState.message.includes('successfully')) {
        setValidationErrors({});
        toast.success(createState.message);
      } else {
        toast.error(createState.message);
      }
    }
  }, [createState]);

  useEffect(() => {
    if (updateState.message) {
      if (updateState.message.includes('successfully')) {
        setValidationErrors({});
        toast.success(updateState.message);
      } else {
        toast.error(updateState.message);
      }
    }
  }, [updateState]);

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const wardrobeJson = await fetchFreshWardrobe();
        setWardrobeData(wardrobeJson);

        let editorOptions: EditorOptionsResponse = { types: [], materials: [], colors: [] };
        try {
          editorOptions = await fetchEditorOptions();
        } catch (optionsError) {
          console.error('Failed to fetch editor options, falling back to wardrobe-derived values:', optionsError);
        }

        const wardrobeTypeOptions = wardrobeJson.map((garment) => garment.type);
        const wardrobeMaterialOptions = wardrobeJson.flatMap((garment) =>
          garment.material_composition.map((material) => material.material)
        );
        const wardrobeColorOptions = wardrobeJson.flatMap((garment) => garment.color_palette);

        setTypeOptions(mergeUniqueStrings([...editorOptions.types, ...wardrobeTypeOptions]));
        setMaterialOptions(mergeUniqueStrings([...editorOptions.materials, ...wardrobeMaterialOptions]));
        setColorOptions(mergeUniqueStrings([...editorOptions.colors, ...wardrobeColorOptions]));

        const schemaRes = await fetch('/schema.json'); // Assuming schema.json is in public
        const schemaJson = await schemaRes.json();
        setSchemaData(schemaJson);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
        toast.error('Failed to load initial wardrobe data or schema.');
      }
    };
    fetchData();
  }, [fetchEditorOptions, fetchFreshWardrobe]); // Run once on mount

  

  const initializeNewGarment = (): GarmentFormData => {
    // ID will be generated by the database, so no need to calculate here
    return {
      file_name: '',
      model: '',
      brand: '',
      type: '',
      style: '',
      formality: '',
      material_composition: [],
      color_palette: [],
      suitable_weather: [],
      suitable_time_of_day: [],
      suitable_places: [],
      suitable_occasions: [],
      features: '',
      favorite: false, // Default to false for new garments
    };
  };

  useEffect(() => {
    if (isNewGarmentMode) {
      setFormData(initializeNewGarment());
    } else if (wardrobeData.length > 0) {
      const currentGarment = wardrobeData[currentIndex];
      // Ensure material_composition is an array and filter out empty entries
      const filteredMaterialComposition = Array.isArray(currentGarment.material_composition)
        ? currentGarment.material_composition.filter(mc => mc.material.trim() !== '' && mc.percentage > 0)
        : [];

      setFormData({
        ...currentGarment,
        material_composition: filteredMaterialComposition,
        // Ensure other array fields are arrays
        color_palette: Array.isArray(currentGarment.color_palette) ? currentGarment.color_palette : [],
        suitable_weather: Array.isArray(currentGarment.suitable_weather) ? currentGarment.suitable_weather : [],
        suitable_time_of_day: Array.isArray(currentGarment.suitable_time_of_day) ? currentGarment.suitable_time_of_day : [],
        suitable_places: Array.isArray(currentGarment.suitable_places) ? currentGarment.suitable_places : [],
        suitable_occasions: Array.isArray(currentGarment.suitable_occasions) ? currentGarment.suitable_occasions : [],
      });
    }
  }, [currentIndex, wardrobeData, isNewGarmentMode]);

  useEffect(() => {
    if (wardrobeData.length === 0) return;

    const wardrobeTypeOptions = wardrobeData.map((garment) => garment.type);
    const wardrobeMaterialOptions = wardrobeData.flatMap((garment) =>
      garment.material_composition.map((material) => material.material)
    );
    const wardrobeColorOptions = wardrobeData.flatMap((garment) => garment.color_palette);

    setTypeOptions((prevOptions) => mergeUniqueStrings([...prevOptions, ...wardrobeTypeOptions]));
    setMaterialOptions((prevOptions) => mergeUniqueStrings([...prevOptions, ...wardrobeMaterialOptions]));
    setColorOptions((prevOptions) => mergeUniqueStrings([...prevOptions, ...wardrobeColorOptions]));
  }, [wardrobeData]);

  const handleNext = () => {
    if (wardrobeData.length <= 1) return;
    setCurrentIndex((prevIndex) => (prevIndex + 1) % wardrobeData.length);
  };

  const handlePrev = () => {
    if (wardrobeData.length <= 1) return;
    setCurrentIndex((prevIndex) =>
      prevIndex === 0 ? wardrobeData.length - 1 : prevIndex - 1
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFileName(null);
      setImagePreview(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prevData) => {
      if (!prevData) return null;
      if (name.startsWith('material_composition[')) {
        const [_, indexStr, field] = name.match(/material_composition\[(\d+)\]\.(.*)/) || [];
        const index = parseInt(indexStr);
        const newMaterialComposition = [...prevData.material_composition];
        if (field === 'percentage') {
          const newPercentage = value === '' ? NaN : parseInt(value);
          newMaterialComposition[index] = { ...newMaterialComposition[index], [field]: newPercentage };
        } else {
          newMaterialComposition[index] = { ...newMaterialComposition[index], [field]: value };
        }
        return { ...prevData, material_composition: newMaterialComposition };
      }
      return {
        ...prevData,
        [name]: value,
      };
    });
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prevData) => {
      if (!prevData) return null;
      return {
        ...prevData,
        [name]: value,
      };
    });
  };

  const handleMultiSelectChange = (name: string, values: string[]) => {
    setFormData((prevData) => {
      if (!prevData) return null;
      return {
        ...prevData,
        [name]: values,
      };
    });
  };

  const handleAddMaterial = () => {
    setFormData((prevData) => {
      if (!prevData) return null;
      return {
        ...prevData,
        material_composition: [
          ...prevData.material_composition,
          { material: '', percentage: 0 },
        ],
      };
    });
  };

  const handleRemoveMaterial = (indexToRemove: number) => {
    setFormData((prevData) => {
      if (!prevData) return null;
      const newMaterialComposition = prevData.material_composition.filter(
        (_, index) => index !== indexToRemove
      );
      return { ...prevData, material_composition: newMaterialComposition };
    });
  };

  const handleMaterialNameChange = (index: number, materialName: string) => {
    setFormData((prevData) => {
      if (!prevData) return null;
      const newMaterialComposition = [...prevData.material_composition];
      newMaterialComposition[index] = {
        ...newMaterialComposition[index],
        material: materialName,
      };
      return { ...prevData, material_composition: newMaterialComposition };
    });

    setMaterialOptions((prevOptions) => mergeUniqueStrings([...prevOptions, materialName]));
  };

  const handleToggleFavorite = async (garmentId: number, currentFavoriteStatus: boolean) => {
    if (!formData) return;

    const updatedFormData: GarmentFormData = {
      ...formData,
      id: garmentId, // Ensure ID is present for update
      favorite: !currentFavoriteStatus,
    };

    // Create a new FormData object for the update action
    const updateFormData = new FormData();
    for (const key in updatedFormData) {
      if (key === 'material_composition' || key === 'color_palette' || key === 'suitable_weather' || key === 'suitable_time_of_day' || key === 'suitable_places' || key === 'suitable_occasions') {
        updateFormData.append(key, JSON.stringify((updatedFormData as any)[key]));
      } else if (key === 'file_name') {
        // If file_name is a URL, we need to pass it as a string, not a File object
        updateFormData.append('current_file_name', updatedFormData.file_name);
      } else {
        updateFormData.append(key, String((updatedFormData as any)[key]));
      }
    }

    // Call the updateGarment Server Action
    const result = await updateGarment(null, updateFormData); // Pass null for prevState

    if (result.message?.includes('successfully')) {
      toast.success(result.message);
      // Re-fetch data to reflect the change
      const wardrobeJson = await fetchFreshWardrobe();
      setWardrobeData(wardrobeJson);
    } else {
      toast.error(result.message || 'Failed to update favorite status.');
    }
  };

  const handleDelete = async (garmentId: number) => {
    if (window.confirm('Are you sure you want to delete this garment?')) {
      const result = await deleteGarment(garmentId);
      if (result.message?.includes('successfully')) {
        toast.success(result.message);
        // Re-fetch data and adjust index
        const wardrobeJson = await fetchFreshWardrobe();
        setWardrobeData(wardrobeJson);
        setCurrentIndex(0); // Reset to first garment after deletion
      } else {
        toast.error(result.message || 'Failed to delete garment.');
      }
    }
  };

  const validateForm = (data: GarmentFormData) => {
    const errors: Record<string, string> = {};
    if (!schemaData) return errors;

    const requiredFields = schemaData.items.required.filter((field) => field !== 'id');

    requiredFields.forEach(key => {
      const value = (data as any)[key];
      if (typeof value === 'string' && value.trim() === '') {
        errors[key] = 'This field is required';
      } else if (Array.isArray(value) && value.length === 0) {
        errors[key] = 'This field is required';
      } else if (key === 'material_composition') {
        if (value.length === 0 || value.some((mc: MaterialComposition) => mc.material.trim() === '' || isNaN(mc.percentage) || mc.percentage <= 0)) {
          errors[key] = 'Material composition must have at least one valid entry';
        }
      }
    });
    return errors;
  };

  const currentGarment = formData;
  const schemaProperties = schemaData?.items.properties;
  const hasExistingGarments = wardrobeData.length > 0;

  const renderInputField = (key: string, prop: SchemaProperty, value: any) => {
    const isRequired = schemaData?.items.required.includes(key);
    const labelText = `${key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}${isRequired ? ' *' : ''}`;
    const placeholderText = prop.description || `Enter ${key.replace(/_/g, ' ')}`;
    const hasError = validationErrors[key];

    switch (prop.type) {
      case 'string':
        if (key === 'features') {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <Textarea
                name={key}
                value={value}
                onChange={handleChange}
                placeholder={placeholderText}
                className={hasError ? 'border-red-500' : ''}
              />
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        } else if (key === 'file_name') {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <div className="flex items-center">
                <Input
                  type="file"
                  name={key}
                  ref={inputFileRef}
                  onChange={handleFileChange}
                  className={cn(
                    hasError ? 'border-red-500' : '',
                    'file:bg-primary file:text-primary-foreground file:hover:bg-primary/90 file:mr-4 file:px-4 file:py-2 file:rounded-lg'
                  )}
                  style={{ display: 'none' }} // Hide the default input
                />
                <Button
                  type="button"
                  onClick={() => inputFileRef.current?.click()} // Trigger the hidden file input
                  variant="outline"
                  className="mr-4 hover:bg-gray-100"
                >
                  Choose File
                </Button>
                <span className="text-sm text-gray-500">
                  {fileName || (currentGarment && currentGarment.file_name ? currentGarment.file_name.split('/').pop() : 'No file chosen')}
                </span>
              </div>
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        } else if (key === 'type') {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <CreatableCombobox
                options={mergeUniqueStrings([...typeOptions, value])}
                value={value}
                onChange={(nextType) => {
                  handleSelectChange(key, nextType);
                  setTypeOptions((prevOptions) => mergeUniqueStrings([...prevOptions, nextType]));
                }}
                placeholder={placeholderText}
                searchPlaceholder="Search or create garment type..."
                className={hasError ? 'border-red-500' : ''}
              />
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        } else if (prop.enum) {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <Select onValueChange={(val) => handleSelectChange(key, val)} value={value}>
                <SelectTrigger className={cn("w-full", hasError && 'border-red-500')}>
                  <SelectValue placeholder={placeholderText} />
                </SelectTrigger>
                <SelectContent>
                  {prop.enum.map((option: string) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        } else {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <Input
                type="text"
                name={key}
                value={value}
                onChange={handleChange}
                placeholder={placeholderText}
                className={hasError ? 'border-red-500' : ''}
              />
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        }
      case 'integer':
        return (
          <>
            <Label htmlFor={key}>{labelText}</Label>
            <Input
              type="number"
              name={key}
              value={value}
              onChange={handleChange}
              placeholder={placeholderText}
              className={hasError ? 'border-red-500' : ''}
            />
            {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
          </>
        );
      case 'array':
        if (key === 'material_composition') {
          return (
            <div>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              {(value as MaterialComposition[]).map((mc, index) => (
                <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2">
                  <CreatableCombobox
                    options={mergeUniqueStrings([...materialOptions, mc.material])}
                    value={mc.material}
                    onChange={(nextMaterial) => handleMaterialNameChange(index, nextMaterial)}
                    placeholder="Select or create material..."
                    searchPlaceholder="Search or create material..."
                    className={hasError ? 'border-red-500' : ''}
                  />
                  <Input
                    type="number"
                    name={`material_composition[${index}].percentage`}
                    value={isNaN(mc.percentage) ? '' : mc.percentage}
                    onChange={handleChange}
                    placeholder="%"
                    min="0"
                    max="100"
                    className={hasError ? 'border-red-500' : ''}
                  />
                  <Button
                    type="button"
                    onClick={() => handleRemoveMaterial(index)}
                    variant="destructive"
                    size="icon"
                  >
                    X
                  </Button>
                </div>
              ))}
              <Button type="button" onClick={handleAddMaterial} variant="outline" className="mt-2">
                Add Material
              </Button>
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </div>
          );
        } else if (key === 'color_palette') {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <CreatableMultiSelect
                options={mergeUniqueStrings([...colorOptions, ...(value as string[])])}
                selected={value as string[]}
                onChange={(selectedValues) => {
                  handleMultiSelectChange(key, selectedValues);
                  setColorOptions((prevOptions) => mergeUniqueStrings([...prevOptions, ...selectedValues]));
                }}
                placeholder={placeholderText}
                searchPlaceholder="Search or create colors..."
                className={hasError ? 'border-red-500' : ''}
              />
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        } else if (prop.items?.enum) {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <MultiSelect
                options={prop.items.enum as string[]}
                selected={value as string[]}
                onChange={(selectedValues) => handleMultiSelectChange(key, selectedValues)}
                placeholder={placeholderText}
              />
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        } else {
          return (
            <>
              <Label htmlFor={key} className="mb-2 block">{labelText}</Label>
              <Input
                type="text"
                name={key}
                value={Array.isArray(value) ? value.join(', ') : ''}
                onChange={handleChange}
                placeholder={placeholderText}
                className={hasError ? 'border-red-500' : ''}
              />
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        }
      default:
        return (
          <>
            <Label htmlFor={key}>{labelText}</Label>
            <Input
              type="text"
              name={key}
              value={value}
              onChange={handleChange}
              placeholder={placeholderText}
              className={hasError ? 'border-red-500' : ''}
            />
            {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
          </>
        );
    }
  };

  return (
    <div className={cn(
      "min-h-screen bg-gray-100 flex flex-col items-center p-4",
      isNewGarmentModeProp ? "justify-start pt-6" : "justify-start pt-6"
    )}>
      <Toaster />

      

      {!isNewGarmentMode && hasExistingGarments && (
        <div className="flex items-center justify-between w-full max-w-5xl mb-4">
          <Button onClick={handlePrev} variant="outline">
            Previous
          </Button>
          <span className="text-sm">
            {currentIndex + 1} / {wardrobeData.length}
          </span>
          <Button onClick={handleNext} variant="outline">
            Next
          </Button>
        </div>
      )}

      {!isNewGarmentMode && !hasExistingGarments && (
        <Card className="w-full max-w-5xl">
          <CardHeader>
            <CardTitle className="text-center text-2xl">No garments available</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <p className="text-sm text-gray-600">Create your first garment to start editing.</p>
            <Button asChild>
              <Link href="/add-garment">Add Garment</Link>
            </Button>
          </CardContent>
        </Card>
      )}


      {currentGarment && schemaProperties && (
        <Card className="w-full max-w-5xl relative">
          {!isNewGarmentMode && (
            <>
              <FavoriteButton
                isFavorite={currentGarment.favorite}
                onClick={() => handleToggleFavorite(currentGarment.id!, currentGarment.favorite)}
              />
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-4 right-16" // Position next to favorite button
                onClick={() => handleDelete(currentGarment.id!)}
              >
                Delete
              </Button>
            </>
          )}
          <CardHeader>
            <CardTitle className="text-center text-2xl">
              {(isNewGarmentMode && (!currentGarment.model || !currentGarment.brand || !currentGarment.type))
                ? "New Garment"
                : `${currentGarment.model} ${currentGarment.type}, by ${currentGarment.brand}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-6">
              <div className="md:w-1/2 flex flex-col items-center justify-start p-4 relative">
                <Image
                  key={currentGarment.file_name || 'placeholder'}
                  src={imagePreview || currentGarment.file_name || '/placeholder.png'}
                  alt={currentGarment.model || 'Placeholder Image'}
                  width={400}
                  height={400}
                  className="object-contain"
                />
              </div>

              <form
                className="md:w-1/2 p-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!currentGarment) return;

                  const errors = validateForm(currentGarment);
                  setValidationErrors(errors);
                  if (Object.keys(errors).length > 0) {
                    toast.error('Please fix the highlighted fields before saving.');
                    return;
                  }

                  const form = event.target as HTMLFormElement;
                  const formDataForAction = new FormData(form);

                  try {
                    setIsUploading(true);
                    const file = inputFileRef.current?.files?.[0];

                    if (file) {
                      const newBlob = await upload(file.name, file, {
                        access: 'public',
                        handleUploadUrl: '/api/upload',
                      });
                      formDataForAction.set('file_name', newBlob.url);
                    } else if (!isNewGarmentMode) {
                      formDataForAction.set('file_name', currentGarment?.file_name || '');
                    }

                    if (isNewGarmentMode) {
                      startTransition(() => createFormAction(formDataForAction));
                    } else {
                      startTransition(() => updateFormAction(formDataForAction));
                    }
                  } finally {
                    setIsUploading(false);
                  }
                }}
              >
                {/* Hidden input for ID when updating */}
                {currentGarment.id && (
                  <input type="hidden" name="id" value={currentGarment.id} />
                )}
                
                {/* Hidden input for favorite status */}
                <input type="hidden" name="favorite" value={String(currentGarment.favorite)} />

                {/* Hidden input for custom combobox fields */}
                <input type="hidden" name="type" value={currentGarment.type || ''} />

                {/* Hidden inputs for multi-select fields */}
                <input type="hidden" name="colors" value={JSON.stringify(currentGarment.color_palette)} />
                <input type="hidden" name="suitableWeathers" value={JSON.stringify(currentGarment.suitable_weather)} />
                <input type="hidden" name="suitableTimesOfDay" value={JSON.stringify(currentGarment.suitable_time_of_day)} />
                <input type="hidden" name="suitablePlaces" value={JSON.stringify(currentGarment.suitable_places)} />
                <input type="hidden" name="suitableOccasions" value={JSON.stringify(currentGarment.suitable_occasions)} />
                <input type="hidden" name="materials" value={JSON.stringify(currentGarment.material_composition.map(m => ({ material: m.material, percentage: m.percentage })))} />

                {/* Hidden inputs for single-select fields */}
                <input type="hidden" name="style" value={currentGarment.style || ''} />
                <input type="hidden" name="formality" value={currentGarment.formality || ''} />

                <Accordion type="multiple" className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>Basic Information</AccordionTrigger>
                    <AccordionContent>
                      <div>
                        <div className="mb-4">
                          {renderInputField('file_name', { type: 'string', description: 'Image file' }, currentGarment.file_name)}
                          </div>
                        <div className="mb-4">
                          {renderInputField('model', schemaProperties.model, currentGarment.model)}
                        </div>
                        <div className="mb-4">
                          {renderInputField('brand', schemaProperties.brand, currentGarment.brand)}
                        </div>
                        <div className="mb-4">
                          {renderInputField('type', schemaProperties.type, currentGarment.type)}
                        </div>
                        <div className="mb-4">
                          {renderInputField('features', schemaProperties.features, currentGarment.features)}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="item-2">
                    <AccordionTrigger>Style & Formality</AccordionTrigger>
                    <AccordionContent>
                      <div className="mb-4">
                        {renderInputField('style', schemaProperties.style, currentGarment.style)}
                      </div>
                      <div className="mb-4">
                        {renderInputField('formality', schemaProperties.formality, currentGarment.formality)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="item-3">
                    <AccordionTrigger>Material & Color</AccordionTrigger>
                    <AccordionContent>
                      <div className="mb-4 w-full">
                        {renderInputField('material_composition', schemaProperties.material_composition, currentGarment.material_composition)}
                      </div>
                      <div className="mb-4 w-full">
                        {renderInputField('color_palette', schemaProperties.color_palette, currentGarment.color_palette)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="item-4">
                    <AccordionTrigger>Suitability</AccordionTrigger>
                    <AccordionContent>
                      <div className="mb-4 w-full">
                        {renderInputField('suitable_weather', schemaProperties.suitable_weather, currentGarment.suitable_weather)}
                      </div>
                      <div className="mb-4 w-full">
                        {renderInputField('suitable_time_of_day', schemaProperties.suitable_time_of_day, currentGarment.suitable_time_of_day)}
                      </div>
                      <div className="mb-4 w-full">
                        {renderInputField('suitable_places', schemaProperties.suitable_places, currentGarment.suitable_places)}
                      </div>
                      <div className="mb-4 w-full">
                        {renderInputField('suitable_occasions', schemaProperties.suitable_occasions, currentGarment.suitable_occasions)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <div className="flex flex-col mt-4 space-y-2">
                  <SubmitButton pending={isPending || isUploading} />
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/viewer">Cancel</Link>
                  </Button>
                </div>
              </form>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
