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

### Phase 4 — Per-plugin selection behavior (½ day)

**Change**: The hard-coded fly-to in `handleClick` (`zoom: 6, duration: 1200, speed: 1.6`) moves into `MarketsPlugin.getFlyToTarget()`. New plugins can declare their own framing — e.g. a portfolio plugin might want `zoom: 4` with no transition; a saved-locations cluster might want `zoom: 10`.

Trivial, but unblocks every future "this entity wants different camera behavior" requirement.

### Phase 5 — Add `PollingManager` / `CacheLayer` (deferred, when live data lands)

When the first live feed arrives (vacancy poll, transit, live MIS), drop in:
- `PollingManager.ts` from WWV (minor edits: strip Zustand coupling).
- `CacheLayer.ts` from WWV (strip `GeoEntity` typing, make generic over `TDatum`).

`PluginManager` already has the wire-up points; they just become active.

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
