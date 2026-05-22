import type { SliceCreator } from '../createSlice';
import type { ViewState } from '../index';

export type ColorMetric = 'mis' | 'vacancy' | 'rent';
export type BasemapMode = 'dark' | 'light' | 'voyager' | 'terrain' | 'contrast';

export interface StyleSlice {
  colorMetric: ColorMetric;
  basemapMode: BasemapMode;
  setColorMetric(metric: ColorMetric): void;
  setBasemapMode(mode: BasemapMode): void;
}

export const STYLE_DEFAULTS: Pick<StyleSlice, 'colorMetric' | 'basemapMode'> = {
  colorMetric: 'mis',
  basemapMode: 'dark',
};

export const createStyleSlice: SliceCreator<StyleSlice, ViewState> = (_get, set) => ({
  ...STYLE_DEFAULTS,
  setColorMetric(metric) {
    set({ colorMetric: metric });
  },
  setBasemapMode(mode) {
    set({ basemapMode: mode });
  },
});
