# Stratosfyre Globe Extract

Donor package: patterns and modules lifted from WorldWideView's plugin architecture, adapted for Stratosfyre's deck.gl-based `DeckGlobe`. All deliverables stay on deck.gl.

Start with [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md) for the *why*. If you're an agent executing the port, use [`RUNBOOK.md`](./RUNBOOK.md) for the strict step-by-step.

## Directory layout

This mirrors the intended target under `src/globe/` in Stratosfyre — so most of the migration is a directory copy plus import path tweaks.

```
donor-extract/stratosfyre-globe/
├── README.md                      ← you are here
├── MIGRATION_PLAN.md              ← phased plan
├── DataBus.ts                     ← src/globe/DataBus.ts
├── CameraController.ts            ← src/globe/CameraController.ts (Phase 4)
├── CameraController.test.ts       ← Phase 4 unit tests
├── DeckGlobe.refactored.tsx       ← reference (not drop-in)
├── plugins/
│   ├── types.ts                   ← GlobePlugin<T>, PluginContext, FlyToTarget, GlobeEvents
│   ├── PluginRegistry.ts
│   ├── PluginManager.ts
│   ├── filterEngine.ts
│   ├── PollingManager.ts          ← Phase 5: per-plugin polling + backoff
│   ├── CacheLayer.ts              ← Phase 5: L1 memory + L2 IndexedDB
│   ├── PollingManager.test.ts
│   ├── CacheLayer.test.ts
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
4. **Phase 4** — Copy `CameraController.ts` + test. In `DeckGlobe.tsx`, replace the inline `dataBus.on('cameraFlyTo', ...)` block with a single `mountCameraController(...)` call. Move per-entity framing into each plugin's `getFlyToTarget`. Wire the region dropdown to `dataBus.emit('cameraPreset', { presetId })`.
5. **Phase 5** — Copy `plugins/{PollingManager,CacheLayer}.ts` + tests. The updated `PluginManager.ts` (already in this directory) wires them. Per-plugin opt-in: add `fetchData()` + `getPollingInterval()` to any plugin that wants live updates; prop-driven plugins keep working unchanged.

## What is NOT in this package (by design)

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
