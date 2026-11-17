/**
 * Camera views are stored relative to the visible (+Z) sheet face, not to Z=0.
 * This keeps the same close-up when a sheet width (along the press) changes.
 * World units are 10 mm, same convention as PressBrakeViewport.
 */
export interface MainCameraView {
  pos: [number, number, number];
  target: [number, number, number];
}

export const MAIN_CAMERA_STORAGE_KEY = 'falconbend-main-camera-view-v1';

// Near side-on close-up matching the reference screenshot at ~80% of a bend.
// X is almost frontal, a little Y elevation exposes the thickness/upper faces.
// Z values below are offsets from the operator-facing sheet edge.
export const REFERENCE_MAIN_CAMERA: MainCameraView = {
  pos: [1.2, 8.0, 32],
  target: [-0.9, 4.8, 0],
};

export function isMainCameraView(candidate: unknown): candidate is MainCameraView {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const view = candidate as Partial<MainCameraView>;
  const valid = (a: unknown): a is [number, number, number] =>
    Array.isArray(a) && a.length === 3 &&
    a.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e5);
  if (!valid(view.pos) || !valid(view.target)) return false;
  return Math.hypot(...view.pos.map((p, i) => p - view.target![i])) >= 3;
}

export function sheetFrontZ(widthMm: number): number {
  return Math.max(0, widthMm) * 0.05;
}

export function absoluteMainCamera(view: MainCameraView, widthMm: number): MainCameraView {
  const z = sheetFrontZ(widthMm);
  return {
    pos: [view.pos[0], view.pos[1], view.pos[2] + z],
    target: [view.target[0], view.target[1], view.target[2] + z],
  };
}

export function relativeMainCamera(view: MainCameraView, widthMm: number): MainCameraView {
  const z = sheetFrontZ(widthMm);
  return {
    pos: [view.pos[0], view.pos[1], view.pos[2] - z],
    target: [view.target[0], view.target[1], view.target[2] - z],
  };
}
