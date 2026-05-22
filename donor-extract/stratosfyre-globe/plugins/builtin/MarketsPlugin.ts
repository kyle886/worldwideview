/**
 * Worked example: porting the existing markers + pulse + selection code
 * from DeckGlobe.tsx into a self-contained plugin.
 *
 * This is a REFERENCE — paths assume the file lands at
 * `src/globe/plugins/builtin/MarketsPlugin.ts`. Adjust imports to match your
 * existing module layout.
 *
 * What this captures from the current DeckGlobe.tsx:
 *  - buildMarkersLayer (existing layer builder, unchanged)
 *  - buildSelectionPulseLayer (existing, unchanged)
 *  - buildMarkerData / buildPulseData / buildWeightedMarkets (existing helpers)
 *  - colorMetric coupling: 'mis' | 'vacancy' | 'rent'
 *  - selectedMarketId coupling: visual emphasis on selected marker
 *  - Pulse animation loop (0 → 1 over 600ms, honours prefers-reduced-motion)
 *  - Click → fly-to (zoom 6, 1.2s, speed 1.6)
 *  - The 200ms recentlyClickedId flash
 *
 * What the host (DeckGlobe.tsx) keeps:
 *  - The actual `<DeckGL>` element and the deck.gl viewState
 *  - The dataBus → viewState bridge for cameraFlyTo / cameraReset
 */

import type { Layer, PickingInfo } from '@deck.gl/core';
import type {
  GlobePlugin,
  BuildLayersInput,
  PluginContext,
  FlyToTarget,
  FilterDefinition,
} from '../types';
import { dataBus } from '../../DataBus';

// Existing Stratosfyre imports — adjust paths to wherever these live now.
import { buildMarkersLayer } from '../../layers/markers';
import { buildSelectionPulseLayer } from '../../layers/selectionPulse';
import { buildWeightedMarkets } from '../../markerWeights';
import { buildMarkerData, buildPulseData } from '../../markerData';
import type { Market } from '../../../types/market';

/**
 * Lives outside the plugin instance so React StrictMode double-invocation
 * doesn't spawn two animation loops.
 */
class PulseClock {
  private phase = 0;
  private timerId: number | null = null;
  private listeners: Set<(phase: number) => void> = new Set();

  start(): void {
    if (this.timerId != null) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    this.timerId = window.setInterval(() => {
      this.phase = (this.phase + 0.05) % 1;
      this.listeners.forEach((fn) => fn(this.phase));
    }, 30);
  }

  stop(): void {
    if (this.timerId == null) return;
    clearInterval(this.timerId);
    this.timerId = null;
    this.phase = 0;
    this.listeners.forEach((fn) => fn(0));
  }

  getPhase(): number {
    return this.phase;
  }

  subscribe(fn: (phase: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * MarketsPlugin — wraps the markers + selection pulse layers.
 *
 * Data is supplied by the dashboard via `pluginManager.setData('markets', markets)`
 * (Phase 3 keeps the prop-driven flow; no fetchData yet).
 */
export class MarketsPlugin implements GlobePlugin<Market> {
  id = 'markets';
  name = 'Markets';
  description = 'Office and life-science markets coloured by the active metric';
  category = 'markets' as const;
  version = '1.0.0';

  private pulseClock = new PulseClock();
  private recentlyClickedId: string | null = null;
  private recentClickTimer: number | null = null;

  initialize(_ctx: PluginContext): void {
    // Subscribe pulse clock to selection — only animate while something is
    // selected. The host re-runs buildLayers on every pulse tick because the
    // clock notifies via DataBus.dataUpdated below.
    this.pulseClock.subscribe(() => {
      dataBus.emit('dataUpdated', { pluginId: this.id, count: -1 });
    });
  }

  destroy(): void {
    this.pulseClock.stop();
    if (this.recentClickTimer != null) clearTimeout(this.recentClickTimer);
  }

  getEntityId(market: Market): string {
    return market.id;
  }

  buildLayers({ data, ctx }: BuildLayersInput<Market>): Layer[] {
    // 1. Filter by region (was inline in DeckGlobe). When you add filters
    //    properly, replace this with applyFilters(data, this.getFilterDefinitions(), ctx.filters[this.id])
    const regionFilter = ctx.filters[this.id]?.region;
    const visible =
      regionFilter && regionFilter.type === 'select' && regionFilter.values.length > 0
        ? data.filter((m) => regionFilter.values.includes(m.region))
        : data;

    // 2. Weight + shape into MarkerDatum (existing helpers).
    const weighted = buildWeightedMarkets(visible);
    const colorMetric = (ctx.styleMetric ?? 'mis') as 'mis' | 'vacancy' | 'rent';
    const markerData = buildMarkerData(
      weighted,
      ctx.selectedId,
      colorMetric,
      this.recentlyClickedId,
    );

    // 3. Drive the pulse clock based on selection state.
    if (ctx.selectedId) this.pulseClock.start();
    else this.pulseClock.stop();

    const out: Layer[] = [];
    if (markerData.length > 0) {
      out.push(buildMarkersLayer(markerData));
    }

    // 4. Selection pulse — only when something is selected.
    if (ctx.selectedId) {
      const phase = this.pulseClock.getPhase();
      const pulseData = buildPulseData(weighted, ctx.selectedId).map((d) => ({
        ...d,
        radius: 8 + phase * 24,
        color: [255, 138, 26, Math.round(153 * (1 - phase))] as [
          number,
          number,
          number,
          number,
        ],
      }));
      if (pulseData.length > 0) {
        out.push(buildSelectionPulseLayer(pulseData));
      }
    }

    return out;
  }

  onPick(market: Market, _info: PickingInfo, _ctx: PluginContext): void {
    // Flash effect — 200ms visual highlight after click.
    this.recentlyClickedId = market.id;
    if (this.recentClickTimer != null) clearTimeout(this.recentClickTimer);
    this.recentClickTimer = window.setTimeout(() => {
      this.recentlyClickedId = null;
      dataBus.emit('dataUpdated', { pluginId: this.id, count: -1 });
    }, 200);

    // Tell the rest of the system. The store subscribes to entitySelected and
    // updates selectedMarketId; whichever sidebar/detail wants to react does so
    // via the same event.
    dataBus.emit('entitySelected', {
      pluginId: this.id,
      id: market.id,
      datum: market,
    });
  }

  getFlyToTarget(market: Market): FlyToTarget | null {
    // Replicates the hard-coded fly-to from the current handleClick.
    return {
      longitude: market.lng,
      latitude: market.lat,
      zoom: 6,
      durationMs: 1200,
      speed: 1.6,
    };
  }

  getFilterDefinitions(): FilterDefinition[] {
    return [
      {
        id: 'region',
        label: 'Region',
        type: 'select',
        propertyKey: 'region',
        // Populated by the UI / a region-list helper.
        options: [],
      },
      // Add more here as the dashboard grows — vacancy range, rent range, etc.
    ];
  }
}
