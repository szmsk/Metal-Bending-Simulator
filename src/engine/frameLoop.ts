/**
 * The render loop is owned by the viewport, NOT by the bending playback.
 * Pausing a stroke (including due to a collision) never disables on-demand
 * frames requested by OrbitControls, resizing or React scene updates.
 */
export interface FrameLoopDriver {
  requestFrame: (callback: (timestampMs: number) => void) => number;
  cancelFrame: (id: number) => void;
}

export interface FrameLoop {
  /** Draw one frame, even when the bending animation is paused. */
  invalidate: () => void;
  /** Start/resume an animated cycle without replacing a pending view frame. */
  beginAnimation: () => void;
  dispose: () => void;
}

export function createFrameLoop(
  drawFrame: (deltaSeconds: number) => boolean,
  driver: FrameLoopDriver
): FrameLoop {
  let pendingFrame: number | null = null;
  let previousTimestamp: number | null = null;
  let disposed = false;

  const invalidate = () => {
    if (disposed || pendingFrame !== null) return;
    pendingFrame = driver.requestFrame(onFrame);
  };

  const onFrame = (timestampMs: number) => {
    pendingFrame = null;
    if (disposed) return;
    const deltaSeconds = previousTimestamp === null
      ? 0
      : Math.max(0, Math.min(0.05, (timestampMs - previousTimestamp) / 1000));
    previousTimestamp = timestampMs;

    // Returning false ends ONLY continuous playback. The next mouse/scroll
    // interaction may still call invalidate(), and will render normally.
    const keepAnimating = drawFrame(deltaSeconds);
    if (keepAnimating) invalidate();
  };

  return {
    invalidate,
    beginAnimation: () => {
      previousTimestamp = null; // no jump when resuming after inspecting a collision
      invalidate();
    },
    dispose: () => {
      disposed = true;
      if (pendingFrame !== null) driver.cancelFrame(pendingFrame);
      pendingFrame = null;
    },
  };
}
