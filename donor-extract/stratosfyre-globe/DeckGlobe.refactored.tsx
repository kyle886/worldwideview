/**
 * Sketch of `DeckGlobe.tsx` after Phase 3 of the migration plan.
 *
 * NOT a drop-in replacement — paths assume Stratosfyre's existing module
 * layout. Read it as a reference for what the file collapses to once the
 * plugin abstraction is in place.
 *
 * Compare with the current 475-line `DeckGlobe.tsx`:
 *  - All inline layer-building memos collapse into a single
 *    `pluginRegistry.getAll().flatMap(...)`.
 *  - `BASEMAP_TILE_URLS`, `buildCountriesLayer`, the country-outline constants,
 *    and `PHOTOREAL3D_MIN_ZOOM` move into their respective plugin files
 *    (`BasemapPlugin`, `Photoreal3dPlugin`).
 *  - `cameraResetToken` and `onMarketClick` are gone — replaced by DataBus
 *    events.
 *  - Picking dispatches to the owning plugin instead of a single hard-coded
 *    handler.
 *
 * What stays:
 *  - WebGL2 init check (`handleWebGLInitialized`) and error toast.
 *  - `data-deck-ready` canvas tagging for Playwright.
 *  - The controlled `viewState` echo back into deck.gl (so fly-to transitions
 *    don't snap mid-animation).
 *  - The `GLOBE_CONTROLLER_CONFIG`.
 */

import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DeckGL } from '@deck.gl/react';
import {
  _GlobeView as GlobeView,
  FlyToInterpolator,
  type Layer,
  type PickingInfo,
} from '@deck.gl/core';

import { pluginRegistry } from './plugins/PluginRegistry';
import { pluginManager } from './plugins/PluginManager';
import { dataBus } from './DataBus';
import { viewStore as defaultStore, type ViewState, type ViewStore } from './viewStore';

// ─── Constants kept in the shell ────────────────────────────────
export const GLOBE_CONTROLLER_CONFIG = {
  dragPan: true,
  dragRotate: true,
  scrollZoom: true,
  touchZoom: true,
  touchRotate: true,
  doubleClickZoom: false,
  maxZoom: 18,
} as const;

const DEFAULT_VIEW_STATE = { longitude: 0, latitude: 20, zoom: 1.5 };

// ─── Error handlers (unchanged from current file) ───────────────
export function showError(message: string): void {
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.dataset.deckError = 'true';
  Object.assign(toast.style, {
    position: 'fixed',
    top: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1a1a2e',
    color: '#ff6b6b',
    border: '1px solid #ff6b6b',
    padding: '0.75rem 1.5rem',
    borderRadius: '8px',
    zIndex: '9999',
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.9rem',
    maxWidth: '90vw',
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

function handleWebGLInitialized(gl: WebGL2RenderingContext | null): void {
  if (gl == null) showError('WebGL2 unavailable — globe disabled');
}

function handleDeckError(err: Error): void {
  console.error('[DeckGlobe] DECK_GL_RUNTIME_ERROR:', err);
  showError(`Globe runtime error: ${err.message}`);
}

// ─── Subscribe DataBus errors → toast ───────────────────────────
dataBus.on('globeError', ({ message }) => showError(message));

// ─── Component ──────────────────────────────────────────────────
interface DeckGlobeProps {
  initialViewState?: { longitude: number; latitude: number; zoom: number };
  store?: ViewStore;
  controller?: boolean;
  width?: number | string;
  height?: number | string;
}

export function DeckGlobe({
  initialViewState = DEFAULT_VIEW_STATE,
  store = defaultStore,
  controller = true,
  width = '100%',
  height = '100%',
}: Readonly<DeckGlobeProps>): ReactElement {
  const [storeState, setStoreState] = useState<ViewState>(() => store.getState());
  const [viewState, setViewState] = useState<Record<string, unknown>>(
    initialViewState as unknown as Record<string, unknown>,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);

  // ── store subscription
  useEffect(() => store.subscribe((s) => setStoreState(s)), [store]);

  // ── DataBus camera bridge: turn events into deck.gl viewState changes
  useEffect(() => {
    const unsubReset = dataBus.on('cameraReset', () => setViewState(initialViewState));
    const unsubFly = dataBus.on('cameraFlyTo', ({ longitude, latitude, zoom, durationMs, speed }) => {
      setViewState({
        longitude,
        latitude,
        zoom: zoom ?? 6,
        transitionDuration: durationMs ?? 1200,
        transitionInterpolator: new FlyToInterpolator({ speed: speed ?? 1.6 }),
      });
    });
    return () => {
      unsubReset();
      unsubFly();
    };
  }, [initialViewState]);

  // ── plugin context — passed into buildLayers and onPick
  const ctx = useMemo(
    () => ({
      zoom: storeState.zoom,
      selectedId: storeState.selectedMarketId,
      filters: {} as Record<string, Record<string, unknown>>, // wire when filtersSlice lands
      styleMetric: storeState.colorMetric,
    }),
    [storeState],
  );

  // Keep the manager's context provider fresh.
  useEffect(() => {
    pluginManager.setContextProvider(() => ctx as any);
  }, [ctx]);

  // ── build all layers in one pass over the registry
  const layers: Layer[] = useMemo(() => {
    return pluginRegistry.getAll().flatMap((plugin) => {
      if (!storeState.activeLayers.has(plugin.id as never)) return [];
      const data = pluginManager.getData(plugin.id);
      return plugin.buildLayers({ data, ctx: ctx as any });
    });
  }, [storeState.activeLayers, storeState.zoom, storeState.selectedMarketId, storeState.colorMetric, ctx]);

  // ── click dispatch: find owning plugin via layer id namespace
  const handleClick = (info: PickingInfo): void => {
    const layerId = info.layer?.id ?? '';
    const plugin = pluginRegistry.getAll().find((p) => layerId === p.id || layerId.startsWith(`${p.id}-`));
    if (!plugin || !info.object) return;
    plugin.onPick?.(info.object, info, ctx as any);
    const target = plugin.getFlyToTarget?.(info.object);
    if (target) dataBus.emit('cameraFlyTo', target);
  };

  // ── first-render flag for tests
  const handleAfterRender = (): void => {
    if (readyRef.current) return;
    const canvas = containerRef.current?.querySelector('canvas');
    if (canvas && canvas.dataset.deckReady !== 'true') {
      canvas.dataset.deckReady = 'true';
      readyRef.current = true;
      dataBus.emit('globeReady', {} as Record<string, never>);
    }
  };

  const styleW = typeof width === 'number' ? `${width}px` : width;
  const styleH = typeof height === 'number' ? `${height}px` : height;

  return (
    <div ref={containerRef} style={{ width: styleW, height: styleH }}>
      <DeckGL
        views={new GlobeView({ resolution: 10 })}
        viewState={viewState as unknown as { longitude: number; latitude: number; zoom: number }}
        onViewStateChange={(params) => {
          const vs = params.viewState as { zoom?: number };
          if (typeof vs.zoom === 'number') store.setZoom(vs.zoom);
          setViewState(params.viewState);
        }}
        controller={controller === false ? false : GLOBE_CONTROLLER_CONFIG}
        layers={layers}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        onClick={handleClick}
        onAfterRender={handleAfterRender}
        onWebGLInitialized={handleWebGLInitialized}
        onError={handleDeckError}
      />
    </div>
  );
}
