import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAME_ACCENT_Y_SEGMENTS_MM, FRAME_FRONT_FACE_X_MM, cFrameSectionMm, getMachineZLayout } from '../src/engine/machineLayout';
import { cameraControlSpeeds, clampCameraSensitivity, DEFAULT_CAMERA_SENSITIVITY } from '../src/engine/cameraControls';

test('accent does not bridge the open C-frame throat (the screenshot artifact)', () => {
  assert.equal(FRAME_ACCENT_Y_SEGMENTS_MM.length, 2);
  assert.ok(FRAME_ACCENT_Y_SEGMENTS_MM[0].endMm < -80);
  assert.ok(FRAME_ACCENT_Y_SEGMENTS_MM[1].startMm > 300);
  assert.equal(FRAME_FRONT_FACE_X_MM, 100);
});

test('upper and lower structural rails terminate outside column volume', () => {
  const l = getMachineZLayout(4100,3600);
  assert.deepEqual(l.columns, [{startMm:-1880,endMm:-1800},{startMm:1800,endMm:1880}]);
  assert.equal(l.structuralRails.length,3);
  for (const rail of l.structuralRails) for (const column of l.columns) {
    assert.ok(rail.endMm <= column.startMm || rail.startMm >= column.endMm);
  }
  for (const column of l.columns) {
    assert.ok(l.topHeader.endMm <= column.startMm || l.topHeader.startMm >= column.endMm);
  }
});

test('C-shaped housing has a real, open mouth on the operator-facing edge', () => {
  const section = cFrameSectionMm(410);
  assert.ok(section.some(p => p.x===100 && p.y===-80));
  assert.ok(section.some(p => p.x===100 && p.y===300));
  assert.ok(section.every(p => Number.isFinite(p.x)&&Number.isFinite(p.y)));
});

test('camera controls start much slower than stock OrbitControls', () => {
  const settings=cameraControlSpeeds(DEFAULT_CAMERA_SENSITIVITY);
  assert.ok(settings.rotateSpeed<0.5 && settings.rotateSpeed>0.2);
  assert.ok(settings.panSpeed<0.5);
  assert.ok(settings.zoomSpeed<0.7);
  assert.ok(settings.dampingFactor>=0.1);
});

test('camera sensitivity is bounded and speeds rise monotonically', () => {
  assert.equal(clampCameraSensitivity(-40),20);
  assert.equal(clampCameraSensitivity(400),100);
  assert.equal(clampCameraSensitivity(NaN),DEFAULT_CAMERA_SENSITIVITY);
  assert.ok(cameraControlSpeeds(20).rotateSpeed < cameraControlSpeeds(100).rotateSpeed);
  assert.ok(cameraControlSpeeds(20).panSpeed < cameraControlSpeeds(100).panSpeed);
});
