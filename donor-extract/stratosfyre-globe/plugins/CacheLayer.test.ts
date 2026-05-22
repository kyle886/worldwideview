/**
 * Tests for CacheLayer.
 *
 * Focus is on L1 (memory) semantics and the IDB-absent fallback. Full IDB
 * integration is left for an e2e test — jsdom's IDB shim varies by version
 * and isn't worth fighting in a unit test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCacheLayer } from './CacheLayer';

interface Market { id: string; name: string }

describe('CacheLayer — L1 memory', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('set + get round-trips', async () => {
    const cache = createCacheLayer();
    await cache.init();
    cache.set<Market>('markets', [{ id: 'm1', name: 'NYC' }]);
    const out = cache.get<Market>('markets');
    expect(out).toEqual([{ id: 'm1', name: 'NYC' }]);
  });

  it('expires entries past their TTL', async () => {
    const cache = createCacheLayer({ defaultTtlMs: 1000 });
    await cache.init();
    cache.set('markets', [{ id: 'm1' }]);
    expect(cache.get('markets')).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(cache.get('markets')).toBeNull();
  });

  it('honours a per-call TTL override', async () => {
    const cache = createCacheLayer({ defaultTtlMs: 30_000 });
    await cache.init();
    cache.set('markets', [{ id: 'm1' }], 500);
    vi.advanceTimersByTime(600);
    expect(cache.get('markets')).toBeNull();
  });

  it('invalidate() removes the entry from L1', async () => {
    const cache = createCacheLayer();
    await cache.init();
    cache.set('markets', [{ id: 'm1' }]);
    cache.invalidate('markets');
    expect(cache.get('markets')).toBeNull();
  });

  it('clear() empties the L1 cache', async () => {
    const cache = createCacheLayer();
    await cache.init();
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });

  it('returns null on cache miss', async () => {
    const cache = createCacheLayer();
    await cache.init();
    expect(cache.get('never-set')).toBeNull();
  });
});

describe('CacheLayer — IDB-absent fallback', () => {
  let originalIDB: unknown;

  beforeEach(() => {
    originalIDB = (globalThis as Record<string, unknown>).indexedDB;
    delete (globalThis as Record<string, unknown>).indexedDB;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).indexedDB = originalIDB;
  });

  it('init() resolves even without IDB', async () => {
    const cache = createCacheLayer();
    await expect(cache.init()).resolves.toBeUndefined();
  });

  it('set/get still work — L1 only', async () => {
    const cache = createCacheLayer();
    await cache.init();
    cache.set('markets', [{ id: 'm1' }]);
    expect(cache.get('markets')).toEqual([{ id: 'm1' }]);
  });

  it('getFromPersistent() returns null without IDB', async () => {
    const cache = createCacheLayer();
    await cache.init();
    expect(await cache.getFromPersistent('markets')).toBeNull();
  });
});
