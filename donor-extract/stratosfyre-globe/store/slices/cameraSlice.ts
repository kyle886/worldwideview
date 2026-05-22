/**
 * cameraSlice — just zoom now.
 *
 * Note: `cameraResetToken` from the original viewStore is GONE in Phase 2.
 * After Phase 1 it lives as `dataBus.emit('cameraReset')` instead — a one-shot
 * event, which is what it always wanted to be. Renderers subscribe via
 * `dataBus.on('cameraReset', ...)` and reset their viewState directly.
 *
 * If you want to keep `resetCamera()` as a method on the store for backward
 * compatibility during the migration, expose it as a thin emit wrapper:
 *
 *   resetCamera() { dataBus.emit('cameraReset', {}); }
 *
 * Listed under the "deprecated shim" comment so it's obvious it should be
 * removed once all consumers move to the DataBus.
 */

import type { SliceCreator } from '../createSlice';
import type { ViewState } from '../index';

export interface CameraSlice {
  zoom: number;
  setZoom(zoom: number): void;
}

export const CAMERA_DEFAULTS: Pick<CameraSlice, 'zoom'> = {
  zoom: 1.5,
};

export const createCameraSlice: SliceCreator<CameraSlice, ViewState> = (_get, set) => ({
  ...CAMERA_DEFAULTS,
  setZoom(zoom) {
    set({ zoom });
  },
});
