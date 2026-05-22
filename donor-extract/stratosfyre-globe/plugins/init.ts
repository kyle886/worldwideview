/**
 * Plugin bootstrap — register all built-in plugins and wire the
 * PluginManager's context provider against the sliced viewStore.
 *
 * Call once at app startup (e.g. from your top-level App component, the
 * same place that today owns the `viewStore` and `<DeckGlobe>` mount).
 *
 *   import { initGlobePlugins } from './globe/plugins/init';
 *   await initGlobePlugins({ store: viewStore });
 *
 * After this call:
 *  - All built-in plugins are registered and initialized.
 *  - `pluginManager.setContextProvider` returns a fresh PluginContext on
 *    every call, derived from the current `viewStore.getState()`.
 *  - You still need to feed prop-driven data in once it lands:
 *      pluginManager.setData('markets', markets);
 *      pluginManager.setData('arcs', arcs);
 *      pluginManager.setData('voronoi', voronoiPolygons);
 *      pluginManager.setData('hex', markets); // hex derives from markets
 */

import { pluginRegistry } from './PluginRegistry';
import { pluginManager } from './PluginManager';
import type { PluginContext } from './types';
import type { ViewStore } from '../store';

import { MarketsPlugin } from './builtin/MarketsPlugin';
import { ArcsPlugin } from './builtin/ArcsPlugin';
import { HexPlugin } from './builtin/HexPlugin';
import { VoronoiPlugin } from './builtin/VoronoiPlugin';
import { Photoreal3dPlugin } from './builtin/Photoreal3dPlugin';
import { BasemapPlugin } from './builtin/BasemapPlugin';

export interface InitOptions {
  store: ViewStore;
}

/** Idempotent: safe to call more than once during HMR. */
let initialized = false;

export async function initGlobePlugins({ store }: InitOptions): Promise<void> {
  if (initialized) return;

  // Snapshot-driven context provider. Reads the latest store state every
  // time the manager (or a plugin via `manager.setContextProvider`) asks.
  pluginManager.setContextProvider((): PluginContext => {
    const s = store.getState();
    return {
      zoom: s.zoom,
      selectedId: s.selectedMarketId,
      filters: {}, // wire when filtersSlice gets the per-plugin shape
      styleMetric: s.colorMetric,
      heatmapMode: s.heatmapMode,
      basemapMode: s.basemapMode,
    };
  });

  // Register built-ins. Order is for boot-log readability — registration is
  // not order-sensitive. BasemapPlugin first so it shows up at the bottom of
  // the layer stack.
  pluginRegistry.register(new BasemapPlugin());
  pluginRegistry.register(new MarketsPlugin());
  pluginRegistry.register(new VoronoiPlugin());
  pluginRegistry.register(new HexPlugin());
  pluginRegistry.register(new ArcsPlugin());
  pluginRegistry.register(new Photoreal3dPlugin());

  await pluginManager.init();

  for (const plugin of pluginRegistry.getAll()) {
    await pluginManager.registerPlugin(plugin);
    // Enable all toggleable plugins by default — UI toggles them via
    // store.toggleLayer; alwaysOn plugins ignore the activeLayers gate.
    pluginManager.enable(plugin.id);
  }

  initialized = true;
}
