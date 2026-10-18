import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PREFIX, resolveAsset } from '../lib/assets.js';

const DIR = fileURLToPath(new URL('../assets', import.meta.url));

test('serves a whitelisted asset', () => {
  const asset = resolveAsset(DIR, PREFIX + '/config.json');
  assert.ok(asset);
  assert.equal(asset.type, 'application/json; charset=utf-8');
  assert.equal(asset.cache, 'no-store');
});

test('rejects traversal and unknown extensions', () => {
  assert.equal(resolveAsset(DIR, PREFIX + '/../package.json'), null);
  assert.equal(resolveAsset(DIR, PREFIX + '/%2e%2e/package.json'), null);
  assert.equal(resolveAsset(DIR, PREFIX + '/client.exe'), null);
  assert.equal(resolveAsset(DIR, '/dsh-whale-rice/'), null);
  assert.equal(resolveAsset(DIR, '/other/client.js'), null);
});

test('images use a long cache, code does not', () => {
  const image = resolveAsset(DIR, PREFIX + '/demo.png');
  assert.ok(image);
  assert.equal(image.cache, 'public, max-age=3600');
  const js = resolveAsset(DIR, PREFIX + '/client.js');
  assert.ok(js);
  assert.equal(js.cache, 'no-store');
});
