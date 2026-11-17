import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('esbuild is declared directly at the compatible 0.28 line', () => {
  assert.match(pkg.devDependencies.esbuild, /^\^0\.28\.[2-9]$/);
});

test('Vite 8 and tsx are still present', () => {
  assert.match(pkg.dependencies.vite, /^\^8\./);
  assert.match(pkg.devDependencies.tsx, /^\^4\./);
});

test('incompatible legacy Bun lockfile is not shipped', () => {
  assert.equal(fs.existsSync(path.join(root, 'bun.lock')), false);
});
