/**
 * CameraController — single place that turns DataBus camera events into
 * deck.gl viewState changes.
 *
 * After Phase 4 of the migration, `DeckGlobe.tsx` no longer contains any
 * fly-to construction, no FlyToInterpolator references, no cursor-flip
 * side effect, and no reduced-motion checks. All of that lives here.
 *
 * Subscribes to:
 *   - dataBus.on('cameraFlyTo', target) — fired by plugin onPick handlers
 *     (each plugin returns its own framing via getFlyToTarget)
 *   - dataBus.on('cameraReset', _)     — back to initial view
 *   - dataBus.on('cameraPreset', { presetId }) — named viewpoints (regions)
 *
 * Side effects handled here:
 *   - prefers-reduced-motion: zeroes `durationMs` when the user opts out
 *     (unless the target sets `respectReducedMotion: false`)
 *   - Cursor flip to 'wait' for the duration of any fly-to with a transition
 *
 * The controller is constructor-less; you mount it from DeckGlobe by calling
 * `mountCameraController({ setViewState, initialViewState })` once and
 * holding the returned `unmount()` for cleanup.
 */

import { FlyToInterpolator } from '@deck.gl/core';
import { dataBus } from './DataBus';
import type { FlyToTarget, CameraPreset } from './plugins/types';

interface ViewStatePatch {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  transitionDuration?: number;
  transitionInterpolator?: FlyToInterpolator;
}

export interface MountOptions {
  /** Setter for deck.gl's controlled viewState. */
  setViewState: (patch: ViewStatePatch) => void;
  /** Initial view returned to on `cameraReset`. */
  initialViewState: { longitude: number; latitude: number; zoom: number };
  /**
   * Side-effect knobs. All default true. Disable for tests or for embedding
   * the globe in a context where the document doesn't own the cursor.
   */
  enableCursorFlip?: boolean;
  enableReducedMotion?: boolean;
}

/** Built-in regional presets. Replace coordinates to match Stratosfyre's framing. */
export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  global:       { id: 'global',       longitude: 0,    latitude: 20,  zoom: 1.5, durationMs: 2000 },
  americas:     { id: 'americas',     longitude: -80,  latitude: 15,  zoom: 2.5, durationMs: 2000 },
  europe:       { id: 'europe',       longitude: 15,   latitude: 50,  zoom: 3.0, durationMs: 2000 },
  mena:         { id: 'mena',         longitude: 42,   latitude: 28,  zoom: 3.0, durationMs: 2000 },
  asiaPacific:  { id: 'asiaPacific',  longitude: 105,  latitude: 30,  zoom: 2.5, durationMs: 2000 },
  africa:       { id: 'africa',       longitude: 22,   latitude: 2,   zoom: 2.5, durationMs: 2000 },
  oceania:      { id: 'oceania',      longitude: 140,  latitude: -25, zoom: 2.8, durationMs: 2000 },
  arctic:       { id: 'arctic',       longitude: 0,    latitude: 80,  zoom: 2.5, durationMs: 2000 },
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Translate a `FlyToTarget` into a deck.gl viewState patch. Pure — easy to
 * unit-test. Honors `respectReducedMotion` (defaults to true).
 */
export function targetToViewState(
  target: FlyToTarget,
  opts: { enableReducedMotion: boolean } = { enableReducedMotion: true },
): ViewStatePatch {
  const respect = target.respectReducedMotion !== false;
  const reduced = opts.enableReducedMotion && respect && prefersReducedMotion();
  const duration = reduced ? 0 : (target.durationMs ?? 1200);
  const patch: ViewStatePatch = {
    longitude: target.longitude,
    latitude: target.latitude,
    zoom: target.zoom ?? 6,
  };
  if (target.pitch != null) patch.pitch = target.pitch;
  if (target.bearing != null) patch.bearing = target.bearing;
  if (duration > 0) {
    patch.transitionDuration = duration;
    patch.transitionInterpolator = new FlyToInterpolator({
      speed: target.speed ?? 1.6,
    });
  }
  return patch;
}

/** Cursor-flip lifecycle. Returns a function to clear any pending flip. */
function flipCursorWhile(durationMs: number): () => void {
  if (typeof document === 'undefined' || durationMs <= 0) return () => {};
  const prev = document.body.style.cursor;
  document.body.style.cursor = 'wait';
  const timer = window.setTimeout(() => {
    document.body.style.cursor = prev;
  }, durationMs);
  return () => {
    clearTimeout(timer);
    document.body.style.cursor = prev;
  };
}

export function mountCameraController({
  setViewState,
  initialViewState,
  enableCursorFlip = true,
  enableReducedMotion = true,
}: MountOptions): () => void {
  let cancelCursor: () => void = () => {};

  const unsubReset = dataBus.on('cameraReset', () => {
    cancelCursor();
    setViewState({
      longitude: initialViewState.longitude,
      latitude: initialViewState.latitude,
      zoom: initialViewState.zoom,
    });
  });

  const unsubFly = dataBus.on('cameraFlyTo', (target) => {
    cancelCursor();
    const patch = targetToViewState(target, { enableReducedMotion });
    setViewState(patch);
    if (enableCursorFlip && patch.transitionDuration && patch.transitionDuration > 0) {
      cancelCursor = flipCursorWhile(patch.transitionDuration);
    }
  });

  const unsubPreset = dataBus.on('cameraPreset', ({ presetId }) => {
    const preset = CAMERA_PRESETS[presetId];
    if (!preset) {
      console.warn(`[CameraController] unknown preset: ${presetId}`);
      return;
    }
    cancelCursor();
    const patch = targetToViewState(preset, { enableReducedMotion });
    setViewState(patch);
    if (enableCursorFlip && patch.transitionDuration && patch.transitionDuration > 0) {
      cancelCursor = flipCursorWhile(patch.transitionDuration);
    }
  });

  return () => {
    cancelCursor();
    unsubReset();
    unsubFly();
    unsubPreset();
  };
}
