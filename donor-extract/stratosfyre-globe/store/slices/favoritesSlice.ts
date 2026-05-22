import type { SliceCreator } from '../createSlice';
import type { ViewState } from '../index';

export interface FavoritesSlice {
  savedMarketIds: ReadonlySet<string>;
  toggleSavedMarket(id: string): void;
  clearSavedMarkets(): void;
}

export const FAVORITES_DEFAULTS: Pick<FavoritesSlice, 'savedMarketIds'> = {
  savedMarketIds: new Set<string>(),
};

export const createFavoritesSlice: SliceCreator<FavoritesSlice, ViewState> = (get, set) => ({
  ...FAVORITES_DEFAULTS,
  toggleSavedMarket(id) {
    const next = new Set(get().savedMarketIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ savedMarketIds: next });
  },
  clearSavedMarkets() {
    set({ savedMarketIds: new Set() });
  },
});
