// electron/history-audio.js
//
// Recordings reach the History player through the `sokuji-history:` scheme, so the page never holds a file's
// address and the player can seek: `sokuji-history://track/<record id>/<source>` answers the file or a byte range
// of it, streamed. Only kept tracks are served; anything else is not found. No page reads a recording's bytes:
// saving one is done here, the system's Save dialog asking where and this process copying the file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { HistoryError } = require('./history-store.js');

const HISTORY_SCHEME = 'sokuji-history';

/**
 * Before the app is ready: the scheme may stream media to the player. It is not open to cross-origin reads, so the
 * page (loaded from file:// when packaged) can play a recording but cannot read its bytes.
 */
function registerHistoryScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: HISTORY_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

const notFound = () => new Response(null, { status: 404 });

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
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/ogg' };
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

/**
 * Saving a kept track where the user says: the system's Save dialog proposes `defaultName` (a file name only, in
 * `defaultDir`), and the file is copied there. Resolves `{ saved: false }` when the user cancels; rejects with
 * NO_TRACK for a track that is not kept, before asking anything.
 */
async function saveTrackAs({ store, showSaveDialog, defaultDir, recordId, source, title, defaultName }) {
  const file = store.trackFile({ recordId, source });
  if (!file) throw new HistoryError('NO_TRACK', `No kept ${source} track in record ${recordId}`);
  let name = path.basename(typeof defaultName === 'string' && defaultName.trim() ? defaultName.trim() : `${source}.opus`);
  if (!name.toLowerCase().endsWith('.opus')) name += '.opus';
  const answer = await showSaveDialog({
    title: typeof title === 'string' ? title.slice(0, 200) : '',
    defaultPath: path.join(defaultDir, name),
    filters: [{ name: 'Opus', extensions: ['opus'] }],
  });
  if (!answer || answer.canceled || !answer.filePath) return { saved: false };
  await fs.promises.copyFile(file, answer.filePath);
  return { saved: true };
}

module.exports = { HISTORY_SCHEME, registerHistoryScheme, trackResponse, saveTrackAs };
