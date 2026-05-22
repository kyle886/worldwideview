/**
 * VoronoiPlugin — coverage polygons between markets.
 *
 * Data supplied externally via `pluginManager.setData('voronoi', polys)`.
 */

import type { Layer } from '@deck.gl/core';
import type { GlobePlugin, BuildLayersInput } from '../types';

import { buildVoronoiLayer } from '../../layers/voronoi';
import type { VoronoiPolygon } from '../../types';

export class VoronoiPlugin implements GlobePlugin<VoronoiPolygon> {
  id = 'voronoi';
  name = 'Voronoi';
  description = 'Market coverage polygons';
  category = 'overlay' as const;
  version = '1.0.0';

  buildLayers({ data }: BuildLayersInput<VoronoiPolygon>): Layer[] {
    if (data.length === 0) return [];
    return [buildVoronoiLayer(data)];
  }
}
