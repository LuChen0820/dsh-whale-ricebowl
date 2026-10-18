import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFile(join(ROOT, name), 'utf8');

test('package.json is a valid DSH bundle', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.name, 'dsh-whale-ricebowl');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'lib/index.js');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.peerDependencies['dsh-whale-widget'], '^0.4.2');
  for (const name of ['lib/index.js', 'assets/client.js', 'assets/client.css', 'assets/config.json', 'assets/lines.json', 'cordis.patch.yml']) {
    const info = await stat(join(ROOT, name));
    assert.ok(info.isFile(), name + ' should exist');
  }
});

test('patch layer inserts a stable row id', async () => {
  const patch = await read('cordis.patch.yml');
  assert.ok(patch.includes('- insert:'));
  assert.ok(patch.includes('id: dsh-whale-ricebowl'));
});

test('client has a single-boot guard and avoids host class prefix in css', async () => {
  const client = await read('assets/client.js');
  assert.ok(client.includes('window.__dshWhaleRice'));
  const css = await read('assets/client.css');
  assert.ok(css.includes('.dshwr-layer'));
  assert.equal(css.includes('.dshwv-'), false);
});

test('v0.5.0 is a feeding mechanic, not the old prediction bet', async () => {
  const client = await read('assets/client.js');
  for (const word of ['预测', '押注', '超了', '省下']) {
    assert.equal(client.includes(word), false, 'old wording should be gone: ' + word);
  }
  for (const piece of ['feedBowls', 'dshwr-tank:v1', 'enqueueEat', 'pickBegLine', 'dshwr-stack', 'tokensPerBowl']) {
    assert.ok(client.includes(piece), 'client should contain ' + piece);
  }
});

test('config is a 1M-per-bowl tank with 5 visible bowls', async () => {
  const config = JSON.parse(await read('assets/config.json'));
  assert.equal(config.tokensPerBowl, 1000000);
  assert.equal(config.maxBowls, 5);
  assert.ok(Array.isArray(config.feedBowls) && config.feedBowls.length >= 2);
  assert.deepEqual(config.feedBowls.slice(0, 3), [1, 2, 5]);
  assert.ok(config.biteTokens > 0);
  assert.ok(config.mouth && config.mouth.x > 0 && config.mouth.y > 0);
});

test('lines are feeding/ begging lines used by the client', async () => {
  const lines = JSON.parse(await read('assets/lines.json'));
  for (const key of ['beg', 'feed']) {
    assert.ok(Array.isArray(lines[key]) && lines[key].length > 0, key);
  }
  assert.equal(typeof lines.onboard, 'string');
  const client = await read('assets/client.js');
  assert.ok(client.includes('rt.lines.feed') && client.includes('rt.lines.beg'));
});
