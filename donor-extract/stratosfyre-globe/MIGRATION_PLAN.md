# Stratosfyre Globe Uplift — Migration Plan

Lift patterns from WorldWideView's (Cesium-based) plugin architecture into Stratosfyre's deck.gl globe, while keeping the existing `DeckGlobe.tsx` rendering pipeline intact.

## Goals

1. Turn `DeckGlobe.tsx` from a ~475-line god component that knows about every layer/data-source into a ~100-line shell that loops over a registry of plugins.
2. Replace the `cameraResetToken` counter and `onMarketClick` prop pattern with a typed event bus.
3. Make adding a new data source (transit, weather, portfolio overlay, saved-locations cluster) a single-file change.
4. Keep all current behavior — fly-to, pulse, basemap modes, heatmap toggle — working at every step.

## Non-goals (for this migration)

- Don't port WWV's Cesium primitive batcher or LOD model promotion (deck.gl handles batching).
- Don't add `PollingManager` / `CacheLayer` yet — Stratosfyre markets are passed as props; only port these when a real live feed lands.
- Don't switch state libraries. Keep the custom `viewStore` pub/sub; just slice it.

## Phasing

Each phase is independently mergeable and behavior-preserving.

### Phase 1 — Drop in `DataBus`, kill `cameraResetToken` (½ day)

**Change**: Add `donor-extract/stratosfyre-globe/DataBus.ts` to `src/globe/DataBus.ts`. Replace the token-bump pattern with events.

| Before | After |
|---|---|
| `viewStore.resetCamera()` bumps counter | `dataBus.emit("cameraReset")` |
| `useEffect` on `state.cameraResetToken` | `useEffect`: `dataBus.on("cameraReset", () => setViewState(initial))` |
| `onMarketClick` prop drilling | `dataBus.emit("entitySelected", { id, datum })` |
| Manual `setViewState({ ..., transitionInterpolator: new FlyToInterpolator(...) })` inside `handleClick` | `dataBus.emit("cameraFlyTo", { lng, lat, zoom, durationMs })`; a single effect in `DeckGlobe` translates that to deck.gl viewstate |

Remove `cameraResetToken` and `onMarketClick` from `viewStore`/`DeckGlobeProps` (or keep `onMarketClick` as a thin adapter that just re-emits, for backward compatibility during the transition).

**Risk**: Low. Mechanical refactor.
**Test**: Existing Playwright + smoke test should pass unchanged.

### Phase 2 — Slice `viewStore` (½ day)

**Change**: Break `viewStore.ts` into composable slices using the same pattern WWV uses for Zustand (just adapted to your custom pub/sub).

```
src/globe/store/
  index.ts              # composes the singleton
  createSlice.ts        # tiny helper for slice creators
  slices/
    selectionSlice.ts   # selectedMarketId, recentlyClickedId
    layersSlice.ts      # activeLayers, heatmapMode
    styleSlice.ts       # colorMetric, basemapMode
    cameraSlice.ts      # zoom (cameraResetToken now lives on DataBus)
    favoritesSlice.ts   # savedMarketIds
    filtersSlice.ts     # regionFilter + (future) per-plugin filters
```

Each slice exports a state shape + mutators. `createViewStore()` composes them via spread. Listeners stay global.

**Risk**: Low. Pure refactor. Public API of `viewStore` is unchanged.
**Test**: Run `store/index.test.ts` (in this directory). For belt-and-suspenders confidence during the swap, wire the `runParity()` helper at the bottom of that file against the old `viewStore` for a few days, then delete.

### Phase 3 — Introduce `GlobePlugin<T>` interface (1–2 days, the big one)

**Change**: Define a deck.gl-flavored plugin interface and port each existing layer family into a plugin file. `DeckGlobe.tsx` becomes a loop over registered plugins.

New files:
```
src/globe/plugins/
  types.ts                # GlobePlugin<T>, PluginContext, PluginCategory
  PluginRegistry.ts       # register / get / getAll
  PluginManager.ts        # lifecycle: init, enable, disable, fetch
  filterEngine.ts         # applyFilters — generic over datum type
src/globe/plugins/builtin/
  MarketsPlugin.ts        # wraps buildMarkersLayer + buildSelectionPulseLayer
  ArcsPlugin.ts           # wraps buildArcsLayer
  HexPlugin.ts            # wraps buildHexLayer (with heatmapMode coupling)
  VoronoiPlugin.ts        # wraps buildVoronoiLayer
  Photoreal3dPlugin.ts    # wraps buildPhotoreal3dLayer (with zoom gate)
  BasemapPlugin.ts        # wraps buildBasemapTileLayer + buildCountriesLayer
```

**Plugin contract** (see `types.ts` in this directory):

```typescript
interface GlobePlugin<TDatum = unknown> {
  id: string;
  name: string;
  category: PluginCategory;
  version: string;

  initialize?(ctx: PluginContext): void | Promise<void>;
  destroy?(): void;

  // Data — for now, pass-through; later, replace with fetch()
  fetchData?(ctx: PluginContext): Promise<TDatum[]>;
  getPollingInterval?(): number;

  // Render — return zero or more deck.gl layers given current data + view state
  buildLayers(input: BuildLayersInput<TDatum>): Layer[];

  // Interaction
  getEntityId?(datum: TDatum): string;
  onPick?(datum: TDatum, info: PickingInfo, ctx: PluginContext): void;
  getFlyToTarget?(datum: TDatum): FlyToTarget | null;

  // Filtering (mirrors WWV)
  getFilterDefinitions?(): FilterDefinition[];
}
```

`DeckGlobe.tsx` after refactor (sketch):

```typescript
const allPlugins = pluginRegistry.getAll();

const layers = useMemo(() => {
  return allPlugins.flatMap(plugin => {
    if (!state.activeLayers.has(plugin.id)) return [];
    const data = pluginData[plugin.id] ?? [];
    return plugin.buildLayers({ data, viewState: state, zoom: state.zoom });
  });
}, [allPlugins, state, pluginData]);

const handleClick = (info: PickingInfo) => {
  const layerId = info.layer?.id;
  const plugin = allPlugins.find(p => layerId?.startsWith(p.id));
  if (!plugin || !info.object) return;
  plugin.onPick?.(info.object, info, ctx);
  const flyTo = plugin.getFlyToTarget?.(info.object);
  if (flyTo) dataBus.emit("cameraFlyTo", flyTo);
};
```

**Migration order** (do one at a time, ship each):
1. `MarketsPlugin` — most complex (pulse, color metric, selection). Get this right first; the others are mechanical.
2. `BasemapPlugin` — owns the tile basemap + country outlines. Uses `alwaysOn: true` so it bypasses the `activeLayers` gate.
3. `ArcsPlugin`, `VoronoiPlugin`, `HexPlugin` — straightforward. `HexPlugin` keeps the existing "gate on `heatmapMode`, not `activeLayers`" semantics from DeckGlobe.tsx.
4. `Photoreal3dPlugin` — the zoom gate moves into the plugin's `buildLayers` returning `[]` when zoom < threshold.

**Registration** is done once at app startup via `initGlobePlugins({ store: viewStore })` (see `plugins/init.ts`). This wires the `PluginManager.setContextProvider` so every plugin sees a fresh `PluginContext` derived from the current `viewStore` snapshot.

**Convention**: a plugin's id must be the prefix of every layer id it builds. `DeckGlobe`'s click handler dispatches to the owning plugin via `layerId === p.id || layerId.startsWith(p.id + '-')`. Examples: `MarketsPlugin` owns `markers` + `markers-pulse`; `BasemapPlugin` owns `basemap` + `basemap-countries`.

**Risk**: Medium. Touches the largest file. Mitigation: keep `DeckGlobe.tsx`'s public API identical (same props), and migrate one layer at a time behind a feature flag if you want extra safety.

**Test**: Add a registry-mounting smoke test. Existing Playwright runs unchanged.

### Phase 4 — Per-plugin selection behavior + CameraController (½ day)

**Change**: Centralize all camera logic in `CameraController.ts`. Plugins declare *intent* via `getFlyToTarget(datum)`; the controller translates intent into deck.gl viewState patches, handles reduced-motion, runs the cursor-flip side effect, and dispatches named presets.

After this phase, `DeckGlobe.tsx` contains:
- Zero `FlyToInterpolator` imports
- Zero hard-coded transition durations / speeds
- Zero `window.matchMedia('(prefers-reduced-motion)')` checks
- Zero `document.body.style.cursor` manipulation

All of that lives in `CameraController.ts`. The `DeckGlobe` shell's camera bridge collapses to a single `mountCameraController({ setViewState, initialViewState })` call.

**Per-plugin fly-to declarations** (examples):

```typescript
// MarketsPlugin — emphatic settle on a single market
getFlyToTarget(market: Market): FlyToTarget {
  return { longitude: market.lng, latitude: market.lat, zoom: 6,
           durationMs: 1200, speed: 1.6 };
}

// Hypothetical PortfolioPlugin — frame a portfolio at low zoom, instant
getFlyToTarget(p: PortfolioEntry): FlyToTarget | null {
  return { longitude: p.centroidLng, latitude: p.centroidLat,
           zoom: 4, durationMs: 0 };
}

// Hypothetical SavedLocationsPlugin — close zoom for keyboard nav
getFlyToTarget(loc: SavedLocation): FlyToTarget {
  return { longitude: loc.lng, latitude: loc.lat, zoom: 10,
           durationMs: 600 };
}

// HoverPreviewPlugin — never moves the camera on pick
getFlyToTarget() { return null; }
```

**Named presets** (`CAMERA_PRESETS` in `CameraController.ts`): trigger via `dataBus.emit('cameraPreset', { presetId: 'europe' })`. Wire this to the region-filter dropdown so changing the filter also re-frames the camera. Built-in preset ids: `global`, `americas`, `europe`, `mena`, `asiaPacific`, `africa`, `oceania`, `arctic`. Override coordinates to match Stratosfyre's preferred framing.

**Risk**: Low. The controller is pure-ish (one DataBus subscription + one setViewState call); the deck.gl side is unchanged.
**Test**: Run `CameraController.test.ts` — covers reduced-motion gating, preset dispatch, unmount cleanup, and the pure `targetToViewState` translator.

### Phase 5 — Wire `PollingManager` + `CacheLayer` (live-data day)

**Change**: Activate the polling + cache stack so plugins that declare a `fetchData()` + `getPollingInterval()` get scheduled automatically, and every plugin (prop-driven or fetch-driven) gets cache-first enable behavior.

This phase is the moment a Stratosfyre data source goes live — e.g. office-vacancy polling, transit overlay, real-time MIS updates. Before that, all data is still passed in via `pluginManager.setData(...)` from the dashboard.

**Drop-in files:**
- `plugins/PollingManager.ts` — exponential backoff, pause/resume, live `setInterval()` tuning, no concurrent ticks per plugin.
- `plugins/CacheLayer.ts` — L1 memory + L2 IndexedDB, TTL per entry (default 30s), graceful degradation if IDB is unavailable.
- `plugins/PluginManager.ts` (updated) — the previously-stubbed hooks are now active:
  - `init()` opens the IDB connection.
  - `registerPlugin()` registers a polling task iff the plugin has both `fetchData` and `getPollingInterval() > 0`.
  - `enable()` serves L1 immediately, falls back to L2 in the background, then starts polling.
  - `disable()` stops polling but keeps the cache warm.
  - New: `setPollingInterval(id, ms)` and `setCacheTtl(ms)` for Config-panel knobs.

**Per-plugin opt-in** — adding live polling to MarketsPlugin (illustrative):

```typescript
class MarketsPlugin implements GlobePlugin<Market> {
  // ...existing fields...
  getPollingInterval() { return 60_000; }  // 1 minute
  async fetchData(_ctx: PluginContext): Promise<Market[]> {
    const res = await fetch('/api/markets');
    if (!res.ok) throw new Error(`markets api ${res.status}`);
    return res.json();
  }
}
```

The plugin keeps working in prop-driven mode (host calls `setData`) — `fetchData` only kicks in for plugins that need it. Mix and match per plugin.

**Risk**: Low for caching (additive); medium for polling, because the moment a real endpoint exists, you're now hitting it on a schedule. Watch for: cumulative request rate across plugins, IDB quota for chatty plugins (override the default 30s TTL), backoff behavior when a backend hiccups.

**Test**: Run `PollingManager.test.ts` (fake timers cover the immediate tick, backoff cap, error-count reset, pause/resume, live `setInterval`, and the no-concurrent-ticks guarantee) and `CacheLayer.test.ts` (L1 TTL, eviction, IDB-absent fallback).

## Files in this directory

| File | Purpose | Action |
|---|---|---|
| `MIGRATION_PLAN.md` | This document | Read |
| `types.ts` | deck.gl-flavored `GlobePlugin<T>` + supporting types | Copy to `src/globe/plugins/types.ts` |
| `DataBus.ts` | Typed pub/sub, lifted from WWV with Stratosfyre's event set | Copy to `src/globe/DataBus.ts` |
| `PluginRegistry.ts` | Registration / discovery | Copy to `src/globe/plugins/PluginRegistry.ts` |
| `PluginManager.ts` | Lifecycle + data routing (polling/cache hooks stubbed) | Copy to `src/globe/plugins/PluginManager.ts` |
| `filterEngine.ts` | Generic filter application (works on any datum shape) | Copy to `src/globe/plugins/filterEngine.ts` |
| `MarketsPlugin.example.ts` | Worked example: port `buildMarkersLayer` + pulse + selection into a plugin | Reference; adapt for your data shape |
| `DeckGlobe.refactored.tsx` | Sketch of the slimmed `DeckGlobe.tsx` after Phase 3 | Reference; not drop-in |

## What you gain after Phase 3

| Concern | Before | After |
|---|---|---|
| Add a new data source | Edit `DeckGlobe.tsx` (475 lines), add layer build to memo, add toggle to `LayerKey` union, add prop, wire into store | Write `src/globe/plugins/builtin/MyPlugin.ts` (~80 lines), register it once |
| Per-entity click behavior | Hard-coded in `handleClick` | `plugin.getFlyToTarget(datum)` + `plugin.onPick(datum, info)` |
| Filter UI | Inline `markets.filter` by region | `applyFilters(data, plugin.getFilterDefinitions(), state.filters[plugin.id])` — drives a generic filter panel |
| Cross-cutting events (selection, camera reset, fly-to) | Token bumps + prop callbacks | `dataBus.emit("eventName", payload)` |
| Test isolation | Have to mount full `DeckGlobe` to test a layer | Unit-test `plugin.buildLayers(testData, testCtx)` directly |

## What this does NOT change

- Rendering engine (still deck.gl `_GlobeView`)
- Basemap tile sources (Carto / Stadia URLs unchanged)
- Pulse animation timing, FlyToInterpolator behavior
- Test harness (`data-deck-ready` canvas tagging, `showError` toast)
- The market data shape (`Market`, `MarkerDatum`) — plugins are typed over their own datum type via the `<TDatum>` generic
