export interface Garment {
  id: number;
  file_name: string;
  model: string;
  brand: string;
  type: string;
  style: string;
  formality: string;
  material_composition: MaterialComposition[];
  color_palette: string[];
  suitable_weather: string[];
  suitable_time_of_day: string[];
  suitable_places: string[];
  suitable_occasions: string[];
  features: string;
  favorite?: boolean;
}

export interface MaterialComposition {
  material: string;
  percentage: number;
}

export type GarmentFormData = Omit<Garment, 'id' | 'favorite'> & {
  id?: number;
  favorite: boolean;
};
