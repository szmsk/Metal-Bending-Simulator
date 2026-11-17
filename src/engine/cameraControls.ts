/** Adjustable, bounded OrbitControls speeds. Values intentionally low for CAD work. */
export const CAMERA_SENSITIVITY_KEY = 'falconbend-camera-sensitivity-v1';
export const DEFAULT_CAMERA_SENSITIVITY = 40;

export function clampCameraSensitivity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CAMERA_SENSITIVITY;
  return Math.max(20, Math.min(100, Math.round(value)));
}

export function cameraControlSpeeds(value: number) {
  const s = clampCameraSensitivity(value) / 100;
  return {
    rotateSpeed: 0.95 * s,  // 0.38 at default, instead of the OrbitControls default 1
    panSpeed: 0.90 * s,     // 0.36 at default
    zoomSpeed: 0.30 + s * 0.60, // 0.54 at default
    dampingFactor: 0.14,  // reduce lingering motion after drag
  };
}
