/**
 * Compatibility test for the sliced viewStore.
 *
 * Goals:
 *  1. The new sliced store exposes the same public API as the original
 *     monolithic viewStore (every mutator, getState, subscribe).
 *  2. Every mutator notifies every listener (no equality short-circuit —
 *     matches the explicit "Keeps the model simple" comment in the original).
 *  3. Sets returned by getState are clones; mutating the snapshot does not
 *     leak back into the store.
 *  4. `resetCamera()` (the back-compat shim) emits `cameraReset` on the
 *     DataBus rather than mutating the store.
 *
 * Two phases of safety:
 *  - These tests run against the new store alone, asserting the contract.
 *  - When you're ready to swap the singleton in `DeckGlobe.tsx`, add a
 *    "parity test" that imports BOTH the old and new store and runs them
 *    in lockstep — see `runParity()` at the bottom of this file. Wire it
 *    by adding the old store import; delete once the swap is shipped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createViewStore, type ViewState, type ViewStore } from './index';
import { dataBus } from '../DataBus';

describe('sliced viewStore', () => {
  let store: ViewStore;

  beforeEach(() => {
    store = createViewStore();
  });

  describe('initial state', () => {
    it('matches documented defaults', () => {
      const s = store.getState();
      expect(s.selectedMarketId).toBeNull();
      expect(s.regionFilter).toBe('all');
      expect(s.activeLayers).toEqual(new Set(['markers']));
      expect(s.heatmapMode).toBe('none');
      expect(s.colorMetric).toBe('mis');
      expect(s.basemapMode).toBe('dark');
      expect(s.savedMarketIds).toEqual(new Set());
      expect(s.zoom).toBe(1.5);
    });

    it('accepts a partial initial state', () => {
      const s = createViewStore({ zoom: 8, colorMetric: 'rent' }).getState();
      expect(s.zoom).toBe(8);
      expect(s.colorMetric).toBe('rent');
      // unspecified fields keep defaults
      expect(s.basemapMode).toBe('dark');
    });

    it('does not allow external mutation of initial Sets to leak in', () => {
      const layers = new Set(['markers', 'arcs'] as const);
      const s = createViewStore({ activeLayers: layers });
      (layers as Set<string>).add('hex');
      expect(s.getState().activeLayers.has('hex' as never)).toBe(false);
    });
  });

  describe('mutators notify on every change', () => {
    it.each([
      ['setSelectedMarketId', (s: ViewStore) => s.setSelectedMarketId('m1')],
      ['setRegionFilter',     (s: ViewStore) => s.setRegionFilter('americas')],
      ['setActiveLayers',     (s: ViewStore) => s.setActiveLayers(new Set(['arcs']))],
      ['toggleLayer',         (s: ViewStore) => s.toggleLayer('hex')],
      ['setHeatmapMode',      (s: ViewStore) => s.setHeatmapMode('extruded')],
      ['setColorMetric',      (s: ViewStore) => s.setColorMetric('vacancy')],
      ['setBasemapMode',      (s: ViewStore) => s.setBasemapMode('light')],
      ['toggleSavedMarket',   (s: ViewStore) => s.toggleSavedMarket('m1')],
      ['setZoom',             (s: ViewStore) => s.setZoom(5)],
    ])('%s notifies subscribers', (_, fire) => {
      const listener = vi.fn();
      const unsub = store.subscribe(listener);
      fire(store);
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('notifies even when the new value equals the old (no short-circuit)', () => {
      const listener = vi.fn();
      store.subscribe(listener);
      store.setColorMetric('mis'); // already 'mis'
      store.setColorMetric('mis');
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('unsubscribe stops further notifications', () => {
      const listener = vi.fn();
      const unsub = store.subscribe(listener);
      store.setZoom(2);
      unsub();
      store.setZoom(3);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('selection slice', () => {
    it('round-trips a market id', () => {
      store.setSelectedMarketId('mkt-42');
      expect(store.getState().selectedMarketId).toBe('mkt-42');
      store.setSelectedMarketId(null);
      expect(store.getState().selectedMarketId).toBeNull();
    });
  });

  describe('layers slice', () => {
    it('toggleLayer adds when missing, removes when present', () => {
      store.toggleLayer('arcs');
      expect(store.getState().activeLayers.has('arcs')).toBe(true);
      store.toggleLayer('arcs');
      expect(store.getState().activeLayers.has('arcs')).toBe(false);
    });

    it('setActiveLayers replaces the set entirely', () => {
      store.setActiveLayers(new Set(['voronoi', 'hex']));
      const s = store.getState();
      expect(s.activeLayers.has('markers')).toBe(false);
      expect(s.activeLayers.has('voronoi')).toBe(true);
      expect(s.activeLayers.has('hex')).toBe(true);
    });

    it('setHeatmapMode round-trips', () => {
      store.setHeatmapMode('extruded');
      expect(store.getState().heatmapMode).toBe('extruded');
    });
  });

  describe('favorites slice', () => {
    it('toggleSavedMarket adds and removes', () => {
      store.toggleSavedMarket('m1');
      store.toggleSavedMarket('m2');
      expect(store.getState().savedMarketIds).toEqual(new Set(['m1', 'm2']));
      store.toggleSavedMarket('m1');
      expect(store.getState().savedMarketIds).toEqual(new Set(['m2']));
    });

    it('clearSavedMarkets empties the set', () => {
      store.toggleSavedMarket('m1');
      store.clearSavedMarkets();
      expect(store.getState().savedMarketIds.size).toBe(0);
    });
  });

  describe('getState returns clones', () => {
    it('mutating activeLayers on the snapshot does not affect the store', () => {
      const snapshot = store.getState();
      (snapshot.activeLayers as Set<string>).add('arcs');
      expect(store.getState().activeLayers.has('arcs' as never)).toBe(false);
    });

    it('mutating savedMarketIds on the snapshot does not affect the store', () => {
      store.toggleSavedMarket('m1');
      const snapshot = store.getState();
      (snapshot.savedMarketIds as Set<string>).add('m999');
      expect(store.getState().savedMarketIds.has('m999')).toBe(false);
    });
  });

  describe('camera reset shim', () => {
    let busListener: ReturnType<typeof vi.fn>;
    let unsub: () => void;

    beforeEach(() => {
      busListener = vi.fn();
      unsub = dataBus.on('cameraReset', busListener);
    });
    afterEach(() => unsub());

    it('resetCamera() emits cameraReset on the DataBus', () => {
      store.resetCamera();
      expect(busListener).toHaveBeenCalledTimes(1);
    });

    it('resetCamera() does NOT bump any field on the store (token is gone)', () => {
      const before = store.getState();
      store.resetCamera();
      // No state changed — only the DataBus event fired.
      expect(store.getState()).toEqual(before);
    });
  });
});

/**
 * Parity helper — wire when you want side-by-side verification.
 *
 * Usage during migration:
 *
 *   import { createViewStore as createOldStore } from './viewStore'; // old file
 *   import { createViewStore as createNewStore } from './store';     // new
 *
 *   describe('parity', () => {
 *     it.each(SCRIPTS)('script %#', (script) => {
 *       runParity(createOldStore(), createNewStore(), script);
 *     });
 *   });
 *
 * `script` is an array of `(store: ViewStore) => void` ops. We assert that
 * the two stores' snapshots match after every op (modulo cameraResetToken,
 * which is intentionally removed in the new store).
 */
export function runParity(
  oldStore: { getState(): ViewState & { cameraResetToken?: number } },
  newStore: { getState(): ViewState },
  script: Array<(s: { getState(): ViewState } & Record<string, unknown>) => void>,
): void {
  for (const op of script) {
    op(oldStore as never);
    op(newStore as never);
    const o = oldStore.getState();
    const n = newStore.getState();
    // Strip cameraResetToken from the old snapshot before comparing —
    // it's intentionally absent in the new store.
    const { cameraResetToken: _ignored, ...oRest } = o;
    expect(n).toEqual(oRest);
  }
}
