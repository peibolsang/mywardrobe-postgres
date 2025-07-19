export interface Garment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  features: string;
  favorite: boolean;
  style_id: number;
  formality_id: number;
  warmth_level_id: number;
}

export interface MaterialComposition {
  material: string;
  percentage: number;
}

export interface GarmentFormData {
  id?: number;
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
  favorite: boolean;
}
