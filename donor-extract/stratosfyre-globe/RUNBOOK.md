---
runbook_id: stratosfyre-globe-uplift
runbook_version: 1
authored_by: claude (worldwideview donor session)
target_repo: stratosfyre-global-practices
donor_repo: worldwideview
donor_branch: claude/claude-md-docs-2O0sD
donor_path_within_repo: donor-extract/stratosfyre-globe/
phases: [1, 2, 3, 4, 5]
expected_total_diff: ~30 files added, ~1 file deleted (viewStore.ts), DeckGlobe.tsx rewritten
estimated_wall_time_per_phase: { 1: "30m", 2: "30m", 3: "2h", 4: "30m", 5: "30m" }
---

# RUNBOOK — Stratosfyre Globe Uplift (deck.gl)

You are an agent porting patterns from the `worldwideview` donor repo into
`stratosfyre-global-practices`. The donor patterns are pre-adapted for deck.gl.
Execute phases 1 → 5 in order. **Do not skip phases.** Each phase ends with a
commit checkpoint; do not proceed if its checks fail.

## Required reading before you start

Read these files in the donor before any action:

```
$DONOR/README.md
$DONOR/MIGRATION_PLAN.md
$DONOR/plugins/types.ts
$DONOR/DeckGlobe.refactored.tsx
```

The plan doc explains the *why*. This runbook is the *how*. If they disagree, the plan wins — flag the discrepancy and ASK before proceeding.

## Variables

Set these once before running any step. Use absolute paths.

```bash
DONOR=/abs/path/to/worldwideview/donor-extract/stratosfyre-globe
TARGET=/abs/path/to/stratosfyre-global-practices
```

All steps below assume `cd $TARGET`. Every file path uses `$DONOR/...` for source and `src/globe/...` (relative) for destination.

## Halt conditions (apply globally, all phases)

If any of these occur, STOP and ASK the user:

- `H1`: A target file already exists with conflicting content (not the same content as donor + import path tweaks).
- `H2`: A `npm test` run reports more failures after a step than before it.
- `H3`: A `tsc --noEmit` introduces type errors in files this runbook didn't touch.
- `H4`: An import the donor file expects (e.g. `'../../layers/markers'`) does not resolve in the target.
- `H5`: The donor file references a Stratosfyre type the target doesn't export.
- `H6`: A check command at the end of a step returns unexpected output.
- `H7`: You're about to delete `viewStore.ts` but haven't committed the new `store/` directory yet.

Do not invent fixes for halt conditions. Report the condition, the step id, the command output, and wait.

## Pre-flight

Run these checks before Phase 1. Halt on any failure.

```yaml
- id: preflight.git_clean
  command: cd $TARGET && git status --porcelain
  expect_stdout: ""
  on_failure: HALT (working tree is dirty)

- id: preflight.donor_present
  command: test -f $DONOR/README.md && test -f $DONOR/MIGRATION_PLAN.md
  expect_exit: 0
  on_failure: HALT (DONOR path is wrong)

- id: preflight.target_layout
  command: test -d $TARGET/src/globe
  expect_exit: 0
  on_failure: HALT (target src/globe/ missing — wrong TARGET path?)

- id: preflight.deckgl_installed
  command: cd $TARGET && node -e "require('@deck.gl/core')"
  expect_exit: 0
  on_failure: HALT (run `npm install` first)

- id: preflight.baseline_tests
  command: cd $TARGET && npm test --silent 2>&1 | tail -20
  expect_substring: "passed"
  store_as: BASELINE_TEST_OUTPUT
  on_failure: HALT (target tests already failing — fix or skip)

- id: preflight.baseline_typecheck
  command: cd $TARGET && npx tsc --noEmit 2>&1 | tail -20
  expect_exit: 0
  store_as: BASELINE_TSC_OUTPUT
  on_failure: HALT (target type-check already failing)

- id: preflight.feature_branch
  command: cd $TARGET && git checkout -b feat/globe-plugin-uplift
  expect_exit: 0
  on_failure: branch may already exist; check `git branch --show-current` and continue if on the right branch
```

---

## Phase 1 — DataBus + types, kill cameraResetToken

Goal: introduce a typed event bus and remove the token-bump signaling pattern. No behavior change.

```yaml
- id: phase1.copy_databus_and_types
  preconditions:
    - test -f $DONOR/DataBus.ts
    - test -f $DONOR/plugins/types.ts
  actions:
    - mkdir -p src/globe/plugins
    - cp $DONOR/DataBus.ts src/globe/DataBus.ts
    - cp $DONOR/plugins/types.ts src/globe/plugins/types.ts
  checks:
    - command: test -f src/globe/DataBus.ts && test -f src/globe/plugins/types.ts
      expect_exit: 0
    - command: grep -c "export const dataBus" src/globe/DataBus.ts
      expect_substring: "1"
  on_failure: HALT, restore via `git checkout -- src/globe/`
  notes: |
    DataBus.ts has zero external imports beyond `./plugins/types`.
    types.ts has only `@deck.gl/core` + `react` type imports.

- id: phase1.find_camerareset_callsites
  actions:
    - cd $TARGET && grep -rn "cameraResetToken" src/ > /tmp/cameraReset_callsites.txt || true
    - cd $TARGET && grep -rn "resetCamera\(" src/ >> /tmp/cameraReset_callsites.txt || true
  checks:
    - command: cat /tmp/cameraReset_callsites.txt
      record_only: true
  notes: |
    Read the file. Every line is a site to rewrite. Typical pattern:
      - viewStore.resetCamera()  →  dataBus.emit('cameraReset', {})
      - useEffect on state.cameraResetToken  →  dataBus.on('cameraReset', ...)
    HALT if call sites are in files NOT under src/globe/ or src/components/ —
    those may need a different treatment.

- id: phase1.find_onmarketclick_callsites
  actions:
    - cd $TARGET && grep -rn "onMarketClick" src/ > /tmp/onMarketClick_callsites.txt || true
  checks:
    - command: cat /tmp/onMarketClick_callsites.txt
      record_only: true
  notes: |
    Each `onMarketClick={handler}` prop becomes:
      useEffect(() => dataBus.on('entitySelected', ({ datum }) => handler(datum as Market)), []);
    Do NOT delete onMarketClick from DeckGlobeProps in Phase 1.
    That's a deprecation shim — DeckGlobe re-emits onto the bus AND calls the prop
    so old call sites keep working. Removal happens in Phase 3 cleanup.

- id: phase1.rewrite_callsites
  actions:
    - For each line in /tmp/cameraReset_callsites.txt, edit per the patterns
      in phase1.find_camerareset_callsites.notes.
    - For each line in /tmp/onMarketClick_callsites.txt, edit per the patterns
      in phase1.find_onmarketclick_callsites.notes.
    - In src/globe/DeckGlobe.tsx, add the `dataBus.emit('entitySelected', ...)`
      and `dataBus.emit('cameraReset', ...)` emit calls alongside existing logic.
      Do NOT delete the existing handleClick fly-to logic yet (Phase 4 does that).
  checks:
    - command: cd $TARGET && grep -c "cameraResetToken" src/ -r || true
      expect_substring: "0"
      on_failure: HALT — at least one call site missed
    - command: cd $TARGET && npx tsc --noEmit 2>&1 | tail -30
      expect_exit: 0
      on_failure: HALT, log error, ASK

- id: phase1.run_tests
  command: cd $TARGET && npm test --silent
  expect_substring: "passed"
  on_failure: HALT and report which tests regressed vs BASELINE_TEST_OUTPUT

- id: phase1.commit
  preconditions:
    - all previous phase1 checks passed
  actions:
    - cd $TARGET && git add src/globe/DataBus.ts src/globe/plugins/types.ts
    - cd $TARGET && git add -u src/   # rewritten call sites
    - cd $TARGET && git commit -m "feat(globe): introduce DataBus; replace cameraResetToken with events"
  checks:
    - command: cd $TARGET && git log -1 --format=%s
      expect_substring: "DataBus"
```

---

## Phase 2 — Sliced viewStore

Goal: replace monolithic `viewStore.ts` with a composed-from-slices version. Public API unchanged. Behavior unchanged.

```yaml
- id: phase2.copy_store
  preconditions:
    - test -d $DONOR/store
  actions:
    - mkdir -p src/globe/store/slices
    - cp $DONOR/store/createSlice.ts src/globe/store/createSlice.ts
    - cp $DONOR/store/index.ts src/globe/store/index.ts
    - cp $DONOR/store/index.test.ts src/globe/store/index.test.ts
    - cp $DONOR/store/slices/*.ts src/globe/store/slices/
  checks:
    - command: ls src/globe/store/slices/ | wc -l
      expect_substring: "6"
    - command: test -f src/globe/store/index.ts && test -f src/globe/store/index.test.ts
      expect_exit: 0

- id: phase2.fix_imports_in_new_store
  notes: |
    The donor's store/index.ts imports `../DataBus`. That resolves correctly
    when the file is at src/globe/store/index.ts because DataBus.ts is at
    src/globe/DataBus.ts (one level up). No edit needed.
    
    HALT if the target keeps DataBus elsewhere — adjust the relative path.
  checks:
    - command: cd $TARGET && node -e "require.resolve('./src/globe/store/index.ts')" 2>&1 || true
      record_only: true
    - command: cd $TARGET && npx tsc --noEmit src/globe/store/index.ts 2>&1 | tail -20
      expect_exit: 0
      on_failure: HALT, report tsc error, ASK

- id: phase2.run_compat_test
  command: cd $TARGET && npx vitest run src/globe/store/index.test.ts
  expect_substring: "passed"
  on_failure: HALT — sliced store contract broken; do not swap

- id: phase2.swap_singleton
  notes: |
    Find every import of the old viewStore.
  actions:
    - cd $TARGET && grep -rln "from ['\"].*viewStore['\"]" src/ > /tmp/viewstore_importers.txt
    - For each importer, replace the import path:
        from '../viewStore'  →  from '../store'
        from './viewStore'   →  from './store'
        (etc — preserve relative depth)
    - Do NOT delete the old viewStore.ts yet.
  checks:
    - command: cd $TARGET && grep -rln "viewStore" src/ | grep -v "src/globe/store/" || true
      expect_stdout: ""
      on_failure: at least one importer was missed; HALT and re-check

- id: phase2.run_full_tests
  command: cd $TARGET && npm test --silent
  expect_substring: "passed"
  on_failure: HALT — store swap broke tests; diff outputs against BASELINE_TEST_OUTPUT

- id: phase2.delete_old_viewstore
  preconditions:
    - phase2.run_full_tests passed
    - git status shows only expected files modified
  actions:
    - cd $TARGET && rm src/globe/viewStore.ts
  checks:
    - command: cd $TARGET && grep -rln "viewStore" src/ | grep -v "src/globe/store/" || true
      expect_stdout: ""

- id: phase2.commit
  actions:
    - cd $TARGET && git add -A src/globe/store/
    - cd $TARGET && git add -u src/
    - cd $TARGET && git rm src/globe/viewStore.ts || true   # may already be staged
    - cd $TARGET && git commit -m "refactor(globe): slice viewStore into composable slices"
```

---

## Phase 3 — Plugin architecture (largest phase)

Goal: introduce `GlobePlugin<T>` interface, port every inline layer in `DeckGlobe.tsx` into a plugin, replace the inline layer-building memo with a loop over the registry. Behavior unchanged.

This phase has the highest risk. Migrate plugins ONE AT A TIME with a commit per plugin.

```yaml
- id: phase3.copy_plugin_infra
  preconditions:
    - test -f $DONOR/plugins/PluginRegistry.ts
    - test -f $DONOR/plugins/PluginManager.ts
  actions:
    - cp $DONOR/plugins/PluginRegistry.ts src/globe/plugins/PluginRegistry.ts
    - cp $DONOR/plugins/PluginManager.ts src/globe/plugins/PluginManager.ts
    - cp $DONOR/plugins/filterEngine.ts src/globe/plugins/filterEngine.ts
    - cp $DONOR/plugins/init.ts src/globe/plugins/init.ts
  checks:
    - command: cd $TARGET && npx tsc --noEmit 2>&1 | tail -20
      expect_exit: 0
      on_failure: HALT — type errors before any plugins are added means an
                  import path in the infra files needs adjustment

- id: phase3.copy_basemap_plugin
  notes: |
    BasemapPlugin first because it's the only `alwaysOn` plugin and has no
    dependencies on Stratosfyre's existing layer builders.
  actions:
    - mkdir -p src/globe/plugins/builtin
    - cp $DONOR/plugins/builtin/BasemapPlugin.ts src/globe/plugins/builtin/BasemapPlugin.ts
  checks:
    - command: cd $TARGET && npx tsc --noEmit src/globe/plugins/builtin/BasemapPlugin.ts 2>&1 | tail -20
      expect_exit: 0

- id: phase3.delete_basemap_inline
  notes: |
    Now remove the inline tile-basemap + countries layer-build code from
    DeckGlobe.tsx. Search for these symbols:
      - BASEMAP_TILE_URLS
      - buildBasemapTileLayer
      - buildCountriesLayer
      - COUNTRIES_URL
      - SPHERE_POLYGON (if still present)
    They all move to BasemapPlugin. The layers memo in DeckGlobe loses two lines.
  actions:
    - Edit src/globe/DeckGlobe.tsx — remove the constants and helpers above.
    - In the layers memo, REMOVE the `out.push(buildBasemapTileLayer(...))` and
      `out.push(buildCountriesLayer())` lines.
    - Add a registry-walk at the top of the layers memo:
        const pluginLayers = pluginRegistry.getAll()
          .filter(p => p.alwaysOn)
          .flatMap(p => p.buildLayers({ data: [], ctx }));
        const out: Layer[] = [...pluginLayers];
  checks:
    - command: cd $TARGET && grep -c "BASEMAP_TILE_URLS\|buildBasemapTileLayer\|buildCountriesLayer" src/globe/DeckGlobe.tsx
      expect_substring: "0"
    - command: cd $TARGET && npm test --silent
      expect_substring: "passed"
  on_failure:
    - If basemap stops rendering visually: HALT and ASK. The most common cause
      is `alwaysOn: true` was not honored by the registry walk.

- id: phase3.commit_basemap
  actions:
    - cd $TARGET && git add src/globe/plugins/
    - cd $TARGET && git add -u src/globe/DeckGlobe.tsx
    - cd $TARGET && git commit -m "refactor(globe): port basemap into BasemapPlugin"

- id: phase3.copy_simple_plugins
  notes: |
    Three mechanical ports: Arcs, Voronoi, Photoreal3d. No state coupling.
    Photoreal3dPlugin owns the zoom gate (>= 8) internally.
  actions:
    - cp $DONOR/plugins/builtin/ArcsPlugin.ts src/globe/plugins/builtin/
    - cp $DONOR/plugins/builtin/VoronoiPlugin.ts src/globe/plugins/builtin/
    - cp $DONOR/plugins/builtin/Photoreal3dPlugin.ts src/globe/plugins/builtin/
  checks:
    - command: cd $TARGET && npx tsc --noEmit 2>&1 | tail -20
      expect_exit: 0
      on_failure: |
        Most likely import paths to existing Stratosfyre helpers
        (`../../layers/arcs`, `../../types`) don't resolve. Verify the
        Stratosfyre files exist; adjust the donor file's import path if
        the target uses a different location. HALT if helpers are missing.

- id: phase3.copy_hex_plugin
  notes: |
    HexPlugin imports buildWeightedMarkets and the Market type. Gate is on
    `ctx.heatmapMode !== 'none'`, not activeLayers — this is INTENTIONAL and
    preserves a specific desync prevention from the original DeckGlobe.tsx.
  actions:
    - cp $DONOR/plugins/builtin/HexPlugin.ts src/globe/plugins/builtin/
  checks:
    - command: cd $TARGET && npx tsc --noEmit src/globe/plugins/builtin/HexPlugin.ts 2>&1 | tail -10
      expect_exit: 0

- id: phase3.copy_markets_plugin
  notes: |
    The most complex port: pulse clock, color metric, selection, recentlyClickedId
    flash. The donor MarketsPlugin emits dataUpdated on every pulse tick to force
    re-render. If you observe FPS regression, swap to deck.gl updateTriggers
    (see plan doc) — but ONLY after a working port is in place. Do not optimize
    in this step.
  actions:
    - cp $DONOR/plugins/builtin/MarketsPlugin.ts src/globe/plugins/builtin/
  checks:
    - command: cd $TARGET && npx tsc --noEmit src/globe/plugins/builtin/MarketsPlugin.ts 2>&1 | tail -10
      expect_exit: 0

- id: phase3.refactor_deckglobe
  notes: |
    This is the largest single edit. Use $DONOR/DeckGlobe.refactored.tsx as a
    reference — but DO NOT copy it wholesale; Stratosfyre's existing
    DeckGlobe.tsx has Stratosfyre-specific code (error toast styling,
    data-deck-ready test hook, CLEAR_COLOR, etc.) that must be preserved.
    
    Concrete edits, in order:
    
    1. Add imports:
         import { pluginRegistry } from './plugins/PluginRegistry';
         import { pluginManager } from './plugins/PluginManager';
         import { initGlobePlugins } from './plugins/init';
         import { dataBus } from './DataBus';
    
    2. In the top-level mount effect (existing useEffect that runs once),
       add:
         useEffect(() => {
           initGlobePlugins({ store }).catch(console.error);
         }, [store]);
    
    3. Replace data feeding: every place that currently puts markets/arcs/
       voronoi into local state, replace with:
         pluginManager.setData('markets', markets);
         pluginManager.setData('arcs', arcs);
         pluginManager.setData('voronoi', voronoiPolygons);
         pluginManager.setData('hex', markets);  // hex derives from markets
    
    4. Replace the inline layer memo. The donor reference shows the shape:
         const layers = useMemo(() => {
           return pluginRegistry.getAll().flatMap((plugin) => {
             const gated = !plugin.alwaysOn && !storeState.activeLayers.has(plugin.id);
             if (gated) return [];
             return plugin.buildLayers({
               data: pluginManager.getData(plugin.id),
               ctx: { ... },  // see donor file for full ctx shape
             });
           });
         }, [...deps]);
    
    5. Replace handleClick. Dispatch to the owning plugin via layer-id prefix:
         const plugin = pluginRegistry.getAll().find(
           p => info.layer?.id === p.id || info.layer?.id?.startsWith(p.id + '-')
         );
         if (plugin && info.object) {
           plugin.onPick?.(info.object, info, ctx);
           const target = plugin.getFlyToTarget?.(info.object);
           if (target) dataBus.emit('cameraFlyTo', target);
         }
    
    6. PRESERVE: error handlers (showError, handleWebGLInitialized, handleDeckError),
       data-deck-ready canvas tagging, GLOBE_CONTROLLER_CONFIG, CLEAR_COLOR,
       reduced-motion checks for the cursor flip (TEMPORARILY — Phase 4 moves
       this to CameraController).
    
    7. KEEP onMarketClick prop and the FlyToInterpolator call in handleClick
       for now. They become dead code in Phase 4 but removing them now risks
       breaking external callers.
  checks:
    - command: cd $TARGET && npx tsc --noEmit 2>&1 | tail -30
      expect_exit: 0
      on_failure: HALT, dump tsc output, ASK
    - command: cd $TARGET && grep -c "pluginRegistry.getAll()" src/globe/DeckGlobe.tsx
      expect_substring: "1"
      on_failure: HALT — registry walk not present
    - command: cd $TARGET && npm test --silent
      expect_substring: "passed"

- id: phase3.smoke_test_browser
  notes: |
    Run the dev server and verify in a browser.
    This is a HUMAN step — you cannot verify rendering yourself.
    ASK the user to confirm before continuing.
  actions:
    - cd $TARGET && npm run dev &
    - Sleep 5 seconds for the dev server to come up.
    - ASK user: "Please visit http://localhost:3000 and confirm:
        1. Globe renders with dark basemap + country outlines
        2. Markets layer shows points coloured by MIS
        3. Clicking a market flies to it and shows the pulse
        4. Toggling Arcs / Voronoi / Hex / Photoreal3d works
        5. No regressions vs main branch.
       Reply 'OK' to continue or paste the regression."
  on_failure: HALT — do not commit a broken visual port

- id: phase3.commit
  preconditions:
    - phase3.smoke_test_browser OK from user
  actions:
    - cd $TARGET && git add -A src/globe/plugins/ src/globe/DeckGlobe.tsx
    - cd $TARGET && git add -u src/
    - cd $TARGET && git commit -m "refactor(globe): port layers into plugin registry"
```

---

## Phase 4 — CameraController

Goal: centralize all camera transitions, reduced-motion, and cursor-flip side effects in one module. `DeckGlobe.tsx` loses all FlyToInterpolator references.

```yaml
- id: phase4.copy_controller
  actions:
    - cp $DONOR/CameraController.ts src/globe/CameraController.ts
    - cp $DONOR/CameraController.test.ts src/globe/CameraController.test.ts
  checks:
    - command: cd $TARGET && npx tsc --noEmit src/globe/CameraController.ts 2>&1 | tail -20
      expect_exit: 0
    - command: cd $TARGET && npx vitest run src/globe/CameraController.test.ts
      expect_substring: "passed"

- id: phase4.replace_camera_logic_in_deckglobe
  actions:
    - Edit src/globe/DeckGlobe.tsx
    - Remove the import of FlyToInterpolator from '@deck.gl/core'.
    - Remove the inline handleClick fly-to block (zoom: 6, transitionDuration: 1200, etc.).
    - Remove the cursor-flip block (document.body.style.cursor = 'wait').
    - Remove any prefers-reduced-motion checks tied to fly-to.
    - Add import: import { mountCameraController } from './CameraController';
    - In a useEffect with dep [initialViewState]:
        return mountCameraController({
          setViewState: (patch) => setViewState(patch as unknown as Record<string, unknown>),
          initialViewState,
        });
    - In handleClick, KEEP the dispatch logic (plugin.onPick + plugin.getFlyToTarget +
      dataBus.emit('cameraFlyTo', ...)). The controller handles the rest.
  checks:
    - command: cd $TARGET && grep -c "FlyToInterpolator" src/globe/DeckGlobe.tsx
      expect_substring: "0"
    - command: cd $TARGET && grep -c "document.body.style.cursor" src/globe/DeckGlobe.tsx
      expect_substring: "0"
    - command: cd $TARGET && grep -c "mountCameraController" src/globe/DeckGlobe.tsx
      expect_substring: "1"
    - command: cd $TARGET && npx tsc --noEmit 2>&1 | tail -20
      expect_exit: 0

- id: phase4.wire_region_to_preset
  notes: |
    Optional but recommended. Where the region filter changes (CommandBar?),
    fire a cameraPreset:
      onRegionChange: (region) => {
        store.setRegionFilter(region);
        if (region in CAMERA_PRESETS) {
          dataBus.emit('cameraPreset', { presetId: region });
        }
      }
    Find the callsite with: grep -rn "setRegionFilter" src/
  checks: []
  notes_followup: |
    Skip if Stratosfyre's region filter UI doesn't currently exist or is
    out of scope for this PR. The preset infra works without this wiring.

- id: phase4.smoke_test
  actions:
    - ASK user to verify in browser:
        1. Click a market — flies smoothly to it.
        2. Cursor shows 'wait' during the transition then reverts.
        3. With prefers-reduced-motion enabled in OS settings, the fly-to
           is instant (durationMs = 0).
        4. Reset button (if it exists) returns to initial view.
        5. If wiring step 3 was done: region dropdown reframes the globe.
  on_failure: HALT and report

- id: phase4.commit
  actions:
    - cd $TARGET && git add src/globe/CameraController.ts src/globe/CameraController.test.ts
    - cd $TARGET && git add -u src/globe/DeckGlobe.tsx
    - cd $TARGET && git commit -m "refactor(globe): centralize camera transitions in CameraController"
```

---

## Phase 5 — PollingManager + CacheLayer

Goal: copy the polling and cache modules. They are dormant until a plugin opts in via `fetchData()` + `getPollingInterval()`. Behavior change is ZERO at copy time.

```yaml
- id: phase5.copy_polling_and_cache
  actions:
    - cp $DONOR/plugins/PollingManager.ts src/globe/plugins/PollingManager.ts
    - cp $DONOR/plugins/CacheLayer.ts src/globe/plugins/CacheLayer.ts
    - cp $DONOR/plugins/PollingManager.test.ts src/globe/plugins/PollingManager.test.ts
    - cp $DONOR/plugins/CacheLayer.test.ts src/globe/plugins/CacheLayer.test.ts
  checks:
    - command: cd $TARGET && npx tsc --noEmit 2>&1 | tail -20
      expect_exit: 0
    - command: cd $TARGET && npx vitest run src/globe/plugins/PollingManager.test.ts src/globe/plugins/CacheLayer.test.ts
      expect_substring: "passed"

- id: phase5.verify_pluginmanager_wiring
  notes: |
    The donor PluginManager.ts already has the polling+cache hooks active.
    It was already copied in Phase 3. Verify it imports the new modules:
  checks:
    - command: cd $TARGET && grep -c "from './PollingManager'" src/globe/plugins/PluginManager.ts
      expect_substring: "1"
    - command: cd $TARGET && grep -c "from './CacheLayer'" src/globe/plugins/PluginManager.ts
      expect_substring: "1"
    - command: cd $TARGET && npm test --silent
      expect_substring: "passed"

- id: phase5.smoke_test
  notes: |
    Nothing should change visually. Prop-driven plugins (the current state)
    don't poll. Verify:
      1. Globe still renders.
      2. Toggling a layer off then on is INSTANT now (L1 cache hit).
      3. After a page reload with layer toggled on, the previous data flashes
         in before any fresh data lands (L2 hit, if IDB available).
    The L2 behavior is hard to verify on a first run since there's nothing
    cached yet — toggle a few times and reload to populate.
  actions:
    - ASK user to confirm toggle-off-on feels instant.
  on_failure: report

- id: phase5.commit
  actions:
    - cd $TARGET && git add src/globe/plugins/PollingManager.ts src/globe/plugins/CacheLayer.ts
    - cd $TARGET && git add src/globe/plugins/PollingManager.test.ts src/globe/plugins/CacheLayer.test.ts
    - cd $TARGET && git commit -m "feat(globe): add PollingManager + CacheLayer (dormant until plugin opt-in)"
```

---

## Post-flight

After all phases:

```yaml
- id: postflight.full_test
  command: cd $TARGET && npm test
  expect_substring: "passed"

- id: postflight.full_typecheck
  command: cd $TARGET && npx tsc --noEmit
  expect_exit: 0

- id: postflight.diff_summary
  command: cd $TARGET && git log feat/globe-plugin-uplift --not main --oneline
  expect_min_lines: 5

- id: postflight.report
  notes: |
    Generate a one-paragraph summary covering:
      - Number of files added under src/globe/plugins/
      - Number of files added under src/globe/store/
      - DeckGlobe.tsx line count delta (expect: dropped from ~475 to ~200)
      - viewStore.ts removed
      - Tests added (count: index.test, CameraController.test, PollingManager.test, CacheLayer.test = 4)
      - Whether Phase 4 region-preset wiring was applied
    Surface this to the user.
```

---

## When to stop and ask

Beyond the H1–H7 halt conditions above, ASK the user (do not guess) if:

- `A1`: A Stratosfyre-specific helper imported by a donor plugin doesn't exist (e.g. `buildWeightedMarkets`). The user may have a different name or path.
- `A2`: The target's `viewStore.ts` has fields you haven't seen in the donor — they need their own slice file.
- `A3`: Two or more `<DeckGlobe>` instances are mounted in the target (the donor's pluginManager is a singleton; isolation may need `createPluginManager()` per instance).
- `A4`: The target uses a state library other than the custom pub/sub described in the donor — the slice creator pattern may need adjustment.
- `A5`: After Phase 3, FPS visibly drops vs the main branch. The pulse-tick re-emit is the prime suspect — the fix is to use deck.gl `updateTriggers` rather than full layer rebuild on each pulse phase. ASK before making this optimization.

## Source-of-truth references

If any step is ambiguous, defer to these files in the donor (in priority order):

1. `$DONOR/MIGRATION_PLAN.md` — design intent
2. `$DONOR/plugins/types.ts` — interface contract
3. `$DONOR/DeckGlobe.refactored.tsx` — shape reference
4. `$DONOR/README.md` — layout overview

The runbook (this file) is the execution layer. If the runbook says X but the plan says ¬X, the plan wins and you ASK.
