/**
 * Tests for CameraController.
 *
 * The pure translator `targetToViewState` is the bulk of the surface and is
 * exhaustively tested. The mount glue (DataBus subscription) is tested
 * lightly — one emit per event channel, asserting the setter was called
 * with the expected patch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  targetToViewState,
  mountCameraController,
  CAMERA_PRESETS,
} from './CameraController';
import { dataBus } from './DataBus';

describe('targetToViewState', () => {
  it('produces a basic patch with sensible defaults', () => {
    const patch = targetToViewState(
      { longitude: -73.9, latitude: 40.7 },
      { enableReducedMotion: false },
    );
    expect(patch.longitude).toBe(-73.9);
    expect(patch.latitude).toBe(40.7);
    expect(patch.zoom).toBe(6);
    expect(patch.transitionDuration).toBe(1200);
    expect(patch.transitionInterpolator).toBeDefined();
  });

  it('respects an explicit zoom and duration', () => {
    const patch = targetToViewState(
      { longitude: 0, latitude: 0, zoom: 10, durationMs: 800 },
      { enableReducedMotion: false },
    );
    expect(patch.zoom).toBe(10);
    expect(patch.transitionDuration).toBe(800);
  });

  it('omits the interpolator when durationMs is 0', () => {
    const patch = targetToViewState(
      { longitude: 0, latitude: 0, durationMs: 0 },
      { enableReducedMotion: false },
    );
    expect(patch.transitionDuration).toBeUndefined();
    expect(patch.transitionInterpolator).toBeUndefined();
  });

  it('includes pitch and bearing when set', () => {
    const patch = targetToViewState(
      { longitude: 0, latitude: 0, pitch: 45, bearing: 90 },
      { enableReducedMotion: false },
    );
    expect(patch.pitch).toBe(45);
    expect(patch.bearing).toBe(90);
  });

  describe('reduced-motion handling', () => {
    let mql: { matches: boolean };

    beforeEach(() => {
      mql = { matches: false };
      vi.stubGlobal('matchMedia', vi.fn(() => mql));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('zeroes durationMs when prefers-reduced-motion is set', () => {
      mql.matches = true;
      const patch = targetToViewState({ longitude: 0, latitude: 0, durationMs: 1200 });
      expect(patch.transitionDuration).toBeUndefined();
      expect(patch.transitionInterpolator).toBeUndefined();
    });

    it('respects respectReducedMotion: false override', () => {
      mql.matches = true;
      const patch = targetToViewState({
        longitude: 0, latitude: 0, durationMs: 1200,
        respectReducedMotion: false,
      });
      expect(patch.transitionDuration).toBe(1200);
    });

    it('respects enableReducedMotion: false on the controller', () => {
      mql.matches = true;
      const patch = targetToViewState(
        { longitude: 0, latitude: 0, durationMs: 1200 },
        { enableReducedMotion: false },
      );
      expect(patch.transitionDuration).toBe(1200);
    });
  });
});

describe('mountCameraController — DataBus → setViewState', () => {
  const initialViewState = { longitude: 0, latitude: 20, zoom: 1.5 };
  let setViewState: ReturnType<typeof vi.fn>;
  let unmount: () => void;

  beforeEach(() => {
    setViewState = vi.fn();
    unmount = mountCameraController({
      setViewState,
      initialViewState,
      enableCursorFlip: false, // skip document side-effects in jsdom
      enableReducedMotion: false,
    });
  });
  afterEach(() => unmount());

  it('cameraReset returns to initialViewState', () => {
    dataBus.emit('cameraReset', {} as Record<string, never>);
    expect(setViewState).toHaveBeenCalledWith(
      expect.objectContaining(initialViewState),
    );
  });

  it('cameraFlyTo translates target to viewState patch', () => {
    dataBus.emit('cameraFlyTo', {
      longitude: -73.9, latitude: 40.7, zoom: 8, durationMs: 500,
    });
    expect(setViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        longitude: -73.9, latitude: 40.7, zoom: 8, transitionDuration: 500,
      }),
    );
  });

  it('cameraPreset fires the registered preset', () => {
    dataBus.emit('cameraPreset', { presetId: 'europe' });
    const preset = CAMERA_PRESETS.europe;
    expect(setViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        longitude: preset.longitude,
        latitude: preset.latitude,
        zoom: preset.zoom,
      }),
    );
  });

  it('unknown preset id logs and does not call setViewState', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dataBus.emit('cameraPreset', { presetId: 'mars' });
    expect(setViewState).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unmount removes all subscriptions', () => {
    unmount();
    dataBus.emit('cameraReset', {} as Record<string, never>);
    dataBus.emit('cameraFlyTo', { longitude: 0, latitude: 0 });
    expect(setViewState).not.toHaveBeenCalled();
  });
});
