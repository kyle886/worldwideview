/**
 * Typed pub/sub event bus.
 *
 * Lifted near-verbatim from WWV's src/core/data/DataBus.ts; the only change is
 * pointing the event-name keys at Stratosfyre's `GlobeEvents` (see types.ts).
 *
 * Usage:
 *   import { dataBus } from './DataBus';
 *
 *   const unsub = dataBus.on('cameraFlyTo', ({ longitude, latitude, zoom }) => { ... });
 *   dataBus.emit('cameraFlyTo', { longitude: -73.9, latitude: 40.7, zoom: 6 });
 *   unsub();
 *
 * Singleton-by-default. Use `createDataBus()` in tests to get an isolated
 * instance.
 */

import type { GlobeEvents } from './types';

type EventHandler<T> = (data: T) => void;

class DataBus {
  private listeners: Map<string, Set<EventHandler<unknown>>> = new Map();

  on<K extends keyof GlobeEvents>(
    event: K,
    handler: EventHandler<GlobeEvents[K]>,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<unknown>);
    return () => {
      this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
    };
  }

  emit<K extends keyof GlobeEvents>(event: K, data: GlobeEvents[K]): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[DataBus] Error in handler for "${String(event)}":`, err);
      }
    });
  }

  off<K extends keyof GlobeEvents>(
    event: K,
    handler: EventHandler<GlobeEvents[K]>,
  ): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  removeAllListeners(event?: keyof GlobeEvents): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

export function createDataBus(): DataBus {
  return new DataBus();
}

/** Module-scope singleton — the default for most call sites. */
export const dataBus = new DataBus();
