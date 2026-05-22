/**
 * PluginManager — lifecycle + data routing.
 *
 * Adapted from WWV's src/core/plugins/PluginManager.ts. Two differences:
 *  1. Polling and caching are stubbed (not wired). Drop in PollingManager +
 *     CacheLayer from WWV in Phase 5 when a live feed arrives — the hooks
 *     (`registerPolling`, `loadFromCache`) are already in place as no-ops.
 *  2. No Zustand coupling. The host (DeckGlobe) reads plugin data via
 *     `getData(pluginId)` and re-renders normally; loading state can be
 *     surfaced via the DataBus instead of through a store mutator.
 *
 * Usage:
 *   await pluginManager.init();
 *   for (const p of pluginRegistry.getAll()) await pluginManager.registerPlugin(p);
 *   pluginManager.setData('markets', marketsArray);   // for prop-driven plugins
 *   pluginManager.enable('markets');                  // for fetch-driven plugins
 */

import type { GlobePlugin, PluginContext } from './types';
import { dataBus } from '../DataBus';

interface ManagedPlugin {
  plugin: GlobePlugin<unknown>;
  enabled: boolean;
  data: unknown[];
}

class PluginManager {
  private plugins: Map<string, ManagedPlugin> = new Map();
  private initialized = false;
  private ctxProvider: () => PluginContext = () => ({
    zoom: 0,
    selectedId: null,
    filters: {},
  });

  /**
   * Provide a function that returns the current cross-cutting context whenever
   * the manager calls into a plugin. Wire this in DeckGlobe so plugins can read
   * `state.selectedMarketId`, `state.colorMetric`, etc.
   */
  setContextProvider(provider: () => PluginContext): void {
    this.ctxProvider = provider;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // Future: await cacheLayer.init();
    this.initialized = true;
  }

  async registerPlugin(plugin: GlobePlugin<unknown>): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginManager] Plugin "${plugin.id}" already registered`);
      return;
    }
    this.plugins.set(plugin.id, { plugin, enabled: false, data: [] });
    try {
      await plugin.initialize?.(this.ctxProvider());
    } catch (err) {
      console.error(`[PluginManager] init failed for ${plugin.id}:`, err);
    }
    // Future: pollingManager.register(plugin.id, plugin.getPollingInterval?.() ?? 0, ...)
  }

  /**
   * Push data into a plugin from outside (the common case while Stratosfyre
   * still receives markets/arcs/voronoi as props from the dashboard).
   * Emits `dataUpdated` so any UI counter can react.
   */
  setData<T>(pluginId: string, data: T[]): void {
    const managed = this.plugins.get(pluginId);
    if (!managed) return;
    managed.data = data as unknown[];
    dataBus.emit('dataUpdated', { pluginId, count: data.length });
  }

  getData<T = unknown>(pluginId: string): T[] {
    return (this.plugins.get(pluginId)?.data ?? []) as T[];
  }

  enable(pluginId: string): void {
    const managed = this.plugins.get(pluginId);
    if (!managed || managed.enabled) return;
    managed.enabled = true;
    // Future: cacheLayer.get(id) -> seed managed.data; pollingManager.start(id)
    dataBus.emit('layerToggled', { pluginId, enabled: true });
  }

  disable(pluginId: string): void {
    const managed = this.plugins.get(pluginId);
    if (!managed || !managed.enabled) return;
    managed.enabled = false;
    // Future: pollingManager.stop(id)
    dataBus.emit('layerToggled', { pluginId, enabled: false });
  }

  toggle(pluginId: string): void {
    const managed = this.plugins.get(pluginId);
    if (!managed) return;
    if (managed.enabled) this.disable(pluginId);
    else this.enable(pluginId);
  }

  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.enabled ?? false;
  }

  getAll(): ManagedPlugin[] {
    return Array.from(this.plugins.values());
  }

  destroy(): void {
    this.plugins.forEach((m) => {
      try {
        m.plugin.destroy?.();
      } catch {
        /* ignore */
      }
    });
    this.plugins.clear();
    this.initialized = false;
  }
}

export const pluginManager = new PluginManager();
