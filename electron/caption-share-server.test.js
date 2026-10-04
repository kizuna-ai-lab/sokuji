// electron/caption-share-server.test.js
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createCaptionShareServer } = require('./caption-share-server.js');

const STATE = { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false };

function memoryAssets() {
  const files = new Map([
    ['viewer.html', Buffer.from('<!doctype html><title>viewer</title>')],
    ['static/viewer-1.js', Buffer.from('console.log(1)')],
    ['static/main-9.js', Buffer.from('main app')],
  ]);
  return { allowed: async () => new Set(['static/viewer-1.js']), read: async (rel) => files.get(rel) ?? null };
}

function get(port, path, host = `127.0.0.1:${port}`, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: { Host: host, ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

/** Opens an SSE stream and collects parsed events; `raw` keeps comments too. */
function stream(port, path = '/events') {
  return new Promise((resolve, reject) => {
    const events = [];
    let raw = '';
    let buffer = '';
    const req = http.get({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const name = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (name) events.push({ name, data: data ? JSON.parse(data) : null });
        }
      });
      resolve({
        status: res.statusCode,
        events,
        raw: () => raw,
        ended: new Promise((r) => res.on('end', r)),
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

const until = async (check, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

let servers = [];
afterEach(async () => {
  for (const s of servers) await s.stop();
  servers = [];
});

const make = (options = {}) => {
  const server = createCaptionShareServer({ assets: memoryAssets(), ports: [0], ...options });
  servers.push(server);
  return server;
};

describe('caption share server', () => {
  it('serves the viewer page and only the viewer allowlist, with the security headers', async () => {
    const server = make();
    const { port } = await server.start(STATE);
    const page = await get(port, '/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('viewer');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect((await get(port, '/static/viewer-1.js')).status).toBe(200);
    expect((await get(port, '/static/main-9.js')).status).toBe(404);
    expect((await get(port, '/static/../viewer.html')).status).toBe(404);
    expect((await get(port, '/present')).status).toBe(200); // the test client is loopback
  });

  it('answers a computer name in the Host header with 403 and the address to use instead', async () => {
    const server = make();
    const { port } = await server.start(STATE);
    const res = await get(port, '/', `DESKTOP-ABC:${port}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatch(/address Sokuji shows/);
    expect(res.body).toMatch(/192\.168\.1\.23/);
  });

  it('moves to the next port when one is taken, and reports ports-busy when all are', async () => {
    const blocker = http.createServer();
    await new Promise((r) => blocker.listen(0, '0.0.0.0', r));
    const taken = blocker.address().port;
    try {
      const server = make({ ports: [taken, 0] });
      const { port } = await server.start(STATE);
      expect(port).not.toBe(taken);
      const busy = make({ ports: [taken] });
      await expect(busy.start(STATE)).rejects.toMatchObject({ code: 'ports-busy' });
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  it('sends a snapshot first, then increments, and counts viewers but not the present page', async () => {
    const server = make();
    const { port } = await server.start(STATE);
    const counts = [];
    server.onViewersChange((n) => counts.push(n));
    server.patch({ upsert: [{ id: 'a', t: 1 }], remove: [] });

    const one = await stream(port);
    await until(() => one.events.length >= 1);
    expect(one.events[0]).toEqual({ name: 'snapshot', data: { state: STATE, entries: [{ id: 'a', t: 1 }] } });
    expect(server.viewers()).toBe(1);

    const present = await stream(port, '/present/events');
    server.setPresent({ url: 'http://192.168.1.23:7788/', viewers: 1 });
    await until(() => present.events.some((e) => e.name === 'present'));
    expect(server.viewers()).toBe(1);

    server.patch({ upsert: [{ id: 'b', t: 2 }], remove: ['a'] });
    server.setState({ ...STATE, phase: 'idle' });
    server.clear('restart');
    await until(() => one.events.length >= 5);
    expect(one.events.slice(1).map((e) => e.name)).toEqual(['upsert', 'remove', 'state', 'clear']);
    expect(one.events[4].data).toEqual({ reason: 'restart' });

    one.close();
    await until(() => server.viewers() === 0);
    expect(counts).toEqual([1, 0]);
    present.close();
  });

  it('beats every stream on the heartbeat', async () => {
    let beat = null;
    const server = make({ timers: { setInterval: (fn) => { beat = fn; return 1; }, clearInterval: () => {} } });
    const { port } = await server.start(STATE);
    const one = await stream(port);
    await until(() => one.events.length >= 1);
    beat();
    await until(() => one.raw().includes(': ping'));
    expect(one.raw().startsWith('retry: 3000')).toBe(true);
  });

  it('says ended to every stream, then closes', async () => {
    const server = make();
    const { port } = await server.start(STATE);
    const one = await stream(port);
    await until(() => one.events.length >= 1);
    await server.stop();
    await one.ended;
    expect(one.events.at(-1)).toEqual({ name: 'ended', data: {} });
    expect(server.running()).toBe(false);
    await expect(get(port, '/')).rejects.toBeTruthy();
  });

  it('in development, forwards only a path to the pinned dev server, never to a host the request names', async () => {
    const seen = [];
    const upstream = http.createServer((req, res) => {
      seen.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie });
      res.end('dev');
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    try {
      const devHost = `127.0.0.1:${upstream.address().port}`;
      const server = make({ assets: null, devServerUrl: `http://${devHost}` });
      const { port } = await server.start(STATE);
      expect((await get(port, '//evil.example/x')).status).toBe(404);
      expect((await get(port, 'http://evil.example/x')).status).toBe(404);
      const ok = await get(port, '/src/viewer/main.tsx?v=1', undefined, { Cookie: 'session=secret' });
      expect(ok.body).toBe('dev');
      expect(seen).toEqual([{ url: '/src/viewer/main.tsx?v=1', host: devHost, cookie: undefined }]);
    } finally {
      await new Promise((r) => upstream.close(r));
    }
  });

  it('forwards page requests to the development server', async () => {
    const upstream = http.createServer((req, res) => { res.end(`dev ${req.url}`); });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    try {
      const server = make({ assets: null, devServerUrl: `http://127.0.0.1:${upstream.address().port}` });
      const { port } = await server.start(STATE);
      expect((await get(port, '/')).body).toBe('dev /viewer.html');
      expect((await get(port, '/src/viewer/main.tsx')).body).toBe('dev /src/viewer/main.tsx');
    } finally {
      await new Promise((r) => upstream.close(r));
    }
  });
});
