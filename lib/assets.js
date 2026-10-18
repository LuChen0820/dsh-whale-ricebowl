import { join, resolve, sep } from 'node:path';

export const PREFIX = '/dsh-whale-rice';

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

const LONG_CACHE = new Set(['.png', '.webp', '.gif', '.svg', '.woff2', '.mp3', '.wav']);

/**
 * Resolve a request pathname under /dsh-whale-rice/<name> to a file inside
 * the plugin assets directory. Rejects traversal, unknown extensions and
 * anything that escapes the assets root.
 *
 * @param {string} assetsDir absolute assets directory
 * @param {string} pathname request pathname
 * @returns {{ file: string, type: string, cache: string } | null}
 */
export function resolveAsset(assetsDir, pathname) {
  if (typeof pathname !== 'string' || pathname.indexOf(PREFIX + '/') !== 0) return null;
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice(PREFIX.length + 1));
  } catch (err) {
    return null;
  }
  if (!rel || rel.indexOf('\0') !== -1 || rel.indexOf('\\') !== -1) return null;
  const parts = rel.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return null;
  }
  const dot = rel.lastIndexOf('.');
  const ext = dot === -1 ? '' : rel.slice(dot).toLowerCase();
  const type = MIME[ext];
  if (!type) return null;
  const file = resolve(join(assetsDir, ...parts));
  const base = resolve(assetsDir);
  if (file !== base && file.indexOf(base + sep) !== 0) return null;
  return { file, type, cache: LONG_CACHE.has(ext) ? 'public, max-age=3600' : 'no-store' };
}
