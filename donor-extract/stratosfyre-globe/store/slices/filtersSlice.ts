/**
 * filtersSlice — Phase 2 holds `regionFilter` in its current shape so this
 * slicing pass is purely mechanical. Phase 3 (plugin-ification) replaces
 * `regionFilter` with the generic per-plugin filter system:
 *
 *   filters: Record<pluginId, Record<filterId, FilterValue>>
 *
 * Plugins then declare their filter knobs via `getFilterDefinitions()` and a
 * generic FilterPanel UI reads them. For now the existing prop survives so
 * Phase 2 stays a pure refactor.
 */

import type { SliceCreator } from '../createSlice';
import type { ViewState } from '../index';

// Whatever your current RegionFilter union is — re-export the existing type
// from src/globe/types in the real codebase.
export type RegionFilter = 'all' | string;

export interface FiltersSlice {
  regionFilter: RegionFilter;
  setRegionFilter(filter: RegionFilter): void;
}

export const FILTERS_DEFAULTS: Pick<FiltersSlice, 'regionFilter'> = {
  regionFilter: 'all',
};

export const createFiltersSlice: SliceCreator<FiltersSlice, ViewState> = (_get, set) => ({
  ...FILTERS_DEFAULTS,
  setRegionFilter(filter) {
    set({ regionFilter: filter });
  },
});
