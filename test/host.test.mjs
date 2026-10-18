import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function makeCtx() {
  const handlers = new Map();
  const routes = [];
  const taps = [];
  const effects = [];
  const ctx = {
    handlers,
    routes,
    taps,
    effects,
    get() { return undefined; },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return () => {
        const list = handlers.get(event) || [];
        const at = list.indexOf(handler);
        if (at !== -1) list.splice(at, 1);
      };
    },
    emit(event, ...args) {
      for (const handler of (handlers.get(event) || []).slice()) handler(...args);
    },
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
    },
    inject(deps, cb) {
      cb(ctx);
    },
    webServer: {
      register(route) { routes.push(route); return () => {}; },
      tapIndex(transform) { taps.push(transform); return () => {}; }
    }
  };
  return ctx;
}

function makeRes() {
  return {
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
    destroy() {}
  };
}

test('registers a desktop injection row', () => {
  const ctx = makeCtx();
  apply(ctx);
  const table = [];
  ctx.emit('webserver/index-inject', table);
  assert.equal(table.length, 1);
  assert.equal(table[0].kind, 'script');
  assert.equal(table[0].placement, 'body');
  assert.ok(table[0].text.includes('/dsh-whale-rice/client.js'));
});

test('tapIndex injects stylesheet and client script once', () => {
  const ctx = makeCtx();
  apply(ctx);
  assert.equal(ctx.taps.length, 1);
  const once = ctx.taps[0]('<html><body></body></html>');
  assert.ok(once.includes('/dsh-whale-rice/client.css'));
  assert.ok(once.includes('/dsh-whale-rice/client.js'));
  const twice = ctx.taps[0](once);
  assert.equal(once, twice);
});

test('snapshot route folds session events', async () => {
  const ctx = makeCtx();
  apply(ctx);
  ctx.emit('session/event', { id: 's1' }, { type: 'turn/start', data: { turn: 3 } });
  ctx.emit('session/event', { id: 's1' }, { type: 'assistant/message', data: { turn: 3, usage: { inputTokens: 8000, outputTokens: 1000 } } });
  ctx.emit('session/event', { id: 's1' }, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
  const route = ctx.routes.find((r) => r.kind === 'exact' && r.path === '/dsh-whale-rice/turn.json');
  assert.ok(route);
  const res = makeRes();
  await route.handler({ method: 'GET', url: '/dsh-whale-rice/turn.json' }, res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.sessions[0].turn, 3);
  assert.equal(body.sessions[0].actualTokens, 9000);
  assert.equal(body.sessions[0].running, false);
});

test('asset route serves config.json and rejects traversal', async () => {
  const ctx = makeCtx();
  apply(ctx);
  const route = ctx.routes.find((r) => r.kind === 'prefix');
  assert.ok(route);
  const ok = makeRes();
  await route.handler({ method: 'GET', url: '/dsh-whale-rice/config.json' }, ok);
  assert.equal(ok.status, 200);
  assert.ok(JSON.parse(ok.body).tokensPerBowl > 0);
  const missing = makeRes();
  await route.handler({ method: 'GET', url: '/dsh-whale-rice/../package.json' }, missing);
  assert.equal(missing.status, 404);
  const method = makeRes();
  await route.handler({ method: 'POST', url: '/dsh-whale-rice/config.json' }, method);
  assert.equal(method.status, 405);
});

test('snapshot endpoint keeps sessions small and JSON serialisable', async () => {
  const ctx = makeCtx();
  apply(ctx);
  for (let i = 0; i < 30; i++) {
    ctx.emit('session/event', { id: 's' + i }, { type: 'turn/start', data: { turn: 1 } });
  }
  const route = ctx.routes.find((r) => r.kind === 'exact');
  const res = makeRes();
  await route.handler({ method: 'GET', url: '/dsh-whale-rice/turn.json' }, res);
  const body = JSON.parse(res.body);
  assert.ok(body.sessions.length <= 12);
  assert.equal(body.v, 1);
});
