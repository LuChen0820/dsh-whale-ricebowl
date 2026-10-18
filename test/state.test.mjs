import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, foldEvent, snapshot, usageTokens } from '../lib/state.js';

test('usageTokens counts non-cached input + output only', () => {
  assert.equal(usageTokens({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 99999 }), 1500);
  assert.equal(usageTokens({ inputTokens: 0, outputTokens: 0 }), 0);
  assert.equal(usageTokens(null), 0);
  assert.equal(usageTokens({ inputTokens: '7', outputTokens: '3' }), 10);
});

test('fold a complete turn', () => {
  const store = createStore();
  foldEvent(store, { id: 's1' }, { type: 'turn/start', data: { turn: 1 } }, 1000);
  foldEvent(store, { id: 's1' }, { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 2000, outputTokens: 500 } } }, 1100);
  foldEvent(store, { id: 's1' }, { type: 'tool/call', data: { name: 'read' } }, 1200);
  foldEvent(store, { id: 's1' }, { type: 'tool/result', data: { content: [{ isError: true }] } }, 1300);
  foldEvent(store, { id: 's1' }, { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 3000, outputTokens: 700 } } }, 1400);
  foldEvent(store, { id: 's1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }, 1500);

  const snap = snapshot(store, 1600);
  assert.equal(snap.sessions.length, 1);
  const s = snap.sessions[0];
  assert.equal(s.sessionId, 's1');
  assert.equal(s.turn, 1);
  assert.equal(s.running, false);
  assert.equal(s.actualTokens, 6200);
  assert.equal(s.toolCalls, 1);
  assert.equal(s.toolFailures, 1);
  assert.equal(s.reason, 'completed');
  assert.deepEqual(s.settled, { turn: 1, actualTokens: 6200 });
});

test('starting a new turn resets actual tokens', () => {
  const store = createStore();
  foldEvent(store, 's1', { type: 'turn/start', data: { turn: 1 } }, 1000);
  foldEvent(store, 's1', { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 5000, outputTokens: 500 } } }, 1100);
  foldEvent(store, 's1', { type: 'turn/start', data: { turn: 2 } }, 1200);
  const s = snapshot(store, 1300).sessions[0];
  assert.equal(s.turn, 2);
  assert.equal(s.running, true);
  assert.equal(s.actualTokens, 0);
});

test('plugin loading mid-turn adopts the running turn', () => {
  const store = createStore();
  foldEvent(store, 's1', { type: 'assistant/message', data: { turn: 7, usage: { inputTokens: 100, outputTokens: 20 } } }, 2000);
  const s = snapshot(store, 2100).sessions[0];
  assert.equal(s.turn, 7);
  assert.equal(s.running, true);
  assert.equal(s.actualTokens, 120);
});

test('multiple sessions: latest event wins and order is by recency', () => {
  const store = createStore();
  foldEvent(store, 'a', { type: 'turn/start', data: { turn: 1 } }, 1000);
  foldEvent(store, 'b', { type: 'turn/start', data: { turn: 1 } }, 2000);
  foldEvent(store, 'a', { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 10, outputTokens: 10 } } }, 3000);
  const snap = snapshot(store, 3100);
  assert.equal(snap.latestSessionId, 'a');
  assert.deepEqual(snap.sessions.map((s) => s.sessionId), ['a', 'b']);
});

test('malformed events are ignored', () => {
  const store = createStore();
  foldEvent(store, 's1', null, 1000);
  foldEvent(store, 's1', { type: 42 }, 1000);
  foldEvent(store, '', { type: 'turn/start' }, 1000);
  foldEvent(store, 's1', { type: 'weird/unknown' }, 1000);
  const snap = snapshot(store, 1100);
  assert.equal(snap.seq, 0);
  assert.equal(snap.sessions.length, 0);
});

test('snapshot is JSON serialisable and seq advances with relevant events', () => {
  const store = createStore();
  foldEvent(store, 's1', { type: 'turn/start', data: { turn: 1 } }, 1000);
  foldEvent(store, 's1', { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 1, outputTokens: 1 } } }, 1100);
  const snap = snapshot(store, 1200);
  assert.equal(snap.v, 1);
  assert.equal(snap.seq, 2);
  assert.ok(JSON.parse(JSON.stringify(snap)).sessions.length === 1);
});
