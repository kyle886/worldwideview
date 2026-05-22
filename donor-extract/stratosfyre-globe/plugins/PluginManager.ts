/**
 * PluginManager — lifecycle, polling, caching, and data routing.
 *
 * Adapted from WWV's src/core/plugins/PluginManager.ts. Differences:
 *  1. No Zustand coupling. The host (DeckGlobe) reads plugin data via
 *     `getData(pluginId)` and re-renders normally; loading state is
 *     surfaced through the DataBus rather than store mutators.
 *  2. Cache and polling are pluggable. By default the module singletons
 *     are used; pass a custom instance via the constructor for tests or
 *     for multiple isolated globes on one page.
 *
 * Bootstrap (typical):
 *   await pluginManager.init();
 *   for (const p of pluginRegistry.getAll()) await pluginManager.registerPlugin(p);
 *   pluginManager.enable('markets');
 *
 * Per-plugin data sourcing:
 *  - `plugin.fetchData()` + `plugin.getPollingInterval()` defined → auto-polled
 *  - Otherwise → host pushes data via `pluginManager.setData(id, array)`
 *    (the prop-driven path Stratosfyre uses today)
 */

import type { GlobePlugin, PluginContext } from './types';
import { dataBus } from '../DataBus';
import { cacheLayer as defaultCache, type CacheLayer } from './CacheLayer';
import { pollingManager as defaultPolling, type PollingManager } from './PollingManager';

interface ManagedPlugin {
  plugin: GlobePlugin<unknown>;
  enabled: boolean;
  data: unknown[];
  /** True if a polling task is registered (fetchData + interval > 0 at register time). */
  hasPollingTask: boolean;
}

export interface PluginManagerOptions {
  cache?: CacheLayer;
  polling?: PollingManager;
  /** TTL applied to every cache write done by this manager. Default 30s. */
  cacheTtlMs?: number;
}

class PluginManager {
  private plugins: Map<string, ManagedPlugin> = new Map();
  private initialized = false;
  private cache: CacheLayer;
  private polling: PollingManager;
  private cacheTtl: number;
  private ctxProvider: () => PluginContext = () => ({
    zoom: 0,
    selectedId: null,
    filters: {},
  });

  constructor(opts: PluginManagerOptions = {}) {
    this.cache = opts.cache ?? defaultCache;
    this.polling = opts.polling ?? defaultPolling;
    this.cacheTtl = opts.cacheTtlMs ?? 30_000;
  }

  /** Provide the current cross-cutting context for plugin lifecycle / poll calls. */
  setContextProvider(provider: () => PluginContext): void {
    this.ctxProvider = provider;
  }

  /** Override the cache TTL for subsequent writes (Config panel knob, etc.). */
  setCacheTtl(ttlMs: number): void {
    this.cacheTtl = ttlMs;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.cache.init();
    this.initialized = true;
  }

  async registerPlugin(plugin: GlobePlugin<unknown>): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginManager] Plugin "${plugin.id}" already registered`);
      return;
    }
    const managed: ManagedPlugin = {
      plugin,
      enabled: false,
      data: [],
      hasPollingTask: false,
    };
    this.plugins.set(plugin.id, managed);

    try {
      await plugin.initialize?.(this.ctxProvider());
    } catch (err) {
      console.error(`[PluginManager] init failed for ${plugin.id}:`, err);
    }

    // Register polling if the plugin can fetch and declares an interval.
    const interval = plugin.getPollingInterval?.() ?? 0;
    if (plugin.fetchData && interval > 0) {
      this.polling.register(plugin.id, interval, async () => {
        // Guard: skip if the plugin was disabled between schedule and tick.
        if (!managed.enabled) return;
        try {
          const fresh = await plugin.fetchData!(this.ctxProvider());
          this.handleFreshData(plugin.id, fresh);
        } catch (err) {
          // Re-throw so PollingManager counts the error toward backoff.
          plugin.initialize && console.warn(`[PluginManager] fetch failed for ${plugin.id}:`, err);
          throw err;
        }
      });
      managed.hasPollingTask = true;
    }
  }

  /** Push data into a plugin from outside (prop-driven path). */
  setData<T>(pluginId: string, data: T[]): void {
    this.handleFreshData(pluginId, data);
  }

  getData<T = unknown>(pluginId: string): T[] {
    return (this.plugins.get(pluginId)?.data ?? []) as T[];
  }

  async enable(pluginId: string): Promise<void> {
    const managed = this.plugins.get(pluginId);
    if (!managed || managed.enabled) return;
    managed.enabled = true;

    // L1 first — synchronous, snappy UI.
    const l1 = this.cache.get(pluginId);
    if (l1 && l1.length > 0) {
      managed.data = l1;
      dataBus.emit('dataUpdated', { pluginId, count: l1.length });
    } else {
      // L2 — fire-and-forget. Re-check `managed.enabled` when it resolves
      // in case the user toggled off in the interim.
      this.cache.getFromPersistent(pluginId).then((l2) => {
        if (!l2 || !managed.enabled || managed.data.length > 0) return;
        managed.data = l2;
        dataBus.emit('dataUpdated', { pluginId, count: l2.length });
      });
    }

    if (managed.hasPollingTask) this.polling.start(pluginId);
    dataBus.emit('layerToggled', { pluginId, enabled: true });
  }

  disable(pluginId: string): void {
    const managed = this.plugins.get(pluginId);
    if (!managed || !managed.enabled) return;
    managed.enabled = false;
    if (managed.hasPollingTask) this.polling.stop(pluginId);
    dataBus.emit('layerToggled', { pluginId, enabled: false });
  }

  async toggle(pluginId: string): Promise<void> {
    const managed = this.plugins.get(pluginId);
    if (!managed) return;
    if (managed.enabled) this.disable(pluginId);
    else await this.enable(pluginId);
  }

  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.enabled ?? false;
  }

  getAll(): ManagedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Live-tune the polling interval for a plugin. Pair with a UI control
   * (Config panel "Refresh every: __ s").
   */
  setPollingInterval(pluginId: string, intervalMs: number): void {
    this.polling.setInterval(pluginId, intervalMs);
  }

  destroy(): void {
    this.polling.stopAll();
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

  /** Central handler — write-through cache, store, emit. */
  private handleFreshData<T>(pluginId: string, data: T[]): void {
    const managed = this.plugins.get(pluginId);
    if (!managed) return;
    managed.data = data as unknown[];
    this.cache.set(pluginId, data, this.cacheTtl);
    dataBus.emit('dataUpdated', { pluginId, count: data.length });
  }
}

export function createPluginManager(opts?: PluginManagerOptions): PluginManager {
  return new PluginManager(opts);
}

export const pluginManager = new PluginManager();
export type { PluginManager };
