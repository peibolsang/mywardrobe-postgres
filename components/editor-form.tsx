"use client";

import { FavoriteButton } from './client/favorite-button';
import { useState, useEffect, useRef, useTransition, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import Image from 'next/image';
import Link from 'next/link';
import { Toaster } from '../components/ui/sonner';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { MultiSelect } from '../components/ui/multi-select';
import { CreatableCombobox } from '../components/ui/creatable-combobox';
import { CreatableMultiSelect } from '../components/ui/creatable-multi-select';
import { cn } from '../lib/utils';
import { createGarment, updateGarment, deleteGarment } from '@/actions/garment'; // Import Server Actions
import { useActionState } from 'react'; // Import new React 19 hooks
import { Garment, GarmentFormData, MaterialComposition } from '@/lib/types'; // Import GarmentFormData and MaterialComposition

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
  initialGarmentId?: number | null;
  initialWardrobeData?: Garment[];
  initialSchemaData?: Schema;
  initialEditorOptions?: EditorOptionsResponse;
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

const resolveCanonicalEnumValue = (value: string | undefined, options: string[] | undefined): string => {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return '';
  if (!Array.isArray(options) || options.length === 0) return rawValue;

  const canonical = options.find((option) => option.toLowerCase() === rawValue.toLowerCase());
  return canonical ?? rawValue;
};

export default function EditorForm({
  isNewGarmentMode: isNewGarmentModeProp = false,
  initialGarmentId = null,
  initialWardrobeData,
  initialSchemaData,
  initialEditorOptions,
}: EditorFormProps) {
  const [wardrobeData, setWardrobeData] = useState<Garment[]>(initialWardrobeData ?? []);
  const [schemaData, setSchemaData] = useState<Schema | null>(initialSchemaData ?? null);
  const [typeOptions, setTypeOptions] = useState<string[]>(
    mergeUniqueStrings(initialEditorOptions?.types ?? [])
  );
  const [materialOptions, setMaterialOptions] = useState<string[]>(
    mergeUniqueStrings(initialEditorOptions?.materials ?? [])
  );
  const [colorOptions, setColorOptions] = useState<string[]>(
    mergeUniqueStrings(initialEditorOptions?.colors ?? [])
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [formData, setFormData] = useState<GarmentFormData | null>(null); // Use GarmentFormData for form state
  const inputFileRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  const isNewGarmentMode = isNewGarmentModeProp;
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const hasServerHydration =
    initialWardrobeData !== undefined &&
    initialSchemaData !== undefined &&
    initialEditorOptions !== undefined;

  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const hasAppliedInitialSelection = useRef(false);
  const hasReconciledFreshData = useRef(false);

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
    if (hasServerHydration) return;

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
  }, [fetchEditorOptions, fetchFreshWardrobe, hasServerHydration]); // Run once on mount

  

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
        favorite: Boolean(currentGarment.favorite),
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

  useEffect(() => {
    if (isNewGarmentMode || !initialGarmentId || wardrobeData.length === 0 || hasAppliedInitialSelection.current) {
      return;
    }

    const selectedIndex = wardrobeData.findIndex((garment) => garment.id === initialGarmentId);
    if (selectedIndex >= 0) {
      setCurrentIndex(selectedIndex);
    }
    hasAppliedInitialSelection.current = true;
  }, [initialGarmentId, isNewGarmentMode, wardrobeData]);

  useEffect(() => {
    if (isNewGarmentMode || !initialGarmentId || hasReconciledFreshData.current) return;

    hasReconciledFreshData.current = true;
    (async () => {
      try {
        const latestWardrobe = await fetchFreshWardrobe();
        setWardrobeData(latestWardrobe);

        const selectedIndex = latestWardrobe.findIndex((garment) => garment.id === initialGarmentId);
        if (selectedIndex >= 0) {
          setCurrentIndex(selectedIndex);
        }
      } catch (error) {
        console.error('Failed to reconcile fresh editor data:', error);
      }
    })();
  }, [fetchFreshWardrobe, initialGarmentId, isNewGarmentMode]);

  useEffect(() => {
    if (isNewGarmentMode || !schemaData) return;

    setFormData((prevData) => {
      if (!prevData) return prevData;

      const styleOptions = schemaData.items.properties?.style?.enum ?? [];
      const formalityOptions = schemaData.items.properties?.formality?.enum ?? [];

      const canonicalStyle = resolveCanonicalEnumValue(prevData.style, styleOptions);
      const canonicalFormality = resolveCanonicalEnumValue(prevData.formality, formalityOptions);

      if (canonicalStyle === prevData.style && canonicalFormality === prevData.formality) {
        return prevData;
      }

      return {
        ...prevData,
        style: canonicalStyle,
        formality: canonicalFormality,
      };
    });
  }, [isNewGarmentMode, schemaData, formData?.style, formData?.formality]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setValidationErrors((prev) => {
        if (!prev.file_name) return prev;
        const { file_name, ...rest } = prev;
        return rest;
      });
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
      if (key === 'file_name') {
        const hasExistingFileName = typeof value === 'string' && value.trim() !== '';
        const hasSelectedFile = Boolean(inputFileRef.current?.files?.length);
        if (!hasExistingFileName && !hasSelectedFile) {
          errors[key] = 'This field is required';
        }
        return;
      }

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
  const getDisplayFileName = (rawFileName: string | null | undefined) => {
    const source = (fileName ?? rawFileName ?? '').trim();
    if (!source) return 'No file chosen';

    const withoutQuery = source.split('?')[0];
    const segment = withoutQuery.split('/').pop() || withoutQuery;
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };

  const renderInputField = (key: string, prop: SchemaProperty, value: any) => {
    const isRequired = schemaData?.items.required.includes(key);
    const viewerLabelMap: Record<string, string> = {
      file_name: 'Garment Image',
      model: 'Model',
      brand: 'Brand',
      type: 'Type',
      features: 'Features',
      style: 'Style',
      formality: 'Formality',
      material_composition: 'Material Composition',
      color_palette: 'Color Palette',
      suitable_weather: 'Best For Weather',
      suitable_time_of_day: 'Best Time Of Day',
      suitable_places: 'Best Places',
      suitable_occasions: 'Best Occasions',
    };
    const labelText = `${viewerLabelMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}${isRequired ? ' *' : ''}`;
    const labelClassName = "mb-2 block text-xs uppercase tracking-wide text-slate-500";
    const placeholderText = prop.description || `Enter ${key.replace(/_/g, ' ')}`;
    const hasError = validationErrors[key];

    switch (prop.type) {
      case 'string':
        if (key === 'features') {
          return (
            <>
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
          const displayFileName = getDisplayFileName(currentGarment?.file_name);
          return (
            <>
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
              <div className="flex min-w-0 items-center gap-3">
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
                  className="shrink-0 hover:bg-gray-100"
                >
                  Choose File
                </Button>
                <span className="min-w-0 truncate text-sm text-gray-500" title={displayFileName}>
                  {displayFileName}
                </span>
              </div>
              {hasError && <p className="text-red-500 text-sm mt-1">{hasError}</p>}
            </>
          );
        } else if (key === 'type') {
          return (
            <>
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
          const enumOptions = [...prop.enum];
          const currentValue = typeof value === 'string' ? value.trim() : '';
          if (currentValue && !enumOptions.includes(currentValue)) {
            enumOptions.unshift(currentValue);
          }

          return (
            <>
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
              <Select onValueChange={(val) => handleSelectChange(key, val)} value={value}>
                <SelectTrigger className={cn("w-full", hasError && 'border-red-500')}>
                  <SelectValue placeholder={placeholderText} />
                </SelectTrigger>
                <SelectContent>
                  {enumOptions.map((option: string) => (
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
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
            <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
                    variant="outline"
                    size="icon"
                    className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                    aria-label="Remove material"
                  >
                    <Trash2 className="h-4 w-4" />
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
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
              <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
            <Label htmlFor={key} className={labelClassName}>{labelText}</Label>
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
    <div className="box-border min-h-[calc(100dvh-65px)] bg-slate-100 p-4 md:p-6">
      <Toaster />

      <div className="mx-auto mb-4 w-full max-w-[1700px]">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/viewer" className="text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline">
            &larr; Back to Wardrobe
          </Link>
        </div>
      </div>

      {!isNewGarmentMode && !hasExistingGarments && (
        <Card className="mx-auto w-full max-w-5xl">
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
        <div className="mx-auto grid w-full max-w-[1700px] gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
            <Card className="relative h-fit">
              <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-2xl">
                    {(isNewGarmentMode && (!currentGarment.model || !currentGarment.brand || !currentGarment.type))
                      ? 'New Garment'
                      : (currentGarment.model || 'Untitled')}
                  </CardTitle>
                  {!isNewGarmentMode && (
                    <FavoriteButton
                      isFavorite={currentGarment.favorite}
                      onClick={() => handleToggleFavorite(currentGarment.id!, currentGarment.favorite)}
                    />
                  )}
                </div>
                <p className="text-sm text-slate-600">
                  {currentGarment.type || 'Type N/A'} by {currentGarment.brand || 'Brand N/A'}
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-xl p-1">
                  <Image
                    key={currentGarment.file_name || 'placeholder'}
                    src={imagePreview || currentGarment.file_name || '/placeholder.png'}
                    alt={currentGarment.model || 'Placeholder Image'}
                    width={700}
                    height={700}
                    className="h-auto w-full object-contain"
                  />
                </div>
              </CardContent>
            </Card>

          <form
            className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start"
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
            {currentGarment.id && (
              <input type="hidden" name="id" value={currentGarment.id} />
            )}
            <input type="hidden" name="favorite" value={String(currentGarment.favorite)} />
            <input type="hidden" name="type" value={currentGarment.type || ''} />
            <input type="hidden" name="colors" value={JSON.stringify(currentGarment.color_palette)} />
            <input type="hidden" name="suitableWeathers" value={JSON.stringify(currentGarment.suitable_weather)} />
            <input type="hidden" name="suitableTimesOfDay" value={JSON.stringify(currentGarment.suitable_time_of_day)} />
            <input type="hidden" name="suitablePlaces" value={JSON.stringify(currentGarment.suitable_places)} />
            <input type="hidden" name="suitableOccasions" value={JSON.stringify(currentGarment.suitable_occasions)} />
            <input type="hidden" name="materials" value={JSON.stringify(currentGarment.material_composition.map(m => ({ material: m.material, percentage: m.percentage })))} />
            <input type="hidden" name="style" value={currentGarment.style || ''} />
            <input type="hidden" name="formality" value={currentGarment.formality || ''} />

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>{renderInputField('file_name', { type: 'string', description: 'Image file' }, currentGarment.file_name)}</div>
                  <div>{renderInputField('model', schemaProperties.model, currentGarment.model)}</div>
                  <div>{renderInputField('brand', schemaProperties.brand, currentGarment.brand)}</div>
                  <div>{renderInputField('type', schemaProperties.type, currentGarment.type)}</div>
                  <div>{renderInputField('features', schemaProperties.features, currentGarment.features)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Style & Formality</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div>{renderInputField('style', schemaProperties.style, currentGarment.style)}</div>
                  <div>{renderInputField('formality', schemaProperties.formality, currentGarment.formality)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Material & Color</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>{renderInputField('material_composition', schemaProperties.material_composition, currentGarment.material_composition)}</div>
                  <div>{renderInputField('color_palette', schemaProperties.color_palette, currentGarment.color_palette)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Suitability</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>{renderInputField('suitable_weather', schemaProperties.suitable_weather, currentGarment.suitable_weather)}</div>
                  <div>{renderInputField('suitable_time_of_day', schemaProperties.suitable_time_of_day, currentGarment.suitable_time_of_day)}</div>
                  <div>{renderInputField('suitable_places', schemaProperties.suitable_places, currentGarment.suitable_places)}</div>
                  <div>{renderInputField('suitable_occasions', schemaProperties.suitable_occasions, currentGarment.suitable_occasions)}</div>
                </CardContent>
              </Card>
            </div>

            <Card className="lg:self-start">
              <CardContent className="pt-0">
                <div className="flex flex-col gap-2">
                  <Button type="submit" className="w-full" disabled={isPending || isUploading}>
                    {isPending || isUploading
                      ? (isNewGarmentMode ? 'Creating...' : 'Saving...')
                      : (isNewGarmentMode ? 'Create Garment' : 'Save Changes')}
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/viewer">Cancel</Link>
                  </Button>
                  {!isNewGarmentMode && (
                    <Button
                      variant="outline"
                      className="w-full border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                      onClick={() => handleDelete(currentGarment.id!)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

          </form>
        </div>
      )}
    </div>
  );
}
