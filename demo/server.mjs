import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'assets');
const LOCAL = join(HERE, '.local');
const PORT = Number(process.env.PORT || 19480);

// 预览用的鲸鱼立绘：优先 demo/.local/whale.png，其次自动找本机宿主插件自带的默认立绘，
// 都没有才退回自绘占位图。宿主立绘只在本机预览时读取，不会打进 npm 包。
const HOST_ART_CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-whale-widget', 'assets', 'DSniang1.png'),
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-whale-widget', 'assets', 'DSniang1.png')
];
function hostArt() {
  if (process.env.DSH_WHALE_ART && existsSync(process.env.DSH_WHALE_ART)) return process.env.DSH_WHALE_ART;
  for (const p of HOST_ART_CANDIDATES) { if (existsSync(p)) return p; }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const mock = {
  sessionId: 'demo-session',
  turn: 1,
  running: false,
  actualTokens: 0,
  lastEventAt: Date.now(),
  seq: 1
};

function snapshot() {
  return {
    v: 1,
    at: Date.now(),
    seq: mock.seq++,
    latestSessionId: mock.sessionId,
    sessions: [{
      sessionId: mock.sessionId,
      turn: mock.turn,
      running: mock.running,
      actualTokens: mock.actualTokens,
      usageEvents: 0,
      toolCalls: 0,
      toolFailures: 0,
      startedAt: 0,
      endedAt: 0,
      reason: mock.running ? '' : 'completed',
      lastEventType: mock.running ? 'assistant/message' : 'turn/end',
      lastEventAt: mock.lastEventAt,
      settled: mock.running ? null : { turn: mock.turn, actualTokens: mock.actualTokens }
    }]
  };
}

async function serveFile(file, res) {
  try {
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
    return true;
  } catch (err) {
    return false;
  }
}

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname === '/') {
      if (!(await serveFile(join(HERE, 'index.html'), res))) { res.writeHead(500); res.end('index.html missing'); }
      return;
    }
    if (pathname === '/mock/set') {
      const q = url.searchParams;
      if (q.has('turn')) mock.turn = Number(q.get('turn')) || mock.turn;
      if (q.has('running')) mock.running = q.get('running') === '1';
      if (q.has('actual')) mock.actualTokens = Math.max(0, Number(q.get('actual')) || 0);
      if (q.get('reset') === '1')      {
        mock.turn = 1; mock.running = false; mock.actualTokens = 0;
      }
      mock.lastEventAt = Date.now();
      json(res, { ok: true, mock });
      return;
    }
    if (pathname === '/mock/status') { json(res, mock); return; }
    if (pathname === '/dsh-whale-rice/turn.json') { json(res, snapshot()); return; }
    if (pathname.indexOf('/dsh-whale-rice/') === 0) {
      const name = pathname.slice('/dsh-whale-rice/'.length);
      if (!name || name.indexOf('..') !== -1 || name.indexOf('\\') !== -1) { res.writeHead(404); res.end('not found'); return; }
      if (!(await serveFile(join(ASSETS, name), res))) { res.writeHead(404); res.end('not found'); }
      return;
    }
    if (pathname === '/demo/whale.png') {
      if (await serveFile(join(LOCAL, 'whale.png'), res)) return;
      const art = hostArt();
      if (art && (await serveFile(art, res))) return;
      if (await serveFile(join(HERE, 'placeholder.svg'), res)) return;
      res.writeHead(404); res.end('no art');
      return;
    }
    if (pathname.indexOf('/demo/') === 0) {
      const name = pathname.slice('/demo/'.length);
      if (!name || name.indexOf('..') !== -1) { res.writeHead(404); res.end('not found'); return; }
      if (!(await serveFile(join(HERE, name), res))) { res.writeHead(404); res.end('not found'); }
      return;
    }
    res.writeHead(404); res.end('not found');
  } catch (err) {
    res.writeHead(500); res.end(String(err && err.stack ? err.stack : err));
  }
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('[ricebowl demo] http://127.0.0.1:' + PORT + '/');
});
