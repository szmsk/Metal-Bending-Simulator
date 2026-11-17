import assert from 'node:assert/strict';
import test from 'node:test';
import { PUNCH_TOOLS, DIE_TOOLS } from '../src/data/library';

test('katalog: PS.135.85.R08 ma poprawny kąt/promień i siłę', () => {
  const p = PUNCH_TOOLS.find(p => p.code === 'PS.135.85.R08');
  assert.ok(p);
  assert.equal(p.tipAngleDeg, 85);
  assert.equal(p.tipRadiusMm, .8);
  assert.equal(p.maxLoadKnPerM, 1000);
  assert.equal(p.heightMm, 105); // wysokość robocza bez trzpienia 30 mm
});

test('katalog: TOP.175.60.R5 ma poprawny kąt/promień i siłę', () => {
  const p = PUNCH_TOOLS.find(p => p.code === 'TOP.175.60.R5');
  assert.ok(p);
  assert.equal(p.tipAngleDeg, 60);
  assert.equal(p.tipRadiusMm, 5);
  assert.equal(p.maxLoadKnPerM, 1600);
  assert.equal(p.heightMm, 145);
});

test('katalog: M.460.R ma cztery warianty V i dwa typy promieni', () => {
  const dies = DIE_TOOLS.filter(d => d.code.startsWith('M.460.R-'));
  assert.deepEqual(dies.map(d => d.vOpeningMm), [16, 22, 35, 50]);
  assert.deepEqual(dies.map(d => d.shoulderRadiusMm), [2, 2, 2, 3]);
  assert.ok(dies.every(d => d.vAngleDeg === 85 && d.heightMm === 60 && d.maxLoadKnPerM === 800));
});
