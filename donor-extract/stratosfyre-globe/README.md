# Stratosfyre Globe Extract

This directory is a donor package: patterns and modules lifted from WorldWideView's plugin architecture, adapted for Stratosfyre's deck.gl-based `DeckGlobe`.

Start with [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md).

## File index

| File | What it is | WWV source |
|---|---|---|
| `MIGRATION_PLAN.md` | Phased plan + rationale | new |
| `types.ts` | `GlobePlugin<TDatum>`, `PluginContext`, `FilterDefinition`, `GlobeEvents` | adapted from `src/core/plugins/PluginTypes.ts` |
| `DataBus.ts` | Typed pub/sub event bus | near-verbatim from `src/core/data/DataBus.ts` |
| `PluginRegistry.ts` | Static plugin lookup | near-verbatim from `src/core/plugins/PluginRegistry.ts` |
| `PluginManager.ts` | Lifecycle + data routing (polling/cache stubbed) | adapted from `src/core/plugins/PluginManager.ts` |
| `filterEngine.ts` | Generic `applyFilters<T>` | adapted from `src/core/filters/filterEngine.ts` |
| `MarketsPlugin.example.ts` | Worked example: existing markers + pulse + selection as a plugin | new |
| `DeckGlobe.refactored.tsx` | Sketch of `DeckGlobe.tsx` after Phase 3 | new |
| `store/createSlice.ts` | `SliceCreator<TSlice, TFullState>` helper | adapted from WWV's slice pattern |
| `store/index.ts` | Composed `viewStore` — preserves the existing public API | new |
| `store/slices/selectionSlice.ts` | `selectedMarketId` + mutator | new |
| `store/slices/layersSlice.ts` | `activeLayers` + `heatmapMode` + mutators | new |
| `store/slices/styleSlice.ts` | `colorMetric` + `basemapMode` + mutators | new |
| `store/slices/cameraSlice.ts` | `zoom` (note: `cameraResetToken` is gone, now a DataBus event) | new |
| `store/slices/favoritesSlice.ts` | `savedMarketIds` + toggle | new |
| `store/slices/filtersSlice.ts` | `regionFilter` (Phase 2 keeps the shape; Phase 3 generalizes) | new |

## Copy targets in Stratosfyre

```
src/globe/
  DataBus.ts                          ← DataBus.ts (this dir)
  DeckGlobe.tsx                       ← migrate per DeckGlobe.refactored.tsx
  plugins/
    types.ts                          ← types.ts
    PluginRegistry.ts                 ← PluginRegistry.ts
    PluginManager.ts                  ← PluginManager.ts
    filterEngine.ts                   ← filterEngine.ts
    builtin/
      MarketsPlugin.ts                ← MarketsPlugin.example.ts (rename, adjust paths)
      BasemapPlugin.ts                ← Phase 3: extract from current DeckGlobe.tsx
      ArcsPlugin.ts                   ← Phase 3
      HexPlugin.ts                    ← Phase 3
      VoronoiPlugin.ts                ← Phase 3
      Photoreal3dPlugin.ts            ← Phase 3
  store/
    index.ts                          ← store/index.ts (replaces viewStore.ts)
    createSlice.ts                    ← store/createSlice.ts
    slices/
      selectionSlice.ts               ← store/slices/selectionSlice.ts
      layersSlice.ts                  ← store/slices/layersSlice.ts
      styleSlice.ts                   ← store/slices/styleSlice.ts
      cameraSlice.ts                  ← store/slices/cameraSlice.ts
      favoritesSlice.ts               ← store/slices/favoritesSlice.ts
      filtersSlice.ts                 ← store/slices/filtersSlice.ts
```

## What is NOT in this package (yet, by design)

- **`PollingManager`** — drop in only when a real live feed lands (Phase 5). WWV's version at `src/core/data/PollingManager.ts` works as-is once you strip its Zustand subscription (~10 lines).
- **`CacheLayer`** — same; lift from `src/core/data/CacheLayer.ts` when persisted offline data is on the table. Replace `GeoEntity` with `<T>`.
- **Server-side polling / API routes** — Stratosfyre has its own data layer; WWV's `src/lib/<plugin>/` and `src/app/api/<plugin>/` patterns are specific to Next.js + Supabase and don't generalize cleanly.
- **Cesium primitive batching** — irrelevant for deck.gl.

## Original (full-quality) sources in WWV

If you want to read the originals untouched:

- `src/core/plugins/PluginTypes.ts`
- `src/core/plugins/PluginRegistry.ts`
- `src/core/plugins/PluginManager.ts`
- `src/core/data/DataBus.ts`
- `src/core/data/PollingManager.ts`
- `src/core/data/CacheLayer.ts`
- `src/core/filters/filterEngine.ts`
- `src/plugins/aviation/index.ts` (canonical plugin example, Cesium-flavored)
- `src/components/layout/AppShell.tsx` (registration sequence)
