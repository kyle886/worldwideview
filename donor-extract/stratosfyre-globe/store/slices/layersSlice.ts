import type { SliceCreator } from '../createSlice';
import type { ViewState } from '../index';

export type LayerKey = 'markers' | 'arcs' | 'hex' | 'voronoi' | 'photoreal3d';
export type HeatmapMode = 'none' | 'extruded';

export interface LayersSlice {
  activeLayers: ReadonlySet<LayerKey>;
  heatmapMode: HeatmapMode;
  setActiveLayers(layers: ReadonlySet<LayerKey>): void;
  toggleLayer(layer: LayerKey): void;
  setHeatmapMode(mode: HeatmapMode): void;
}

export const LAYERS_DEFAULTS: Pick<LayersSlice, 'activeLayers' | 'heatmapMode'> = {
  activeLayers: new Set<LayerKey>(['markers']),
  heatmapMode: 'none',
};

export const createLayersSlice: SliceCreator<LayersSlice, ViewState> = (get, set) => ({
  ...LAYERS_DEFAULTS,
  setActiveLayers(layers) {
    set({ activeLayers: new Set(layers) });
  },
  toggleLayer(layer) {
    const next = new Set(get().activeLayers);
    if (next.has(layer)) next.delete(layer);
    else next.add(layer);
    set({ activeLayers: next });
  },
  setHeatmapMode(mode) {
    set({ heatmapMode: mode });
  },
});
