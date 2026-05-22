/**
 * CacheLayer — two-tier cache: in-memory Map (L1) + IndexedDB (L2).
 *
 * Adapted from WWV's src/core/data/CacheLayer.ts. Differences:
 *  - Generic over the cached datum type. The cache holds `unknown[]`
 *    internally; callers cast at retrieval (`cacheLayer.get<Market>('markets')`).
 *    Runtime is untyped — same pattern as Map-as-cache in any TS codebase.
 *  - DB name configurable at construction; default is 'stratosfyre-globe-cache'.
 *  - Gracefully degrades if IndexedDB is unavailable (private mode, SSR,
 *    test environments). L1 still works in all cases.
 *
 * TTL semantics: each entry stores its own TTL; `get()` returns null and
 * evicts when expired. Default TTL is 30s — short enough that stale data
 * doesn't paint, long enough that a layer toggle feels instant via L1.
 *
 * Use:
 *   await cacheLayer.init();              // open IDB; safe to call repeatedly
 *   cacheLayer.set('markets', markets);   // 30s TTL
 *   cacheLayer.set('aviation', planes, 5_000);  // custom TTL
 *   const cached = cacheLayer.get<Market>('markets');
 *   const persisted = await cacheLayer.getFromPersistent<Market>('markets');
 */

interface CacheEntry {
  data: unknown[];
  timestamp: number;
  ttl: number;
}

export interface CacheLayerOptions {
  dbName?: string;
  storeName?: string;
  /** Default TTL in ms applied when set() is called without an explicit value. */
  defaultTtlMs?: number;
}

class CacheLayer {
  private memoryCache: Map<string, CacheEntry> = new Map();
  private dbName: string;
  private storeName: string;
  private defaultTtl: number;
  private db: IDBDatabase | null = null;
  private initialized = false;

  constructor(opts: CacheLayerOptions = {}) {
    this.dbName = opts.dbName ?? 'stratosfyre-globe-cache';
    this.storeName = opts.storeName ?? 'entries';
    this.defaultTtl = opts.defaultTtlMs ?? 30_000;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof indexedDB === 'undefined') {
      // SSR or a runtime without IDB — L1 only. Not an error.
      return;
    }
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => {
        console.warn('[CacheLayer] IndexedDB unavailable; L1-only mode');
        resolve();
      };
    });
  }

  set<T>(pluginId: string, data: T[], ttlMs?: number): void {
    const entry: CacheEntry = {
      data: data as unknown[],
      timestamp: Date.now(),
      ttl: ttlMs ?? this.defaultTtl,
    };
    this.memoryCache.set(pluginId, entry);
    if (!this.db) return;
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(entry, pluginId);
    } catch {
      // Quota / serialization errors are non-fatal; L1 still has the data.
    }
  }

  get<T = unknown>(pluginId: string): T[] | null {
    const entry = this.memoryCache.get(pluginId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.memoryCache.delete(pluginId);
      return null;
    }
    return entry.data as T[];
  }

  async getFromPersistent<T = unknown>(pluginId: string): Promise<T[] | null> {
    if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readonly');
        const req = tx.objectStore(this.storeName).get(pluginId);
        req.onsuccess = () => {
          const entry = req.result as CacheEntry | undefined;
          if (!entry || Date.now() - entry.timestamp > entry.ttl) {
            resolve(null);
            return;
          }
          // Hot-load into L1 so the next sync `get()` is fast.
          this.memoryCache.set(pluginId, entry);
          resolve(entry.data as T[]);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  invalidate(pluginId: string): void {
    this.memoryCache.delete(pluginId);
    if (!this.db) return;
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(pluginId);
    } catch {
      /* ignore */
    }
  }

  clear(): void {
    this.memoryCache.clear();
    if (!this.db) return;
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).clear();
    } catch {
      /* ignore */
    }
  }
}

export function createCacheLayer(opts?: CacheLayerOptions): CacheLayer {
  return new CacheLayer(opts);
}

export const cacheLayer = new CacheLayer();
export type { CacheLayer };
