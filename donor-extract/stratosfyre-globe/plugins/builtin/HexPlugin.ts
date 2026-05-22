/**
 * HexPlugin — extruded hex columns.
 *
 * Visibility gates on `ctx.heatmapMode !== 'none'` rather than
 * `activeLayers.has('hex')`. The existing DeckGlobe.tsx had this comment:
 *
 *   "Hex visibility derives purely from heatmapMode — gating on
 *    activeLayers.has('hex') as well allowed the two-step store
 *    mutation to desync (heatmap on but layer off, or vice versa)."
 *
 * So we preserve that. The plugin is registered but its `activeLayers`
 * membership is effectively ignored. (If you want consistency, you can
 * also flip `activeLayers` whenever `heatmapMode` changes — but the
 * heatmap-mode-as-source-of-truth is the simpler model.)
 *
 * Column weight is derived per-market from `ctx.styleMetric`:
 *  - 'vacancy' → officeVacancy
 *  - 'rent'    → primeRent
 *  - otherwise → _misWeight
 * with a fallback to _misWeight when the active metric is missing.
 */

import type { Layer } from '@deck.gl/core';
import type { GlobePlugin, BuildLayersInput } from '../types';

// Existing builder + market shape — adjust paths.
import { buildHexLayer } from '../../layers/hex';
import { buildWeightedMarkets } from '../../markerWeights';
import type { Market } from '../../../types/market';
import type { HexDatum } from '../../types';

export class HexPlugin implements GlobePlugin<Market> {
  id = 'hex';
  name = 'Heatmap';
  description = 'Extruded hex columns scaled by the active metric';
  category = 'heatmap' as const;
  version = '1.0.0';

  buildLayers({ data, ctx }: BuildLayersInput<Market>): Layer[] {
    if (ctx.heatmapMode === 'none' || data.length === 0) return [];
    const weighted = buildWeightedMarkets(data);
    const metric = ctx.styleMetric ?? 'mis';
    const hexData: HexDatum[] = weighted.map((m) => {
      let weight: number;
      if (metric === 'vacancy') weight = m.officeVacancy ?? m._misWeight;
      else if (metric === 'rent') weight = m.primeRent ?? m._misWeight;
      else weight = m._misWeight;
      return { position: [m.lng, m.lat], weight };
    });
    // Pass the heatmapMode through to the builder if it accepts a mode arg.
    return [buildHexLayer(hexData, ctx.heatmapMode as 'extruded')];
  }
}
