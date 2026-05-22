/**
 * Photoreal3dPlugin — Google Photorealistic 3D Tiles (when zoomed in).
 *
 * Internally enforces the zoom gate that used to live in DeckGlobe.tsx:
 *   "Below this zoom Tile3DLayer fetches very few tiles anyway, but the
 *    gate avoids the cost of attaching the layer to the deck.gl render
 *    tree at all."
 *
 * Returns `[]` when zoom < PHOTOREAL3D_MIN_ZOOM, so the layer never even
 * enters the deck.gl pipeline at low zoom.
 */

import type { Layer } from '@deck.gl/core';
import type { GlobePlugin, BuildLayersInput } from '../types';

import { buildPhotoreal3dLayer } from '../../layers/photoreal3d';

export const PHOTOREAL3D_MIN_ZOOM = 8;

export class Photoreal3dPlugin implements GlobePlugin<never> {
  id = 'photoreal3d';
  name = 'Photorealistic 3D';
  description = 'Google Photorealistic 3D Tiles (city zoom only)';
  category = 'photoreal' as const;
  version = '1.0.0';

  buildLayers({ ctx }: BuildLayersInput<never>): Layer[] {
    if (ctx.zoom < PHOTOREAL3D_MIN_ZOOM) return [];
    return [buildPhotoreal3dLayer()];
  }
}
