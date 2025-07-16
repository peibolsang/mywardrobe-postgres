"use client";

import { useState, useEffect } from 'react';
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
import Link from 'next/link';
import { cn } from '../lib/utils';

interface MaterialComposition {
  material: string;
  percentage: number;
}

interface Garment {
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: MaterialComposition[];
  color_palette: string[];
  warmth_level: string;
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
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

interface EditorFormProps {
  initialWardrobeData: Garment[];
  initialSchemaData: Schema;
}

export default function EditorForm({ initialWardrobeData, initialSchemaData }: EditorFormProps) {
  const [wardrobeData, setWardrobeData] = useState<Garment[]>(initialWardrobeData);
  const [schemaData, setSchemaData] = useState<Schema>(initialSchemaData);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [formData, setFormData] = useState<Garment | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isNewGarmentMode, setIsNewGarmentMode] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const initializeNewGarment = (): Garment => ({
    file_name: '', // Will be generated or handled later
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
  });

  useEffect(() => {
    if (wardrobeData.length > 0 && !isNewGarmentMode) {
      const currentGarment = wardrobeData[currentIndex];
      const filteredMaterialComposition = currentGarment.material_composition.filter(mc => mc.percentage > 0);
      setFormData({ ...currentGarment, material_composition: filteredMaterialComposition });
    } else if (isNewGarmentMode) {
      setFormData(initializeNewGarment());
    }
  }, [currentIndex, wardrobeData, isNewGarmentMode]);

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
      // Handle array types (e.g., color_palette, suitable_weather) - now handled by MultiSelect
      if (name.startsWith('material_composition[')) {
        // Handle material_composition array of objects
        const [_, indexStr, field] = name.match(/material_composition\[(\d+)\]\.(.*)/) || [];
        const index = parseInt(indexStr);
        const newMaterialComposition = [...prevData.material_composition];
        if (field === 'percentage') {
          const newPercentage = value === '' ? NaN : parseInt(value); // Allow empty string, convert to NaN
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

  const handleSave = async () => {
    if (!formData) return;

    const errors = validateForm(formData);
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      toast.error('Please fill in all required fields.');
      return;
    }

    const dataToSave = {
      ...formData,
      material_composition: formData.material_composition.filter(mc => mc.percentage > 0)
    };

    let updatedWardrobeData = [];
    if (isNewGarmentMode) {
      updatedWardrobeData = [...wardrobeData, dataToSave];
    } else {
      updatedWardrobeData = wardrobeData.map((item, idx) => (idx === currentIndex ? dataToSave : item));
    }

    try {
      setIsSaving(true);
      const res = await fetch('/api/update-wardrobe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedWardrobeData),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      setWardrobeData(updatedWardrobeData);
      if (isNewGarmentMode) { // Only change index if a new garment was added
        setCurrentIndex(updatedWardrobeData.length - 1);
      }
      setIsNewGarmentMode(false); // Exit new garment mode after saving
      setValidationErrors({}); // Clear validation errors on successful save

      toast.success('Wardrobe data updated successfully!', {
        style: {
          background: "#d4edda",
          color: "#155724",
          borderColor: "#c3e6cb",
        },
      });
    } catch (e: any) {
      console.error('Error saving data:', e);
      toast.error(`Failed to save data: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const validateForm = (data: Garment) => {
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
        } else if (prop.items?.enum) { // Check if the array items have enums
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
          // Fallback for other array types if any
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

      {!isNewGarmentMode && (
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
            setCurrentIndex(0); // Go back to the first garment
            setValidationErrors({}); // Clear validation errors
          }}>
            Cancel
          </Button>
        </div>
      )}

      {currentGarment && schemaProperties && (
        <Card className="w-full max-w-5xl">
          <CardHeader>
            <CardTitle className="text-center text-2xl">{currentGarment.model} {currentGarment.type}, by {currentGarment.brand}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-6">
              <div className="md:w-1/2 flex flex-col items-center justify-start p-4">
                {currentGarment.file_name && (
                  <Image
                    key={currentGarment.file_name} // Add key to force re-render on file_name change
                    src={currentGarment.file_name}
                    alt={currentGarment.model}
                    width={400}
                    height={400}
                    objectFit="contain"
                  />
                )}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="md:w-1/2 p-4">
                
                <Accordion type="multiple" className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>Basic Information</AccordionTrigger>
                    <AccordionContent>
              <div>
                <div>
                        {isNewGarmentMode && renderInputField('file_name', { type: 'string', description: 'Image file name (e.g., /image.png)' }, currentGarment.file_name)}
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
                <Button type="submit" className="mt-4 w-full" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
