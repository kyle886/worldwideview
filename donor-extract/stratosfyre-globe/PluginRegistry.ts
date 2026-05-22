/**
 * Plugin registry — static lookup by id + dynamic registration.
 *
 * Lifted from WWV's src/core/plugins/PluginRegistry.ts. The only difference is
 * the `WorldPlugin` type was renamed to `GlobePlugin<unknown>` so plugins of
 * different datum shapes share one registry.
 */

import type { GlobePlugin } from './types';

type AnyPlugin = GlobePlugin<unknown>;

class PluginRegistry {
  private plugins: Map<string, AnyPlugin> = new Map();

  register(plugin: AnyPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginRegistry] Plugin "${plugin.id}" already registered`);
      return;
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(pluginId: string): AnyPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getAll(): AnyPlugin[] {
    return Array.from(this.plugins.values());
  }

  getByCategory(category: string): AnyPlugin[] {
    return this.getAll().filter((p) => p.category === category);
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  unregister(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

  /** Test helper — wipe all registrations. */
  clear(): void {
    this.plugins.clear();
  }
}

export const pluginRegistry = new PluginRegistry();
