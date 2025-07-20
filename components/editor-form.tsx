"use client";

import { FiHeart } from 'react-icons/fi';
import { useState, useEffect } from 'react'; // Removed useRef
import Image from 'next/image';
import { Toaster } from '../components/ui/sonner';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { MultiSelect } from '../components/ui/multi-select';
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
  warmth_level: string; // Now a string name from lookup
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
  // No props needed, data will be fetched internally or by parent Server Component
}

export default function EditorForm() { // Removed props from function signature
  const [wardrobeData, setWardrobeData] = useState<Garment[]>([]); // Initialize as empty
  const [schemaData, setSchemaData] = useState<Schema | null>(null); // Initialize as null
  const [currentIndex, setCurrentIndex] = useState(0);
  const [formData, setFormData] = useState<GarmentFormData | null>(null); // Use GarmentFormData for form state
  const [isNewGarmentMode, setIsNewGarmentMode] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // useActionState for form submission feedback
  const [createState, createFormAction] = useActionState(createGarment, { message: '', status: '' });
  const [updateState, updateFormAction] = useActionState(updateGarment, { message: '', status: '' });
  

  // Handle toast messages from Server Actions
  useEffect(() => {
    if (createState.message) {
      if (createState.message.includes('successfully')) {
        toast.success(createState.message);
      } else {
        toast.error(createState.message);
      }
    }
  }, [createState]);

  useEffect(() => {
    if (updateState.message) {
      if (updateState.message.includes('successfully')) {
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
        const wardrobeRes = await fetch('/api/wardrobe');
        const wardrobeJson = await wardrobeRes.json();
        setWardrobeData(wardrobeJson);

        const schemaRes = await fetch('/schema.json'); // Assuming schema.json is in public
        const schemaJson = await schemaRes.json();
        setSchemaData(schemaJson);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
        toast.error('Failed to load initial wardrobe data or schema.');
      }
    };
    fetchData();
  }, []); // Run once on mount

  useEffect(() => {
    if (wardrobeData.length > 0 && !isNewGarmentMode) {
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
    } else if (isNewGarmentMode) {
      setFormData(initializeNewGarment());
    }
  }, [currentIndex, wardrobeData, isNewGarmentMode]);

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
      warmth_level: '',
      suitable_weather: [],
      suitable_time_of_day: [],
      suitable_places: [],
      suitable_occasions: [],
      features: '',
      favorite: false, // Default to false for new garments
    };
  };

  const handleNext = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % wardrobeData.length);
  };

  const handlePrev = () => {
    setCurrentIndex((prevIndex) =>
      prevIndex === 0 ? wardrobeData.length - 1 : prevIndex - 1
    );
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
      const wardrobeRes = await fetch('/api/wardrobe');
      const wardrobeJson = await wardrobeRes.json();
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
        const wardrobeRes = await fetch('/api/wardrobe');
        const wardrobeJson = await wardrobeRes.json();
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

    const requiredFields = isNewGarmentMode ? [...schemaData.items.required, 'file_name'] : schemaData.items.required;

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
        else if (prop.enum) {
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
                <div key={index} className="flex space-x-2 mb-2">
                  <Input
                    type="text"
                    name={`material_composition[${index}].material`}
                    value={mc.material}
                    onChange={handleChange}
                    placeholder="e.g., Cotton"
                    className={hasError ? 'border-red-500' : ''}
                  />
                  <Input
                    type="number"
                    name={`material_composition[${index}].percentage`}
                    value={isNaN(mc.percentage) ? '' : mc.percentage}
                    onChange={handleChange}
                    placeholder="e.g., 70 (0-100)"
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
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <Toaster />

      <div className="absolute top-4 right-4">
        <Button variant="default" onClick={() => setIsNewGarmentMode(true)}>
          New Garment
        </Button>
      </div>

      {!isNewGarmentMode && wardrobeData.length > 0 && (
        <div className="flex items-center justify-between w-full max-w-5xl mb-8">
          <Button onClick={handlePrev} variant="outline">
            Previous
          </Button>
          <span className="text-xl">
            {currentIndex + 1} / {wardrobeData.length}
          </span>
          <Button onClick={handleNext} variant="outline">
            Next
          </Button>
        </div>
      )}

      {isNewGarmentMode && (
        <div className="flex items-center justify-between w-full max-w-5xl mb-8">
          <Button variant="outline" onClick={() => {
            setIsNewGarmentMode(false);
            setCurrentIndex(0);
            setValidationErrors({});
          }}>
            Cancel
          </Button>
        </div>
      )}

      {currentGarment && schemaProperties && (
        <Card className="w-full max-w-5xl relative">
          {!isNewGarmentMode && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 text-gray-400 hover:text-red-500"
                onClick={() => handleToggleFavorite(currentGarment.id!, currentGarment.favorite)} // Pass current favorite status
              >
                <FiHeart fill={currentGarment.favorite ? 'red' : 'none'} />
              </Button>
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
              {currentGarment.model} {currentGarment.type}, by {currentGarment.brand}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-6">
              <div className="md:w-1/2 flex flex-col items-center justify-start p-4">
                {currentGarment.file_name && (
                  <Image
                    key={currentGarment.file_name}
                    src={currentGarment.file_name}
                    alt={currentGarment.model}
                    width={400}
                    height={400}
                    objectFit="contain"
                  />
                )}
              </div>

              <form action={isNewGarmentMode ? createFormAction : updateFormAction} className="md:w-1/2 p-4">
                {/* Hidden input for ID when updating */}
                {!isNewGarmentMode && currentGarment.id && (
                  <input type="hidden" name="id" value={currentGarment.id} />
                )}
                
                {/* Hidden input for favorite status */}
                <input type="hidden" name="favorite" value={String(currentGarment.favorite)} />

                {/* Hidden inputs for multi-select fields */}
                <input type="hidden" name="colors" value={currentGarment.color_palette.join(',')} />
                <input type="hidden" name="suitableWeathers" value={currentGarment.suitable_weather.join(',')} />
                <input type="hidden" name="suitableTimesOfDay" value={currentGarment.suitable_time_of_day.join(',')} />
                <input type="hidden" name="suitablePlaces" value={currentGarment.suitable_places.join(',')} />
                <input type="hidden" name="suitableOccasions" value={currentGarment.suitable_occasions.join(',')} />
                <input type="hidden" name="materials" value={JSON.stringify(currentGarment.material_composition.map(m => ({ material: m.material, percentage: m.percentage })))} />

                {/* Hidden inputs for single-select fields */}
                <input type="hidden" name="style" value={currentGarment.style || ''} />
                <input type="hidden" name="formality" value={currentGarment.formality || ''} />
                <input type="hidden" name="warmthLevel" value={currentGarment.warmth_level || ''} />

                <Accordion type="multiple" className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>Basic Information</AccordionTrigger>
                    <AccordionContent>
                      <div>
                        <div>
                          {renderInputField('file_name', { type: 'string', description: 'Image file' }, currentGarment.file_name)}
                          {renderInputField('model', schemaProperties.model, currentGarment.model)}
                        </div>
                        <div className="mb-4 mt-4">
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
                        {renderInputField('warmth_level', schemaProperties.warmth_level, currentGarment.warmth_level)}
                      </div>
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
                <SubmitButton />
              </form>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}