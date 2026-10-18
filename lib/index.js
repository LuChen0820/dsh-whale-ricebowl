import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREFIX, resolveAsset } from './assets.js';
import { createStore, foldEvent, snapshot } from './state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HERE, '..', 'assets');
const PLUGIN_ID = 'dsh-whale-ricebowl';
const CLIENT_JS = PREFIX + '/client.js';
const CLIENT_CSS = PREFIX + '/client.css';
const MARKER = 'data-plugin="' + PLUGIN_ID + '"';

function indexTags() {
  return '<link rel="stylesheet" href="' + CLIENT_CSS + '" ' + MARKER + '>'
    + '<script defer src="' + CLIENT_JS + '" ' + MARKER + '></script>';
}

function injectTags(html) {
  if (typeof html !== 'string') return html;
  if (html.indexOf(CLIENT_JS) !== -1) return html;
  const tags = indexTags();
  const at = html.indexOf('</body>');
  if (at !== -1) return html.slice(0, at) + tags + html.slice(at);
  return html + tags;
}

function desktopRowText() {
  return '(function(){try{'
    + 'if(window.__dshWhaleRice)return;'
    + 'var d=document.body||document.documentElement;if(!d)return;'
    + 'if(!document.getElementById("dshwr-css")){var l=document.createElement("link");l.rel="stylesheet";l.href="' + CLIENT_CSS + '";l.id="dshwr-css";d.appendChild(l);}'
    + 'if(!document.getElementById("dshwr-js")){var s=document.createElement("script");s.defer=true;s.src="' + CLIENT_JS + '";s.id="dshwr-js";s.onerror=function(){};d.appendChild(s);}'
    + '}catch(e){}})()';
}

/**
 * Desktop (Electron) boot HTML is served statically, so tapIndex never runs.
 * The only channel is the structured webserver/index-inject table. Register it
 * before any service wait so the one-time collection cannot miss it.
 */
function registerRows(root) {
  root.effect(() => {
    const off = root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return;
        for (const row of table) {
          if (row && row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(CLIENT_JS) !== -1) return;
        }
        table.push({ kind: 'script', placement: 'body', text: desktopRowText() });
      } catch (err) {
        // Never let the injection row break the host boot.
      }
    });
    return () => {
      try { if (off) off(); } catch (err) { /* ignore */ }
    };
  }, PLUGIN_ID + ': desktop injection row');
}

function send(res, status, type, body, cache) {
  try {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': cache || 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
  } catch (err) {
    try { res.destroy(); } catch (inner) { /* ignore */ }
  }
}

async function handleAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
    return;
  }
  let pathname = '/';
  try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (err) { /* keep / */ }
  const asset = resolveAsset(ASSETS_DIR, pathname);
  if (!asset) {
    send(res, 404, 'text/plain; charset=utf-8', 'not found');
    return;
  }
  try {
    const body = await readFile(asset.file);
    send(res, 200, asset.type, body, asset.cache);
  } catch (err) {
    send(res, 404, 'text/plain; charset=utf-8', 'not found');
  }
}

/**
 * Host-side entry. Keeps a per-session turn snapshot for the browser half,
 * serves its assets and injects the client script on both web and desktop.
 *
 * @param {object} root cordis plugin context
 */
export function apply(root) {
  try { registerRows(root); } catch (err) { /* desktop channel is best effort */ }

  root.inject(['webServer'], (ctx) => {
    const store = createStore();

    // session/event is global in current DSH; older builds may not take the
    // options bag, so try both spellings like the upstream widgets do.
    const subscribe = (event, handler) => {
      for (const options of [{ global: true }, null]) {
        try {
          if (options) ctx.on(event, handler, options);
          else ctx.on(event, handler);
          return true;
        } catch (err) { /* try the next spelling */ }
      }
      return false;
    };

    subscribe('session/event', (session, event) => {
      try { foldEvent(store, session, event); } catch (err) { /* ignore a broken event */ }
    });

    ctx.effect(() => ctx.webServer.tapIndex(injectTags), PLUGIN_ID + ': index tap');
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: handleAsset }),
      PLUGIN_ID + ': assets route'
    );
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: PREFIX + '/turn.json',
        handler: (req, res) => {
          try {
            const body = JSON.stringify(snapshot(store));
            send(res, 200, 'application/json; charset=utf-8', body);
          } catch (err) {
            send(res, 500, 'application/json; charset=utf-8', '{"error":"snapshot failed"}');
          }
        }
      }),
      PLUGIN_ID + ': snapshot route'
    );
  });
}

const plugin = { name: PLUGIN_ID, apply };
export default plugin;
