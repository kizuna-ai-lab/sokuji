// electron/history-audio.js
//
// Recordings reach the History player through the `sokuji-history:` scheme, so the page never holds a file's
// address and the player can seek: `sokuji-history://track/<record id>/<source>` answers the file or a byte range
// of it, streamed. Only kept tracks are served; anything else is not found.
'use strict';

const fs = require('node:fs');
const { Readable } = require('node:stream');

const HISTORY_SCHEME = 'sokuji-history';

/** Before the app is ready: the scheme may stream media and be fetched like https. */
function registerHistoryScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: HISTORY_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

const notFound = () => new Response(null, { status: 404 });

/**
 * The app's own page: the packaged page loads from file:// (its requests say `null` or `file://`), the development
 * one from the dev server. Saving a recording fetches it, which needs the answer to name the page; media loads do not.
 */
const APP_ORIGINS = new Set(['null', 'file://', 'http://localhost:5173']);
const corsFor = (request) => {
  const origin = request.headers.get('Origin');
  return origin && APP_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
};

/** `bytes=a-b` or `bytes=a-` against a file of `size` bytes: the inclusive range, 'unsatisfiable', or null for none. */
function rangeOf(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** The answer to one request from the player. */
async function trackResponse(store, request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return notFound();
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.host !== 'track' || parts.length !== 2) return notFound();
  const file = store.trackFile({ recordId: decodeURIComponent(parts[0]), source: decodeURIComponent(parts[1]) });
  if (!file) return notFound();
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return notFound();
  }
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/ogg', ...corsFor(request) };
  const range = rangeOf(request.headers.get('Range'), size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'Content-Length': String(size === 0 ? 0 : end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

module.exports = { HISTORY_SCHEME, registerHistoryScheme, trackResponse };
