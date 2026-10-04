// electron/caption-share-core.test.js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('./caption-share-core.js');

describe('shared log', () => {
  it('keeps arrival order, replaces an entry in place, removes and clears', () => {
    const log = core.createShareLog();
    log.upsert([{ id: 'a', v: 1 }, { id: 'b', v: 1 }]);
    log.upsert([{ id: 'a', v: 2 }]);
    expect(log.list()).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 1 }]);
    log.remove(['a']);
    expect(log.list().map((e) => e.id)).toEqual(['b']);
    log.clear();
    expect(log.list()).toEqual([]);
  });

  it('drops the oldest entries past the cap', () => {
    const log = core.createShareLog({ cap: 3 });
    log.upsert(['1', '2', '3', '4', '5'].map((id) => ({ id })));
    expect(log.list().map((e) => e.id)).toEqual(['3', '4', '5']);
    expect(core.SHARE_LOG_CAP).toBe(5000);
  });

  it('skips entries without a string id', () => {
    const log = core.createShareLog();
    log.upsert([null, { id: 7 }, { id: 'ok' }]);
    expect(log.list()).toEqual([{ id: 'ok' }]);
  });
});

describe('SSE wire', () => {
  it('writes one event per block with its data on one line', () => {
    expect(core.sseEvent('upsert', { entries: [{ text: 'a\nb' }] }))
      .toBe('event: upsert\ndata: {"entries":[{"text":"a\\nb"}]}\n\n');
    expect(core.SSE_PREAMBLE).toBe('retry: 3000\n\n');
    expect(core.SSE_HEARTBEAT).toBe(': ping\n\n');
  });
});

describe('request predicates', () => {
  it('accepts IP literals and localhost in the Host header and refuses names', () => {
    for (const host of ['192.168.1.23:7788', '127.0.0.1:7788', 'localhost:7788', 'localhost', '[::1]:7788', '10.0.0.5']) {
      expect(core.hostAllowed(host), host).toBe(true);
    }
    for (const host of ['DESKTOP-ABC:7788', 'evil.example.com:7788', 'sokuji.local:7788', '', undefined, '[nope]:1']) {
      expect(core.hostAllowed(host), String(host)).toBe(false);
    }
  });

  it('tells a loopback peer from one on the network', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(core.isLoopback(a), a).toBe(true);
    for (const a of ['192.168.1.5', '::ffff:192.168.1.5', '', undefined]) expect(core.isLoopback(a), String(a)).toBe(false);
  });

  it('turns a URL path into a build-relative path and refuses traversal', () => {
    expect(core.staticPath('/static/viewer-abc.js')).toBe('static/viewer-abc.js');
    expect(core.staticPath('/static/%2e%2e/secret')).toBeNull();
    expect(core.staticPath('/../package.json')).toBeNull();
    expect(core.staticPath('/static\\x.js')).toBeNull();
    expect(core.staticPath('/')).toBeNull();
    expect(core.staticPath('/%E0%A4%A')).toBeNull();
  });
});

describe('viewer asset allowlist', () => {
  const manifest = {
    'index.html': { file: 'static/main-1.js', isEntry: true, imports: ['_react-2.js'], css: ['static/main-1.css'] },
    'viewer.html': {
      file: 'static/viewer-3.js', isEntry: true, imports: ['_react-2.js'],
      dynamicImports: ['src/viewer/PresentApp.tsx'], css: ['static/viewer-3.css'],
    },
    '_react-2.js': { file: 'static/react-2.js' },
    'src/viewer/PresentApp.tsx': {
      file: 'static/PresentApp-4.js', imports: ['_react-2.js'], css: ['static/PresentApp-4.css'], assets: ['static/x.svg'],
    },
  };

  it('follows imports, dynamic imports, css and assets from the viewer entry only', () => {
    expect([...core.viewerAssets(manifest, 'viewer.html')].sort()).toEqual([
      'static/PresentApp-4.css', 'static/PresentApp-4.js', 'static/react-2.js',
      'static/viewer-3.css', 'static/viewer-3.js', 'static/x.svg',
    ]);
  });

  it('is empty when the entry is missing', () => {
    expect(core.viewerAssets(manifest, 'nope.html').size).toBe(0);
  });
});

describe('responses', () => {
  it('names content types and carries the security headers', () => {
    expect(core.contentType('static/a.js')).toBe('text/javascript; charset=utf-8');
    expect(core.contentType('viewer.html')).toBe('text/html; charset=utf-8');
    expect(core.contentType('static/a.css')).toBe('text/css; charset=utf-8');
    expect(core.contentType('static/a.bin')).toBe('application/octet-stream');
    expect(core.SECURITY_HEADERS['Content-Security-Policy']).toBe(
      "default-src 'self'; img-src 'self' data:; media-src 'self' data:; style-src 'self' 'unsafe-inline'",
    );
    expect(core.SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(core.SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
    expect(core.SECURITY_HEADERS['Cache-Control']).toBe('no-store');
  });
});
