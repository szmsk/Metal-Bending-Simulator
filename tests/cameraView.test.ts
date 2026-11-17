import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteMainCamera, isMainCameraView, REFERENCE_MAIN_CAMERA, relativeMainCamera, sheetFrontZ } from '../src/engine/mainCameraView';

test('reference camera is a close, almost side-on view of the sheet face', () => {
  const v = absoluteMainCamera(REFERENCE_MAIN_CAMERA, 1000);
  assert.deepEqual(v.pos, [1.2, 8, 82]);
  assert.deepEqual(v.target, [-0.9, 4.8, 50]);
  assert.ok(v.pos[2] - v.target[2] >= 28);
  assert.ok(Math.abs(v.pos[0] - v.target[0]) < 3);
});

test('camera follows front of the part after changing sheet width', () => {
  assert.equal(sheetFrontZ(260), 13);
  const v = absoluteMainCamera(REFERENCE_MAIN_CAMERA, 2500);
  assert.deepEqual(v.pos, [1.2, 8, 157]);
  assert.deepEqual(v.target, [-0.9, 4.8, 125]);
});

test('camera save / restore roundtrip preserves exact world viewpoint', () => {
  const v = { pos: [3, 12, 95] as [number, number, number], target: [-2, 6, 48] as [number, number, number] };
  assert.deepEqual(absoluteMainCamera(relativeMainCamera(v, 1000), 1000), v);
});

test('invalid stored views are rejected rather than crashing the viewport', () => {
  assert.equal(isMainCameraView({ pos: [1, NaN, 3], target: [0, 0, 0] }), false);
  assert.equal(isMainCameraView({ pos: [0, 0, 0], target: [0, 0, 0] }), false);
  assert.equal(isMainCameraView(REFERENCE_MAIN_CAMERA), true);
});
