/**
 * ArcsPlugin — wraps the existing `buildArcsLayer` builder.
 *
 * Data is supplied by the dashboard via
 * `pluginManager.setData('arcs', arcsArray)`. The plugin doesn't fetch its
 * own data yet; when arcs become live (e.g. real-time deal flow), drop in
 * `fetchData()` + `getPollingInterval()`.
 */

import type { Layer } from '@deck.gl/core';
import type { GlobePlugin, BuildLayersInput } from '../types';

// Existing layer builder — adjust path to your repo.
import { buildArcsLayer } from '../../layers/arcs';
import type { ArcDatum } from '../../types';

export class ArcsPlugin implements GlobePlugin<ArcDatum> {
  id = 'arcs';
  name = 'Arcs';
  description = 'Origin → destination flow arcs between markets';
  category = 'overlay' as const;
  version = '1.0.0';

  buildLayers({ data }: BuildLayersInput<ArcDatum>): Layer[] {
    if (data.length === 0) return [];
    return [buildArcsLayer(data)];
  }
}
