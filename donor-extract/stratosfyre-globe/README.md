# Stratosfyre Globe Extract

Donor package: patterns and modules lifted from WorldWideView's plugin architecture, adapted for Stratosfyre's deck.gl-based `DeckGlobe`. All deliverables stay on deck.gl.

Start with [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md).

## Directory layout

This mirrors the intended target under `src/globe/` in Stratosfyre — so most of the migration is a directory copy plus import path tweaks.

```
donor-extract/stratosfyre-globe/
├── README.md                      ← you are here
├── MIGRATION_PLAN.md              ← phased plan
├── DataBus.ts                     ← src/globe/DataBus.ts
├── DeckGlobe.refactored.tsx       ← reference (not drop-in)
├── plugins/
│   ├── types.ts                   ← GlobePlugin<T>, PluginContext, FlyToTarget, GlobeEvents
│   ├── PluginRegistry.ts
│   ├── PluginManager.ts
│   ├── filterEngine.ts
│   ├── init.ts                    ← registration bootstrap
│   └── builtin/
│       ├── MarketsPlugin.ts       ← markers + pulse + selection (the complex one)
│       ├── BasemapPlugin.ts       ← tile basemap + country outlines (alwaysOn)
│       ├── ArcsPlugin.ts
│       ├── HexPlugin.ts           ← gated on heatmapMode
│       ├── VoronoiPlugin.ts
│       └── Photoreal3dPlugin.ts   ← gated on zoom >= 8
└── store/
    ├── index.ts                   ← composed viewStore (replaces viewStore.ts)
    ├── index.test.ts              ← Phase 2 compatibility test
    ├── createSlice.ts
    └── slices/
        ├── selectionSlice.ts
        ├── layersSlice.ts
        ├── styleSlice.ts
        ├── cameraSlice.ts         ← cameraResetToken is GONE; see migration plan
        ├── favoritesSlice.ts
        └── filtersSlice.ts
```

## Migration order (cheat sheet)

1. **Phase 1** — Copy `DataBus.ts` and `plugins/types.ts`. Replace `cameraResetToken` and `onMarketClick` with `dataBus.emit(...)`.
2. **Phase 2** — Copy the `store/` directory; swap the singleton. Run `store/index.test.ts`. Optional: wire the `runParity` helper against the old viewStore for a few days before deletion.
3. **Phase 3** — Copy `plugins/PluginRegistry.ts`, `plugins/PluginManager.ts`, `plugins/filterEngine.ts`. Copy `plugins/builtin/*` one at a time, starting with `MarketsPlugin`. After each plugin lands, delete the equivalent inline code from `DeckGlobe.tsx`. Final step: refactor `DeckGlobe.tsx` per `DeckGlobe.refactored.tsx`.
4. **Phase 4** — Move the hard-coded fly-to from the old `handleClick` into each plugin's `getFlyToTarget`.
5. **Phase 5 (deferred)** — Add `PollingManager` + `CacheLayer` from WWV when a real live feed lands.

## What is NOT in this package (yet, by design)

- **`PollingManager`** — drop in only when a real live feed lands (Phase 5). WWV's version at `src/core/data/PollingManager.ts` works as-is once you strip its Zustand subscription (~10 lines).
- **`CacheLayer`** — same; lift from `src/core/data/CacheLayer.ts` when persisted offline data is on the table. Replace `GeoEntity` with `<T>`.
- **Server-side polling / API routes** — Stratosfyre has its own data layer; WWV's `src/lib/<plugin>/` and `src/app/api/<plugin>/` patterns are Next.js + Supabase specific.
- **Cesium primitive batching** — irrelevant for deck.gl, which already does GPU batching via `ScatterplotLayer` / `IconLayer`.

## Convention: plugin id == layer id prefix

For picking dispatch to work, every layer a plugin builds must have an id that starts with the plugin's id. Examples:

| Plugin id | Layer ids |
|---|---|
| `markers` | `markers`, `markers-pulse` |
| `basemap` | `basemap`, `basemap-countries` |
| `hex` | `hex` (or `hex-extruded`) |
| `photoreal3d` | `photoreal3d` |

`DeckGlobe`'s click handler finds the owning plugin with `layerId === p.id || layerId.startsWith(p.id + '-')`. Keep that convention and dispatch stays trivial.

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
