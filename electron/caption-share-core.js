// electron/caption-share-core.js
//
// The LAN caption-share server's pure parts (spec 2026-10-04 §3.2, §4.3,
// §4.4): the shared conversation, the SSE wire format, the request
// predicates and the viewer's asset allowlist. No server and no Electron
// here, so each rule is tested on its own.
const net = require('net');
const path = require('path');

const SHARE_LOG_CAP = 5000;

/** The shared conversation: entry id → ViewerEntry, in arrival order, capped (oldest dropped first). */
function createShareLog({ cap = SHARE_LOG_CAP } = {}) {
  const entries = new Map();
  return {
    upsert(list) {
      for (const entry of list) {
        if (!entry || typeof entry.id !== 'string') continue;
        // Map.set on a known key keeps its place: an update does not move a line.
        entries.set(entry.id, entry);
      }
      while (entries.size > cap) entries.delete(entries.keys().next().value);
    },
    remove(ids) {
      for (const id of ids) entries.delete(id);
    },
    clear() {
      entries.clear();
    },
    list() {
      return [...entries.values()];
    },
    get size() {
      return entries.size;
    },
  };
}

/** One SSE event. JSON.stringify escapes newlines, so the data stays on one line. */
function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

const SSE_PREAMBLE = 'retry: 3000\n\n';
const SSE_HEARTBEAT = ': ping\n\n';

/**
 * The Host header names an IP address or localhost, with any port. A DNS
 * name is refused: that is how DNS rebinding reaches a server on the LAN.
 */
function hostAllowed(host) {
  if (typeof host !== 'string' || host === '') return false;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 1 && net.isIP(host.slice(1, end)) === 6;
  }
  const colon = host.lastIndexOf(':');
  const name = colon === -1 ? host : host.slice(0, colon);
  return name === 'localhost' || net.isIP(name) === 4;
}

/** The peer is this computer (the present page is for the host only). */
function isLoopback(address) {
  if (typeof address !== 'string' || address === '') return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return v4 === '::1' || /^127\./.test(v4);
}

/** A URL path as a path relative to the build directory, or null for anything that could leave it. */
function staticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, '');
  if (rel === '' || rel.includes('\0') || rel.includes('\\')) return null;
  if (rel.split('/').some((part) => part === '..' || part === '.' || part === '')) return null;
  return rel;
}

/**
 * Every file the viewer entry needs, from Vite's build manifest: its own
 * chunk, the chunks it imports (statically or dynamically), their CSS and
 * assets. Nothing else in build/ is served, the main app's bundle included.
 */
function viewerAssets(manifest, entryKey) {
  const files = new Set();
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    if (chunk.file) files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const asset of chunk.assets ?? []) files.add(asset);
    for (const dep of chunk.imports ?? []) visit(dep);
    for (const dep of chunk.dynamicImports ?? []) visit(dep);
  };
  visit(entryKey);
  return files;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

function contentType(file) {
  return TYPES[path.extname(file)] ?? 'application/octet-stream';
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' data:; style-src 'self' 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

module.exports = {
  SHARE_LOG_CAP,
  createShareLog,
  sseEvent,
  SSE_PREAMBLE,
  SSE_HEARTBEAT,
  hostAllowed,
  isLoopback,
  staticPath,
  viewerAssets,
  contentType,
  SECURITY_HEADERS,
};
