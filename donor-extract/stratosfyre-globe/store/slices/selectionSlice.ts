import type { SliceCreator } from '../createSlice';
import type { ViewState } from '../index';

export interface SelectionSlice {
  selectedMarketId: string | null;
  setSelectedMarketId(id: string | null): void;
}

export const SELECTION_DEFAULTS: Pick<SelectionSlice, 'selectedMarketId'> = {
  selectedMarketId: null,
};

export const createSelectionSlice: SliceCreator<SelectionSlice, ViewState> = (_get, set) => ({
  ...SELECTION_DEFAULTS,
  setSelectedMarketId(id) {
    set({ selectedMarketId: id });
  },
});
