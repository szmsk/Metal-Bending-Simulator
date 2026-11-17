import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MACHINE, DIE_TOOLS, MATERIALS, PART_PRESETS, PUNCH_TOOLS } from '../src/data/library';
import { detectFrameCollisions, sampleBendStroke, simulateFullSequenceCollisions, testPolygonIntersection } from '../src/engine/collisionEngine';
import { evaluateKinematics } from '../src/engine/kinematics';
import { parseProfile, validateProfile } from '../src/engine/profileValidation';
import { intersectPrisms3D, outsideContactPocket, prism } from '../src/engine/prismatic3d';
import { buildMachineSolids3D } from '../src/engine/collision3d';
import { getBendMarks } from '../src/engine/bendMarks';

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const part = PART_PRESETS[0];
const steps = part.bends.map((_, bendIndex) => ({ bendIndex, flipHorizontal: false }));

function report() {
  return simulateFullSequenceCollisions(part, MATERIALS[0], PUNCH_TOOLS[0], DIE_TOOLS[2], steps, true, false);
}

test('oddzielone bryły mają dodatni prześwit', () => {
  const r = testPolygonIntersection(rect(0, 0, 4, 4), rect(5, 0, 4, 4));
  assert.equal(r.intersecting, false);
  assert.equal(r.clearanceMm, 1);
});

test('styczność krawędzi bez penetracji nie jest kolizją', () => {
  const r = testPolygonIntersection(rect(0, 0, 4, 4), rect(4, 0, 4, 4));
  assert.equal(r.intersecting, false);
  assert.equal(r.clearanceMm, 0);
});

test('przenikanie dwóch brył jest wykrywane', () => {
  const r = testPolygonIntersection(rect(0, 0, 4, 4), rect(3, 0, 4, 4));
  assert.equal(r.intersecting, true);
  assert.ok(r.clearanceMm < 0);
});

test('obrys nie może sam siebie przecinać', () => {
  assert.match(validateProfile([
    { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 },
  ]) ?? '', /sam siebie|zerową/i);
  assert.equal(parseProfile('0 0\n4 0\n4 4\n0 4').length, 4);
});

test('adaptacyjny skok analizuje więcej niż 20 pozycji', () => {
  const sampled = sampleBendStroke(
    (u) => evaluateKinematics(part, MATERIALS[0], PUNCH_TOOLS[0], DIE_TOOLS[2], steps, 1, u, true),
    20
  );
  assert.equal(sampled.converged, true);
  assert.ok(sampled.frames.length > 20);
  assert.equal(sampled.frames[0].strokeProgress, 0);
  assert.equal(sampled.frames[sampled.frames.length - 1].strokeProgress, 1);
});

test('raport obejmuje każdą operację z adaptacyjnymi klatkami 3D', () => {
  const reports = report();
  assert.equal(reports.length, part.bends.length);
  for (const r of reports) assert.ok(r.checkedFrames > 20);
});

test('przekroczenie dopuszczalnego obciążenia narzędzia daje sygnał', () => {
  const weakPunch = { ...PUNCH_TOOLS[0], maxLoadKnPerM: 1 };
  const reports = simulateFullSequenceCollisions(part, MATERIALS[0], weakPunch, DIE_TOOLS[2], steps, true, false);
  assert.ok(reports.every((r) => r.toolLoadExceeded));
});


test('3D: pokrywający się przekrój XY nie koliduje, jeśli Z jest rozdzielone', () => {
  const a = prism('a', rect(0, 0, 10, 10), -20, -10);
  const b = prism('b', rect(0, 0, 10, 10), 20, 30);
  const result = intersectPrisms3D(a, b);
  assert.equal(result.intersecting, false);
  assert.equal(result.clearanceMm, 30);
});

test('3D: styczność płaszczyzn Z jest kontaktem, nie penetracją', () => {
  const a = prism('a', rect(0, 0, 10, 10), -10, 0);
  const b = prism('b', rect(0, 0, 10, 10), 0, 10);
  const result = intersectPrisms3D(a, b);
  assert.equal(result.intersecting, false);
  assert.equal(result.clearanceMm, 0);
});

test('3D: przecięcie objętości w XY i Z jest kolizją z punktem kontaktowym Z', () => {
  const a = prism('a', rect(0, 0, 10, 10), -10, 10);
  const b = prism('b', rect(5, 5, 10, 10), 2, 5);
  const result = intersectPrisms3D(a, b);
  assert.equal(result.intersecting, true);
  assert.ok(result.penetrationMm > 0);
  assert.equal(result.point.z, 3.5);
  assert.equal(result.overlapWidthMm, 3);
});

test('3D: detektor uwzględnia ustawienie segmentów stempla na osi Z', () => {
  const frame = evaluateKinematics(part, MATERIALS[0], PUNCH_TOOLS[0], DIE_TOOLS[2], steps, 1, 0.65, true);
  const toolAtCenter = { ...DEFAULT_MACHINE, collisionGeometry: { ...DEFAULT_MACHINE.collisionGeometry,
    toolLengthMm: 100, toolOffsetZMm: 0 } };
  const toolAtSide = { ...DEFAULT_MACHINE, collisionGeometry: { ...DEFAULT_MACHINE.collisionGeometry,
    toolLengthMm: 100, toolOffsetZMm: 900 } };
  const center = detectFrameCollisions(frame, part, PUNCH_TOOLS[0], DIE_TOOLS[2], false, toolAtCenter);
  const side = detectFrameCollisions(frame, part, PUNCH_TOOLS[0], DIE_TOOLS[2], false, toolAtSide);
  assert.ok(center.some(c => c.severity === 'critical' && c.type === 'punch'));
  assert.ok(!side.some(c => c.severity === 'critical' && c.message.includes('(punch-0)')));
});

test('3D: segmenty matrycy i stempla mają niezależne pozycje', () => {
  const frame = evaluateKinematics(part, MATERIALS[0], PUNCH_TOOLS[0], DIE_TOOLS[2], steps, 1, .65, true);
  const machine = { ...DEFAULT_MACHINE, collisionGeometry: { ...DEFAULT_MACHINE.collisionGeometry,
    punchStationsZMm: [{startMm:-200,endMm:-100},{startMm:100,endMm:200}],
    dieStationsZMm: [{startMm:-30,endMm:30}],
  } };
  const solids = buildMachineSolids3D(frame, part, PUNCH_TOOLS[0], DIE_TOOLS[2], false, machine);
  assert.equal(solids.filter(s => s.id.startsWith('punch-')).length, 2);
  assert.equal(solids.filter(s => /^die-\d+$/.test(s.id)).length, 1);
  assert.ok(solids.some(s => s.id==='punch-1' && s.zMin===100 && s.zMax===200));
});

test('3D: strefa kontaktu jest lokalna, poza nią blacha nadal podlega kontroli', () => {
  const pieces = outsideContactPocket(rect(-50, -5, 100, 10), -20, 20, -10, 10);
  assert.ok(pieces.some(poly => poly.some(p => p.x < -20)));
  assert.ok(pieces.some(poly => poly.some(p => p.x > 20)));
});

test('linie gięcia są oznaczone również przed pierwszym skokiem', () => {
  const flat = evaluateKinematics(part,MATERIALS[0],PUNCH_TOOLS[0],DIE_TOOLS[2],steps,0,0,true);
  const lines=getBendMarks(flat,part,steps,0);
  assert.equal(lines.length,part.bends.length);
  assert.equal(lines.filter(x=>x.active).length,1);
  assert.ok(lines.every(x=>Number.isFinite(x.xMm) && Number.isFinite(x.yMm)));
  assert.ok(lines.every(x=>!x.completed));
});


test('penetracja przy przecinających się cienkich pasach nie jest arbitralnie zawyżana do 0,21 mm', () => {
  const horizontal=rect(-10,-.5,20,1);
  const vertical=rect(-.5,-10,1,20);
  const hit=testPolygonIntersection(horizontal,vertical);
  assert.equal(hit.intersecting,true);
  assert.ok(hit.clearanceMm < 0 && hit.clearanceMm > -0.01);
});
