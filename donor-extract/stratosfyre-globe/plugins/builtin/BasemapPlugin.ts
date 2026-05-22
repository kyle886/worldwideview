/**
 * BasemapPlugin — owns the Carto/Stadia tile basemap + country outlines.
 *
 * Always-on (`alwaysOn: true`) — basemap renders regardless of
 * `activeLayers`. The basemap source is driven by `ctx.basemapMode`, which
 * the user changes via the existing `viewStore.setBasemapMode(...)`.
 *
 * This plugin owns the constants and helpers that used to live inline at
 * the top of `DeckGlobe.tsx`:
 *  - BASEMAP_TILE_URLS map
 *  - buildBasemapTileLayer (TileLayer + BitmapLayer sub-render)
 *  - buildCountriesLayer (GeoJsonLayer, outlines only)
 *  - COUNTRIES_URL constant
 *
 * Adjust import paths to your existing helpers if they already live in
 * `src/globe/layers/`.
 */

import type { Layer } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import type { GlobePlugin, BuildLayersInput } from '../types';

export type BasemapMode = 'dark' | 'light' | 'voyager' | 'terrain' | 'contrast';

export const BASEMAP_TILE_URLS: Record<BasemapMode, string> = {
  dark: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
  light: 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
  voyager: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  terrain: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png',
  contrast: 'https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png',
};

const COUNTRIES_URL =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson';

function buildBasemapTileLayer(mode: BasemapMode): Layer {
  return new TileLayer({
    id: 'basemap',
    data: BASEMAP_TILE_URLS[mode],
    minZoom: 0,
    maxZoom: 18,
    tileSize: 256,
    pickable: false,
    renderSubLayers: (props) => {
      const bbox = props.tile.boundingBox as [[number, number], [number, number]];
      const bounds: [number, number, number, number] = [
        bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1],
      ];
      return new BitmapLayer({
        id: `${props.id}-bitmap`,
        image: props.data as string,
        bounds,
      });
    },
  });
}

function buildCountriesLayer(): Layer {
  return new GeoJsonLayer({
    id: 'basemap-countries',
    data: COUNTRIES_URL,
    stroked: true,
    filled: false,
    getLineColor: [70, 84, 112, 200],
    lineWidthMinPixels: 0.5,
    pickable: false,
  });
}

export class BasemapPlugin implements GlobePlugin<never> {
  id = 'basemap';
  name = 'Basemap';
  description = 'Tile basemap + country outlines';
  category = 'basemap' as const;
  version = '1.0.0';
  alwaysOn = true;

  buildLayers({ ctx }: BuildLayersInput<never>): Layer[] {
    const mode = (ctx.basemapMode ?? 'dark') as BasemapMode;
    return [buildBasemapTileLayer(mode), buildCountriesLayer()];
  }
}
