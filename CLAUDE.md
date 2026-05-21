# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**WorldWideView** is a modular, real-time geospatial intelligence engine built on a CesiumJS 3D globe inside a Next.js (App Router) application. Each data source (aviation, maritime, wildfire, military, borders, traffic cameras, GeoJSON imports) is a self-contained **plugin** that conforms to the `WorldPlugin` interface. The core engine is data-agnostic — adding a new layer means writing a plugin, not modifying the core.

## Commands

```bash
npm run dev          # Next.js dev server with --webpack (HMR breaks without it)
npm run build        # Production build (also uses --webpack)
npm start            # Run production build
npm test             # Vitest, runs once (vitest run)
npm run copy-cesium  # Copy Cesium static assets to public/cesium (auto-runs via predev)
npm run clean        # Remove .next build cache
```

Run a single test file or test by name:
```bash
npx vitest run src/lib/aviation/cache.test.ts
npx vitest run -t "rate limit"
npx vitest                       # watch mode
```

Vitest is configured (`vitest.config.ts`) with `jsdom`, globals enabled, the `@/*` path alias, and only includes tests under `src/lib/**`, `src/core/**`, and `src/plugins/**`.

## Cesium Setup (critical)

- Cesium static assets must live in `public/cesium`. `scripts/copy-cesium.mjs` copies `Workers`, `ThirdParty`, `Assets`, `Widgets` from `node_modules/cesium/Build/Cesium` and runs automatically before `dev` via the `predev` hook. If Cesium fails to load (workers 404, no terrain), re-run `npm run copy-cesium`.
- `next.config.ts` sets `CESIUM_BASE_URL = "/cesium"` via `webpack.DefinePlugin` for the browser bundle, and stubs Node-only modules (`fs`, `http`, `https`, `zlib`, `url`) to `false` in the client fallback. **You must use the webpack bundler** (the default `--webpack` flag) — Turbopack does not apply this config and breaks Cesium.
- `GlobeView` is loaded via `next/dynamic` with `ssr: false` (see `src/components/layout/AppShell.tsx`). Anything that imports `cesium` at module scope must be behind a dynamic import or `"use client"` boundary.
- `output: "standalone"` plus `outputFileTracingExcludes` for `./public/cesium/**` keeps Cesium assets out of the standalone trace; the Dockerfile copies `public/` separately for that reason.

## Architecture

### Plugin lifecycle (the spine of the app)

1. `AppShell.tsx` instantiates each built-in plugin and calls `pluginRegistry.register(...)`, then `await pluginManager.init()` (which initializes `cacheLayer`), then `pluginManager.registerPlugin(plugin)` for each one.
2. `PluginManager.registerPlugin` builds a `PluginContext`, calls `plugin.initialize(ctx)`, emits `pluginRegistered` on the `DataBus`, and registers the plugin's `fetch()` with `PollingManager` at the plugin's `getPollingInterval()`.
3. When a user toggles a layer, `pluginManager.enablePlugin(id)` is called. It serves cached entities from L1 (memory) or L2 (IndexedDB) immediately for snappy UX, then starts polling and emits `layerToggled`.
4. Each successful poll routes results through `handleDataUpdate` → `cacheLayer.set(...)` → `dataBus.emit("dataUpdated", { pluginId, entities })`.
5. `GlobeView` reads the merged entity map from the Zustand store (`entitiesByPlugin`) on render, applies per-plugin `getFilterDefinitions()` filters via `applyFilters`, calls each plugin's `renderEntity()` to derive Cesium options, and feeds the result through the primitive rendering pipeline.

### Rendering: Cesium Primitives, not Entities

This is a deliberate performance decision. `EntityRenderer.ts` creates a single `PointPrimitiveCollection`, `BillboardCollection`, and `LabelCollection` on the viewer (stashed at `viewer._wwvPoints`, `viewer._wwvBillboards`, `viewer._wwvLabels`). All live data points go into these batched collections — the Cesium `Entity` API is only used for selection indicators, trails, and info-card targets. Aim for `point`/`billboard` types in `renderEntity()`; reaching for the Entity API for high-count data will collapse FPS.

`useModelRendering` is an LOD trick: for entities returned with `type: "model"`, the renderer still creates a billboard, then promotes nearby ones to a real glTF model and hides the underlying billboard (`_modelPromoted` flag on `AnimatableItem`).

### State (Zustand, sliced)

`src/core/state/store.ts` composes a single `useStore` from independent slices: `globe`, `layers`, `timeline`, `ui`, `filter`, `data`, `config`, `favorites`, `geojson`. When adding state, create or extend a slice rather than mutating the store directly. The store is the single source of truth for layer enable/disable, selected entity, time range, filters, and rendered entity sets.

### Data flow / events

`DataBus` (`src/core/data/DataBus.ts`) is a typed pub/sub keyed on `DataBusEvents` (defined in `PluginTypes.ts`). Use it for cross-cutting events — `dataUpdated`, `entitySelected`, `layerToggled`, `timeRangeChanged`, `cameraPreset`, `cameraGoTo`, `globeReady`. `DataBusSubscriber` mirrors selected events into the Zustand store. Don't add new ad-hoc emitters; extend `DataBusEvents`.

`globeReady` is special: emitted from `GlobeView.handleViewerReady` after the Google 3D Tileset's `initialTilesLoaded` fires. `AppShell` waits for it to start the boot animation sequence (`useBootSequence`).

### Server-side polling (background workers)

`src/instrumentation.ts` is Next.js's instrumentation hook. On the Node runtime it kicks off `startAviationPolling()` (OpenSky), `startAisStream()` (maritime WebSocket), and `startMilitaryPolling()` (adsb.fi). These maintain server-side state in `src/lib/<plugin>/state.ts` and `cache.ts` so the per-plugin API routes (`src/app/api/<plugin>/route.ts`) can respond from memory without burning external API quota. History playback (e.g. `/api/aviation/history?time=...`) is backed by Supabase via `src/lib/aviation/supabase.ts`.

OpenSky uses a multi-credential rotation scheme — see `src/lib/aviation/credentials.ts` and the `OPENSKY_CREDENTIALS` env var (comma-separated `clientId:clientSecret` pairs).

### Where plugin code lives

| Plugin | Client (`src/plugins/<id>/`) | Server (`src/lib/<id>/` + `src/app/api/<id>/`) |
|---|---|---|
| `aviation` | OpenSky → billboards, altitude-coloured | polling, Supabase history, rate limiting |
| `maritime` | AIS stream → points | AIS WebSocket worker |
| `wildfire` | NASA FIRMS → points sized by FRP | proxy route |
| `military` | adsb.fi → billboards | polling |
| `borders` | client-side country borders overlay | — |
| `camera` | traffic-cam plugin with frustum rendering | per-source proxies under `/api/camera/` |
| `geojson` | runtime GeoJSON importer | — |

New plugin checklist: implement `WorldPlugin` (id/name/icon/category/version + the lifecycle, fetch, polling, layer, render methods), prefix every `GeoEntity.id` with your plugin id, register in `AppShell.tsx`, and add an API route only if you need server-side proxying or auth. See `docs/PLUGIN_GUIDE.md` for the full walkthrough and `src/plugins/aviation/index.ts` as the canonical reference.

## Conventions

- **Path alias**: `@/*` → `./src/*` (configured in both `tsconfig.json` and `vitest.config.ts`).
- **TypeScript strict**: `strict: true` is on. Avoid `any` (acknowledged in `CONTRIBUTING.md`).
- **File size**: `CONTRIBUTING.md` calls for files under ~150 lines; split into modules when they grow.
- **Commit style**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, …). Branches `feat/…`, `fix/…`, `docs/…`, `refactor/…`.
- **Plugin entity IDs**: Always prefix with the plugin id (e.g. `aviation-${icao24}`, `earthquake-${usgsId}`) to avoid collisions across layers.
- **No `console.log` cleanup needed for `[AppShell]`/`[PluginManager]` style breadcrumbs** — they're the existing debugging convention.
