import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameLoop } from '../src/engine/frameLoop';

function fakeDriver() {
  let nextId = 1;
  const callbacks = new Map<number, (ms: number) => void>();
  return {
    driver: {
      requestFrame: (cb: (ms: number) => void) => {
        const id = nextId++;
        callbacks.set(id, cb);
        return id;
      },
      cancelFrame: (id: number) => { callbacks.delete(id); },
    },
    frame: (ms: number) => {
      const pending = [...callbacks.entries()];
      assert.equal(pending.length, 1, 'only one frame should be scheduled');
      callbacks.delete(pending[0][0]);
      pending[0][1](ms);
    },
    pending: () => callbacks.size,
  };
}

test('kolizja wstrzymuje tylko ciągłe gięcie, ruch kamery nadal wywołuje render', () => {
  const fake = fakeDriver();
  let playing = true;
  let draws = 0;
  const loop = createFrameLoop(() => {
    draws++;
    if (draws === 2) playing = false; // hit detected on the second frame
    return playing;
  }, fake.driver);
  loop.beginAnimation();
  fake.frame(1000);
  assert.equal(fake.pending(), 1, 'playback schedules the next frame');
  fake.frame(1016);
  assert.equal(fake.pending(), 0, 'collision pauses playback');
  loop.invalidate(); // OrbitControls change after a collision
  fake.frame(1032);
  assert.equal(draws, 3, 'camera can redraw even though playback remains stopped');
  assert.equal(fake.pending(), 0, 'idle camera need not render continuously');
  loop.dispose();
});

test('rozpoczęcie odtwarzania nie anuluje klatki już zamówionej przez kamerę', () => {
  const fake = fakeDriver();
  let renders = 0;
  const loop = createFrameLoop(() => { renders++; return false; }, fake.driver);
  loop.invalidate(); // camera is moving when Play is clicked
  loop.beginAnimation();
  assert.equal(fake.pending(), 1);
  fake.frame(1000);
  assert.equal(renders, 1);
  loop.invalidate();
  fake.frame(1040);
  assert.equal(renders, 2);
  loop.dispose();
});

test('wiele zmian kamery w jednej klatce jest scalanych; unmount anuluje pracę', () => {
  const fake = fakeDriver();
  let renders = 0;
  const loop = createFrameLoop(() => { renders++; return false; }, fake.driver);
  loop.invalidate();
  loop.invalidate();
  loop.invalidate();
  assert.equal(fake.pending(), 1);
  loop.dispose();
  assert.equal(fake.pending(), 0);
  loop.invalidate();
  assert.equal(fake.pending(), 0);
  assert.equal(renders, 0);
});

test('po zatrzymaniu i ponownym uruchomieniu nie ma skoku czasu', () => {
  const fake = fakeDriver();
  let continuous = false;
  const deltas: number[] = [];
  const loop = createFrameLoop((delta) => { deltas.push(delta); return continuous; }, fake.driver);
  loop.invalidate();
  fake.frame(1000);
  continuous = true;
  loop.beginAnimation();
  fake.frame(100000);
  assert.equal(deltas[1], 0);
  loop.dispose();
});
