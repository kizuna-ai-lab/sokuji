// electron/caption-share-server.js
//
// The LAN caption-share HTTP server (spec 2026-10-04 §3.2, §4.3, §4.4):
// Node's own `http`, Server-Sent Events for the push. Electron-free, so it
// is tested on a real socket; electron/caption-share.js wires it to IPC.
const http = require('http');
const core = require('./caption-share-core.js');

const PORTS = Array.from({ length: 10 }, (_, i) => 7788 + i);
const HEARTBEAT_MS = 15_000;
const WRONG_HOST = 'Open the address Sokuji shows. It starts with http:// and a number such as 192.168.1.23.';
const FORWARDED_HEADERS = ['accept', 'accept-encoding', 'accept-language', 'if-none-match', 'if-modified-since', 'cache-control'];

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

function createCaptionShareServer({ assets, devServerUrl = null, ports = PORTS, timers = { setInterval, clearInterval } } = {}) {
  const log = core.createShareLog();
  const streams = new Set();
  const viewerListeners = new Set();
  let server = null;
  let port = null;
  let heartbeat = null;
  let state = null;
  let present = null;

  const viewers = () => {
    let n = 0;
    for (const s of streams) if (s.kind === 'viewer') n += 1;
    return n;
  };
  const viewersChanged = () => {
    const n = viewers();
    for (const fn of viewerListeners) fn(n);
  };

  const drop = (stream) => {
    if (!streams.delete(stream)) return;
    try {
      stream.res.end();
    } catch {
      // the socket is already gone
    }
    if (stream.kind === 'viewer') viewersChanged();
  };
  const write = (stream, chunk) => {
    try {
      stream.res.write(chunk);
    } catch {
      drop(stream);
    }
  };
  const broadcast = (kind, chunk) => {
    for (const s of [...streams]) if (s.kind === kind) write(s, chunk);
  };

  const send = (res, status, text) => {
    res.writeHead(status, { ...core.SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  };

  const openStream = (req, res, kind) => {
    res.writeHead(200, { ...core.SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
    const stream = { res, kind };
    streams.add(stream);
    write(stream, core.SSE_PREAMBLE);
    if (kind === 'viewer') write(stream, core.sseEvent('snapshot', { state, entries: log.list() }));
    else if (present) write(stream, core.sseEvent('present', present));
    req.on('close', () => drop(stream));
    res.on('error', () => drop(stream));
    if (kind === 'viewer') viewersChanged();
  };

  // Development only: the Vite dev server serves viewer.html and its modules.
  // Its responses pass through as they are (no CSP: Vite injects inline scripts).
  // The upstream is pinned to the dev server and only a path goes to it, with
  // a few caching headers: never a host the request names, never its cookies.
  const proxy = (req, res, targetPath) => {
    const target = new URL(devServerUrl);
    const headers = { host: target.host };
    for (const name of FORWARDED_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
    const upstream = http.request(
      { hostname: target.hostname, port: target.port, path: targetPath, method: 'GET', headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => send(res, 502, 'The development server is not running.'));
    upstream.end();
  };

  const servePage = async (req, res) => {
    if (devServerUrl) return proxy(req, res, '/viewer.html');
    const html = await assets.read('viewer.html');
    if (!html) return send(res, 404, 'Not found');
    res.writeHead(200, { ...core.SECURITY_HEADERS, 'Content-Type': core.contentType('viewer.html') });
    res.end(html);
  };

  const serveAsset = async (req, res, url) => {
    if (devServerUrl) return proxy(req, res, url.pathname + url.search);
    const rel = core.staticPath(url.pathname);
    if (!rel) return send(res, 404, 'Not found');
    const allowed = await assets.allowed();
    if (!allowed.has(rel)) return send(res, 404, 'Not found');
    const body = await assets.read(rel);
    if (!body) return send(res, 404, 'Not found');
    res.writeHead(200, { ...core.SECURITY_HEADERS, 'Content-Type': core.contentType(rel) });
    res.end(body);
  };

  const handle = async (req, res) => {
    if (!core.hostAllowed(req.headers.host)) return send(res, 403, WRONG_HOST);
    if (req.method !== 'GET') return send(res, 404, 'Not found');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 404, 'Not found');
    }
    // An absolute-form (`http://other/x`) or protocol-relative (`//other/x`)
    // target names another host: this server answers only for itself.
    if (url.origin !== 'http://localhost') return send(res, 404, 'Not found');
    const local = core.isLoopback(req.socket.remoteAddress);
    switch (url.pathname) {
      case '/events':
        return openStream(req, res, 'viewer');
      case '/present/events':
        return local ? openStream(req, res, 'present') : send(res, 403, 'Not available');
      case '/present':
        return local ? servePage(req, res) : send(res, 403, 'Not available');
      case '/':
        return servePage(req, res);
      default:
        return serveAsset(req, res, url);
    }
  };

  const onRequest = (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Error');
      else res.destroy();
    });
  };

  return {
    async start(initialState) {
      if (server) return { port };
      state = initialState;
      let lastError = null;
      for (const candidate of ports) {
        const s = http.createServer(onRequest);
        try {
          port = await listen(s, candidate);
          server = s;
          break;
        } catch (error) {
          lastError = error;
          if (!error || error.code !== 'EADDRINUSE') break;
        }
      }
      if (!server) {
        const busy = !lastError || lastError.code === 'EADDRINUSE';
        const error = new Error(busy ? 'All share ports are in use' : String(lastError.message ?? lastError));
        error.code = busy ? 'ports-busy' : 'listen-failed';
        port = null;
        throw error;
      }
      heartbeat = timers.setInterval(() => {
        for (const s of [...streams]) write(s, core.SSE_HEARTBEAT);
      }, HEARTBEAT_MS);
      return { port };
    },
    async stop() {
      if (!server) return;
      for (const s of [...streams]) {
        write(s, core.sseEvent('ended', {}));
        drop(s);
      }
      timers.clearInterval(heartbeat);
      heartbeat = null;
      const closing = server;
      server = null;
      port = null;
      log.clear();
      present = null;
      await new Promise((resolve) => {
        closing.close(() => resolve());
        closing.closeAllConnections?.();
      });
    },
    patch({ upsert = [], remove = [] }) {
      if (!server) return;
      log.upsert(upsert);
      log.remove(remove);
      if (upsert.length > 0) broadcast('viewer', core.sseEvent('upsert', { entries: upsert }));
      if (remove.length > 0) broadcast('viewer', core.sseEvent('remove', { ids: remove }));
    },
    clear(reason) {
      if (!server) return;
      log.clear();
      broadcast('viewer', core.sseEvent('clear', { reason }));
    },
    setState(next) {
      state = next;
      if (server) broadcast('viewer', core.sseEvent('state', { state }));
    },
    setPresent(info) {
      present = info;
      if (server) broadcast('present', core.sseEvent('present', info));
    },
    onViewersChange(fn) {
      viewerListeners.add(fn);
      return () => viewerListeners.delete(fn);
    },
    running: () => server !== null,
    port: () => port,
    viewers,
  };
}

module.exports = { createCaptionShareServer, PORTS, HEARTBEAT_MS };
