/**
 * Composed viewStore — slice-based replacement for the monolithic
 * viewStore.ts.
 *
 * The PUBLIC API is unchanged from the original:
 *   - `viewStore.getState() -> ViewState`
 *   - `viewStore.subscribe(listener) -> unsubscribe`
 *   - Every original mutator (setSelectedMarketId, setRegionFilter,
 *     setActiveLayers, toggleLayer, setHeatmapMode, setColorMetric,
 *     setBasemapMode, toggleSavedMarket, setZoom) is still on the store.
 *
 * What changed:
 *   - State and mutators are defined in `./slices/*.ts`, one concern per file.
 *   - `cameraResetToken` is removed; consumers call `dataBus.emit('cameraReset')`
 *     (a thin shim `resetCamera()` is provided here for back-compat during the
 *     migration; delete once all call sites are updated).
 *   - `getState()` still clones every Set field so external mutations of the
 *     snapshot don't leak into the store.
 */

import { createSelectionSlice, SELECTION_DEFAULTS, type SelectionSlice } from './slices/selectionSlice';
import { createLayersSlice, LAYERS_DEFAULTS, type LayersSlice, type LayerKey, type HeatmapMode } from './slices/layersSlice';
import { createStyleSlice, STYLE_DEFAULTS, type StyleSlice, type ColorMetric, type BasemapMode } from './slices/styleSlice';
import { createCameraSlice, CAMERA_DEFAULTS, type CameraSlice } from './slices/cameraSlice';
import { createFavoritesSlice, FAVORITES_DEFAULTS, type FavoritesSlice } from './slices/favoritesSlice';
import { createFiltersSlice, FILTERS_DEFAULTS, type FiltersSlice, type RegionFilter } from './slices/filtersSlice';
import { dataBus } from '../DataBus';

// Re-export for consumers that imported these from the old viewStore.ts
export type { LayerKey, HeatmapMode, ColorMetric, BasemapMode, RegionFilter };

// ─── Composed state shape ───────────────────────────────────────
export type ViewState = SelectionSlice &
  LayersSlice &
  StyleSlice &
  CameraSlice &
  FavoritesSlice &
  FiltersSlice;

export type ViewStore = ViewState & {
  getState(): ViewState;
  subscribe(listener: ViewListener): () => void;
  /** @deprecated — emits `dataBus.emit('cameraReset')`. Use that directly. */
  resetCamera(): void;
};

export type ViewListener = (state: ViewState) => void;

// ─── Defaults (merged from each slice) ──────────────────────────
const DEFAULT_STATE: ViewState = {
  ...SELECTION_DEFAULTS,
  ...LAYERS_DEFAULTS,
  ...STYLE_DEFAULTS,
  ...CAMERA_DEFAULTS,
  ...FAVORITES_DEFAULTS,
  ...FILTERS_DEFAULTS,
} as ViewState;

// ─── Composer ───────────────────────────────────────────────────
/**
 * Clone every known Set field so callers can mutate the snapshot freely
 * without leaking changes back into the store. Mirrors the original
 * viewStore.getState() behavior.
 */
function cloneState(s: ViewState): ViewState {
  return {
    ...s,
    activeLayers: new Set(s.activeLayers),
    savedMarketIds: new Set(s.savedMarketIds),
  };
}

export function createViewStore(initial?: Partial<ViewState>): ViewStore {
  let state: ViewState = {
    ...DEFAULT_STATE,
    ...initial,
    activeLayers: new Set(initial?.activeLayers ?? DEFAULT_STATE.activeLayers),
    savedMarketIds: new Set(initial?.savedMarketIds ?? DEFAULT_STATE.savedMarketIds),
  };

  const listeners = new Set<ViewListener>();

  const get = (): ViewState => state;
  const set = (patch: Partial<ViewState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  // Compose slices. Each slice contributes both its state defaults
  // (already merged into DEFAULT_STATE) and its mutator methods.
  const slices: ViewState = {
    ...createSelectionSlice(get, set),
    ...createLayersSlice(get, set),
    ...createStyleSlice(get, set),
    ...createCameraSlice(get, set),
    ...createFavoritesSlice(get, set),
    ...createFiltersSlice(get, set),
  };

  return {
    ...slices,
    getState: () => cloneState(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resetCamera() {
      dataBus.emit('cameraReset', {} as Record<string, never>);
    },
  } as ViewStore;
}

/** Module-scope singleton — used by DeckGlobe + controllers by default. */
export const viewStore: ViewStore = createViewStore();
