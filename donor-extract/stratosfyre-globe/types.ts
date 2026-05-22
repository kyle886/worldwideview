/**
 * GlobePlugin — deck.gl-flavored adaptation of WWV's WorldPlugin.
 *
 * Key differences from WWV's `WorldPlugin`:
 *  - No `GeoEntity` requirement — each plugin is generic over its own datum type
 *    via `<TDatum>`. Markets, arcs, hex cells, and polygons all coexist.
 *  - No `renderEntity(entity) -> CesiumEntityOptions`. Instead, `buildLayers()`
 *    returns zero or more deck.gl Layer instances — matching deck.gl's
 *    "construct the layer with all data and accessors" model rather than
 *    Cesium's per-entity primitive update.
 *  - `onPick` + `getFlyToTarget` replace WWV's `SelectionBehavior`.
 *  - `category` is left open as a string for now; tighten when the UI taxonomy
 *    settles.
 */

import type { Layer, PickingInfo } from '@deck.gl/core';

export type PluginCategory =
  | 'markets'
  | 'overlay'
  | 'basemap'
  | 'heatmap'
  | 'photoreal'
  | 'custom';

// ─── Filter definitions (mirror of WWV) ─────────────────────────
export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterRangeConfig {
  min: number;
  max: number;
  step: number;
}

export interface FilterDefinition {
  id: string;
  label: string;
  type: 'text' | 'select' | 'range' | 'boolean';
  /** Key into the datum object that this filter reads from. */
  propertyKey: string;
  options?: FilterSelectOption[];
  range?: FilterRangeConfig;
}

export type FilterValue =
  | { type: 'text'; value: string }
  | { type: 'select'; values: string[] }
  | { type: 'range'; min: number; max: number }
  | { type: 'boolean'; value: boolean };

// ─── Fly-to target ──────────────────────────────────────────────
export interface FlyToTarget {
  longitude: number;
  latitude: number;
  zoom?: number;
  /** Transition duration in ms. 0 = no transition. */
  durationMs?: number;
  /** FlyToInterpolator speed factor. Default 1.6. */
  speed?: number;
}

// ─── Plugin context — passed to lifecycle + render hooks ────────
/**
 * Provided to every plugin during initialize/buildLayers/onPick.
 * Carries cross-cutting state that plugins may read but should not mutate
 * directly — all mutations go through the store or DataBus.
 */
export interface PluginContext {
  /** Current zoom level. */
  zoom: number;
  /** Currently selected entity id, or null. */
  selectedId: string | null;
  /** Active filters keyed by plugin id, then by filter id. */
  filters: Record<string, Record<string, FilterValue>>;
  /** Globally-controlled style metric (e.g. 'mis' | 'vacancy' | 'rent' in Stratosfyre). */
  styleMetric?: string;
  /** Push an error up to the host shell (toast, log). */
  onError?: (err: Error) => void;
}

// ─── buildLayers input ──────────────────────────────────────────
export interface BuildLayersInput<TDatum> {
  data: TDatum[];
  ctx: PluginContext;
}

// ─── The interface ──────────────────────────────────────────────
export interface GlobePlugin<TDatum = unknown> {
  // Identity
  id: string;
  name: string;
  description?: string;
  category: PluginCategory;
  version: string;

  // Lifecycle
  initialize?(ctx: PluginContext): void | Promise<void>;
  destroy?(): void;

  // Data sourcing — optional for plugins whose data is passed in from host
  /**
   * Fetch the plugin's data set. Called by PluginManager on the polling interval
   * if `getPollingInterval()` returns a positive value. Plugins whose data is
   * supplied as props (e.g. MarketsPlugin in the current Stratosfyre dashboard)
   * can leave this undefined.
   */
  fetchData?(ctx: PluginContext): Promise<TDatum[]>;
  /** Polling interval in ms. Return 0 or undefined to disable polling. */
  getPollingInterval?(): number;

  // Rendering — the heart of the contract
  /**
   * Return zero or more deck.gl Layer instances. Called every time data or
   * context (zoom, selection, style) changes.
   *
   * Return `[]` to render nothing (e.g. zoom below threshold, no data, layer
   * toggled off — the manager already filters by activeLayers but a plugin
   * can short-circuit further).
   */
  buildLayers(input: BuildLayersInput<TDatum>): Layer[];

  // Interaction
  /** Extract a stable id from a picked datum. Used for selection and dedup. */
  getEntityId?(datum: TDatum): string;
  /**
   * Called when a layer owned by this plugin is clicked. The plugin decides
   * what to do — update local store, emit DataBus events, etc.
   */
  onPick?(datum: TDatum, info: PickingInfo, ctx: PluginContext): void;
  /**
   * Return a camera target for fly-to on selection, or null for no movement.
   * Lets each plugin declare its own framing (markets want zoom: 6 over 1.2s;
   * a portfolio overlay might want zoom: 4 with no transition).
   */
  getFlyToTarget?(datum: TDatum): FlyToTarget | null;

  // Filtering
  getFilterDefinitions?(): FilterDefinition[];

  // Optional UI extensions — return React components for sidebar / detail panes
  getSidebarComponent?(): React.ComponentType;
  getDetailComponent?(): React.ComponentType<{ datum: TDatum }>;
}

// ─── DataBus event contract ─────────────────────────────────────
/**
 * Cross-cutting events. Replace `cameraResetToken` and `onMarketClick`
 * prop with these. Plugins and UI components both publish and subscribe.
 */
export interface GlobeEvents {
  /** Bubbled up when any plugin selects an entity (or selection is cleared). */
  entitySelected: { pluginId: string; id: string | null; datum: unknown };
  /** Request a camera reset to the default view. */
  cameraReset: Record<string, never>;
  /** Request the camera fly to a specific location. */
  cameraFlyTo: FlyToTarget;
  /** A plugin's data set changed (after fetch, filter, or external update). */
  dataUpdated: { pluginId: string; count: number };
  /** A layer was toggled on/off. */
  layerToggled: { pluginId: string; enabled: boolean };
  /** Globe shell finished its initial render (canvas has `data-deck-ready`). */
  globeReady: Record<string, never>;
  /** Non-blocking error to surface as a toast. */
  globeError: { code: string; message: string };
}
