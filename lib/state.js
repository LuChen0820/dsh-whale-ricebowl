/**
 * Pure session-event folding for the rice bowl add-on.
 *
 * The host half keeps a tiny per-session snapshot: current turn, whether the
 * agent is running, how many tokens this turn really used, and the last tool
 * activity. The browser half polls /dsh-whale-rice/turn.json and compares the
 * user's rice prediction with these numbers.
 *
 * Kept dependency free and DOM free so it can be unit tested with plain node.
 */

// DSH inputTokens is non-cached input (Anthropic style); outputTokens includes
// reasoning. This is the same billable-ish accounting the whale widget uses for
// its per-turn cost math, so predictions stay comparable with what people see.
const COUNT_CACHE_READ = false;

export function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  let total = num(usage.inputTokens) + num(usage.outputTokens);
  if (COUNT_CACHE_READ) total += num(usage.cacheReadTokens);
  return total;
}

function newSessionState(sessionId, now) {
  return {
    sessionId,
    turn: 0,
    running: false,
    actualTokens: 0,
    usageEvents: 0,
    toolCalls: 0,
    toolFailures: 0,
    startedAt: 0,
    endedAt: 0,
    reason: '',
    lastEventType: '',
    lastEventAt: now,
    settled: null
  };
}

export function createStore() {
  return { seq: 0, latestSessionId: null, sessions: new Map() };
}

function sessionOf(store, sessionId, now) {
  const sid = String(sessionId);
  let state = store.sessions.get(sid);
  if (!state) {
    state = newSessionState(sid, now);
    store.sessions.set(sid, state);
  }
  return state;
}

function touch(store, state, sid, type, now) {
  state.lastEventType = type;
  state.lastEventAt = now;
  store.seq += 1;
  store.latestSessionId = sid;
}

function prune(store, now) {
  if (store.sessions.size <= 24) return;
  const rows = [];
  for (const state of store.sessions.values()) rows.push(state);
  rows.sort((a, b) => b.lastEventAt - a.lastEventAt);
  const keep = new Set(rows.slice(0, 16).map((row) => row.sessionId));
  for (const sid of [...store.sessions.keys()]) {
    if (!keep.has(sid) && now - (store.sessions.get(sid).lastEventAt || 0) > 60 * 60 * 1000) {
      store.sessions.delete(sid);
    }
  }
}

/**
 * Fold one DSH session event into the store. Unknown or malformed events are
 * ignored; a broken event must never interrupt the host.
 *
 * @param {ReturnType<typeof createStore>} store
 * @param {string | { id?: string }} session session object or session id
 * @param {{ type?: string, data?: object }} event
 * @param {number} [now]
 */
export function foldEvent(store, session, event, now) {
  const at = typeof now === 'number' ? now : Date.now();
  if (!store || !event || typeof event.type !== 'string') return;
  const sid = String(session && typeof session === 'object' ? (session.id || '') : (session || ''));
  if (!sid) return;
  const data = event.data && typeof event.data === 'object' ? event.data : {};

  switch (event.type) {
    case 'turn/start': {
      const state = sessionOf(store, sid, at);
      const turn = Number(data.turn);
      state.turn = Number.isFinite(turn) ? turn : state.turn + 1;
      state.running = true;
      state.actualTokens = 0;
      state.usageEvents = 0;
      state.toolCalls = 0;
      state.toolFailures = 0;
      state.startedAt = at;
      state.endedAt = 0;
      state.reason = '';
      state.settled = null;
      touch(store, state, sid, event.type, at);
      break;
    }
    case 'assistant/message': {
      const state = sessionOf(store, sid, at);
      const turn = Number(data.turn);
      if (Number.isFinite(turn) && turn !== state.turn) {
        // The plugin can load in the middle of a turn: adopt the turn number.
        state.turn = turn;
        state.running = true;
        state.startedAt = state.startedAt || at;
      }
      const tokens = usageTokens(data.usage);
      if (tokens > 0) {
        state.actualTokens += tokens;
        state.usageEvents += 1;
      }
      touch(store, state, sid, event.type, at);
      break;
    }
    case 'tool/call': {
      const state = sessionOf(store, sid, at);
      state.toolCalls += 1;
      touch(store, state, sid, event.type, at);
      break;
    }
    case 'tool/result': {
      const state = sessionOf(store, sid, at);
      const content = Array.isArray(data.content) ? data.content[0] : null;
      if ((content && content.isError === true) || data.error !== undefined) state.toolFailures += 1;
      touch(store, state, sid, event.type, at);
      break;
    }
    case 'turn/end': {
      const state = sessionOf(store, sid, at);
      const turn = Number(data.turn);
      if (Number.isFinite(turn)) state.turn = Math.max(state.turn, turn);
      state.running = false;
      state.endedAt = at;
      const reason = data.reason && typeof data.reason === 'object'
        ? String(data.reason.kind || data.reason.reason || '')
        : String(data.reason || '');
      state.reason = reason.slice(0, 40);
      state.settled = { turn: state.turn, actualTokens: state.actualTokens };
      touch(store, state, sid, event.type, at);
      break;
    }
    default:
      break;
  }
  prune(store, at);
}

/**
 * Produce a JSON-serialisable snapshot for the browser half.
 *
 * @param {ReturnType<typeof createStore>} store
 * @param {number} [now]
 */
export function snapshot(store, now) {
  const at = typeof now === 'number' ? now : Date.now();
  const sessions = [];
  for (const state of store.sessions.values()) sessions.push({ ...state });
  sessions.sort((a, b) => b.lastEventAt - a.lastEventAt);
  return {
    v: 1,
    at,
    seq: store.seq,
    latestSessionId: store.latestSessionId,
    sessions: sessions.slice(0, 12)
  };
}
