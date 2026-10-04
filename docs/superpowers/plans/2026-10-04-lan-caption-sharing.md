# LAN Caption Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Sokuji desktop app serves its live conversation over the local network so people on the same network read the captions and translations in a browser, on a phone or a laptop.

**Architecture:** A share publisher in the host renderer mirrors the conversation view into `ViewerEntry` patches and sends them over IPC; a Node `http` server in the Electron main process keeps the shared conversation and pushes it to viewers with Server-Sent Events; the viewer and projector pages are a second Vite input (`viewer.html`), a small React app that loads nothing from outside the host.

**Tech Stack:** Electron main (CommonJS, Node `http`), React 19 + TypeScript, zustand, Vite 8 (rolldown), vitest 4 + Testing Library, `uqr` (QR encoding), `nosleep.js` (keep-awake fallback).

**Spec:** `docs/superpowers/specs/2026-10-04-lan-caption-sharing-design.md` (commits `bc3b03c9`, `560ba7bf`). Read it before starting any task.

## Global Constraints

- Desktop (Electron) only. The toolbar button renders only when `isElectron()` (`src/utils/environment.ts:34`).
- Nothing reaches Kizuna AI's servers. The viewer page loads nothing from another origin and imports no analytics or PostHog code.
- Ports 7788–7797, first free one wins. Shared-conversation cap 5000 entries. SSE `retry: 3000`, heartbeat every 15 000 ms. Network re-read every 10 000 ms. No-viewer warning after 120 000 ms with no device ever connected.
- Nothing about sharing is persisted on the host (no settingsStore, no localStorage). Viewer preferences live in the viewer browser's `localStorage` under `sokuji.viewer.*`, every access in try/catch.
- UI reuses the app's components: `ToggleSwitch`, `Button`, `FormInput`, `StatusMessage` (`src/components/Settings/shared/`), the `select-dropdown` class, the segmented-control archetype of `src/components/MainPanel/ModePicker.scss`, the `option-row` mixin and `font-size-btn`. Copy the nearest sibling's markup and class names.
- Controls appear only when usable: no sound button anywhere; the viewer's save action exists only when `allowSave` is true.
- Analytics: host side only, `caption_share_started { address_kind }` and `caption_share_ended { duration_ms, peak_viewers }`.
- Code, comments, commit messages and PR text in English; conventional commits; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Renderer code never calls `console.error`/`console.warn`: use `reportError`/`reportWarning` from `src/lib/diagnostics/report.ts`. `src/viewer` has zero console calls.
- IPC handlers are registered with literal channel strings (`ipcMain.handle('caption-share:start', …)`): `electron/ipc-channels.test.js` finds them by regex.
- TypeScript: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` stays at the baseline **96**, and none of the errors is in a file this plan creates or changes.
- Worktree: `.claude/worktrees/lan-caption-sharing`, branch `worktree-lan-caption-sharing`. `node_modules` is a symlink to the main checkout's (already in place). Test baseline for `npx vitest run electron src/lib/session src/components/MainPanel/panel src/lib/diagnostics src/locales src/app`: 77 files, 1188 tests, all passing.

## Review Focus

1. **A phone wakes up and reconnects.** The new `snapshot` must replace the page's entries, not append duplicates. Test: Task 10, "a snapshot after entries replaces them".
2. **A line the viewer already has changes** (partial → final, rows re-cut). The `upsert` of a known id replaces it in place and order stays by `t`. Test: Task 10, "an upsert of a known id replaces it".
3. **The host changes the language pair while sharing.** A viewer whose chosen language is no longer in the pair falls back to both languages, target first. Tests: Task 10 `validChoice`, Task 11 wiring.
4. **Someone types the computer's name** (`http://DESKTOP-ABC:7788`) instead of the IP. They get a 403 with a sentence telling them to use the address Sokuji shows, not a blank page. Test: Task 4.
5. **macOS: the main window is closed and reopened from the dock** while sharing is off. IPC handlers stay registered once, and status pushes go to the new window. Test: Task 5.

## Execution and reporting

Four slices; report after each in the approved format (verification numbers first, then a commit table, then non-obvious findings):

- **Slice 1, main process:** Tasks 1–5.
- **Slice 2, host side:** Tasks 6–9.
- **Slice 3, viewer pages:** Tasks 10–12.
- **Slice 4, translations and verification:** Tasks 13–14.

Commit after every task, on `worktree-lan-caption-sharing`. **Push** of that branch to `kizuna-ai-lab/sokuji` happens only if jiangzhuo approved it with this plan. Never push to `main`; never open a PR without asking.

## File Structure

| File | Responsibility |
|---|---|
| `electron/caption-share-core.js` | Pure parts of the server: shared log, SSE format, request predicates, viewer asset allowlist |
| `electron/caption-share-net.js` | Ranking this computer's IPv4 addresses for phones on the same network |
| `electron/caption-share-server.js` | The HTTP server: routes, SSE streams, heartbeat, port fallback, dev proxy |
| `electron/caption-share.js` | Electron glue: IPC handlers, status push, present window, network poll, ending on page loss |
| `src/lib/session/conversationSet.ts` (modify) | `onReset(listener)` for clear and restart |
| `src/lib/share/types.ts` | Types shared by host, main-process payloads and viewer |
| `src/lib/share/viewerEntry.ts` | `Entry` → `ViewerEntry` |
| `src/lib/share/diff.ts` | Diff against what main acknowledged |
| `src/lib/share/publisher.ts` | Mirrors the view into IPC patches, resets and state |
| `src/lib/share/url.ts`, `src/lib/share/wifiQr.ts` | Share URL; Wi‑Fi QR text |
| `src/stores/captionShareStore.ts` | Host UI state, in memory only |
| `src/app/captionShare.ts` | Host controller: start/stop, status push, publisher lifetime |
| `src/components/CaptionShare/QrCode.tsx` | SVG QR code (host panel and present page) |
| `src/components/CaptionShare/CaptionSharePanel.tsx` + `.scss` | The popover content |
| `src/components/CaptionShare/CaptionShareButton.tsx` | Toolbar button and floating popover |
| `viewer.html`, `src/viewer/*` | Viewer page and present page |
| `scripts/check-viewer-bundle.mjs` | Post-build check of the viewer bundle |
| `scripts/dev/caption-share-demo.mjs` | Dev-only demo server with sample captions, for render checks |

---

### Task 1: Main-process core (pure)

**Files:**
- Create: `electron/caption-share-core.js`
- Test: `electron/caption-share-core.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (CommonJS exports): `createShareLog({ cap? }) → { upsert(entries), remove(ids), clear(), list(), size }`, `SHARE_LOG_CAP = 5000`, `sseEvent(name, data) → string`, `SSE_PREAMBLE`, `SSE_HEARTBEAT`, `hostAllowed(host) → boolean`, `isLoopback(address) → boolean`, `staticPath(urlPath) → string | null`, `viewerAssets(manifest, entryKey) → Set<string>`, `contentType(file) → string`, `SECURITY_HEADERS`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/caption-share-core.test.js`
Expected: FAIL, `Cannot find module './caption-share-core.js'`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/caption-share-core.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add electron/caption-share-core.js electron/caption-share-core.test.js
git commit -m "feat(caption-share): pure core of the LAN share server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Address ranking

**Files:**
- Create: `electron/caption-share-net.js`
- Test: `electron/caption-share-net.test.js`

**Interfaces:**
- Produces: `rankAddresses(interfaces, hardwarePorts?) → Array<{ address, label, kind: 'wifi'|'wired'|'other'|'virtual' }>` (ordered), `parseHardwarePorts(text) → Map<device, 'wifi'|'wired'>`.

Deviation from spec §8, fold into the spec in Task 14: Windows `Local Area Connection* N` (the Mobile Hotspot adapter, 192.168.137.1) and macOS `bridgeN` (Internet Sharing) are **other**, not virtual. They are the right address when phones join the computer's own hotspot, so they must not be marked "usually unreachable".

- [ ] **Step 1: Write the failing test**

```js
// electron/caption-share-net.test.js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rankAddresses, parseHardwarePorts } = require('./caption-share-net.js');

const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal });

describe('rankAddresses', () => {
  it('Linux: Wi-Fi, then wired, then virtual; no loopback, IPv6 or link-local', () => {
    const ranked = rankAddresses({
      lo: [v4('127.0.0.1', true)],
      docker0: [v4('172.17.0.1')],
      wlp2s0: [v4('192.168.1.23'), { address: 'fe80::1', family: 'IPv6', internal: false }],
      enp3s0: [v4('10.0.4.17')],
      tailscale0: [v4('100.88.12.5')],
      virbr0: [v4('192.168.122.1')],
      eth9: [v4('169.254.10.10')],
    });
    expect(ranked.map((a) => [a.label, a.kind])).toEqual([
      ['wlp2s0', 'wifi'],
      ['enp3s0', 'wired'],
      ['docker0', 'virtual'],
      ['tailscale0', 'virtual'],
      ['virbr0', 'virtual'],
    ]);
    expect(ranked[0]).toEqual({ address: '192.168.1.23', label: 'wlp2s0', kind: 'wifi' });
  });

  it('Windows: the Mobile Hotspot adapter is not marked virtual', () => {
    const ranked = rankAddresses({
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
      'vEthernet (WSL)': [v4('172.29.64.1')],
      Ethernet: [v4('10.1.2.3')],
      'Wi-Fi': [v4('192.168.0.12')],
      'Local Area Connection* 10': [v4('192.168.137.1')],
      Tailscale: [v4('100.101.102.103')],
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    });
    expect(ranked.map((a) => [a.label, a.kind])).toEqual([
      ['Wi-Fi', 'wifi'],
      ['Ethernet', 'wired'],
      ['Local Area Connection* 10', 'other'],
      ['Tailscale', 'virtual'],
      ['vEthernet (WSL)', 'virtual'],
      ['VirtualBox Host-Only Network', 'virtual'],
    ]);
  });

  it('macOS: hardware ports name en0/en7; Internet Sharing bridge is other; utun is virtual', () => {
    const ports = new Map([['en0', 'wifi'], ['en7', 'wired']]);
    const ranked = rankAddresses({
      lo0: [v4('127.0.0.1', true)],
      utun3: [v4('100.70.1.2')],
      bridge100: [v4('192.168.2.1')],
      en7: [v4('192.168.1.31')],
      en0: [v4('192.168.1.30')],
    }, ports);
    expect(ranked.map((a) => [a.label, a.kind])).toEqual([
      ['en0', 'wifi'],
      ['en7', 'wired'],
      ['bridge100', 'other'],
      ['utun3', 'virtual'],
    ]);
  });

  it('puts private addresses before public ones within a kind, and accepts a numeric family', () => {
    const ranked = rankAddresses({ eth1: [{ address: '203.0.113.9', family: 4, internal: false }], eth0: [v4('192.168.3.3')] });
    expect(ranked.map((a) => a.address)).toEqual(['192.168.3.3', '203.0.113.9']);
  });

  it('copes with nothing', () => {
    expect(rankAddresses(undefined)).toEqual([]);
    expect(rankAddresses({ eth0: undefined })).toEqual([]);
  });
});

describe('parseHardwarePorts', () => {
  it('reads networksetup -listallhardwareports', () => {
    const out = [
      'Hardware Port: Wi-Fi', 'Device: en0', 'Ethernet Address: aa:bb', '',
      'Hardware Port: Thunderbolt Bridge', 'Device: bridge0', 'Ethernet Address: N/A', '',
      'Hardware Port: USB 10/100/1000 LAN', 'Device: en7', 'Ethernet Address: cc:dd', '',
      'Hardware Port: Ethernet', 'Device: en1', '',
    ].join('\n');
    const map = parseHardwarePorts(out);
    expect(map.get('en0')).toBe('wifi');
    expect(map.get('en7')).toBe('wired');
    expect(map.get('en1')).toBe('wired');
    expect(map.has('bridge0')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/caption-share-net.test.js`
Expected: FAIL, `Cannot find module './caption-share-net.js'`.

- [ ] **Step 3: Write the implementation**

```js
// electron/caption-share-net.js
//
// Which of this computer's addresses a phone on the same network can reach
// (spec 2026-10-04 §8): a pure ranking over os.networkInterfaces(). Wi-Fi and
// wired first; virtual adapters and VPNs last, marked so; never loopback,
// IPv6 or link-local. The default gateway is not looked up.

const VIRTUAL = [
  /^docker/i, /^br-/i, /^veth/i, /^virbr/i, /^lxcbr/i, /^lxdbr/i, /^podman/i, /^cni/i, /^flannel/i,
  /^vethernet/i, /^virtualbox/i, /^vboxnet/i, /^vmware/i, /^vmnet/i,
  /^utun/i, /^tun/i, /^tap/i, /^wg/i, /^tailscale/i, /^zerotier/i, /^zt/i,
  /^awdl/i, /^llw/i, /^anpi/i,
];
const WIFI = [/^wlan/i, /^wlp/i, /^wlx/i, /^wi-?fi/i, /wireless/i, /^无线/];
// `Local Area Connection* N` (with the asterisk) is Windows' Mobile Hotspot /
// Wi-Fi Direct adapter: not wired, and not unreachable either.
const WIRED = [/^eth/i, /^enp/i, /^eno/i, /^ens/i, /^ethernet/i, /^以太网/, /^local area connection(?!\*)/i];

const KIND_ORDER = { wifi: 0, wired: 1, other: 2, virtual: 3 };

function isCgnat(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function isPrivate(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function classify(name, address, hardwarePorts) {
  if (isCgnat(address) || VIRTUAL.some((re) => re.test(name))) return 'virtual';
  const hardware = hardwarePorts.get(name);
  if (hardware) return hardware;
  if (WIFI.some((re) => re.test(name))) return 'wifi';
  if (WIRED.some((re) => re.test(name))) return 'wired';
  return 'other';
}

function rankAddresses(interfaces, hardwarePorts = new Map()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces ?? {})) {
    for (const info of list ?? []) {
      const family = info.family === 4 ? 'IPv4' : info.family;
      if (family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      out.push({ address: info.address, label: name, kind: classify(name, info.address, hardwarePorts) });
    }
  }
  return out.sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || Number(isPrivate(b.address)) - Number(isPrivate(a.address))
    || a.label.localeCompare(b.label));
}

/** macOS `networksetup -listallhardwareports`: device → wifi | wired. */
function parseHardwarePorts(text) {
  const map = new Map();
  let port = null;
  for (const line of String(text).split('\n')) {
    const p = line.match(/^Hardware Port:\s*(.+)$/);
    if (p) {
      port = p[1].trim();
      continue;
    }
    const d = line.match(/^Device:\s*(\S+)/);
    if (d && port) {
      if (/wi-?fi|airport/i.test(port)) map.set(d[1], 'wifi');
      else if (/ethernet|\blan\b/i.test(port)) map.set(d[1], 'wired');
      port = null;
    }
  }
  return map;
}

module.exports = { rankAddresses, parseHardwarePorts };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/caption-share-net.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/caption-share-net.js electron/caption-share-net.test.js
git commit -m "feat(caption-share): rank this computer's addresses for viewers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Viewer build input, strings and bundle check

**Files:**
- Modify: `package.json`, `package-lock.json` (devDependencies `uqr`, `nosleep.js`)
- Create: `viewer.html`, `src/viewer/main.tsx`, `src/viewer/strings.ts`, `src/viewer/strings.test.ts`, `scripts/check-viewer-bundle.mjs`
- Modify: `vite.config.ts` (root `build`), `src/lib/diagnostics/consoleLedger.consistency.test.ts:40-50` (`ROOTS`), `src/locales/en/translation.json` (new `viewer` subtree), the other 29 catalogs (synced)

**Interfaces:**
- Consumes: `viewerAssets` (Task 1).
- Produces: `src/viewer/strings.ts` → `type T = (key: string, params?: Record<string, string | number>) => string`, `VIEWER_CATALOGS: Readonly<Record<string, Words>>`, `pickCatalog(languages, available) → string`, `makeT(words, fallback) → T`, `viewerT(languages) → { t: T; catalog: string }`. Build output `build/viewer.html`, `build/asset-manifest.json`.

- [ ] **Step 1: Add the two dependencies**

Run: `npm install --save-dev uqr@^0.1.3 nosleep.js@^0.12.0`
Expected: `package.json` gains both under `devDependencies` (they are bundled into the renderer and viewer, never required by main). `node_modules` is the main checkout's (symlink), so they install there too; that is expected.

- [ ] **Step 2: Write the failing test**

```ts
// src/viewer/strings.test.ts
import { describe, it, expect } from 'vitest';
import en from '../locales/en/translation.json';
import { VIEWER_CATALOGS, makeT, pickCatalog, viewerT } from './strings';

const ALL = Object.keys(VIEWER_CATALOGS);

describe('viewer strings', () => {
  it('compiles the viewer subtree of all 30 catalogs', () => {
    expect(ALL).toHaveLength(30);
    expect(VIEWER_CATALOGS.en).toEqual((en as Record<string, unknown>).viewer);
    for (const id of ALL) expect(typeof VIEWER_CATALOGS[id]?.title, id).toBe('string');
  });

  it('picks a catalog from navigator.languages', () => {
    expect(pickCatalog(['ja-JP', 'en'], ALL)).toBe('ja');
    expect(pickCatalog(['zh-Hant-TW'], ALL)).toBe('zh_TW');
    expect(pickCatalog(['zh-HK'], ALL)).toBe('zh_TW');
    expect(pickCatalog(['zh'], ALL)).toBe('zh_CN');
    expect(pickCatalog(['zh-Hans-CN'], ALL)).toBe('zh_CN');
    expect(pickCatalog(['pt-BR'], ALL)).toBe('pt_BR');
    expect(pickCatalog(['pt'], ALL)).toBe('pt_PT');
    expect(pickCatalog(['iw'], ALL)).toBe('he');
    expect(pickCatalog(['tl'], ALL)).toBe('fil');
    expect(pickCatalog(['xx', 'ko-KR'], ALL)).toBe('ko');
    expect(pickCatalog(['xx'], ALL)).toBe('en');
    expect(pickCatalog([], ALL)).toBe('en');
  });

  it('looks keys up with an English fallback and fills {{placeholders}}', () => {
    const t = makeT({ a: { b: 'B {{n}}' } }, { a: { b: 'en B', c: 'en C' } });
    expect(t('a.b', { n: 3 })).toBe('B 3');
    expect(t('a.c')).toBe('en C');
    expect(t('a.missing')).toBe('a.missing');
    expect(t('a.b')).toBe('B {{n}}');
  });

  it('builds a t for the browser languages', () => {
    const { t, catalog } = viewerT(['en-US']);
    expect(catalog).toBe('en');
    expect(t('viewer.title')).toBe('Sokuji captions');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/viewer/strings.test.ts`
Expected: FAIL, cannot resolve `./strings`.

- [ ] **Step 4: Add the `viewer` subtree to `src/locales/en/translation.json`**

Add this as the last top-level key of the file (keep its 2-space indentation and add the comma after the previous key):

```json
  "viewer": {
    "title": "Sokuji captions",
    "connecting": "Connecting…",
    "original": "Original",
    "enter": {
      "iRead": "I want to read",
      "both": "Both languages",
      "bothHint": "{{first}} first, {{second}} below",
      "start": "Start reading",
      "insecureNote": "Your browser may call this page not secure. It is a local network address: the captions come straight from the speaker's computer."
    },
    "status": {
      "waiting": "Waiting to start",
      "live": "Live",
      "paused": "Paused",
      "reconnecting": "Reconnecting…",
      "ended": "Sharing has ended"
    },
    "notice": {
      "cleared": "The speaker cleared the earlier captions",
      "restarted": "The speaker started a new round"
    },
    "legend": {
      "onSite": "On site",
      "remote": "Remote"
    },
    "backToLive": "Back to live",
    "dock": {
      "view": "View",
      "textSize": "Text size",
      "more": "More"
    },
    "settings": {
      "title": "Display",
      "iRead": "I read",
      "textSize": "Text size",
      "sizes": {
        "small": "Small",
        "medium": "Medium",
        "large": "Large",
        "xlarge": "Extra large"
      },
      "theme": "Colors",
      "themes": {
        "dark": "Dark",
        "light": "Light",
        "contrast": "High contrast"
      },
      "completeOnly": "Only complete sentences",
      "completeOnlyHint": "Hide what is still being said",
      "keepAwake": "Keep the screen on",
      "save": "Save these captions",
      "saveHint": "A .txt file with what is on this page",
      "saveButton": "Save",
      "close": "Close",
      "aiNote": "Captions are generated by AI and may contain mistakes."
    },
    "shortcuts": "+ − text size · B both languages · F full screen · End back to live",
    "transcript": {
      "header": "Sokuji captions, saved {{time}}"
    },
    "present": {
      "title": "Read the captions on your phone or computer",
      "step1": "Join the Wi‑Fi",
      "password": "Password: {{password}}",
      "step2": "Scan with your phone, or type this address on a computer",
      "step3": "Choose the language you want to read",
      "noInstall": "No app, no sign-in",
      "sameNetwork": "This address only opens on the same network",
      "watching": "Watching: {{count}}",
      "fullscreen": "Full screen",
      "windowTitle": "Sokuji projector page",
      "ended": "Sharing has ended"
    }
  }
```

Then copy it into the other 29 catalogs (English placeholders until Task 13):

Run: `node scripts/sync-locale-keys.mjs`
Expected: each non-en catalog reports the `viewer.*` keys it filled.

- [ ] **Step 5: Write `src/viewer/strings.ts`**

```ts
/**
 * The viewer page's words (spec 2026-10-04 §5.7): the `viewer` subtree of
 * each app catalog, compiled in. Vite's JSON named exports let
 * `import: 'viewer'` take only that subtree, so the rest of every catalog
 * stays out of the bundle (`scripts/check-viewer-bundle.mjs` checks this
 * after a build). A small lookup instead of i18next keeps the page light.
 */
export type Words = { [key: string]: string | Words };
export type T = (key: string, params?: Record<string, string | number>) => string;

const CATALOGS = import.meta.glob<Words>('../locales/*/translation.json', { eager: true, import: 'viewer' });

/** Catalog id (`zh_CN`) → its viewer words. */
export const VIEWER_CATALOGS: Readonly<Record<string, Words>> = Object.fromEntries(
  Object.entries(CATALOGS).map(([file, words]) => {
    const parts = file.split('/');
    return [parts[parts.length - 2], words];
  }),
);

const ALIASES: Readonly<Record<string, string>> = { iw: 'he', in: 'id', tl: 'fil' };

/** The first of the browser's languages a catalog exists for; English otherwise. */
export function pickCatalog(languages: readonly string[], available: readonly string[]): string {
  const have = new Set(available);
  for (const raw of languages) {
    const [base, ...rest] = raw.toLowerCase().split('-');
    let id: string;
    if (base === 'zh') id = rest.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo') ? 'zh_TW' : 'zh_CN';
    else if (base === 'pt') id = rest.includes('br') ? 'pt_BR' : 'pt_PT';
    else id = ALIASES[base] ?? base;
    if (have.has(id)) return id;
  }
  return 'en';
}

function lookup(words: Words | undefined, key: string): string | undefined {
  let node: string | Words | undefined = words;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** `key` is the full key (`viewer.status.live`); the catalogs hold the `viewer` subtree. */
export function makeT(words: Words | undefined, fallback: Words | undefined): T {
  return (key, params) => {
    const local = key.startsWith('viewer.') ? key.slice('viewer.'.length) : key;
    const text = lookup(words, local) ?? lookup(fallback, local) ?? key;
    if (!params) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
  };
}

export function viewerT(languages: readonly string[]): { t: T; catalog: string } {
  const catalog = pickCatalog(languages, Object.keys(VIEWER_CATALOGS));
  return { t: makeT(VIEWER_CATALOGS[catalog], VIEWER_CATALOGS.en), catalog };
}
```

Note: `makeT` in the test above is called with subtree words and keys like `a.b` (no `viewer.` prefix); `viewerT` callers use full keys (`viewer.title`). Both work because the prefix is stripped only when present.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/viewer/strings.test.ts src/locales`
Expected: PASS (the locale lockstep test included).

- [ ] **Step 7: Add the page and its entry**

```html
<!-- viewer.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="referrer" content="no-referrer" />
    <title>Sokuji</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/viewer/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/viewer/main.tsx (replaced by Task 11 with the real pages)
import { createRoot } from 'react-dom/client';
import { viewerT } from './strings';

const { t } = viewerT(navigator.languages ?? [navigator.language]);
const root = document.getElementById('root');
if (root) createRoot(root).render(<p>{t('viewer.title')}</p>);
```

- [ ] **Step 8: Make the root build emit both pages and a manifest**

In `vite.config.ts`, replace the root `build` block (currently `outDir: 'build', assetsDir: 'static', sourcemap: true`) with:

```ts
    build: {
      outDir: 'build',
      assetsDir: 'static',
      sourcemap: true,
      // The LAN caption-share server serves only the viewer's own files, read
      // from this manifest (electron/caption-share-core.js `viewerAssets`). A
      // plain file name, not Vite's default `.vite/manifest.json`: packagers
      // may skip dot-directories.
      manifest: 'asset-manifest.json',
      // Vite 8 reads `rolldownOptions` (see the main-process config above).
      rolldownOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)),
        },
      },
    },
```

and add `import { fileURLToPath } from 'url'` next to the file's other imports (it imports `path` and `fs` the same way).

- [ ] **Step 9: Scan `src/viewer` in the console ledger**

In `src/lib/diagnostics/consoleLedger.consistency.test.ts`, add to `ROOTS` after `'src/providers'`:

```ts
  // The LAN caption viewer runs on other devices and cannot reach report():
  // it shows failures as page state and logs nothing (spec 2026-10-04 §10).
  'src/viewer',
```

Run: `npx vitest run src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS.

- [ ] **Step 10: Write the bundle check**

```js
#!/usr/bin/env node
// scripts/check-viewer-bundle.mjs
//
// After `vite build`: the LAN viewer page's files (per build/asset-manifest.json)
// must not include the main app's entry chunk, viewer.html must load nothing
// from another origin, and the viewer's code must not carry catalog subtrees
// other than `viewer` (which would mean the JSON named-export import pulled
// whole catalogs in). Spec 2026-10-04 §11.5, §13.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { viewerAssets } = require('../electron/caption-share-core.js');

const root = process.cwd();
const build = join(root, 'build');
const manifest = JSON.parse(readFileSync(join(build, 'asset-manifest.json'), 'utf8'));
const files = [...viewerAssets(manifest, 'viewer.html')];
const problems = [];

if (files.length === 0) problems.push('viewer.html is not in build/asset-manifest.json');
const mainEntry = manifest['index.html']?.file;
if (mainEntry && files.includes(mainEntry)) problems.push(`the main app entry ${mainEntry} is on the viewer allowlist`);

const html = readFileSync(join(build, 'viewer.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="(?:https?:)?\/\/[^"]*"/g)) problems.push(`viewer.html loads from another origin: ${m[0]}`);

const ja = JSON.parse(readFileSync(join(root, 'src/locales/ja/translation.json'), 'utf8'));
const sentinels = [];
const walk = (node) => {
  for (const value of Object.values(node)) {
    if (typeof value === 'string') { if (value.length >= 8) sentinels.push(value); } else walk(value);
  }
};
for (const [key, value] of Object.entries(ja)) {
  if (key === 'viewer') continue;
  if (typeof value === 'string') { if (value.length >= 8) sentinels.push(value); } else walk(value);
}
const code = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(build, f), 'utf8')).join('\n');
const leaked = sentinels.filter((s) => code.includes(s));
if (leaked.length > 0) problems.push(`${leaked.length} strings from other ja catalog subtrees are in the viewer bundle, e.g. "${leaked[0]}"`);

if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`${p}\n`);
  process.exit(1);
}
process.stdout.write(`viewer bundle ok: ${files.length} files\n`);
```

- [ ] **Step 11: Build and check**

Run: `npx vite build && node scripts/check-viewer-bundle.mjs`
Expected: the build writes `build/index.html`, `build/viewer.html` and `build/asset-manifest.json`; the check prints `viewer bundle ok: N files`.

If and only if the check reports leaked strings (named exports did not tree-shake), switch to a generated module: create `scripts/gen-viewer-strings.mjs` that reads every `src/locales/<id>/translation.json` and writes `src/viewer/strings.generated.ts` as `export const GENERATED: Record<string, unknown> = { "<id>": <viewer subtree JSON>, … };`, replace the `import.meta.glob` line in `strings.ts` with `import { GENERATED as CATALOGS_BY_ID } from './strings.generated';` and build `VIEWER_CATALOGS` from it directly, add a test asserting the generated file equals what the script would write, rebuild and re-run the check. Record the outcome in the slice report.

If `build/viewer.html` is missing, Vite ignored `rolldownOptions`: change the key to `rollupOptions`, rebuild, and record which key Vite 8 honoured.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json viewer.html vite.config.ts scripts/check-viewer-bundle.mjs \
  src/viewer/main.tsx src/viewer/strings.ts src/viewer/strings.test.ts \
  src/lib/diagnostics/consoleLedger.consistency.test.ts src/locales
git commit -m "build(caption-share): viewer page input, compiled strings, bundle check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The HTTP server

**Files:**
- Create: `electron/caption-share-server.js`
- Test: `electron/caption-share-server.test.js`

**Interfaces:**
- Consumes: Task 1 core.
- Produces: `createCaptionShareServer({ assets, devServerUrl?, ports?, timers? })` → `{ start(state) → Promise<{ port }>, stop() → Promise<void>, patch({ upsert, remove }), clear(reason), setState(state), setPresent(info), onViewersChange(fn) → unsubscribe, running() → boolean, port() → number | null, viewers() → number }`. `assets` is `{ allowed() → Promise<Set<string>>, read(rel) → Promise<Buffer | null> }` or null in development. `start` rejects with an `Error` whose `code` is `'ports-busy'` or `'listen-failed'`.

- [ ] **Step 1: Write the failing test**

```js
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

function get(port, path, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/caption-share-server.test.js`
Expected: FAIL, `Cannot find module './caption-share-server.js'`.

- [ ] **Step 3: Write the implementation**

```js
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
  const proxy = (req, res, targetPath) => {
    const target = new URL(targetPath, devServerUrl);
    const upstream = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: 'GET', headers: { ...req.headers, host: target.host } },
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

  const serveAsset = async (req, res, pathname) => {
    if (devServerUrl) return proxy(req, res, req.url);
    const rel = core.staticPath(pathname);
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
        return serveAsset(req, res, url.pathname);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/caption-share-server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/caption-share-server.js electron/caption-share-server.test.js
git commit -m "feat(caption-share): LAN HTTP server with SSE streams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Electron glue, IPC and wiring into main

**Files:**
- Create: `electron/caption-share.js`, `electron/caption-share.test.js`
- Modify: `electron/main.js` (require at the top; module-level setup after `const nativeHost = new NativeHostManager();`; `attachWindow` in `createWindow` after `setupPopoverWindowHandlers(mainWindow);`), `electron/ipc-channels.js` (`INVOKE_CHANNELS`), `electron/preload.js:62-78` (`validReceiveChannels`), `vite.config.ts:136-165` (main entry map)

**Interfaces:**
- Consumes: Tasks 1, 2, 4.
- Produces: `setupCaptionShare(options) → { attachWindow(win), stop() → Promise<void>, status() → ShareStatus }`. IPC channels `caption-share:start|stop|patch|clear|state|select-address|set-wifi|present` and the push `caption-share:status` with `{ running, port, addresses, selected, viewers, addressChanged }`. Start failure result: `{ error: 'ports-busy' | 'listen-failed', reason: string }`.

- [ ] **Step 1: Write the failing test**

```js
// electron/caption-share.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { setupCaptionShare } = require('./caption-share.js');

const STATE = { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false };
const v4 = (address) => ({ address, family: 'IPv4', internal: false });

function fakeServer() {
  let running = false;
  let port = null;
  let failCode = null;
  const listeners = new Set();
  const api = {
    calls: [],
    present: null,
    async start() {
      if (failCode) { const e = new Error(failCode); e.code = failCode; throw e; }
      running = true;
      port = 7788;
      return { port };
    },
    async stop() { running = false; port = null; api.calls.push('stop'); },
    patch: (p) => api.calls.push(['patch', p]),
    clear: (r) => api.calls.push(['clear', r]),
    setState: (st) => api.calls.push(['state', st]),
    setPresent: (info) => { api.present = info; },
    onViewersChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    running: () => running,
    port: () => port,
    viewers: () => 0,
    fail: (code) => { failCode = code; },
    emitViewers: (n) => { for (const fn of listeners) fn(n); },
  };
  return api;
}

function fakeWindow() {
  const web = new EventEmitter();
  web.sent = [];
  web.send = (channel, payload) => web.sent.push([channel, payload]);
  const win = new EventEmitter();
  win.webContents = web;
  win.isDestroyed = () => false;
  return win;
}

class FakeBrowserWindow extends EventEmitter {
  static all = [];
  constructor(opts) { super(); this.opts = opts; this.url = null; this.closed = false; this.focused = 0; FakeBrowserWindow.all.push(this); }
  loadURL(url) { this.url = url; }
  isDestroyed() { return this.closed; }
  close() { this.closed = true; this.emit('closed'); }
  show() {}
  focus() { this.focused += 1; }
}

let handlers, server, main, interfaces, beat, share;
const call = (channel, payload, sender = main.webContents) => handlers.get(channel)({ sender }, payload);

beforeEach(() => {
  handlers = new Map();
  FakeBrowserWindow.all = [];
  server = fakeServer();
  main = fakeWindow();
  interfaces = { wlan0: [v4('192.168.1.23')], docker0: [v4('172.17.0.1')] };
  beat = null;
  share = setupCaptionShare({
    ipcMain: { handle: (channel, fn) => { if (handlers.has(channel)) throw new Error(`twice: ${channel}`); handlers.set(channel, fn); } },
    BrowserWindow: FakeBrowserWindow,
    app: { getAppPath: () => '/app', on: () => {} },
    isTrustedSender: (sender) => sender === main.webContents,
    getMainWindow: () => main,
    isDev: false,
    networkInterfaces: () => interfaces,
    hardwarePorts: async () => new Map(),
    createServer: () => server,
    timers: { setInterval: (fn) => { beat = fn; return 1; }, clearInterval: () => {} },
  });
  share.attachWindow(main);
});

describe('caption share glue', () => {
  it('registers the eight channels once', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'caption-share:clear', 'caption-share:patch', 'caption-share:present', 'caption-share:select-address',
      'caption-share:set-wifi', 'caption-share:start', 'caption-share:state', 'caption-share:stop',
    ]);
  });

  it('starts with ranked addresses, the first selected', async () => {
    const status = await call('caption-share:start', STATE);
    expect(status).toMatchObject({ running: true, port: 7788, selected: '192.168.1.23', viewers: 0, addressChanged: false });
    expect(status.addresses.map((a) => a.kind)).toEqual(['wifi', 'virtual']);
    expect(server.present.url).toBe('http://192.168.1.23:7788/');
  });

  it('refuses a call that is not from the main window', async () => {
    const result = await call('caption-share:start', STATE, {});
    expect(result).toEqual({ error: 'listen-failed', reason: 'not the main window' });
  });

  it('answers ports-busy when the server cannot listen', async () => {
    server.fail('ports-busy');
    expect(await call('caption-share:start', STATE)).toMatchObject({ error: 'ports-busy' });
  });

  it('pushes status to the main window when the viewer count changes', async () => {
    await call('caption-share:start', STATE);
    server.emitViewers(3);
    const last = main.webContents.sent.at(-1);
    expect(last[0]).toBe('caption-share:status');
    expect(last[1].viewers).toBe(3);
    expect(server.present.viewers).toBe(3);
  });

  it('replaces a vanished address on the next poll and flags it', async () => {
    await call('caption-share:start', STATE);
    interfaces = { wlan0: [v4('192.168.7.8')] };
    beat();
    const last = main.webContents.sent.at(-1)[1];
    expect(last.selected).toBe('192.168.7.8');
    expect(last.addressChanged).toBe(true);
    expect(server.present.url).toBe('http://192.168.7.8:7788/');
  });

  it('opens one present window, focuses it on a second call, and closes it on stop', async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:present');
    await call('caption-share:present');
    expect(FakeBrowserWindow.all).toHaveLength(1);
    expect(FakeBrowserWindow.all[0].url).toBe('http://127.0.0.1:7788/present');
    expect(FakeBrowserWindow.all[0].focused).toBe(1);
    await call('caption-share:stop');
    expect(FakeBrowserWindow.all[0].closed).toBe(true);
    expect(server.calls).toContain('stop');
  });

  it('carries the Wi-Fi hint to the present page and drops an empty name', async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:set-wifi', { wifi: { ssid: 'Meetup-Guest', password: 'pw' } });
    expect(server.present.wifi).toEqual({ ssid: 'Meetup-Guest', password: 'pw' });
    await call('caption-share:set-wifi', { wifi: { ssid: '  ', password: 'pw' } });
    expect(server.present.wifi).toBeNull();
  });

  it('ends the share when the main page navigates or its renderer is gone', async () => {
    await call('caption-share:start', STATE);
    main.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(server.running()).toBe(false);
    await call('caption-share:start', STATE);
    main.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await new Promise((r) => setTimeout(r, 0));
    expect(server.running()).toBe(false);
  });

  it('a window recreated on macOS gets the pushes without registering the handlers again', async () => {
    const second = fakeWindow();
    main = second;
    share.attachWindow(second);
    await call('caption-share:start', STATE);
    server.emitViewers(1);
    expect(second.webContents.sent.at(-1)[1].viewers).toBe(1);
    expect(handlers.size).toBe(8);
  });

  it('passes patches, clears and state through to the server', async () => {
    await call('caption-share:start', STATE);
    await call('caption-share:patch', { upsert: [{ id: 'a' }], remove: ['b', 3] });
    await call('caption-share:clear', { reason: 'restart' });
    await call('caption-share:state', { ...STATE, phase: 'idle' });
    expect(server.calls).toEqual([
      ['patch', { upsert: [{ id: 'a' }], remove: ['b'] }],
      ['clear', 'restart'],
      ['state', { ...STATE, phase: 'idle' }],
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/caption-share.test.js`
Expected: FAIL, `Cannot find module './caption-share.js'`.

- [ ] **Step 3: Write the implementation**

```js
// electron/caption-share.js
//
// The LAN caption-share feature's main-process side (spec 2026-10-04 §3.2,
// §7.3, §8): IPC from the host's window, the status pushed back, the present
// window, the network watch, and ending the share when the host's page goes
// away. Handlers are registered once, when this is set up at module load;
// `attachWindow` follows the main window when macOS recreates it.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { createCaptionShareServer } = require('./caption-share-server.js');
const { rankAddresses, parseHardwarePorts } = require('./caption-share-net.js');
const { viewerAssets } = require('./caption-share-core.js');

const NETWORK_POLL_MS = 10_000;

function buildDirAssets(buildDir) {
  let allowed = null;
  return {
    async allowed() {
      if (!allowed) {
        try {
          const manifest = JSON.parse(await fs.promises.readFile(path.join(buildDir, 'asset-manifest.json'), 'utf8'));
          allowed = viewerAssets(manifest, 'viewer.html');
        } catch {
          allowed = new Set();
        }
      }
      return allowed;
    },
    read: (rel) => fs.promises.readFile(path.join(buildDir, rel)).catch(() => null),
  };
}

function readHardwarePorts() {
  if (process.platform !== 'darwin') return Promise.resolve(new Map());
  return new Promise((resolve) => {
    execFile('networksetup', ['-listallhardwareports'], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? new Map() : parseHardwarePorts(stdout));
    });
  });
}

function validState(s) {
  if (!s || (s.phase !== 'live' && s.phase !== 'idle')) return null;
  if (!s.pair || typeof s.pair.source !== 'string' || typeof s.pair.target !== 'string') return null;
  return { phase: s.phase, pair: { source: s.pair.source, target: s.pair.target }, allowSave: s.allowSave === true };
}

function setupCaptionShare({
  ipcMain,
  BrowserWindow,
  app,
  isTrustedSender,
  getMainWindow,
  isDev,
  buildDir = path.join(app.getAppPath(), 'build'),
  devServerUrl = 'http://localhost:5173',
  networkInterfaces = () => os.networkInterfaces(),
  hardwarePorts = readHardwarePorts,
  createServer = createCaptionShareServer,
  timers = { setInterval, clearInterval },
}) {
  const server = createServer({ assets: isDev ? null : buildDirAssets(buildDir), devServerUrl: isDev ? devServerUrl : null });
  let hardware = new Map();
  let addresses = [];
  let selected = null;
  let addressChanged = false;
  let state = null;
  let wifi = null;
  let poll = null;
  let presentWindow = null;
  let viewers = 0;

  const status = () => ({ running: server.running(), port: server.port(), addresses, selected, viewers, addressChanged });
  const push = () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('caption-share:status', status());
  };
  const presentInfo = () => ({
    url: selected && server.port() ? `http://${selected}:${server.port()}/` : '',
    pair: state ? state.pair : { source: '', target: '' },
    phase: state ? state.phase : 'idle',
    viewers,
    wifi,
  });
  const pushPresent = () => {
    if (server.running()) server.setPresent(presentInfo());
  };

  const refreshAddresses = () => {
    addresses = rankAddresses(networkInterfaces(), hardware);
    if (!addresses.some((a) => a.address === selected)) {
      const had = selected !== null;
      selected = addresses.length > 0 ? addresses[0].address : null;
      if (had) addressChanged = true;
    }
  };

  server.onViewersChange((n) => {
    viewers = n;
    push();
    pushPresent();
  });

  const stop = async () => {
    if (poll) {
      timers.clearInterval(poll);
      poll = null;
    }
    if (presentWindow && !presentWindow.isDestroyed()) presentWindow.close();
    presentWindow = null;
    await server.stop();
    addressChanged = false;
    viewers = 0;
    push();
  };

  ipcMain.handle('caption-share:start', async (event, payload) => {
    if (!isTrustedSender(event.sender)) return { error: 'listen-failed', reason: 'not the main window' };
    const next = validState(payload);
    if (!next) return { error: 'listen-failed', reason: 'bad state' };
    state = next;
    try {
      hardware = await hardwarePorts();
      await server.start(state);
    } catch (error) {
      return { error: error && error.code === 'ports-busy' ? 'ports-busy' : 'listen-failed', reason: String((error && error.message) || error) };
    }
    selected = null;
    addressChanged = false;
    refreshAddresses();
    poll = timers.setInterval(() => {
      const before = JSON.stringify([addresses, selected]);
      refreshAddresses();
      if (JSON.stringify([addresses, selected]) !== before) {
        push();
        pushPresent();
      }
    }, NETWORK_POLL_MS);
    pushPresent();
    return status();
  });

  ipcMain.handle('caption-share:stop', async (event) => {
    if (!isTrustedSender(event.sender)) return null;
    await stop();
    return status();
  });

  ipcMain.handle('caption-share:patch', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    server.patch({
      upsert: Array.isArray(payload && payload.upsert) ? payload.upsert : [],
      remove: Array.isArray(payload && payload.remove) ? payload.remove.filter((id) => typeof id === 'string') : [],
    });
  });

  ipcMain.handle('caption-share:clear', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    server.clear(payload && payload.reason === 'restart' ? 'restart' : 'clear');
  });

  ipcMain.handle('caption-share:state', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    const next = validState(payload);
    if (!next) return;
    state = next;
    server.setState(state);
    pushPresent();
  });

  ipcMain.handle('caption-share:select-address', (event, payload) => {
    if (!isTrustedSender(event.sender)) return status();
    if (addresses.some((a) => a.address === (payload && payload.address))) {
      selected = payload.address;
      addressChanged = false;
      pushPresent();
    }
    return status();
  });

  ipcMain.handle('caption-share:set-wifi', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    const w = payload && payload.wifi;
    wifi = w && typeof w.ssid === 'string' && w.ssid.trim() !== ''
      ? { ssid: w.ssid.trim(), password: typeof w.password === 'string' ? w.password : '' }
      : null;
    pushPresent();
  });

  ipcMain.handle('caption-share:present', (event) => {
    if (!isTrustedSender(event.sender) || !server.running()) return;
    if (presentWindow && !presentWindow.isDestroyed()) {
      presentWindow.show();
      presentWindow.focus();
      return;
    }
    presentWindow = new BrowserWindow({
      width: 1100,
      height: 700,
      title: 'Sokuji',
      backgroundColor: '#111111',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    presentWindow.on('closed', () => { presentWindow = null; });
    presentWindow.loadURL(`http://127.0.0.1:${server.port()}/present`);
  });

  app.on('will-quit', () => { void stop(); });

  const attachWindow = (win) => {
    const end = () => {
      if (server.running()) void stop();
    };
    win.webContents.on('render-process-gone', end);
    // Electron passes a details object first; older versions also pass
    // (url, isInPlace, isMainFrame) positionally.
    win.webContents.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
      const main = details && typeof details.isMainFrame === 'boolean' ? details.isMainFrame : isMainFrame;
      const same = details && typeof details.isSameDocument === 'boolean' ? details.isSameDocument : isInPlace;
      if (main && !same) end();
    });
    win.on('closed', end);
  };

  return { attachWindow, stop, status };
}

module.exports = { setupCaptionShare, NETWORK_POLL_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/caption-share.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into main, the allowlists and the entry map**

In `electron/main.js`, add after `const { setupTranscriptSaveHandler } = require('./transcript-save.js');`:

```js
const { setupCaptionShare } = require('./caption-share.js');
```

After `const nativeHost = new NativeHostManager();`:

```js
// LAN caption sharing (spec 2026-10-04): handlers registered once, here;
// createWindow() hands each new main window to attachWindow().
const captionShare = setupCaptionShare({
  ipcMain,
  BrowserWindow,
  app,
  isTrustedSender: (sender) => sender === mainWindow?.webContents,
  getMainWindow: () => mainWindow,
  isDev: import.meta.env.MODE === 'development' || !app.isPackaged,
});
```

The two closures read `mainWindow` when an IPC call arrives, long after the module has run, so the block may sit above the `let mainWindow` declaration. In `createWindow()`, after `setupPopoverWindowHandlers(mainWindow);`:

```js
  captionShare.attachWindow(mainWindow);
```

In `electron/ipc-channels.js`, append to `INVOKE_CHANNELS`:

```js
  // LAN caption sharing (electron/caption-share.js)
  'caption-share:start',
  'caption-share:stop',
  'caption-share:patch',
  'caption-share:clear',
  'caption-share:state',
  'caption-share:select-address',
  'caption-share:set-wifi',
  'caption-share:present',
```

In `electron/preload.js` `validReceiveChannels`, add before `'app:close-requested'`:

```js
  // LAN caption sharing status (main → renderer)
  'caption-share:status',
```

In `vite.config.ts`, add to the main `entry` map:

```ts
            'caption-share': 'electron/caption-share.js',
            'caption-share-core': 'electron/caption-share-core.js',
            'caption-share-net': 'electron/caption-share-net.js',
            'caption-share-server': 'electron/caption-share-server.js',
```

- [ ] **Step 6: Run the main-process suite**

Run: `npx vitest run electron`
Expected: PASS, including `electron/ipc-channels.test.js` and `electron/entry-map.consistency.test.js`.

- [ ] **Step 7: Commit**

```bash
git add electron/caption-share.js electron/caption-share.test.js electron/main.js electron/ipc-channels.js electron/preload.js vite.config.ts
git commit -m "feat(caption-share): main-process IPC, present window and lifecycle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Slice 1 ends here: report.**

---

### Task 6: Conversation reset signal

**Files:**
- Modify: `src/lib/session/conversationSet.ts`
- Test: `src/lib/session/conversationSet.test.ts`

**Interfaces:**
- Produces: `export type ConversationResetReason = 'clear' | 'restart'`; `ConversationSet.onReset(listener: (reason: ConversationResetReason) => void): () => void`. Spec §3.1 calls this the runner's `onConversationReset`; it lives on `runner.conversation` because `replace` and `clear` both pass through that object.

- [ ] **Step 1: Write the failing test** (append to the existing `describe('ConversationSet')`)

```ts
  it('says why the conversation emptied: restart on a new run, clear on clear()', () => {
    const set = new ConversationSet();
    const heard: string[] = [];
    const off = set.onReset((reason) => heard.push(reason));
    set.replace(new Map([['speaker', make('speaker', 'r1')]]));
    set.clear();
    set.replace(new Map([['speaker', make('speaker', 'r2')]]));
    off();
    set.clear();
    expect(heard).toEqual(['restart', 'clear', 'restart']);
  });

  it('a reset listener that throws does not keep a later one from hearing it', () => {
    const set = new ConversationSet();
    set.onReset(() => { throw new Error('buggy'); });
    const heard: string[] = [];
    set.onReset((reason) => heard.push(reason));
    set.clear();
    expect(heard).toEqual(['clear']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/session/conversationSet.test.ts`
Expected: FAIL, `set.onReset is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/lib/session/conversationSet.ts`, export the type above the class:

```ts
/** Why the conversation emptied: `clear()` was called, or a new run replaced it. */
export type ConversationResetReason = 'clear' | 'restart';
```

Add a field next to `listeners`:

```ts
  private readonly resetListeners = new Set<(reason: ConversationResetReason) => void>();
```

Add the method after `subscribe`:

```ts
  /** Told when the conversation empties (LAN caption sharing mirrors it, spec 2026-10-04 §3.1). */
  onReset(listener: (reason: ConversationResetReason) => void): () => void {
    this.resetListeners.add(listener);
    return () => { this.resetListeners.delete(listener); };
  }
```

In `replace(...)`, after `this.changed();` add `this.reset('restart');`. In `clear()`, after the loop add `this.reset('clear');`. Add the private method after `changed()`:

```ts
  private reset(reason: ConversationResetReason): void {
    for (const listener of this.resetListeners) {
      try {
        listener(reason);
      } catch (error) {
        reportError('SessionRunner', `A conversation reset listener threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'reset-listener' });
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/conversationSet.ts src/lib/session/conversationSet.test.ts
git commit -m "feat(session): conversation set tells listeners why it emptied

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Share types, entry mapping, diff and publisher

**Files:**
- Create: `src/lib/share/types.ts`, `src/lib/share/viewerEntry.ts`, `src/lib/share/diff.ts`, `src/lib/share/publisher.ts`, `src/lib/share/url.ts`, `src/lib/share/wifiQr.ts`
- Test: `src/lib/share/viewerEntry.test.ts`, `src/lib/share/diff.test.ts`, `src/lib/share/publisher.test.ts`, `src/lib/share/small.test.ts`

**Interfaces:**
- Consumes: `Entry` (`src/lib/projection/types.ts`), `Readable` (`src/lib/view/conversationView.ts`), `ConversationResetReason` (Task 6).
- Produces:
  - `types.ts`: `ViewerRow`, `ViewerEntry`, `ShareState`, `AddressKind`, `ShareAddress`, `ShareStatus`, `ResetReason`, `WifiHint`, `PresentInfo`, `ViewerEvent` (shapes below).
  - `toViewerEntry(entry: Entry): ViewerEntry | null`.
  - `diffEntries(acked: ReadonlyMap<string, string>, items: readonly ShareItem[]) → EntryDiff` and `applyDiff(acked: Map<string, string>, diff: EntryDiff) → void`, where `ShareItem = { entry: ViewerEntry; json: string }` and `EntryDiff = { upsert: ViewerEntry[]; remove: string[]; json: Map<string, string> }`.
  - `startSharePublisher(sources: PublisherSources, port: SharePort) → () => void`.
  - `shareUrl(status: ShareStatus) → string | null`; `wifiQrText(ssid: string, password: string) → string`.

- [ ] **Step 1: Write the types (no test of their own)**

```ts
// src/lib/share/types.ts
/**
 * LAN caption sharing (spec 2026-10-04 §4): what the host renderer, the
 * main process and the viewer page exchange. Plain data, JSON-safe.
 */
import type { LegName } from '../conversation/types';

export interface ViewerRow { key: string; text: string; final: boolean }

export interface ViewerEntry {
  id: string;
  leg: LegName;
  t: number;
  languages: { source: string; target: string };
  source: ViewerRow[];
  translation: ViewerRow[];
}

export interface ShareState {
  phase: 'live' | 'idle';
  pair: { source: string; target: string };
  allowSave: boolean;
}

export type AddressKind = 'wifi' | 'wired' | 'other' | 'virtual';
export interface ShareAddress { address: string; label: string; kind: AddressKind }

export interface ShareStatus {
  running: boolean;
  port: number | null;
  addresses: ShareAddress[];
  selected: string | null;
  viewers: number;
  addressChanged: boolean;
}

export type ResetReason = 'clear' | 'restart';
export interface WifiHint { ssid: string; password: string }

export interface PresentInfo {
  url: string;
  pair: ShareState['pair'];
  phase: ShareState['phase'];
  viewers: number;
  wifi: WifiHint | null;
}

export type ViewerEvent =
  | { type: 'snapshot'; state: ShareState; entries: ViewerEntry[] }
  | { type: 'upsert'; entries: ViewerEntry[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear'; reason: ResetReason }
  | { type: 'state'; state: ShareState }
  | { type: 'ended' };
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/share/viewerEntry.test.ts
import { describe, it, expect } from 'vitest';
import type { Entry } from '../projection/types';
import { toViewerEntry } from './viewerEntry';

const row = (key: string, text: string, final: boolean) => ({
  key, segmentId: key.slice(0, key.lastIndexOf(':')), side: 'source' as const, start: 0, end: text.length, text, final, language: 'ja',
});

describe('toViewerEntry', () => {
  it('keeps what a viewer reads and nothing else', () => {
    const entry: Entry = {
      kind: 'exchange', id: 'speaker:s:r1:speaker:1', leg: 'speaker', languages: { source: 'ja', target: 'zh-CN' },
      pairing: 'stated', t: 1000,
      source: [row('r1:speaker:1:0', 'こんにちは', true)],
      translation: [{ ...row('r1:speaker:2:0', '你好', false), side: 'translation' }],
    };
    expect(toViewerEntry(entry)).toEqual({
      id: 'speaker:s:r1:speaker:1', leg: 'speaker', t: 1000, languages: { source: 'ja', target: 'zh-CN' },
      source: [{ key: 'r1:speaker:1:0', text: 'こんにちは', final: true }],
      translation: [{ key: 'r1:speaker:2:0', text: '你好', final: false }],
    });
  });

  it('leaves notices with the host', () => {
    const notice: Entry = { kind: 'notice', id: 'speaker:n:1', leg: 'speaker', severity: 'error', message: 'x', at: 1 };
    expect(toViewerEntry(notice)).toBeNull();
  });
});
```

```ts
// src/lib/share/diff.test.ts
import { describe, it, expect } from 'vitest';
import type { ViewerEntry } from './types';
import { applyDiff, diffEntries } from './diff';

const entry = (id: string, text: string): ViewerEntry => ({
  id, leg: 'speaker', t: 1, languages: { source: 'ja', target: 'en' },
  source: [{ key: `${id}:0`, text, final: true }], translation: [],
});
const item = (e: ViewerEntry) => ({ entry: e, json: JSON.stringify(e) });

describe('diffEntries', () => {
  it('sends new and changed entries, removes vanished ones, skips unchanged ones', () => {
    const acked = new Map<string, string>();
    const first = diffEntries(acked, [item(entry('a', '1')), item(entry('b', '1'))]);
    expect(first.upsert.map((e) => e.id)).toEqual(['a', 'b']);
    applyDiff(acked, first);

    const second = diffEntries(acked, [item(entry('a', '1')), item(entry('c', '1')), item(entry('b', '2'))]);
    expect(second.upsert.map((e) => e.id)).toEqual(['c', 'b']);
    expect(second.remove).toEqual([]);
    applyDiff(acked, second);

    const third = diffEntries(acked, [item(entry('c', '1'))]);
    expect(third.upsert).toEqual([]);
    expect(third.remove.sort()).toEqual(['a', 'b']);
    applyDiff(acked, third);
    expect([...acked.keys()]).toEqual(['c']);
  });

  it('changes nothing until applied, so a failed send is retried', () => {
    const acked = new Map<string, string>();
    const d = diffEntries(acked, [item(entry('a', '1'))]);
    expect(acked.size).toBe(0);
    expect(diffEntries(acked, [item(entry('a', '1'))]).upsert.map((e) => e.id)).toEqual(['a']);
    applyDiff(acked, d);
    expect(diffEntries(acked, [item(entry('a', '1'))]).upsert).toEqual([]);
  });
});
```

```ts
// src/lib/share/publisher.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Entry } from '../projection/types';
import type { ShareState } from './types';
import { startSharePublisher, type SharePort } from './publisher';

vi.mock('../diagnostics/report', () => ({ reportError: vi.fn(), describeCause: (e: unknown) => String(e) }));
import { reportError } from '../diagnostics/report';

const exchange = (id: string, text: string): Entry => ({
  kind: 'exchange', id, leg: 'speaker', languages: { source: 'ja', target: 'en' }, pairing: 'none', t: 1,
  source: [{ key: `${id}:0`, segmentId: id, side: 'source', start: 0, end: text.length, text, final: true }], translation: [],
});

function readable<T>(value: T) {
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const l of listeners) l(); },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const view = readable<{ entries: readonly Entry[] }>({ entries: [exchange('a', '1')] });
  const state = readable<ShareState>({ phase: 'live', pair: { source: 'ja', target: 'en' }, allowSave: false });
  let resetListener: ((r: 'clear' | 'restart') => void) | null = null;
  const port = {
    patch: vi.fn<SharePort['patch']>(async () => undefined),
    clear: vi.fn<SharePort['clear']>(async () => undefined),
    state: vi.fn<SharePort['state']>(async () => undefined),
  };
  const stop = startSharePublisher(
    { view, state, onReset: (l) => { resetListener = l; return () => { resetListener = null; }; } },
    port,
  );
  return { view, state, port, stop, reset: (r: 'clear' | 'restart') => resetListener?.(r) };
}

describe('startSharePublisher', () => {
  it('sends the state and the current entries at once, then only what changes', async () => {
    const h = harness();
    await flush();
    expect(h.port.state).toHaveBeenCalledTimes(1);
    expect(h.port.patch).toHaveBeenCalledTimes(1);
    expect(h.port.patch.mock.calls[0][0].upsert.map((e) => e.id)).toEqual(['a']);

    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1')] });
    await flush();
    expect(h.port.patch.mock.calls[1][0].upsert.map((e) => e.id)).toEqual(['b']);

    h.view.set({ entries: [exchange('b', '1')] });
    await flush();
    expect(h.port.patch.mock.calls[2][0]).toMatchObject({ upsert: [], remove: ['a'] });
    h.stop();
  });

  it('sends a state only when it changed', async () => {
    const h = harness();
    await flush();
    h.state.set({ ...h.state.get() });
    h.state.set({ ...h.state.get(), allowSave: true });
    await flush();
    expect(h.port.state.mock.calls.map((c) => c[0].allowSave)).toEqual([false, true]);
    h.stop();
  });

  it('on a reset sends clear with the reason and resends everything after it', async () => {
    const h = harness();
    await flush();
    h.reset('restart');
    await flush();
    expect(h.port.clear).toHaveBeenCalledWith('restart');
    h.view.set({ entries: [exchange('a', '1')] });
    await flush();
    expect(h.port.patch.mock.calls.at(-1)?.[0].upsert.map((e) => e.id)).toEqual(['a']);
    h.stop();
  });

  it('retries what a failed patch carried and reports the failure once per streak', async () => {
    const h = harness();
    await flush();
    h.port.patch.mockRejectedValueOnce(new Error('ipc down')).mockRejectedValueOnce(new Error('ipc down'));
    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1')] });
    await flush();
    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1'), exchange('c', '1')] });
    await flush();
    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1'), exchange('c', '1')] });
    await flush();
    const last = h.port.patch.mock.calls.at(-1)?.[0];
    expect(last?.upsert.map((e) => e.id)).toEqual(['b', 'c']);
    expect(reportError).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('stops listening when stopped', async () => {
    const h = harness();
    await flush();
    h.stop();
    h.view.set({ entries: [] });
    await flush();
    expect(h.port.patch).toHaveBeenCalledTimes(1);
  });
});
```

Note on the retry test: the third `view.set` keeps the same entries; the publisher recomputes the diff on every view update, so the last call carries `b` and `c`, which were never acknowledged.

```ts
// src/lib/share/small.test.ts
import { describe, it, expect } from 'vitest';
import { shareUrl } from './url';
import { wifiQrText } from './wifiQr';

describe('shareUrl', () => {
  it('is the selected address and port, or null', () => {
    const base = { running: true, port: 7788, addresses: [], selected: '192.168.1.23', viewers: 0, addressChanged: false };
    expect(shareUrl(base)).toBe('http://192.168.1.23:7788/');
    expect(shareUrl({ ...base, selected: null })).toBeNull();
    expect(shareUrl({ ...base, running: false })).toBeNull();
  });
});

describe('wifiQrText', () => {
  it('escapes the special characters and marks an open network', () => {
    expect(wifiQrText('Meetup-Guest', 'pass')).toBe('WIFI:T:WPA;S:Meetup-Guest;P:pass;;');
    expect(wifiQrText('a;b,c:d"e\\f', 'p;w')).toBe('WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;w;;');
    expect(wifiQrText('Open Net', '')).toBe('WIFI:T:nopass;S:Open Net;;');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/share`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/share/viewerEntry.ts
import type { Entry, Row } from '../projection/types';
import type { ViewerEntry, ViewerRow } from './types';

const row = (r: Row): ViewerRow => ({ key: r.key, text: r.text, final: r.final });

/** What a viewer reads of one entry; notices stay with the host (spec 2026-10-04 §3.1). */
export function toViewerEntry(entry: Entry): ViewerEntry | null {
  if (entry.kind !== 'exchange') return null;
  return {
    id: entry.id,
    leg: entry.leg,
    t: entry.t,
    languages: { source: entry.languages.source, target: entry.languages.target },
    source: entry.source.map(row),
    translation: entry.translation.map(row),
  };
}
```

```ts
// src/lib/share/diff.ts
import type { ViewerEntry } from './types';

export interface ShareItem { entry: ViewerEntry; json: string }
export interface EntryDiff { upsert: ViewerEntry[]; remove: string[]; json: Map<string, string> }

/** What differs from what main acknowledged (`acked`: id → the JSON it holds). Pure: `applyDiff` records a success. */
export function diffEntries(acked: ReadonlyMap<string, string>, items: readonly ShareItem[]): EntryDiff {
  const upsert: ViewerEntry[] = [];
  const json = new Map<string, string>();
  const seen = new Set<string>();
  for (const { entry, json: text } of items) {
    seen.add(entry.id);
    if (acked.get(entry.id) !== text) {
      upsert.push(entry);
      json.set(entry.id, text);
    }
  }
  const remove: string[] = [];
  for (const id of acked.keys()) if (!seen.has(id)) remove.push(id);
  return { upsert, remove, json };
}

export function applyDiff(acked: Map<string, string>, diff: EntryDiff): void {
  for (const id of diff.remove) acked.delete(id);
  for (const [id, text] of diff.json) acked.set(id, text);
}
```

```ts
// src/lib/share/publisher.ts
/**
 * Mirrors the host's conversation view to the LAN caption-share server
 * (spec 2026-10-04 §3.1): patches against what main acknowledged, an
 * explicit clear on every reset, and the share state when it changes.
 */
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import { describeCause, reportError } from '../diagnostics/report';
import { applyDiff, diffEntries, type EntryDiff, type ShareItem } from './diff';
import type { ResetReason, ShareState } from './types';
import { toViewerEntry } from './viewerEntry';

export interface SharePort {
  patch(diff: Pick<EntryDiff, 'upsert' | 'remove'>): Promise<unknown>;
  clear(reason: ResetReason): Promise<unknown>;
  state(state: ShareState): Promise<unknown>;
}

export interface PublisherSources {
  view: Readable<{ entries: readonly Entry[] }>;
  state: Readable<ShareState>;
  onReset(listener: (reason: ResetReason) => void): () => void;
}

export function startSharePublisher(sources: PublisherSources, port: SharePort): () => void {
  const acked = new Map<string, string>();
  const cache = new WeakMap<Entry, ShareItem | null>();
  let failing = false;
  let stopped = false;

  const failed = (error: unknown) => {
    if (!failing) {
      reportError('CaptionShare', `Sending captions to viewers failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:publish' });
    }
    failing = true;
  };

  const items = (): ShareItem[] => {
    const out: ShareItem[] = [];
    for (const entry of sources.view.get().entries) {
      let item = cache.get(entry);
      if (item === undefined) {
        const viewer = toViewerEntry(entry);
        item = viewer ? { entry: viewer, json: JSON.stringify(viewer) } : null;
        cache.set(entry, item);
      }
      if (item) out.push(item);
    }
    return out;
  };

  const publish = () => {
    if (stopped) return;
    const diff = diffEntries(acked, items());
    if (diff.upsert.length === 0 && diff.remove.length === 0) return;
    port.patch({ upsert: diff.upsert, remove: diff.remove }).then(
      () => { failing = false; applyDiff(acked, diff); },
      failed,
    );
  };

  let lastState = '';
  const sendState = () => {
    if (stopped) return;
    const state = sources.state.get();
    const text = JSON.stringify(state);
    if (text === lastState) return;
    lastState = text;
    port.state(state).catch(failed);
  };

  sendState();
  publish();
  const offView = sources.view.subscribe(publish);
  const offState = sources.state.subscribe(sendState);
  const offReset = sources.onReset((reason) => {
    acked.clear();
    port.clear(reason).catch(failed);
  });

  return () => {
    stopped = true;
    offView();
    offState();
    offReset();
  };
}
```

```ts
// src/lib/share/url.ts
import type { ShareStatus } from './types';

/** The address viewers open, or null when sharing is off or no address is chosen. */
export function shareUrl(status: ShareStatus): string | null {
  if (!status.running || !status.selected || !status.port) return null;
  return `http://${status.selected}:${status.port}/`;
}
```

```ts
// src/lib/share/wifiQr.ts
const escape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/** The text a phone camera reads as "join this Wi-Fi" (spec 2026-10-04 §6). */
export function wifiQrText(ssid: string, password: string): string {
  return password ? `WIFI:T:WPA;S:${escape(ssid)};P:${escape(password)};;` : `WIFI:T:nopass;S:${escape(ssid)};;`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/share`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/share
git commit -m "feat(caption-share): share publisher mirroring the conversation view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Host store, controller and analytics events

**Files:**
- Create: `src/stores/captionShareStore.ts`, `src/app/captionShare.ts`
- Modify: `src/lib/analytics.ts` (`AnalyticsEvents`, after `'audio_error'`)
- Test: `src/stores/captionShareStore.test.ts`, `src/app/captionShare.test.ts`

**Interfaces:**
- Consumes: Task 7 (`startSharePublisher`, types), Task 6 (`onReset`), `getAppSession()` (`src/app/session.ts:338`), `useProviderStore.getState().intent` (`src/stores/providerStore.ts:52`).
- Produces:
  - `useCaptionShareStore` (zustand) with `status`, `busy`, `error: { code: 'ports-busy' | 'listen-failed'; reason: string } | null`, `allowSave`, `wifiHint: { enabled; ssid; password }`, `firewallNoteSeen`, `startedAt`, `peakViewers`, `everConnected`, and actions `setStatus`, `setBusy`, `setError`, `setAllowSave`, `setWifiHint`, `markStarted(now, status)`, `markStopped()`. `IDLE_STATUS`.
  - `createCaptionShareController(deps) → CaptionShareController` and `getCaptionShareController()`, with `start() → Promise<boolean>`, `stop()`, `selectAddress(address)`, `setAllowSave(allow)`, `setWifiHint(patch)`, `openPresent()`.
  - Analytics events `caption_share_started`, `caption_share_ended`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/stores/captionShareStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { IDLE_STATUS, useCaptionShareStore } from './captionShareStore';

const running = (viewers: number) => ({ ...IDLE_STATUS, running: true, port: 7788, selected: '192.168.1.23', viewers });

beforeEach(() => useCaptionShareStore.getState().markStopped());

describe('captionShareStore', () => {
  it('tracks the peak and whether anyone ever connected', () => {
    const s = useCaptionShareStore.getState();
    s.markStarted(1000, running(0));
    s.setStatus(running(3));
    s.setStatus(running(1));
    const now = useCaptionShareStore.getState();
    expect(now.startedAt).toBe(1000);
    expect(now.peakViewers).toBe(3);
    expect(now.everConnected).toBe(true);
    expect(now.firewallNoteSeen).toBe(true);
  });

  it('forgets the share on stop but keeps the host options for this run of the app', () => {
    const s = useCaptionShareStore.getState();
    s.setAllowSave(true);
    s.setWifiHint({ enabled: true, ssid: 'Guest' });
    s.markStarted(1, running(2));
    s.markStopped();
    const now = useCaptionShareStore.getState();
    expect(now.status).toEqual(IDLE_STATUS);
    expect(now.startedAt).toBeNull();
    expect(now.peakViewers).toBe(0);
    expect(now.allowSave).toBe(true);
    expect(now.wifiHint).toEqual({ enabled: true, ssid: 'Guest', password: '' });
  });
});
```

```ts
// src/app/captionShare.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { Entry } from '../lib/projection/types';
import type { RunState } from '../lib/session/types';
import { IDLE_STATUS, useCaptionShareStore } from '../stores/captionShareStore';
import { createCaptionShareController } from './captionShare';

vi.mock('../lib/diagnostics/report', () => ({ reportError: vi.fn(), reportWarning: vi.fn(), describeCause: (e: unknown) => String(e) }));

const STATUS = { ...IDLE_STATUS, running: true, port: 7788, selected: '192.168.1.23', addresses: [{ address: '192.168.1.23', label: 'wlan0', kind: 'wifi' as const }] };

function setup(startResult: unknown = STATUS) {
  const receivers = new Map<string, (...args: unknown[]) => void>();
  const ipc = {
    invoke: vi.fn(async (channel: string, _data?: unknown) => {
      if (channel === 'caption-share:start') return startResult;
      if (channel === 'caption-share:stop') return { ...IDLE_STATUS };
      if (channel === 'caption-share:select-address') return { ...STATUS, selected: '10.0.0.2' };
      return undefined;
    }),
    receive: (channel: string, fn: (...args: unknown[]) => void) => { receivers.set(channel, fn); },
  };
  const entries: Entry[] = [];
  const listeners = new Set<() => void>();
  const view = { get: () => ({ entries }), subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); } };
  const run = createStore<RunState>(() => ({ phase: 'running', since: 0, legs: {} }));
  const controller = createCaptionShareController({
    ipc,
    view,
    onReset: () => () => {},
    runState: { getState: () => run.getState(), subscribe: (l) => run.subscribe(() => l()) },
    pair: { get: () => ({ source: 'ja', target: 'zh-CN' }), subscribe: () => () => {} },
    store: useCaptionShareStore,
    now: () => 5000,
  });
  return { ipc, receivers, controller, run };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const channels = (ipc: { invoke: { mock: { calls: unknown[][] } } }) => ipc.invoke.mock.calls.map((c) => c[0]);

beforeEach(() => {
  useCaptionShareStore.getState().markStopped();
  useCaptionShareStore.setState({ allowSave: false, wifiHint: { enabled: false, ssid: '', password: '' }, error: null, busy: false });
});

describe('caption share controller', () => {
  it('starts the server with the share state, then publishes', async () => {
    const { ipc, controller } = setup();
    expect(await controller.start()).toBe(true);
    await flush();
    expect(ipc.invoke.mock.calls[0]).toEqual(['caption-share:start', { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false }]);
    expect(channels(ipc)).toContain('caption-share:state');
    expect(useCaptionShareStore.getState().status.running).toBe(true);
    expect(useCaptionShareStore.getState().startedAt).toBe(5000);
  });

  it('keeps the error and does not publish when the server cannot start', async () => {
    const { ipc, controller } = setup({ error: 'ports-busy', reason: 'All share ports are in use' });
    expect(await controller.start()).toBe(false);
    expect(useCaptionShareStore.getState().error).toEqual({ code: 'ports-busy', reason: 'All share ports are in use' });
    expect(channels(ipc)).not.toContain('caption-share:state');
  });

  it('a pushed status that says stopped ends the publisher and the share', async () => {
    const { ipc, receivers, controller, run } = setup();
    await controller.start();
    await flush();
    receivers.get('caption-share:status')?.({ ...IDLE_STATUS });
    const before = ipc.invoke.mock.calls.length;
    run.setState({ phase: 'idle' });
    await flush();
    expect(ipc.invoke.mock.calls.length).toBe(before);
    expect(useCaptionShareStore.getState().startedAt).toBeNull();
  });

  it('sends allowSave through the state, and the Wi-Fi hint only while sharing', async () => {
    const { ipc, controller } = setup();
    controller.setWifiHint({ enabled: true, ssid: 'Guest' });
    expect(channels(ipc)).not.toContain('caption-share:set-wifi');
    await controller.start();
    await flush();
    expect(ipc.invoke.mock.calls.find((c) => c[0] === 'caption-share:set-wifi')?.[1]).toEqual({ wifi: { ssid: 'Guest', password: '' } });
    controller.setAllowSave(true);
    await flush();
    expect(ipc.invoke.mock.calls.filter((c) => c[0] === 'caption-share:state').at(-1)?.[1]).toMatchObject({ allowSave: true });
    controller.setWifiHint({ enabled: false });
    await flush();
    expect(ipc.invoke.mock.calls.filter((c) => c[0] === 'caption-share:set-wifi').at(-1)?.[1]).toEqual({ wifi: null });
  });

  it('stops, selects an address and opens the present window over IPC', async () => {
    const { ipc, controller } = setup();
    await controller.start();
    await controller.selectAddress('10.0.0.2');
    expect(useCaptionShareStore.getState().status.selected).toBe('10.0.0.2');
    await controller.openPresent();
    await controller.stop();
    expect(channels(ipc)).toEqual(expect.arrayContaining(['caption-share:select-address', 'caption-share:present', 'caption-share:stop']));
    expect(useCaptionShareStore.getState().status).toEqual(IDLE_STATUS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/captionShareStore.test.ts src/app/captionShare.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the store**

```ts
// src/stores/captionShareStore.ts
/**
 * The host side of LAN caption sharing (spec 2026-10-04 §7.4): what the
 * panel shows. Nothing here is persisted (decision 9): every option is gone
 * when Sokuji quits, and sharing is off at every launch.
 */
import { create } from 'zustand';
import type { ShareStatus, WifiHint } from '../lib/share/types';

export const IDLE_STATUS: ShareStatus = { running: false, port: null, addresses: [], selected: null, viewers: 0, addressChanged: false };

export interface ShareError { code: 'ports-busy' | 'listen-failed'; reason: string }
export type WifiHintState = WifiHint & { enabled: boolean };

export interface CaptionShareState {
  status: ShareStatus;
  busy: boolean;
  error: ShareError | null;
  allowSave: boolean;
  wifiHint: WifiHintState;
  firewallNoteSeen: boolean;
  startedAt: number | null;
  peakViewers: number;
  everConnected: boolean;
  setStatus(status: ShareStatus): void;
  setBusy(busy: boolean): void;
  setError(error: ShareError | null): void;
  setAllowSave(allow: boolean): void;
  setWifiHint(patch: Partial<WifiHintState>): void;
  markStarted(now: number, status: ShareStatus): void;
  markStopped(): void;
}

export const useCaptionShareStore = create<CaptionShareState>()((set) => ({
  status: IDLE_STATUS,
  busy: false,
  error: null,
  allowSave: false,
  wifiHint: { enabled: false, ssid: '', password: '' },
  firewallNoteSeen: false,
  startedAt: null,
  peakViewers: 0,
  everConnected: false,
  setStatus: (status) => set((s) => ({
    status,
    peakViewers: Math.max(s.peakViewers, status.viewers),
    everConnected: s.everConnected || status.viewers > 0,
  })),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setAllowSave: (allowSave) => set({ allowSave }),
  setWifiHint: (patch) => set((s) => ({ wifiHint: { ...s.wifiHint, ...patch } })),
  markStarted: (now, status) => set({
    status, startedAt: now, peakViewers: status.viewers, everConnected: status.viewers > 0, firewallNoteSeen: true, error: null,
  }),
  markStopped: () => set({ status: IDLE_STATUS, startedAt: null, peakViewers: 0, everConnected: false }),
}));
```

- [ ] **Step 4: Write the controller**

Check first that the preload's `receive` strips the event (`grep -n "receive:" -A 6 electron/preload.js` shows `const wrapper = (event, ...args) => func(...args);`), so the status arrives as the first argument.

```ts
// src/app/captionShare.ts
/**
 * The host side's controller for LAN caption sharing (spec 2026-10-04
 * §3.1, §7): starts and stops the main-process server, keeps the share
 * publisher alive while it runs, and folds the pushed status into the
 * store. Analytics are tracked by the panel, which can use React hooks.
 */
import type { Entry } from '../lib/projection/types';
import type { ConversationResetReason } from '../lib/session/conversationSet';
import type { RunState } from '../lib/session/types';
import type { Readable } from '../lib/view/conversationView';
import { describeCause, reportError } from '../lib/diagnostics/report';
import { startSharePublisher, type SharePort } from '../lib/share/publisher';
import type { ShareState, ShareStatus } from '../lib/share/types';
import { useCaptionShareStore, type ShareError, type WifiHintState } from '../stores/captionShareStore';
import { useProviderStore } from '../stores/providerStore';
import { getAppSession } from './session';

export interface CaptionShareIpc {
  invoke(channel: string, data?: unknown): Promise<unknown>;
  receive?(channel: string, fn: (...args: unknown[]) => void): void;
}

export interface CaptionShareDeps {
  ipc: CaptionShareIpc;
  view: Readable<{ entries: readonly Entry[] }>;
  onReset(listener: (reason: ConversationResetReason) => void): () => void;
  runState: { getState(): RunState; subscribe(listener: () => void): () => void };
  pair: { get(): { source: string; target: string } | null; subscribe(listener: () => void): () => void };
  store: typeof useCaptionShareStore;
  now(): number;
}

export interface CaptionShareController {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  selectAddress(address: string): Promise<void>;
  setAllowSave(allow: boolean): void;
  setWifiHint(patch: Partial<WifiHintState>): void;
  openPresent(): Promise<void>;
}

type StartResult = ShareStatus | { error: ShareError['code']; reason?: string };

export function createCaptionShareController(deps: CaptionShareDeps): CaptionShareController {
  let stopPublisher: (() => void) | null = null;
  let listening = false;

  const shareState = (): ShareState => ({
    phase: deps.runState.getState().phase === 'running' ? 'live' : 'idle',
    pair: deps.pair.get() ?? { source: '', target: '' },
    allowSave: deps.store.getState().allowSave,
  });
  const stateSource: Readable<ShareState> = {
    get: shareState,
    subscribe(listener) {
      const offs = [deps.runState.subscribe(listener), deps.pair.subscribe(listener), deps.store.subscribe(listener)];
      return () => { for (const off of offs) off(); };
    },
  };
  const port: SharePort = {
    patch: (diff) => deps.ipc.invoke('caption-share:patch', diff),
    clear: (reason) => deps.ipc.invoke('caption-share:clear', { reason }),
    state: (state) => deps.ipc.invoke('caption-share:state', state),
  };

  const endPublisher = () => {
    stopPublisher?.();
    stopPublisher = null;
  };

  const listen = () => {
    if (listening || !deps.ipc.receive) return;
    listening = true;
    deps.ipc.receive('caption-share:status', (status) => {
      const next = status as ShareStatus;
      if (!next.running) {
        endPublisher();
        deps.store.getState().markStopped();
        return;
      }
      deps.store.getState().setStatus(next);
    });
  };

  const pushWifi = async () => {
    if (!deps.store.getState().status.running) return;
    const hint = deps.store.getState().wifiHint;
    const wifi = hint.enabled && hint.ssid.trim() !== '' ? { ssid: hint.ssid.trim(), password: hint.password } : null;
    try {
      await deps.ipc.invoke('caption-share:set-wifi', { wifi });
    } catch (error) {
      reportError('CaptionShare', `Updating the Wi-Fi hint failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:wifi' });
    }
  };

  return {
    async start() {
      const store = deps.store.getState();
      if (store.busy || store.status.running) return store.status.running;
      listen();
      store.setBusy(true);
      store.setError(null);
      try {
        const result = (await deps.ipc.invoke('caption-share:start', shareState())) as StartResult;
        if ('error' in result) {
          reportError('CaptionShare', `Caption sharing could not start: ${result.error}`, { dedupeKey: 'caption-share:start' });
          deps.store.getState().setError({ code: result.error, reason: result.reason ?? '' });
          return false;
        }
        deps.store.getState().markStarted(deps.now(), result);
        stopPublisher = startSharePublisher({ view: deps.view, state: stateSource, onReset: deps.onReset }, port);
        await pushWifi();
        return true;
      } catch (error) {
        reportError('CaptionShare', `Starting caption sharing failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:start' });
        deps.store.getState().setError({ code: 'listen-failed', reason: describeCause(error) });
        return false;
      } finally {
        deps.store.getState().setBusy(false);
      }
    },
    async stop() {
      endPublisher();
      try {
        await deps.ipc.invoke('caption-share:stop');
      } catch (error) {
        reportError('CaptionShare', `Stopping caption sharing failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:stop' });
      }
      deps.store.getState().markStopped();
    },
    async selectAddress(address) {
      try {
        const status = (await deps.ipc.invoke('caption-share:select-address', { address })) as ShareStatus;
        if (status) deps.store.getState().setStatus(status);
      } catch (error) {
        reportError('CaptionShare', `Choosing the share address failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:select' });
      }
    },
    setAllowSave(allow) {
      deps.store.getState().setAllowSave(allow);
    },
    setWifiHint(patch) {
      deps.store.getState().setWifiHint(patch);
      void pushWifi();
    },
    async openPresent() {
      try {
        await deps.ipc.invoke('caption-share:present');
      } catch (error) {
        reportError('CaptionShare', `Opening the projector page failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:present' });
      }
    },
  };
}

let controller: CaptionShareController | null = null;

/** The page's one controller, over the app session and window.electron (desktop only). */
export function getCaptionShareController(): CaptionShareController {
  if (!controller) {
    const session = getAppSession();
    controller = createCaptionShareController({
      ipc: window.electron,
      view: session.view,
      onReset: (listener) => session.runner.conversation.onReset(listener),
      runState: { getState: () => session.runner.state.getState(), subscribe: (listener) => session.runner.state.subscribe(() => listener()) },
      pair: { get: () => useProviderStore.getState().intent ?? null, subscribe: (listener) => useProviderStore.subscribe(() => listener()) },
      store: useCaptionShareStore,
      now: () => Date.now(),
    });
  }
  return controller;
}
```

- [ ] **Step 5: Add the analytics events**

In `src/lib/analytics.ts`, inside `AnalyticsEvents`, after the `'audio_error'` entry:

```ts
  // LAN caption sharing (spec 2026-10-04 §7.5): host side only, no content.
  'caption_share_started': { address_kind: 'wifi' | 'wired' | 'other' | 'virtual' };
  'caption_share_ended': { duration_ms: number; peak_viewers: number };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/stores/captionShareStore.test.ts src/app src/lib/diagnostics`
Expected: PASS (the console ledger included: these files hold no console calls).

- [ ] **Step 7: Commit**

```bash
git add src/stores/captionShareStore.ts src/stores/captionShareStore.test.ts src/app/captionShare.ts src/app/captionShare.test.ts src/lib/analytics.ts
git commit -m "feat(caption-share): host store, controller and analytics events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Host panel and toolbar button

**Files:**
- Create: `src/components/CaptionShare/QrCode.tsx`, `src/components/CaptionShare/CaptionSharePanel.tsx`, `src/components/CaptionShare/CaptionSharePanel.scss`, `src/components/CaptionShare/CaptionShareButton.tsx`
- Modify: `src/components/MainPanel/panel/PanelToolbar.tsx` (render the button before the ⚙ button), `src/locales/en/translation.json` (new `captionShare` subtree) and the 29 synced catalogs
- Test: `src/components/CaptionShare/CaptionSharePanel.test.tsx`, `src/components/CaptionShare/QrCode.test.tsx`, `src/components/MainPanel/panel/PanelToolbar.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 8 (`useCaptionShareStore`, `getCaptionShareController`), Task 7 (`shareUrl`), `useAnalytics` (`src/lib/analytics.ts:410`).
- Produces: `QrCode` (`{ value: string; size?: number; label: string; className?: string }`, reused by the present page in Task 12), `CaptionSharePanel`, `CaptionShareButton`, `NO_VIEWERS_WARNING_MS = 120_000`.

- [ ] **Step 1: Add the `captionShare` subtree to `src/locales/en/translation.json`** (as a top-level key before `viewer`), then run `node scripts/sync-locale-keys.mjs`.

```json
  "captionShare": {
    "button": "Share captions",
    "buttonActive": "Sharing captions: {{count}} watching",
    "intro": "Let people on the same network read the captions and translations here on their phones or computers.",
    "enable": "Share captions",
    "firewallNote": "Windows may ask whether Sokuji can use the network. Choose Private networks.",
    "address": "Address",
    "copy": "Copy",
    "copied": "Copied",
    "network": "Network",
    "kinds": {
      "wifi": "Wi‑Fi",
      "wired": "Wired",
      "other": "Network",
      "virtual": "Virtual adapter"
    },
    "recommended": "recommended",
    "usuallyUnreachable": "usually unreachable",
    "watching": "Watching",
    "watchingCount": "{{count}} watching",
    "allowSave": "Let viewers save these captions",
    "wifiHint": "Add a Wi‑Fi hint to the projector page",
    "wifiName": "Wi‑Fi name",
    "wifiNamePlaceholder": "e.g. Meetup-Guest",
    "wifiPassword": "Password (optional)",
    "openPresent": "Open projector page",
    "stop": "Stop sharing",
    "stopNote": "Viewers' pages will show that sharing has ended.",
    "warnNoViewers": "Two minutes in and no device has connected. This network may keep devices from reaching each other (guest Wi‑Fi and some company networks do), or a firewall may be blocking Sokuji. Check that everyone is on the same network as this computer, allow Sokuji on private networks in Windows, or use a phone hotspot or your own router.",
    "warnAddressChanged": "The network changed. The address is now {{address}}: send the link again or reopen the projector page.",
    "errorPortsBusy": "Could not start sharing: ports 7788–7797 are all in use.",
    "errorListen": "Could not start sharing: {{reason}}"
  },
```

- [ ] **Step 2: Write the failing tests**

```tsx
// src/components/CaptionShare/QrCode.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import QrCode from './QrCode';

describe('QrCode', () => {
  it('draws the modules on white with a quiet zone and an accessible label', () => {
    const { container } = render(<QrCode value="http://192.168.1.23:7788/" label="share address" size={96} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('share address');
    expect(svg.getAttribute('width')).toBe('96');
    const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(x).toBe(-4);
    expect(y).toBe(-4);
    expect(w).toBe(h);
    expect(container.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(100);
  });
});
```

```tsx
// src/components/CaptionShare/CaptionSharePanel.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { IDLE_STATUS, useCaptionShareStore } from '../../stores/captionShareStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
const trackEvent = vi.fn();
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
const controller = {
  start: vi.fn(async () => {
    useCaptionShareStore.getState().markStarted(Date.now(), RUNNING);
    return true;
  }),
  stop: vi.fn(async () => { useCaptionShareStore.getState().markStopped(); }),
  selectAddress: vi.fn(async () => {}),
  setAllowSave: vi.fn(),
  setWifiHint: vi.fn(),
  openPresent: vi.fn(async () => {}),
};
vi.mock('../../app/captionShare', () => ({ getCaptionShareController: () => controller }));

import CaptionSharePanel, { NO_VIEWERS_WARNING_MS } from './CaptionSharePanel';

const RUNNING = {
  ...IDLE_STATUS, running: true, port: 7788, selected: '192.168.1.23', viewers: 0,
  addresses: [{ address: '192.168.1.23', label: 'wlan0', kind: 'wifi' as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useCaptionShareStore.getState().markStopped();
  useCaptionShareStore.setState({ allowSave: false, wifiHint: { enabled: false, ssid: '', password: '' }, error: null, busy: false, firewallNoteSeen: false });
  (window as unknown as { electron?: unknown }).electron = { osInfo: { platform: 'linux' } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CaptionSharePanel', () => {
  it('off: explains, offers the switch, and tracks a successful start with the address kind', async () => {
    render(<CaptionSharePanel />);
    expect(screen.getByText('captionShare.intro')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('switch')); });
    expect(controller.start).toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith('caption_share_started', { address_kind: 'wifi' });
  });

  it('shows the firewall note on Windows only, until a start succeeded', () => {
    (window as unknown as { electron: unknown }).electron = { osInfo: { platform: 'win32' } };
    const { rerender } = render(<CaptionSharePanel />);
    expect(screen.getByText('captionShare.firewallNote')).toBeTruthy();
    act(() => { useCaptionShareStore.setState({ firewallNoteSeen: true }); });
    rerender(<CaptionSharePanel />);
    expect(screen.queryByText('captionShare.firewallNote')).toBeNull();
  });

  it('shows why a start failed', () => {
    useCaptionShareStore.setState({ error: { code: 'ports-busy', reason: '' } });
    render(<CaptionSharePanel />);
    expect(screen.getByText('captionShare.errorPortsBusy')).toBeTruthy();
  });

  it('on: QR code and address, no network dropdown for one address, one for several', () => {
    useCaptionShareStore.getState().markStarted(Date.now(), RUNNING);
    const { rerender } = render(<CaptionSharePanel />);
    expect(screen.getByRole('img', { name: 'http://192.168.1.23:7788/' })).toBeTruthy();
    expect(screen.getByText('http://192.168.1.23:7788/')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    act(() => {
      useCaptionShareStore.getState().setStatus({ ...RUNNING, addresses: [...RUNNING.addresses, { address: '172.17.0.1', label: 'docker0', kind: 'virtual' }] });
    });
    rerender(<CaptionSharePanel />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '172.17.0.1' } });
    expect(controller.selectAddress).toHaveBeenCalledWith('172.17.0.1');
  });

  it('asks for the Wi-Fi fields only when the hint is on, and toggles saving', () => {
    useCaptionShareStore.getState().markStarted(Date.now(), RUNNING);
    const { rerender } = render(<CaptionSharePanel />);
    expect(screen.queryByPlaceholderText('captionShare.wifiNamePlaceholder')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'captionShare.allowSave' }));
    expect(controller.setAllowSave).toHaveBeenCalledWith(true);
    act(() => { useCaptionShareStore.setState({ wifiHint: { enabled: true, ssid: '', password: '' } }); });
    rerender(<CaptionSharePanel />);
    fireEvent.change(screen.getByPlaceholderText('captionShare.wifiNamePlaceholder'), { target: { value: 'Guest' } });
    expect(controller.setWifiHint).toHaveBeenCalledWith({ ssid: 'Guest' });
  });

  it('warns after two minutes with nobody connected, and not once someone did', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useCaptionShareStore.getState().markStarted(1_000_000, RUNNING);
    render(<CaptionSharePanel />);
    expect(screen.queryByText('captionShare.warnNoViewers')).toBeNull();
    act(() => { vi.advanceTimersByTime(NO_VIEWERS_WARNING_MS + 1); });
    expect(screen.getByText('captionShare.warnNoViewers')).toBeTruthy();
    act(() => { useCaptionShareStore.getState().setStatus({ ...RUNNING, viewers: 1 }); });
    expect(screen.queryByText('captionShare.warnNoViewers')).toBeNull();
  });

  it('stopping tracks the duration and the peak, then stops', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    useCaptionShareStore.getState().markStarted(4_000, { ...RUNNING, viewers: 5 });
    render(<CaptionSharePanel />);
    await act(async () => { fireEvent.click(screen.getByText('captionShare.stop')); });
    expect(trackEvent).toHaveBeenCalledWith('caption_share_ended', { duration_ms: 6_000, peak_viewers: 5 });
    expect(controller.stop).toHaveBeenCalled();
  });
});
```

Extend `src/components/MainPanel/panel/PanelToolbar.test.tsx` (add mocks at the top with the others, and the cases inside its `describe`):

```tsx
vi.mock('../../CaptionShare/CaptionShareButton', () => ({
  __esModule: true,
  default: () => <div data-testid="caption-share-marker" />,
}));
const env = vi.hoisted(() => ({ electron: false }));
vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  isElectron: () => env.electron,
}));

  it('offers caption sharing on the desktop app only', () => {
    env.electron = false;
    renderToolbar(['speaker']);
    expect(screen.queryByTestId('caption-share-marker')).toBeNull();
    cleanup();
    env.electron = true;
    renderToolbar(['speaker']);
    expect(screen.getByTestId('caption-share-marker')).toBeTruthy();
    env.electron = false;
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/CaptionShare src/components/MainPanel/panel/PanelToolbar.test.tsx`
Expected: FAIL, modules not found / marker missing.

- [ ] **Step 4: Write the components**

```tsx
// src/components/CaptionShare/QrCode.tsx
import React, { useMemo } from 'react';
import { encode } from 'uqr';

interface QrCodeProps {
  value: string;
  size?: number;
  label: string;
  className?: string;
}

const QUIET = 4;

/** A QR code as SVG modules on white, with a 4-module quiet zone. */
const QrCode: React.FC<QrCodeProps> = ({ value, size = 128, label, className = '' }) => {
  const { path, n } = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 0 });
    let d = '';
    data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
    return { path: d, n: data.length };
  }, [value]);
  const box = n + 2 * QUIET;
  return (
    <svg
      className={`qr-code ${className}`.trim()}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-QUIET} ${-QUIET} ${box} ${box}`}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET} y={-QUIET} width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
};

export default QrCode;
```

```tsx
// src/components/CaptionShare/CaptionSharePanel.tsx
/**
 * The host's caption-share popover (spec 2026-10-04 §7.2): built from the
 * settings' own ToggleSwitch, Button, FormInput and StatusMessage. A control
 * is drawn only when it can be used.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../Settings/shared/ToggleSwitch';
import Button from '../Settings/shared/Button';
import FormInput from '../Settings/shared/FormInput';
import StatusMessage from '../Settings/shared/StatusMessage';
import QrCode from './QrCode';
import { useCaptionShareStore } from '../../stores/captionShareStore';
import { getCaptionShareController } from '../../app/captionShare';
import { shareUrl } from '../../lib/share/url';
import { useAnalytics } from '../../lib/analytics';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import './CaptionSharePanel.scss';

export const NO_VIEWERS_WARNING_MS = 120_000;

const platform = (): string =>
  (window.electron as unknown as { osInfo?: { platform?: string } } | undefined)?.osInfo?.platform ?? '';

const CaptionSharePanel: React.FC = () => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const controller = getCaptionShareController();
  const status = useCaptionShareStore((s) => s.status);
  const busy = useCaptionShareStore((s) => s.busy);
  const error = useCaptionShareStore((s) => s.error);
  const allowSave = useCaptionShareStore((s) => s.allowSave);
  const wifiHint = useCaptionShareStore((s) => s.wifiHint);
  const firewallNoteSeen = useCaptionShareStore((s) => s.firewallNoteSeen);
  const startedAt = useCaptionShareStore((s) => s.startedAt);
  const everConnected = useCaptionShareStore((s) => s.everConnected);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const url = shareUrl(status);

  // One re-render when the no-viewer warning falls due.
  useEffect(() => {
    if (!status.running || startedAt === null || everConnected) return;
    const due = startedAt + NO_VIEWERS_WARNING_MS - Date.now();
    if (due <= 0) {
      setNow(Date.now());
      return;
    }
    const id = window.setTimeout(() => setNow(Date.now()), due);
    return () => window.clearTimeout(id);
  }, [status.running, startedAt, everConnected]);

  const start = async () => {
    if (await controller.start()) {
      const s = useCaptionShareStore.getState().status;
      const kind = s.addresses.find((a) => a.address === s.selected)?.kind ?? 'other';
      trackEvent('caption_share_started', { address_kind: kind });
    }
  };
  const stop = async () => {
    const s = useCaptionShareStore.getState();
    if (s.startedAt !== null) trackEvent('caption_share_ended', { duration_ms: Date.now() - s.startedAt, peak_viewers: s.peakViewers });
    await controller.stop();
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      reportWarning('CaptionShare', `Copying the share address failed: ${describeCause(e)}`, { cause: e });
    }
  };

  const noViewers = status.running && startedAt !== null && !everConnected && now - startedAt >= NO_VIEWERS_WARNING_MS;

  if (!status.running) {
    return (
      <div className="caption-share-panel">
        <p className="caption-share-panel__intro">{t('captionShare.intro', 'Let people on the same network read the captions and translations here on their phones or computers.')}</p>
        <ToggleSwitch checked={false} onChange={() => void start()} label={t('captionShare.enable', 'Share captions')} disabled={busy} />
        {platform() === 'win32' && !firewallNoteSeen && (
          <p className="caption-share-panel__note">{t('captionShare.firewallNote', 'Windows may ask whether Sokuji can use the network. Choose Private networks.')}</p>
        )}
        {error && (
          <StatusMessage variant="error">
            {error.code === 'ports-busy'
              ? t('captionShare.errorPortsBusy', 'Could not start sharing: ports 7788–7797 are all in use.')
              : t('captionShare.errorListen', { reason: error.reason, defaultValue: 'Could not start sharing: {{reason}}' })}
          </StatusMessage>
        )}
      </div>
    );
  }

  return (
    <div className="caption-share-panel">
      <ToggleSwitch checked onChange={() => void stop()} label={t('captionShare.enable', 'Share captions')} disabled={busy} />
      <div className="caption-share-panel__main">
        {url && <QrCode value={url} size={128} label={url} />}
        <div className="caption-share-panel__facts">
          <div className="caption-share-panel__fact">
            <span className="caption-share-panel__label">{t('captionShare.address', 'Address')}</span>
            <div className="caption-share-panel__address">
              <code>{url}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy()}>
                {copied ? t('captionShare.copied', 'Copied') : t('captionShare.copy', 'Copy')}
              </Button>
            </div>
          </div>
          {status.addresses.length > 1 && (
            <div className="caption-share-panel__fact">
              <label className="caption-share-panel__label" htmlFor="caption-share-network">{t('captionShare.network', 'Network')}</label>
              <select
                id="caption-share-network"
                className="select-dropdown"
                value={status.selected ?? ''}
                onChange={(e) => void controller.selectAddress(e.target.value)}
              >
                {status.addresses.map((a, i) => (
                  <option key={a.address} value={a.address}>
                    {`${t(`captionShare.kinds.${a.kind}`, a.kind)} · ${a.address}`}
                    {i === 0 ? ` (${t('captionShare.recommended', 'recommended')})` : ''}
                    {i !== 0 && a.kind === 'virtual' ? ` (${t('captionShare.usuallyUnreachable', 'usually unreachable')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="caption-share-panel__fact">
            <span className="caption-share-panel__label">{t('captionShare.watching', 'Watching')}</span>
            <span className="caption-share-panel__count">{t('captionShare.watchingCount', { count: status.viewers, defaultValue: '{{count}} watching' })}</span>
          </div>
        </div>
      </div>
      <div className="caption-share-panel__options">
        <ToggleSwitch checked={allowSave} onChange={() => controller.setAllowSave(!allowSave)} label={t('captionShare.allowSave', 'Let viewers save these captions')} />
        <ToggleSwitch checked={wifiHint.enabled} onChange={() => controller.setWifiHint({ enabled: !wifiHint.enabled })} label={t('captionShare.wifiHint', 'Add a Wi‑Fi hint to the projector page')} />
        {wifiHint.enabled && (
          <div className="caption-share-panel__wifi">
            <label className="caption-share-panel__label" htmlFor="caption-share-wifi-name">{t('captionShare.wifiName', 'Wi‑Fi name')}</label>
            <FormInput
              id="caption-share-wifi-name"
              value={wifiHint.ssid}
              onChange={(e) => controller.setWifiHint({ ssid: e.target.value })}
              placeholder={t('captionShare.wifiNamePlaceholder', 'e.g. Meetup-Guest')}
            />
            <label className="caption-share-panel__label" htmlFor="caption-share-wifi-password">{t('captionShare.wifiPassword', 'Password (optional)')}</label>
            <FormInput
              id="caption-share-wifi-password"
              value={wifiHint.password}
              onChange={(e) => controller.setWifiHint({ password: e.target.value })}
            />
          </div>
        )}
      </div>
      {status.addressChanged && url && (
        <StatusMessage variant="warning">{t('captionShare.warnAddressChanged', { address: url, defaultValue: 'The network changed. The address is now {{address}}: send the link again or reopen the projector page.' })}</StatusMessage>
      )}
      {noViewers && <StatusMessage variant="warning">{t('captionShare.warnNoViewers', 'Two minutes in and no device has connected.')}</StatusMessage>}
      <div className="caption-share-panel__actions">
        <Button variant="secondary" size="sm" onClick={() => void controller.openPresent()}>{t('captionShare.openPresent', 'Open projector page')}</Button>
        <Button variant="ghost" size="sm" onClick={() => void stop()}>{t('captionShare.stop', 'Stop sharing')}</Button>
      </div>
      <p className="caption-share-panel__note">{t('captionShare.stopNote', "Viewers' pages will show that sharing has ended.")}</p>
    </div>
  );
};

export default CaptionSharePanel;
```

The Wi‑Fi password field is plain text on purpose: the host is about to project it.

```scss
// src/components/CaptionShare/CaptionSharePanel.scss
@use '../Settings/shared/variables' as vars;
@use '../../styles/tokens' as tk;

// Chrome copied from .display-settings-popover (DisplaySettingsPopover.scss),
// the toolbar's other popover, so the two read as one family.
.caption-share-panel {
  background: #1a1a1a;
  color: #e8e8e8;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  padding: 16px;
  width: 360px;
  box-sizing: border-box;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  max-height: var(--popover-max-height, 100vh);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: vars.$font-body;

  .toggle-switch-component { margin-top: 0; }

  &__intro,
  &__note {
    margin: 0;
    color: vars.$text-muted;
    font-size: vars.$font-caption;
    line-height: 1.5;
  }

  &__main {
    display: grid;
    grid-template-columns: 128px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  &__facts {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  &__label {
    display: block;
    font-size: vars.$font-caption;
    color: vars.$text-muted;
    margin-bottom: 4px;
  }

  &__address {
    display: flex;
    align-items: center;
    gap: 6px;

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
  }

  &__count {
    font-size: 18px;
    font-weight: vars.$weight-medium;
    font-variant-numeric: tabular-nums;
  }

  &__options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid vars.$border-subtle;
    padding-top: 10px;
  }

  &__wifi {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .qr-code { border-radius: 4px; }
}

.caption-share-btn {
  position: relative;

  &.active { color: tk.$color-primary; }

  &__count {
    margin-left: 3px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
}
```

```tsx
// src/components/CaptionShare/CaptionShareButton.tsx
/** The toolbar's caption-share button and its popover, wired like the ⚙ display-settings popover (PanelToolbar.tsx). */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cast } from 'lucide-react';
import {
  useFloating, autoUpdate, offset, flip, shift, size,
  useClick, useDismiss, useRole, useInteractions, FloatingPortal,
} from '@floating-ui/react';
import CaptionSharePanel from './CaptionSharePanel';
import { useCaptionShareStore } from '../../stores/captionShareStore';

const CaptionShareButton: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const running = useCaptionShareStore((s) => s.status.running);
  const viewers = useCaptionShareStore((s) => s.status.viewers);
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, { maxHeight: `${Math.max(0, availableHeight)}px` });
        },
      }),
    ],
  });
  const interactions = useInteractions([
    useClick(floating.context),
    useDismiss(floating.context),
    useRole(floating.context, { role: 'dialog' }),
  ]);
  const label = running
    ? t('captionShare.buttonActive', { count: viewers, defaultValue: 'Sharing captions: {{count}} watching' })
    : t('captionShare.button', 'Share captions');

  return (
    <>
      <button
        className={`font-size-btn caption-share-btn ${running ? 'active' : ''}`.trim()}
        ref={floating.refs.setReference}
        {...interactions.getReferenceProps()}
        title={label}
        aria-label={label}
        type="button"
      >
        <Cast size={14} />
        {running && <span className="caption-share-btn__count">{viewers}</span>}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={floating.refs.setFloating}
            style={floating.floatingStyles}
            aria-label={t('captionShare.button', 'Share captions')}
            {...interactions.getFloatingProps()}
          >
            <CaptionSharePanel />
          </div>
        </FloatingPortal>
      )}
    </>
  );
};

export default CaptionShareButton;
```

In `src/components/MainPanel/panel/PanelToolbar.tsx`, add the imports:

```tsx
import CaptionShareButton from '../../CaptionShare/CaptionShareButton';
import { isElectron } from '../../../utils/environment';
```

and render the button just before the ⚙ display-settings `<button className="font-size-btn" ref={displayPopoverFloating.refs.setReference} …>`:

```tsx
        {/* LAN caption sharing (spec 2026-10-04 §7.1): the desktop app only. */}
        {isElectron() && <CaptionShareButton />}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/CaptionShare src/components/MainPanel/panel src/locales src/lib/diagnostics`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/CaptionShare src/components/MainPanel/panel/PanelToolbar.tsx src/components/MainPanel/panel/PanelToolbar.test.tsx src/locales
git commit -m "feat(caption-share): toolbar button and host share panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Slice 2 ends here: report.**

---

### Task 10: Viewer core (pure)

**Files:**
- Create: `src/viewer/model.ts`, `src/viewer/text.ts`, `src/viewer/layout.ts`, `src/viewer/transcript.ts`, `src/viewer/prefs.ts`
- Test: `src/viewer/model.test.ts`, `src/viewer/text.test.ts`, `src/viewer/layout.test.ts`, `src/viewer/transcript.test.ts`, `src/viewer/prefs.test.ts`

**Interfaces:**
- Consumes: Task 7 types, `needsSpace` (`src/lib/projection/join.ts:19`), `formatLocalDateTime`/`formatLocalTime` (`src/utils/conversationExport.ts`), `T` (Task 3).
- Produces:
  - `model.ts`: `Connection`, `ViewerModel { connection; state: ShareState | null; entries: ViewerEntry[]; notice: ResetReason | null }`, `INITIAL_MODEL`, `ModelEvent = ViewerEvent | { type: 'open' } | { type: 'error' }`, `reduce(model, event)`, `ViewerStatus`, `statusOf(model)`, `legsOf(entries) → { speaker: boolean; participant: boolean }`.
  - `text.ts`: `Choice { code: string; both: boolean }`, `choiceOptions(pair) → Choice[]` (source, both, target), `defaultChoice(pair, languages)`, `validChoice(choice, pair)`, `sidesFor(entry, code) → { primary: ViewerRow[]; secondary: ViewerRow[] }`, `Piece { text; final; space }`, `piecesOf(rows, completeOnly)`, `piecesText(pieces)`.
  - `layout.ts`: `Layout = 'phone' | 'tablet' | 'desktop'`, `layoutFor(width)`, `SIZES`, `Size`, `THEMES`, `Theme`, `defaultSize(layout)`, `stepSize(size, delta)`, `atLiveEdge(scrollTop, clientHeight, scrollHeight)`.
  - `transcript.ts`: `transcriptText(entries, choice, t, now) → string`.
  - `prefs.ts`: `readPref(name, fallback, valid)`, `writePref(name, value)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/viewer/model.test.ts
import { describe, it, expect } from 'vitest';
import type { ShareState, ViewerEntry } from '../lib/share/types';
import { INITIAL_MODEL, legsOf, reduce, statusOf } from './model';

const STATE: ShareState = { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false };
const entry = (id: string, t: number, text = id, leg: 'speaker' | 'participant' = 'speaker'): ViewerEntry => ({
  id, leg, t, languages: { source: 'ja', target: 'zh-CN' }, source: [{ key: `${id}:0`, text, final: true }], translation: [],
});

describe('viewer model', () => {
  it('a snapshot after entries replaces them (a phone that slept and reconnected)', () => {
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: STATE, entries: [entry('a', 1), entry('b', 2)] });
    m = reduce(m, { type: 'error' });
    expect(statusOf(m)).toBe('reconnecting');
    m = reduce(m, { type: 'snapshot', state: STATE, entries: [entry('b', 2), entry('c', 3)] });
    expect(m.entries.map((e) => e.id)).toEqual(['b', 'c']);
    expect(statusOf(m)).toBe('live');
  });

  it('an upsert of a known id replaces it in place; new ones go in by time', () => {
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: STATE, entries: [entry('a', 1, 'partial'), entry('c', 3)] });
    m = reduce(m, { type: 'upsert', entries: [entry('a', 1, 'final'), entry('b', 2)] });
    expect(m.entries.map((e) => [e.id, e.source[0].text])).toEqual([['a', 'final'], ['b', 'b'], ['c', 'c']]);
  });

  it('removes, clears with a reason, and drops the reason when text comes back', () => {
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: STATE, entries: [entry('a', 1), entry('b', 2)] });
    m = reduce(m, { type: 'remove', ids: ['a'] });
    expect(m.entries.map((e) => e.id)).toEqual(['b']);
    m = reduce(m, { type: 'clear', reason: 'restart' });
    expect(m.entries).toEqual([]);
    expect(m.notice).toBe('restart');
    m = reduce(m, { type: 'upsert', entries: [entry('x', 9)] });
    expect(m.notice).toBeNull();
  });

  it('derives the status the page shows', () => {
    expect(statusOf(INITIAL_MODEL)).toBe('waiting');
    let m = reduce(INITIAL_MODEL, { type: 'snapshot', state: { ...STATE, phase: 'idle' }, entries: [] });
    expect(statusOf(m)).toBe('waiting');
    m = reduce(m, { type: 'upsert', entries: [entry('a', 1)] });
    expect(statusOf(m)).toBe('paused');
    m = reduce(m, { type: 'state', state: STATE });
    expect(statusOf(m)).toBe('live');
    m = reduce(m, { type: 'ended' });
    expect(statusOf(m)).toBe('ended');
    expect(statusOf(reduce(m, { type: 'error' }))).toBe('ended');
  });

  it('tells which legs are on the page', () => {
    expect(legsOf([entry('a', 1)])).toEqual({ speaker: true, participant: false });
    expect(legsOf([entry('a', 1), entry('b', 2, 'b', 'participant')])).toEqual({ speaker: true, participant: true });
  });
});
```

```ts
// src/viewer/text.test.ts
import { describe, it, expect } from 'vitest';
import type { ViewerEntry } from '../lib/share/types';
import { choiceOptions, defaultChoice, piecesOf, piecesText, sidesFor, validChoice } from './text';

const PAIR = { source: 'ja', target: 'zh-CN' };
const speaker: ViewerEntry = {
  id: 's', leg: 'speaker', t: 1, languages: { source: 'ja', target: 'zh-CN' },
  source: [{ key: 'r:speaker:1:0', text: 'こんにちは', final: true }],
  translation: [{ key: 'r:speaker:2:0', text: '你好', final: true }],
};
const participant: ViewerEntry = {
  id: 'p', leg: 'participant', t: 2, languages: { source: 'zh-CN', target: 'ja' },
  source: [{ key: 'r:participant:1:0', text: '谢谢', final: true }],
  translation: [{ key: 'r:participant:2:0', text: 'ありがとう', final: false }],
};

describe('choices', () => {
  it('offers source, both, target', () => {
    expect(choiceOptions(PAIR)).toEqual([
      { code: 'ja', both: false }, { code: 'zh-CN', both: true }, { code: 'zh-CN', both: false },
    ]);
  });

  it('defaults to the browser language when it is one side, both otherwise', () => {
    expect(defaultChoice(PAIR, ['zh-TW', 'en'])).toEqual({ code: 'zh-CN', both: false });
    expect(defaultChoice(PAIR, ['ja-JP'])).toEqual({ code: 'ja', both: false });
    expect(defaultChoice(PAIR, ['fr'])).toEqual({ code: 'zh-CN', both: true });
  });

  it('falls back to both, target first, when the pair changed under the choice', () => {
    expect(validChoice({ code: 'ja', both: false }, PAIR)).toEqual({ code: 'ja', both: false });
    expect(validChoice({ code: 'ko', both: false }, PAIR)).toEqual({ code: 'zh-CN', both: true });
  });
});

describe('sidesFor', () => {
  it('picks by language, not by role', () => {
    expect(sidesFor(speaker, 'zh-CN').primary[0].text).toBe('你好');
    expect(sidesFor(participant, 'zh-CN').primary[0].text).toBe('谢谢');
    expect(sidesFor(participant, 'zh-CN').secondary[0].text).toBe('ありがとう');
    expect(sidesFor(speaker, 'ja').primary[0].text).toBe('こんにちは');
  });

  it('reads an auto-detected source as the other side of the target', () => {
    const auto = { ...speaker, languages: { source: 'auto', target: 'zh-CN' } };
    expect(sidesFor(auto, 'auto').primary[0].text).toBe('こんにちは');
  });
});

describe('pieces', () => {
  it('tiles rows of one segment, spaces Latin segments, keeps CJK tight, and can hide unfinished text', () => {
    const rows = [
      { key: 'r:s:1:0', text: 'Hello ', final: true },
      { key: 'r:s:1:1', text: 'there.', final: true },
      { key: 'r:s:2:0', text: 'Next', final: false },
    ];
    expect(piecesText(piecesOf(rows, false))).toBe('Hello there. Next');
    expect(piecesOf(rows, false).map((p) => p.final)).toEqual([true, false]);
    expect(piecesText(piecesOf(rows, true))).toBe('Hello there.');
    expect(piecesText(piecesOf([{ key: 'a:1:0', text: '你好', final: true }, { key: 'a:2:0', text: '世界', final: true }], false))).toBe('你好世界');
  });
});
```

```ts
// src/viewer/layout.test.ts
import { describe, it, expect } from 'vitest';
import { atLiveEdge, defaultSize, layoutFor, stepSize } from './layout';

describe('layout', () => {
  it('picks the layout by width', () => {
    expect(layoutFor(390)).toBe('phone');
    expect(layoutFor(599)).toBe('phone');
    expect(layoutFor(600)).toBe('tablet');
    expect(layoutFor(999)).toBe('tablet');
    expect(layoutFor(1000)).toBe('desktop');
  });

  it('defaults to large text on phones and medium elsewhere, and steps within range', () => {
    expect(defaultSize('phone')).toBe('large');
    expect(defaultSize('desktop')).toBe('medium');
    expect(stepSize('large', 1)).toBe('xlarge');
    expect(stepSize('xlarge', 1)).toBe('xlarge');
    expect(stepSize('small', -1)).toBe('small');
  });

  it('counts within 48px of the bottom as the live edge', () => {
    expect(atLiveEdge(950, 500, 1490)).toBe(true);
    expect(atLiveEdge(900, 500, 1490)).toBe(false);
  });
});
```

```ts
// src/viewer/transcript.test.ts
import { describe, it, expect } from 'vitest';
import type { ViewerEntry } from '../lib/share/types';
import { makeT } from './strings';
import { transcriptText } from './transcript';

const t = makeT({ transcript: { header: 'Saved {{time}}' } }, undefined);
const at = new Date(2026, 9, 4, 19, 12, 5).getTime();
const e = (id: string, src: string, tr: string): ViewerEntry => ({
  id, leg: 'speaker', t: at, languages: { source: 'ja', target: 'zh-CN' },
  source: [{ key: `${id}:1:0`, text: src, final: true }], translation: [{ key: `${id}:2:0`, text: tr, final: true }],
});

describe('transcriptText', () => {
  it('writes a header, then a time and the chosen language per entry, the other line when both', () => {
    const text = transcriptText([e('a', '今日は', '今天'), e('b', '', '')], { code: 'zh-CN', both: true }, t, at);
    expect(text).toBe('Saved 2026-10-04 19:12:05\n\n[19:12:05]\n今天\n今日は\n');
  });

  it('one language only', () => {
    expect(transcriptText([e('a', '今日は', '今天')], { code: 'ja', both: false }, t, at)).toBe('Saved 2026-10-04 19:12:05\n\n[19:12:05]\n今日は\n');
  });
});
```

```ts
// src/viewer/prefs.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readPref, writePref } from './prefs';

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

beforeEach(() => window.localStorage.clear());

describe('viewer prefs', () => {
  it('round-trips under sokuji.viewer.* and ignores bad values', () => {
    writePref('completeOnly', true);
    expect(window.localStorage.getItem('sokuji.viewer.completeOnly')).toBe('true');
    expect(readPref('completeOnly', false, isBool)).toBe(true);
    window.localStorage.setItem('sokuji.viewer.completeOnly', '"yes"');
    expect(readPref('completeOnly', false, isBool)).toBe(false);
  });

  it('works when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readPref('completeOnly', false, isBool)).toBe(false);
    expect(() => writePref('completeOnly', true)).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/viewer`
Expected: FAIL for the five new files (modules not found); `strings.test.ts` still passes.

- [ ] **Step 3: Write the implementation**

```ts
// src/viewer/model.ts
/** The viewer page's state over the share stream (spec 2026-10-04 §4.4, §5.5). */
import type { ResetReason, ShareState, ViewerEntry, ViewerEvent } from '../lib/share/types';

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'ended';

export interface ViewerModel {
  connection: Connection;
  state: ShareState | null;
  entries: ViewerEntry[];
  notice: ResetReason | null;
}

export const INITIAL_MODEL: ViewerModel = { connection: 'connecting', state: null, entries: [], notice: null };

export type ModelEvent = ViewerEvent | { type: 'open' } | { type: 'error' };

const byTime = (list: ViewerEntry[]) => list.slice().sort((a, b) => a.t - b.t);

export function reduce(model: ViewerModel, event: ModelEvent): ViewerModel {
  if (model.connection === 'ended') return model;
  switch (event.type) {
    case 'open':
      return { ...model, connection: 'open' };
    case 'error':
      return { ...model, connection: 'reconnecting' };
    case 'snapshot':
      return { connection: 'open', state: event.state, entries: byTime(event.entries), notice: null };
    case 'upsert': {
      const next = new Map(model.entries.map((e) => [e.id, e] as const));
      for (const e of event.entries) next.set(e.id, e);
      return { ...model, entries: byTime([...next.values()]), notice: event.entries.length > 0 ? null : model.notice };
    }
    case 'remove': {
      const gone = new Set(event.ids);
      return { ...model, entries: model.entries.filter((e) => !gone.has(e.id)) };
    }
    case 'clear':
      return { ...model, entries: [], notice: event.reason };
    case 'state':
      return { ...model, state: event.state };
    case 'ended':
      return { ...model, connection: 'ended' };
  }
}

export type ViewerStatus = 'waiting' | 'live' | 'paused' | 'reconnecting' | 'ended';

export function statusOf(model: ViewerModel): ViewerStatus {
  if (model.connection === 'ended') return 'ended';
  if (model.connection === 'reconnecting') return 'reconnecting';
  if (!model.state) return 'waiting';
  if (model.state.phase === 'live') return 'live';
  return model.entries.length > 0 ? 'paused' : 'waiting';
}

export function legsOf(entries: readonly ViewerEntry[]): { speaker: boolean; participant: boolean } {
  return { speaker: entries.some((e) => e.leg === 'speaker'), participant: entries.some((e) => e.leg === 'participant') };
}
```

```ts
// src/viewer/text.ts
/**
 * What a viewer reads of an entry (spec 2026-10-04 §5.2, decision 5): the
 * choice is a language, not a role, so "Chinese" is the translation of the
 * host's line and the original of the other side's.
 */
import { needsSpace } from '../lib/projection/join';
import type { ShareState, ViewerEntry, ViewerRow } from '../lib/share/types';

export interface Choice { code: string; both: boolean }
type Pair = ShareState['pair'];

/** Entering: the source language, both, the target language. */
export function choiceOptions(pair: Pair): Choice[] {
  return [{ code: pair.source, both: false }, { code: pair.target, both: true }, { code: pair.target, both: false }];
}

const base = (tag: string) => tag.toLowerCase().split('-')[0];

export function defaultChoice(pair: Pair, languages: readonly string[]): Choice {
  for (const lang of languages) {
    if (base(lang) === base(pair.target)) return { code: pair.target, both: false };
    if (base(lang) === base(pair.source)) return { code: pair.source, both: false };
  }
  return { code: pair.target, both: true };
}

export function validChoice(choice: Choice, pair: Pair): Choice {
  return choice.code === pair.source || choice.code === pair.target ? choice : { code: pair.target, both: true };
}

/** The entry's rows in the chosen language first. A target match reads the translation; anything else the source (an auto-detected source included). */
export function sidesFor(entry: ViewerEntry, code: string): { primary: ViewerRow[]; secondary: ViewerRow[] } {
  return entry.languages.target === code
    ? { primary: entry.translation, secondary: entry.source }
    : { primary: entry.source, secondary: entry.translation };
}

export interface Piece { text: string; final: boolean; space: boolean }

/** Rows as display pieces: rows of a segment tile its text; between segments a space only where `needsSpace` says. */
export function piecesOf(rows: readonly ViewerRow[], completeOnly: boolean): Piece[] {
  const segments: Array<{ id: string; text: string; final: boolean }> = [];
  for (const row of rows) {
    if (completeOnly && !row.final) continue;
    const id = row.key.slice(0, row.key.lastIndexOf(':'));
    const last = segments[segments.length - 1];
    if (last && last.id === id) last.text += row.text;
    else segments.push({ id, text: row.text, final: row.final });
  }
  const pieces: Piece[] = [];
  let joined = '';
  for (const seg of segments) {
    const text = seg.text.trim();
    if (text === '') continue;
    const space = needsSpace(joined, text);
    joined += (space ? ' ' : '') + text;
    pieces.push({ text, final: seg.final, space });
  }
  return pieces;
}

export function piecesText(pieces: readonly Piece[]): string {
  return pieces.map((p) => (p.space ? ' ' : '') + p.text).join('');
}
```

```ts
// src/viewer/layout.ts
/** Layout by width, text sizes and colour schemes (spec 2026-10-04 §5.3, §5.4). */
export type Layout = 'phone' | 'tablet' | 'desktop';
export const SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type Size = (typeof SIZES)[number];
export const THEMES = ['dark', 'light', 'contrast'] as const;
export type Theme = (typeof THEMES)[number];

export function layoutFor(width: number): Layout {
  if (width < 600) return 'phone';
  return width < 1000 ? 'tablet' : 'desktop';
}

export function defaultSize(layout: Layout): Size {
  return layout === 'phone' ? 'large' : 'medium';
}

export function stepSize(size: Size, delta: 1 | -1): Size {
  const i = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(size) + delta));
  return SIZES[i];
}

/** Within 48px of the bottom counts as following the live edge. */
export function atLiveEdge(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= 48;
}
```

```ts
// src/viewer/transcript.ts
/** The .txt a viewer saves when the host allows it (spec 2026-10-04 §5.4). */
import type { ViewerEntry } from '../lib/share/types';
import { formatLocalDateTime, formatLocalTime } from '../utils/conversationExport';
import type { T } from './strings';
import { piecesOf, piecesText, sidesFor, type Choice } from './text';

export function transcriptText(entries: readonly ViewerEntry[], choice: Choice, t: T, now: number): string {
  const lines = [t('viewer.transcript.header', { time: formatLocalDateTime(now) }), ''];
  for (const entry of entries) {
    const { primary, secondary } = sidesFor(entry, choice.code);
    const first = piecesText(piecesOf(primary, false));
    const second = choice.both ? piecesText(piecesOf(secondary, false)) : '';
    if (first === '' && second === '') continue;
    lines.push(`[${formatLocalTime(entry.t)}]`);
    if (first) lines.push(first);
    if (second) lines.push(second);
    lines.push('');
  }
  return lines.join('\n');
}
```

The transcript test's `makeT` is given the subtree words (`{ transcript: … }`) and the full key `viewer.transcript.header`; `makeT` strips the `viewer.` prefix, so it resolves.

```ts
// src/viewer/prefs.ts
/** The viewer's own preferences, on its own device; the page works without storage (private mode, blocked storage). */
const PREFIX = 'sokuji.viewer.';

export function readPref<T>(name: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + name);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(name: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Storage unavailable: the preference lasts until the page closes.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/viewer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/model.ts src/viewer/text.ts src/viewer/layout.ts src/viewer/transcript.ts src/viewer/prefs.ts src/viewer/*.test.ts
git commit -m "feat(viewer): stream model, language choice, layout and transcript

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Viewer page UI

**Files:**
- Create: `src/viewer/useViewerStream.ts`, `src/viewer/keepAwake.ts`, `src/viewer/Segmented.tsx`, `src/viewer/EntryScreen.tsx`, `src/viewer/CaptionList.tsx`, `src/viewer/ViewerBar.tsx`, `src/viewer/SettingsPanel.tsx`, `src/viewer/ViewerApp.tsx`, `src/viewer/viewer.scss`
- Modify: `src/viewer/main.tsx` (route by path)
- Test: `src/viewer/ViewerApp.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 7, 10; `ToggleSwitch`, `Button` (`src/components/Settings/shared/`); `languageLabel` (`src/lib/language/label.ts`); `downloadFile`, `exportFilename` (`src/utils/conversationExport.ts`).
- Produces: `useViewerStream(url?) → ViewerModel`, `keepAwake(on) → Promise<boolean>`, `ViewerApp` (default export). `main.tsx` lazily loads `PresentApp` (Task 12) on `/present`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/viewer/ViewerApp.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ViewerModel } from './model';
import type { ViewerEntry } from '../lib/share/types';

const model = vi.hoisted(() => ({ current: null as unknown as ViewerModel }));
vi.mock('./useViewerStream', () => ({ useViewerStream: () => model.current }));
vi.mock('./keepAwake', () => ({ keepAwake: vi.fn(async () => true) }));
vi.mock('../utils/conversationExport', async (orig) => ({ ...(await orig<typeof import('../utils/conversationExport')>()), downloadFile: vi.fn() }));
import { downloadFile } from '../utils/conversationExport';
import ViewerApp from './ViewerApp';

const entry = (id: string, leg: 'speaker' | 'participant', src: string, tr: string, t = 1): ViewerEntry => ({
  id, leg, t, languages: leg === 'speaker' ? { source: 'ja', target: 'zh-CN' } : { source: 'zh-CN', target: 'ja' },
  source: [{ key: `${id}:1:0`, text: src, final: true }], translation: [{ key: `${id}:2:0`, text: tr, final: true }],
});
const live = (over: Partial<ViewerModel> = {}): ViewerModel => ({
  connection: 'open',
  state: { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false },
  entries: [entry('a', 'speaker', '今日は', '今天')],
  notice: null,
  ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  model.current = live();
});
afterEach(cleanup);

const enter = () => fireEvent.click(screen.getByRole('button', { name: 'Start reading' }));

describe('ViewerApp', () => {
  it('enters with source, both and target to choose from, in that order', () => {
    render(<ViewerApp />);
    const options = [...document.querySelectorAll('.viewer-option')];
    expect(options.map((b) => b.textContent)).toEqual(['Japanese', expect.stringContaining('Both languages'), 'Chinese (China)']);
    enter();
    expect(screen.getByText('今天')).toBeTruthy();
  });

  it('shows no save action unless the host allows it', () => {
    render(<ViewerApp />);
    enter();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByText('Save these captions')).toBeNull();
    cleanup();
    model.current = live({ state: { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: true } });
    render(<ViewerApp />);
    enter();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(downloadFile).toHaveBeenCalled();
  });

  it('shows the legend only once both sides have spoken', () => {
    render(<ViewerApp />);
    enter();
    expect(screen.queryByText('On site')).toBeNull();
    cleanup();
    model.current = live({ entries: [entry('a', 'speaker', '今日は', '今天'), entry('b', 'participant', '谢谢', 'ありがとう', 2)] });
    render(<ViewerApp />);
    enter();
    expect(screen.getByText('On site')).toBeTruthy();
    expect(screen.getByText('Remote')).toBeTruthy();
  });

  it('reads each side in the chosen language', () => {
    model.current = live({ entries: [entry('a', 'speaker', '今日は', '今天'), entry('b', 'participant', '谢谢', 'ありがとう', 2)] });
    render(<ViewerApp />);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Chinese (China)')!);
    enter();
    expect(screen.getByText('今天')).toBeTruthy();
    expect(screen.getByText('谢谢')).toBeTruthy();
    expect(screen.queryByText('ありがとう')).toBeNull();
  });

  it('names each state, and the reason the list emptied', () => {
    model.current = live({ connection: 'reconnecting' });
    const { rerender } = render(<ViewerApp />);
    enter();
    expect(screen.getAllByText('Reconnecting…').length).toBeGreaterThan(0);
    model.current = live({ entries: [], notice: 'restart' });
    rerender(<ViewerApp />);
    expect(screen.getByText('The speaker started a new round')).toBeTruthy();
    model.current = live({ connection: 'ended' });
    rerender(<ViewerApp />);
    expect(screen.getAllByText('Sharing has ended').length).toBeGreaterThan(0);
    expect(document.title).toContain('Sharing has ended');
  });

  it('falls back to both languages when the pair changes under the choice', () => {
    render(<ViewerApp />);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Japanese')!);
    enter();
    expect(screen.queryByText('今天')).toBeNull();
    model.current = live({ state: { phase: 'live', pair: { source: 'ko', target: 'zh-CN' }, allowSave: false } });
    act(() => { fireEvent(window, new Event('resize')); });
    cleanup();
    render(<ViewerApp />);
    enter();
    expect(screen.getByText('今天')).toBeTruthy();
  });
});
```

The last test re-renders a fresh page after the pair change; the choice stored in `localStorage` (`ja`) is no longer in the pair, so `validChoice` gives "both, target first" and the Chinese line shows.



- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/viewer/ViewerApp.test.tsx`
Expected: FAIL (`./ViewerApp` not found).

- [ ] **Step 3: Write the stream hook, keep-awake and the segmented control**

```ts
// src/viewer/useViewerStream.ts
import { useEffect, useReducer } from 'react';
import { INITIAL_MODEL, reduce, type ViewerModel } from './model';

const EVENTS = ['snapshot', 'upsert', 'remove', 'clear', 'state'] as const;

/** The share stream as a model. EventSource reconnects by itself; `ended` closes it for good. */
export function useViewerStream(url = '/events'): ViewerModel {
  const [model, dispatch] = useReducer(reduce, INITIAL_MODEL);
  useEffect(() => {
    const source = new EventSource(url);
    source.onopen = () => dispatch({ type: 'open' });
    source.onerror = () => dispatch({ type: 'error' });
    for (const type of EVENTS) {
      source.addEventListener(type, (event) => {
        try {
          dispatch({ type, ...JSON.parse((event as MessageEvent<string>).data) });
        } catch {
          // A frame that does not parse is skipped; the next snapshot re-syncs the page.
        }
      });
    }
    source.addEventListener('ended', () => {
      dispatch({ type: 'ended' });
      source.close();
    });
    return () => source.close();
  }, [url]);
  return model;
}
```

```ts
// src/viewer/keepAwake.ts
/**
 * Keeping the screen on (spec 2026-10-04 §5.6). The page is plain HTTP, so
 * the Wake Lock API is unavailable; nosleep.js then plays a tiny muted,
 * looping inline video. `enable()` must run inside a tap.
 */
import NoSleep from 'nosleep.js';

let instance: NoSleep | null = null;

export async function keepAwake(on: boolean): Promise<boolean> {
  try {
    instance ??= new NoSleep();
    if (on) await instance.enable();
    else instance.disable();
    return true;
  } catch {
    return false;
  }
}
```

```tsx
// src/viewer/Segmented.tsx
/** The app's segmented control (ModePicker.scss archetype), for the viewer's 2–4-way choices. */
import React from 'react';

interface SegmentedProps<V extends string> {
  label: string;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange(value: V): void;
}

export default function Segmented<V extends string>({ label, options, value, onChange }: SegmentedProps<V>): React.ReactElement {
  return (
    <div className="viewer-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`viewer-segmented__option ${o.value === value ? 'active' : ''}`.trim()}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write the page components**

```tsx
// src/viewer/EntryScreen.tsx
import React from 'react';
import Button from '../components/Settings/shared/Button';
import type { ShareState } from '../lib/share/types';
import type { T } from './strings';
import { choiceOptions, type Choice } from './text';

interface EntryScreenProps {
  t: T;
  name(code: string): string;
  pair: ShareState['pair'] | null;
  choice: Choice;
  onChoose(choice: Choice): void;
  onStart(): void;
}

const same = (a: Choice, b: Choice) => a.code === b.code && a.both === b.both;

const EntryScreen: React.FC<EntryScreenProps> = ({ t, name, pair, choice, onChoose, onStart }) => (
  <main className="viewer-enter">
    <h1 className="viewer-enter__title">{t('viewer.title')}</h1>
    {pair ? (
      <>
        <p className="viewer-enter__pair">{`${name(pair.source)} ⇄ ${name(pair.target)}`}</p>
        <fieldset className="viewer-enter__choices">
          <legend>{t('viewer.enter.iRead')}</legend>
          {choiceOptions(pair).map((option) => {
            const selected = option.both ? choice.both : same(option, choice);
            const other = option.both ? (choice.code === pair.source ? pair.target : pair.source) : '';
            const first = option.both ? (choice.code === pair.source ? pair.source : pair.target) : '';
            return (
              <button
                key={`${option.code}:${option.both}`}
                type="button"
                className={`viewer-option ${selected ? 'selected' : ''}`.trim()}
                aria-pressed={selected}
                onClick={() => onChoose(option.both ? { code: first, both: true } : option)}
              >
                <b>{option.both ? t('viewer.enter.both') : name(option.code)}</b>
                {option.both && <span>{t('viewer.enter.bothHint', { first: name(first), second: name(other) })}</span>}
              </button>
            );
          })}
        </fieldset>
      </>
    ) : (
      <p className="viewer-enter__pair">{t('viewer.connecting')}</p>
    )}
    <Button variant="primary" onClick={onStart} disabled={!pair}>{t('viewer.enter.start')}</Button>
    <p className="viewer-enter__note">{t('viewer.enter.insecureNote')}</p>
  </main>
);

export default EntryScreen;
```

```tsx
// src/viewer/CaptionList.tsx
import React, { useLayoutEffect, useRef } from 'react';
import type { ResetReason, ViewerEntry } from '../lib/share/types';
import { formatLocalTime } from '../utils/conversationExport';
import type { Layout } from './layout';
import { atLiveEdge } from './layout';
import type { T } from './strings';
import { piecesOf, sidesFor, type Choice, type Piece } from './text';

interface CaptionListProps {
  t: T;
  entries: readonly ViewerEntry[];
  choice: Choice;
  completeOnly: boolean;
  layout: Layout;
  notice: ResetReason | null;
  emptyText: string;
  following: boolean;
  onFollowingChange(following: boolean): void;
}

const NOTICE_KEYS: Record<ResetReason, string> = { clear: 'viewer.notice.cleared', restart: 'viewer.notice.restarted' };

const Pieces: React.FC<{ pieces: Piece[] }> = ({ pieces }) => (
  <>
    {pieces.map((p, i) => (
      <React.Fragment key={i}>
        {p.space ? ' ' : ''}
        <span className={p.final ? undefined : 'viewer-partial'}>{p.text}</span>
      </React.Fragment>
    ))}
  </>
);

const CaptionList: React.FC<CaptionListProps> = ({ t, entries, choice, completeOnly, layout, notice, emptyText, following, onFollowingChange }) => {
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [entries, following, choice, completeOnly]);

  const onScroll = () => {
    const el = list.current;
    if (el) onFollowingChange(atLiveEdge(el.scrollTop, el.clientHeight, el.scrollHeight));
  };

  const rows = entries.flatMap((entry) => {
    const { primary, secondary } = sidesFor(entry, choice.code);
    const first = piecesOf(primary, completeOnly);
    const second = choice.both ? piecesOf(secondary, completeOnly) : [];
    if (first.length === 0 && second.length === 0) return [];
    return [(
      <article key={entry.id} className={`viewer-entry viewer-entry--${entry.leg}`}>
        {layout === 'desktop' && <time className="viewer-entry__time">{formatLocalTime(entry.t).slice(0, 5)}</time>}
        {first.length > 0 && <p className="viewer-entry__primary"><Pieces pieces={first} /></p>}
        {second.length > 0 && <p className="viewer-entry__secondary"><Pieces pieces={second} /></p>}
      </article>
    )];
  });

  return (
    <div className="viewer-list-wrap">
      <div className="viewer-list" ref={list} onScroll={onScroll}>
        {notice && <p className="viewer-list__notice">{t(NOTICE_KEYS[notice])}</p>}
        {rows.length === 0 && !notice && <p className="viewer-list__empty">{emptyText}</p>}
        {rows}
      </div>
      {!following && (
        <button type="button" className="viewer-jump" onClick={() => onFollowingChange(true)}>
          {`${t('viewer.backToLive')} ↓`}
        </button>
      )}
    </div>
  );
};

export default CaptionList;
```

```tsx
// src/viewer/ViewerBar.tsx
/** The top bar on tablets and desktops; on phones, the status line and the bottom dock. */
import React from 'react';
import type { ViewerStatus } from './model';
import type { T } from './strings';

export const STATUS_KEYS: Record<ViewerStatus, string> = {
  waiting: 'viewer.status.waiting',
  live: 'viewer.status.live',
  paused: 'viewer.status.paused',
  reconnecting: 'viewer.status.reconnecting',
  ended: 'viewer.status.ended',
};

export const StatusText: React.FC<{ t: T; status: ViewerStatus }> = ({ t, status }) => (
  <span className={`viewer-status viewer-status--${status}`}>
    <i aria-hidden="true" />
    {t(STATUS_KEYS[status])}
  </span>
);

export const Legend: React.FC<{ t: T }> = ({ t }) => (
  <span className="viewer-legend">
    <span className="viewer-legend__item viewer-legend__item--speaker">{t('viewer.legend.onSite')}</span>
    <span className="viewer-legend__item viewer-legend__item--participant">{t('viewer.legend.remote')}</span>
  </span>
);

interface TopBarProps {
  t: T;
  status: ViewerStatus;
  legend: boolean;
  choice: React.ReactNode;
  onSmaller(): void;
  onLarger(): void;
  onMore(): void;
}

export const TopBar: React.FC<TopBarProps> = ({ t, status, legend, choice, onSmaller, onLarger, onMore }) => (
  <header className="viewer-bar">
    <StatusText t={t} status={status} />
    <span className="viewer-bar__title">{t('viewer.title')}</span>
    {legend && <Legend t={t} />}
    <span className="viewer-bar__grow" />
    {choice}
    <button type="button" className="viewer-icon-btn" aria-label={`${t('viewer.dock.textSize')} −`} onClick={onSmaller}>A−</button>
    <button type="button" className="viewer-icon-btn" aria-label={`${t('viewer.dock.textSize')} +`} onClick={onLarger}>A+</button>
    <button type="button" className="viewer-icon-btn" aria-label={t('viewer.dock.more')} onClick={onMore}>⋯</button>
  </header>
);

interface DockProps { t: T; onView(): void; onTextSize(): void; onMore(): void }

export const Dock: React.FC<DockProps> = ({ t, onView, onTextSize, onMore }) => (
  <nav className="viewer-dock">
    <button type="button" onClick={onView}><b aria-hidden="true">文A</b><span>{t('viewer.dock.view')}</span></button>
    <button type="button" onClick={onTextSize}><b aria-hidden="true">Aa</b><span>{t('viewer.dock.textSize')}</span></button>
    <button type="button" onClick={onMore} aria-label={t('viewer.dock.more')}><b aria-hidden="true">⋯</b><span>{t('viewer.dock.more')}</span></button>
  </nav>
);
```

```tsx
// src/viewer/SettingsPanel.tsx
import React from 'react';
import Button from '../components/Settings/shared/Button';
import ToggleSwitch from '../components/Settings/shared/ToggleSwitch';
import type { Layout, Size, Theme } from './layout';
import { SIZES, THEMES } from './layout';
import Segmented from './Segmented';
import type { T } from './strings';

const SIZE_KEYS: Record<Size, string> = {
  small: 'viewer.settings.sizes.small',
  medium: 'viewer.settings.sizes.medium',
  large: 'viewer.settings.sizes.large',
  xlarge: 'viewer.settings.sizes.xlarge',
};
const THEME_KEYS: Record<Theme, string> = {
  dark: 'viewer.settings.themes.dark',
  light: 'viewer.settings.themes.light',
  contrast: 'viewer.settings.themes.contrast',
};

interface SettingsPanelProps {
  t: T;
  layout: Layout;
  choiceControl: React.ReactNode;
  size: Size;
  onSize(size: Size): void;
  theme: Theme;
  onTheme(theme: Theme): void;
  completeOnly: boolean;
  onCompleteOnly(on: boolean): void;
  awake: boolean;
  onAwake(on: boolean): void;
  allowSave: boolean;
  onSave(): void;
  onClose(): void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = (p) => (
  <>
    {p.layout === 'phone' && <div className="viewer-backdrop" onClick={p.onClose} />}
    <section className={`viewer-settings viewer-settings--${p.layout === 'phone' ? 'sheet' : 'menu'}`} role="dialog" aria-label={p.t('viewer.settings.title')}>
      <div className="viewer-settings__head">
        <h2>{p.t('viewer.settings.title')}</h2>
        <Button variant="ghost" size="sm" onClick={p.onClose}>{p.t('viewer.settings.close')}</Button>
      </div>
      {p.layout === 'phone' && (
        <div className="viewer-settings__field"><span>{p.t('viewer.settings.iRead')}</span>{p.choiceControl}</div>
      )}
      <div className="viewer-settings__field">
        <span>{p.t('viewer.settings.textSize')}</span>
        <Segmented label={p.t('viewer.settings.textSize')} value={p.size} onChange={p.onSize}
          options={SIZES.map((s) => ({ value: s, label: p.t(SIZE_KEYS[s]) }))} />
      </div>
      <div className="viewer-settings__field">
        <span>{p.t('viewer.settings.theme')}</span>
        <Segmented label={p.t('viewer.settings.theme')} value={p.theme} onChange={p.onTheme}
          options={THEMES.map((s) => ({ value: s, label: p.t(THEME_KEYS[s]) }))} />
      </div>
      <ToggleSwitch checked={p.completeOnly} onChange={() => p.onCompleteOnly(!p.completeOnly)}
        label={p.t('viewer.settings.completeOnly')} tooltip={p.t('viewer.settings.completeOnlyHint')} />
      <ToggleSwitch checked={p.awake} onChange={() => p.onAwake(!p.awake)} label={p.t('viewer.settings.keepAwake')} />
      {p.allowSave && (
        <div className="viewer-settings__save">
          <div><b>{p.t('viewer.settings.save')}</b><span>{p.t('viewer.settings.saveHint')}</span></div>
          <Button variant="secondary" size="sm" onClick={p.onSave}>{p.t('viewer.settings.saveButton')}</Button>
        </div>
      )}
      <p className="viewer-settings__note">{p.t('viewer.settings.aiNote')}</p>
    </section>
  </>
);

export default SettingsPanel;
```

```tsx
// src/viewer/ViewerApp.tsx
/**
 * The LAN caption viewer (spec 2026-10-04 §5): entering, the captions, the
 * layout by width, settings, and the states over the share stream.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { languageLabel } from '../lib/language/label';
import { downloadFile, exportFilename } from '../utils/conversationExport';
import CaptionList from './CaptionList';
import EntryScreen from './EntryScreen';
import { keepAwake } from './keepAwake';
import { defaultSize, layoutFor, SIZES, stepSize, THEMES, type Size, type Theme } from './layout';
import { legsOf, statusOf } from './model';
import { readPref, writePref } from './prefs';
import Segmented from './Segmented';
import SettingsPanel from './SettingsPanel';
import { viewerT } from './strings';
import { defaultChoice, validChoice, type Choice } from './text';
import { transcriptText } from './transcript';
import { useViewerStream } from './useViewerStream';
import { Dock, Legend, STATUS_KEYS, StatusText, TopBar } from './ViewerBar';
import './viewer.scss';

const isSize = (v: unknown): v is Size => typeof v === 'string' && (SIZES as readonly string[]).includes(v);
const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isChoice = (v: unknown): v is Choice =>
  typeof v === 'object' && v !== null && typeof (v as Choice).code === 'string' && typeof (v as Choice).both === 'boolean';

const languages = (): readonly string[] => (navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]);

const ViewerApp: React.FC = () => {
  const { t, catalog } = useMemo(() => viewerT(languages()), []);
  const model = useViewerStream();
  const status = statusOf(model);
  const pair = model.state?.pair ?? null;
  const [width, setWidth] = useState(() => window.innerWidth);
  const layout = layoutFor(width);
  const [entered, setEntered] = useState(false);
  const [stored, setStored] = useState<Choice | null>(() => readPref('choice', null as Choice | null, (v): v is Choice | null => v === null || isChoice(v)));
  const [size, setSize] = useState<Size>(() => readPref('size', defaultSize(layoutFor(window.innerWidth)), isSize));
  const [theme, setTheme] = useState<Theme>(() => readPref('theme', 'dark', isTheme));
  const [completeOnly, setCompleteOnly] = useState(() => readPref('completeOnly', false, isBool));
  const [awake, setAwake] = useState(() => readPref('keepAwake', true, isBool));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const name = useCallback((code: string) => languageLabel(code, catalog, t('viewer.original')), [catalog, t]);
  const choice: Choice = pair ? validChoice(stored ?? defaultChoice(pair, languages()), pair) : { code: '', both: true };
  const choose = (next: Choice) => { setStored(next); writePref('choice', next); };
  const changeSize = (next: Size) => { setSize(next); writePref('size', next); };

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    const onFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  useEffect(() => {
    document.title = `${status === 'live' ? '● ' : ''}${t(STATUS_KEYS[status])} · ${t('viewer.title')}`;
  }, [status, t]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Not every browser lets a page go full screen (iPhone Safari): nothing to do.
    }
  }, []);

  useEffect(() => {
    if (!entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') changeSize(stepSize(size, 1));
      else if (e.key === '-') changeSize(stepSize(size, -1));
      else if (e.key === 'b' || e.key === 'B') choose({ ...choice, both: !choice.both });
      else if (e.key === 'f' || e.key === 'F') void toggleFullscreen();
      else if (e.key === 'End') setFollowing(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const start = () => {
    setEntered(true);
    if (awake) void keepAwake(true);
  };
  const changeAwake = (on: boolean) => {
    setAwake(on);
    writePref('keepAwake', on);
    void keepAwake(on);
  };
  const save = () => {
    const now = Date.now();
    downloadFile(transcriptText(model.entries, choice, t, now), exportFilename('txt', now), 'text/plain;charset=utf-8');
  };

  if (!entered) {
    return (
      <div className={`viewer viewer--${layout}`}>
        <EntryScreen t={t} name={name} pair={pair} choice={choice} onChoose={choose} onStart={start} />
      </div>
    );
  }

  const legs = legsOf(model.entries);
  const legend = legs.speaker && legs.participant;
  const choiceControl = pair ? (
    <Segmented
      label={t('viewer.settings.iRead')}
      value={choice.both ? 'both' : choice.code}
      onChange={(v) => choose(v === 'both' ? { code: choice.code || pair.target, both: true } : { code: v, both: false })}
      options={[
        { value: pair.source, label: name(pair.source) },
        { value: 'both', label: t('viewer.enter.both') },
        { value: pair.target, label: name(pair.target) },
      ]}
    />
  ) : null;
  const emptyText = t(STATUS_KEYS[status]);
  const classes = [
    'viewer', `viewer--${layout}`, `viewer--${theme}`, `viewer--size-${size}`,
    choice.both ? 'viewer--both' : '', legend ? 'viewer--two-legs' : '', fullscreen ? 'viewer--fullscreen' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {layout === 'phone' ? (
        <header className="viewer-statusline">
          <StatusText t={t} status={status} />
          {legend && <Legend t={t} />}
        </header>
      ) : !fullscreen && (
        <TopBar t={t} status={status} legend={legend} choice={choiceControl}
          onSmaller={() => changeSize(stepSize(size, -1))} onLarger={() => changeSize(stepSize(size, 1))} onMore={() => setSettingsOpen(true)} />
      )}
      <CaptionList t={t} entries={model.entries} choice={choice} completeOnly={completeOnly} layout={layout}
        notice={model.notice} emptyText={emptyText} following={following} onFollowingChange={setFollowing} />
      {layout === 'phone' && (
        <Dock t={t} onView={() => setSettingsOpen(true)} onTextSize={() => changeSize(size === 'xlarge' ? 'small' : stepSize(size, 1))} onMore={() => setSettingsOpen(true)} />
      )}
      {layout === 'desktop' && !fullscreen && <footer className="viewer-footer"><span>{t('viewer.settings.aiNote')}</span><span>{t('viewer.shortcuts')}</span></footer>}
      {settingsOpen && (
        <SettingsPanel
          t={t} layout={layout} choiceControl={choiceControl}
          size={size} onSize={changeSize}
          theme={theme} onTheme={(v) => { setTheme(v); writePref('theme', v); }}
          completeOnly={completeOnly} onCompleteOnly={(v) => { setCompleteOnly(v); writePref('completeOnly', v); }}
          awake={awake} onAwake={changeAwake}
          allowSave={model.state?.allowSave === true} onSave={save}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default ViewerApp;
```

In the entering-test above, `ViewerApp` renders the phone layout (`innerWidth` 390), so "More" is the dock button whose `aria-label` is `More`.

- [ ] **Step 5: Route by path in `src/viewer/main.tsx`**

```tsx
// src/viewer/main.tsx
import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from './ViewerApp';

// The present page is for the host's own window; its QR code module loads only there.
const PresentApp = lazy(() => import('./PresentApp'));

const root = document.getElementById('root');
if (root) {
  const present = window.location.pathname.startsWith('/present');
  createRoot(root).render(
    <React.StrictMode>
      {present ? <Suspense fallback={null}><PresentApp /></Suspense> : <ViewerApp />}
    </React.StrictMode>,
  );
}
```

Until Task 12 lands, create `src/viewer/PresentApp.tsx` with `export default function PresentApp() { return null; }` so the build resolves; Task 12 replaces it.

- [ ] **Step 6: Write the styles**

```scss
// src/viewer/viewer.scss
//
// The LAN caption viewer. Controls are the app's own (ToggleSwitch, Button,
// the ModePicker segmented archetype, option rows) on the app's dark
// surfaces; the light and high-contrast schemes change the caption area only.
@use '../components/Settings/shared/variables' as vars;
@use '../styles/tokens' as tk;

:root { color-scheme: dark; }
html, body, #root { margin: 0; height: 100%; }
body {
  background: #121212;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Hiragino Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-text-size-adjust: 100%;
}

.viewer {
  --v-bg: #121212;
  --v-text: #f2f2f2;
  --v-muted: #9aa0a6;
  --v-line: #2c2c2c;
  --v-partial: #8e9497;
  --v-speaker: #{tk.$color-speaker};
  --v-participant: #{tk.$color-participant};
  --v-size: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--v-bg);
  color: var(--v-text);

  &--light {
    --v-bg: #fafafa; --v-text: #161616; --v-muted: #5f6368; --v-line: #e0e0e0; --v-partial: #80868b;
    --v-speaker: #{tk.$color-primary-fill}; --v-participant: #b9770e;
  }
  &--contrast {
    --v-bg: #000; --v-text: #ffeb3b; --v-muted: #fff; --v-line: #555; --v-partial: #c7b833;
    --v-speaker: #ffeb3b; --v-participant: #4fc3f7;
  }
  &--size-small { --v-size: 16px; }
  &--size-medium { --v-size: 20px; }
  &--size-large { --v-size: 24px; }
  &--size-xlarge { --v-size: 30px; }
  &--fullscreen { --v-size: calc(var(--v-size) * 1.25); }
}

// Entering
.viewer-enter {
  max-width: 420px;
  margin: 0 auto;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #ececec;

  &__title { margin: 0; font-size: 22px; font-weight: 600; }
  &__pair { margin: 0; color: vars.$text-muted; }
  &__choices {
    border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;
    legend { color: vars.$text-muted; font-size: vars.$font-caption; margin-bottom: 8px; }
  }
  &__note { margin: 0; color: vars.$text-muted; font-size: vars.$font-caption; line-height: 1.5; }
  .settings-btn { align-self: stretch; justify-content: center; }
}

.viewer-option {
  @include vars.option-row;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  color: vars.$text-primary;
  text-align: left;
  cursor: pointer;
  &:hover { @include vars.option-row-hover; }
  &.selected { color: vars.$color-primary; border-color: vars.$color-primary; }
  b { font-size: 15px; font-weight: vars.$weight-medium; }
  span { font-size: vars.$font-caption; color: vars.$text-muted; }
  &:focus-visible { @include vars.focus-ring; }
}

// Segmented control: ModePicker.scss archetype, local copy (as Settings.scss does)
.viewer-segmented {
  display: inline-flex;
  align-items: stretch;
  height: 28px;
  box-sizing: border-box;
  border: 1px solid #444;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;

  &__option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    font-size: 12px;
    color: #aaa;
    background: #333;
    border: 0;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    &:not(:last-child) { border-right: 1px solid #444; }
    &:hover:not(.active) { background: #3a3a3a; }
    &.active { @include vars.state-selected-fill; }
    &:focus-visible { @include vars.focus-ring; }
  }
}

// Bars
.viewer-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 20px;
  border-bottom: 1px solid #333;
  background: #1e1e1e;
  color: #ececec;
  font-size: 13px;
  &__title { font-weight: 600; }
  &__grow { flex: 1; }
}
.viewer-statusline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: calc(8px + env(safe-area-inset-top)) 16px 8px;
  color: var(--v-muted);
  font-size: 12px;
}
.viewer-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  i { width: 7px; height: 7px; border-radius: 50%; background: #666; }
  &--live i { background: tk.$color-success; }
  &--reconnecting i { background: tk.$color-degraded; }
}
.viewer-legend {
  display: inline-flex;
  gap: 10px;
  font-size: 12px;
  color: var(--v-muted);
  &__item::before { content: '●'; margin-right: 4px; }
  &__item--speaker::before { color: var(--v-speaker); }
  &__item--participant::before { color: var(--v-participant); }
}
.viewer-icon-btn {
  min-width: 30px;
  height: 28px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #333;
  color: #ddd;
  cursor: pointer;
  &:hover { background: #3a3a3a; }
  &:focus-visible { @include vars.focus-ring; }
}

// Captions
.viewer-list-wrap { position: relative; flex: 1; min-height: 0; }
.viewer-list {
  height: 100%;
  overflow-y: auto;
  padding: 12px 16px 24px;
  box-sizing: border-box;
  .viewer--tablet &, .viewer--desktop:not(.viewer--both) & { max-width: 44em; margin: 0 auto; }
  &__notice, &__empty { color: var(--v-muted); font-size: 14px; text-align: center; margin: 16px 0; }
}
.viewer-entry {
  padding: 8px 0;
  border-bottom: 1px solid var(--v-line);
  user-select: text;
  &__primary { margin: 0; font-size: var(--v-size); line-height: 1.45; font-weight: 600; }
  &__secondary { margin: 4px 0 0; font-size: calc(var(--v-size) * 0.7); line-height: 1.5; color: var(--v-muted); }
  &__time { font-size: 12px; color: var(--v-muted); font-variant-numeric: tabular-nums; }
  .viewer--two-legs &--speaker &__primary::before,
  .viewer--two-legs &--participant &__primary::before { content: '●'; font-size: 0.5em; vertical-align: middle; margin-right: 0.5em; }
  .viewer--two-legs &--speaker &__primary::before { color: var(--v-speaker); }
  .viewer--two-legs &--participant &__primary::before { color: var(--v-participant); }
  .viewer--desktop.viewer--both & {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) minmax(0, 1fr);
    gap: 0 32px;
    align-items: baseline;
  }
  .viewer--desktop.viewer--both & &__secondary { margin: 0; font-size: calc(var(--v-size) * 0.8); }
  .viewer--desktop:not(.viewer--both) & { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 0 24px; align-items: baseline; }
}
.viewer-partial { color: var(--v-partial); text-decoration: underline dashed; text-underline-offset: 0.2em; }
.viewer-jump {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid #444;
  background: #2b2b2b;
  color: #ececec;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
}

// Phone dock
.viewer-dock {
  display: flex;
  justify-content: space-around;
  border-top: 1px solid #333;
  background: #1e1e1e;
  padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
  button {
    display: grid;
    justify-items: center;
    gap: 2px;
    background: none;
    border: 0;
    color: #9aa0a6;
    font-size: 11px;
    cursor: pointer;
    b { color: #ececec; font-size: 15px; }
  }
}

// Desktop footer
.viewer-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 20px;
  border-top: 1px solid #333;
  background: #1e1e1e;
  color: #9aa0a6;
  font-size: 12px;
}

// Settings: a sheet on phones, a menu elsewhere; always the app's dark surface
.viewer-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); }
.viewer-settings {
  position: fixed;
  z-index: 10;
  background: #1e1e1e;
  color: #ececec;
  border: 1px solid #333;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: vars.$font-body;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);

  &--sheet { left: 0; right: 0; bottom: 0; border-radius: 16px 16px 0 0; padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
  &--menu { top: 52px; right: 16px; width: 340px; border-radius: 8px; }

  &__head {
    display: flex; align-items: center; justify-content: space-between;
    h2 { margin: 0; font-size: 15px; font-weight: 600; }
  }
  &__field {
    display: flex; flex-direction: column; gap: 6px;
    > span { font-size: vars.$font-caption; color: vars.$text-muted; }
  }
  &__save {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    div { display: flex; flex-direction: column; gap: 2px; }
    span { font-size: vars.$font-caption; color: vars.$text-muted; }
  }
  &__note { margin: 0; font-size: vars.$font-caption; color: vars.$text-muted; }
  .toggle-switch-component { margin-top: 0; }
}
```

Check before running: `tk.$color-speaker`, `tk.$color-participant`, `tk.$color-success`, `tk.$color-degraded`, `tk.$color-primary-fill` exist in `src/styles/_tokens.scss`; `vars.option-row`, `vars.option-row-hover`, `vars.state-selected-fill`, `vars.focus-ring`, `vars.$weight-medium`, `vars.$text-primary` exist in `src/components/Settings/shared/_variables.scss`. Use what is there; do not invent a token.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/viewer src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/viewer
git commit -m "feat(viewer): LAN caption viewer page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Present page

**Files:**
- Modify: `src/viewer/PresentApp.tsx` (replace the placeholder)
- Create: `src/viewer/present.scss`
- Test: `src/viewer/PresentApp.test.tsx`, `src/viewer/viewerStrings.consistency.test.ts`

**Interfaces:**
- Consumes: `QrCode` (Task 9), `wifiQrText` (Task 7), `viewerT`, `languageLabel`.
- Produces: `PresentApp` (default export), reading `/present/events`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/viewer/PresentApp.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import PresentApp from './PresentApp';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, (e: { data: string }) => void>();
  closed = false;
  constructor(public url: string) { FakeEventSource.last = this; }
  addEventListener(type: string, fn: (e: { data: string }) => void) { this.listeners.set(type, fn); }
  close() { this.closed = true; }
  emit(type: string, data: unknown) { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
}

const INFO = { url: 'http://192.168.1.23:7788/', pair: { source: 'ja', target: 'zh-CN' }, phase: 'live', viewers: 12, wifi: null };

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
});
afterEach(cleanup);

describe('PresentApp', () => {
  it('shows the address large, the QR code, the count, and no Wi-Fi step without a hint', () => {
    render(<PresentApp />);
    expect(FakeEventSource.last?.url).toBe('/present/events');
    act(() => FakeEventSource.last!.emit('present', INFO));
    expect(screen.getByText('http://192.168.1.23:7788/')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'http://192.168.1.23:7788/' })).toBeTruthy();
    expect(screen.getByText('Watching: 12')).toBeTruthy();
    expect(screen.queryByText(/^Join the Wi/)).toBeNull();
    expect(document.title).toBe('Sokuji projector page');
  });

  it('adds the Wi-Fi step with name, password and its own QR code', () => {
    render(<PresentApp />);
    act(() => FakeEventSource.last!.emit('present', { ...INFO, wifi: { ssid: 'Meetup-Guest', password: 'pw' } }));
    expect(screen.getByText(/^Join the Wi/)).toBeTruthy();
    expect(screen.getByText('Meetup-Guest')).toBeTruthy();
    expect(screen.getByText('Password: pw')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Meetup-Guest' })).toBeTruthy();
  });

  it('says sharing has ended and stops listening', () => {
    render(<PresentApp />);
    act(() => FakeEventSource.last!.emit('ended', {}));
    expect(screen.getByText('Sharing has ended')).toBeTruthy();
    expect(FakeEventSource.last!.closed).toBe(true);
  });
});
```

And the key check, which needs every page in place (that is why it lands here and not in Task 11):

```ts
// src/viewer/viewerStrings.consistency.test.ts
/**
 * The viewer's words, both ways: every `viewer.*` key the page's code names
 * exists in `en`, and every `en` `viewer.*` key is named somewhere. Keys are
 * found as string literals ('viewer.x.y'), which is why the code never
 * builds a key from a template.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../locales/en/translation.json';

const DIR = __dirname;
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => readFileSync(join(DIR, f), 'utf8'));

const flatten = (node: unknown, prefix: string): string[] =>
  typeof node === 'string' ? [prefix] : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => flatten(v, `${prefix}.${k}`));

describe('viewer strings in use', () => {
  const used = new Set(sources.flatMap((s) => [...s.matchAll(/['"`](viewer\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1])));
  const defined = new Set(flatten((en as Record<string, unknown>).viewer, 'viewer'));

  it('every key the page names exists in en', () => {
    expect([...used].filter((k) => !defined.has(k))).toEqual([]);
  });

  it('every en key is named by the page', () => {
    expect([...defined].filter((k) => !used.has(k))).toEqual([]);
  });

  it('nothing under src/viewer imports analytics or PostHog', () => {
    for (const s of sources) expect(s).not.toMatch(/analytics|posthog/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/viewer/PresentApp.test.tsx src/viewer/viewerStrings.consistency.test.ts`
Expected: FAIL (the placeholder renders nothing; the key check lists the `viewer.present.*` keys as unused).

- [ ] **Step 3: Write the implementation**

```tsx
// src/viewer/PresentApp.tsx
/** The projector page (spec 2026-10-04 §6): opened by the host into its own window, from loopback only. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QrCode from '../components/CaptionShare/QrCode';
import { languageLabel } from '../lib/language/label';
import type { PresentInfo } from '../lib/share/types';
import { wifiQrText } from '../lib/share/wifiQr';
import { viewerT } from './strings';
import './present.scss';

const languages = (): readonly string[] => (navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]);

export default function PresentApp(): React.ReactElement {
  const { t, catalog } = useMemo(() => viewerT(languages()), []);
  const [info, setInfo] = useState<PresentInfo | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const source = new EventSource('/present/events');
    source.addEventListener('present', (event) => {
      try {
        setInfo(JSON.parse((event as MessageEvent<string>).data) as PresentInfo);
      } catch {
        // A frame that does not parse is skipped; the next one replaces it.
      }
    });
    source.addEventListener('ended', () => {
      setEnded(true);
      source.close();
    });
    return () => source.close();
  }, []);

  useEffect(() => { document.title = t('viewer.present.windowTitle'); }, [t]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Full screen refused: the window stays as it is.
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  if (ended) return <main className="present present--ended"><h1>{t('viewer.present.ended')}</h1></main>;
  if (!info) return <main className="present" />;

  const name = (code: string) => languageLabel(code, catalog, t('viewer.original'));
  return (
    <main className="present">
      <header className="present__head">
        <h1>{t('viewer.present.title')}</h1>
        <p>{`${name(info.pair.source)} ⇄ ${name(info.pair.target)} · ${t('viewer.present.noInstall')}`}</p>
        <button type="button" className="present__fullscreen" onClick={() => void toggleFullscreen()}>{t('viewer.present.fullscreen')}</button>
      </header>
      <ol className={`present__steps ${info.wifi ? 'present__steps--wifi' : ''}`.trim()}>
        {info.wifi && (
          <li className="present__step">
            <span className="present__n">1</span>
            <QrCode value={wifiQrText(info.wifi.ssid, info.wifi.password)} label={info.wifi.ssid} size={220} />
            <b>{t('viewer.present.step1')}</b>
            <span className="present__mono">{info.wifi.ssid}</span>
            {info.wifi.password && <span className="present__mono">{t('viewer.present.password', { password: info.wifi.password })}</span>}
          </li>
        )}
        <li className="present__step">
          <span className="present__n">{info.wifi ? 2 : 1}</span>
          {info.url && <QrCode value={info.url} label={info.url} size={220} />}
          <b>{t('viewer.present.step2')}</b>
          <span className="present__address">{info.url}</span>
        </li>
        <li className="present__step present__step--text">
          <span className="present__n">{info.wifi ? 3 : 2}</span>
          <b className="present__big">{t('viewer.present.step3')}</b>
        </li>
      </ol>
      <footer className="present__foot">
        <span>{t('viewer.present.sameNetwork')}</span>
        <span>{t('viewer.present.watching', { count: info.viewers })}</span>
      </footer>
    </main>
  );
}
```

```scss
// src/viewer/present.scss
@use '../styles/tokens' as tk;

.present {
  min-height: 100%;
  box-sizing: border-box;
  background: #111;
  color: #f2f2f2;
  padding: 4vh 4vw;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 3vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Hiragino Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif;

  &--ended { place-items: center; }

  &__head {
    position: relative;
    h1 { margin: 0; font-size: clamp(24px, 4vw, 48px); }
    p { margin: 0.4em 0 0; color: #a8adb0; font-size: clamp(14px, 1.6vw, 22px); }
  }
  &__fullscreen {
    position: absolute; top: 0; right: 0;
    background: #333; color: #ddd; border: 1px solid #444; border-radius: 6px; padding: 4px 10px; cursor: pointer;
    :fullscreen & { display: none; }
  }
  &__steps {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3vw; align-items: center;
    &--wifi { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  &__step {
    display: grid; justify-items: center; gap: 1.2vh; text-align: center;
    font-size: clamp(14px, 1.6vw, 22px);
    .qr-code { width: min(22vw, 32vh); height: auto; border-radius: 6px; }
  }
  &__n { color: tk.$color-primary; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: clamp(16px, 2vw, 28px); }
  &__mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #cfd3d5; }
  &__address { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 600; font-size: clamp(18px, 2.6vw, 40px); }
  &__big { font-size: clamp(20px, 3vw, 44px); }
  &__foot { display: flex; justify-content: space-between; color: #a8adb0; font-size: clamp(12px, 1.4vw, 18px); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/viewer`
Expected: PASS. If the key check still lists a key, use it where the spec says it belongs or remove it from `en` (then re-run `node scripts/sync-locale-keys.mjs`).

- [ ] **Step 5: Commit**

```bash
git add src/viewer/PresentApp.tsx src/viewer/PresentApp.test.tsx src/viewer/present.scss src/viewer/viewerStrings.consistency.test.ts
git commit -m "feat(viewer): projector page with share and Wi-Fi QR codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Slice 3 ends here: report.**

---

### Task 13: Translations

**Files:**
- Modify: `src/locales/<id>/translation.json` for the 29 non-English catalogs (`ar bn de es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW`), subtrees `captionShare` and `viewer` only.

**Interfaces:** none.

- [ ] **Step 1: Translate `zh_CN` exactly as below** (these strings were settled with jiangzhuo)

```json
  "captionShare": {
    "button": "分享字幕",
    "buttonActive": "正在分享字幕：{{count}} 台设备在看",
    "intro": "让同一个网络里的人用手机或电脑看这里的字幕和译文。",
    "enable": "开启分享",
    "firewallNote": "开启后 Windows 可能会问是否允许 Sokuji 访问网络，请选「专用网络」。",
    "address": "地址",
    "copy": "复制",
    "copied": "已复制",
    "network": "网络",
    "kinds": { "wifi": "Wi‑Fi", "wired": "有线", "other": "网络", "virtual": "虚拟网卡" },
    "recommended": "推荐",
    "usuallyUnreachable": "通常连不上",
    "watching": "在看",
    "watchingCount": "{{count}} 台设备",
    "allowSave": "允许听众保存本场字幕",
    "wifiHint": "投屏页加 Wi‑Fi 提示",
    "wifiName": "Wi‑Fi 名称",
    "wifiNamePlaceholder": "例如 Meetup-Guest",
    "wifiPassword": "密码（可以留空）",
    "openPresent": "打开投屏页",
    "stop": "结束分享",
    "stopNote": "结束后，听众的页面显示「分享已结束」。",
    "warnNoViewers": "开了 2 分钟，还没有设备连上。这个网络可能把设备互相隔离了（访客 Wi‑Fi、部分公司网络会这样），也可能是防火墙拦住了。可以试试：确认大家和这台电脑连的是同一个网络；在 Windows 上允许 Sokuji 访问专用网络；或者改用手机热点、自带的路由器。",
    "warnAddressChanged": "网络变了，地址已经换成 {{address}}，请重新发链接或重新投屏。",
    "errorPortsBusy": "没能开启分享：端口 7788–7797 都被占用了。",
    "errorListen": "没能开启分享：{{reason}}"
  },
  "viewer": {
    "title": "Sokuji 字幕",
    "connecting": "正在连接…",
    "original": "原文",
    "enter": {
      "iRead": "我看",
      "both": "双语",
      "bothHint": "{{first}}在上，{{second}}在下",
      "start": "开始看",
      "insecureNote": "地址栏可能显示「不安全」，因为这是局域网地址：字幕直接来自讲者的电脑。"
    },
    "status": { "waiting": "等待开始", "live": "直播中", "paused": "已暂停", "reconnecting": "重新连接中…", "ended": "分享已结束" },
    "notice": { "cleared": "讲者清空了之前的字幕", "restarted": "讲者开始了新的一轮" },
    "legend": { "onSite": "现场", "remote": "线上" },
    "backToLive": "回到当前",
    "dock": { "view": "看什么", "textSize": "字号", "more": "更多" },
    "settings": {
      "title": "显示设置",
      "iRead": "我看",
      "textSize": "字号",
      "sizes": { "small": "小", "medium": "中", "large": "大", "xlarge": "特大" },
      "theme": "配色",
      "themes": { "dark": "深色", "light": "浅色", "contrast": "高对比" },
      "completeOnly": "只显示完整句",
      "completeOnlyHint": "还没说完的句子先不显示",
      "keepAwake": "保持屏幕常亮",
      "save": "保存本场字幕",
      "saveHint": "把这个页面上的字幕下载为 .txt 文件",
      "saveButton": "保存",
      "close": "关闭",
      "aiNote": "字幕由 AI 生成，仅供参考。"
    },
    "shortcuts": "+ − 字号 · B 双语 · F 全屏 · End 回到当前",
    "transcript": { "header": "Sokuji 字幕，保存于 {{time}}" },
    "present": {
      "title": "用手机或电脑看字幕",
      "step1": "连上 Wi‑Fi",
      "password": "密码：{{password}}",
      "step2": "手机扫码；电脑在浏览器输入这个地址",
      "step3": "选你要看的语言",
      "noInstall": "不用装 app，不用登录",
      "sameNetwork": "这个地址只在同一个网络里打得开",
      "watching": "在看：{{count}}",
      "fullscreen": "全屏",
      "windowTitle": "Sokuji 投屏页",
      "ended": "分享已结束"
    }
  }
```

The catalogs are written by `sync-locale-keys.mjs` with expanded objects; keep each file's existing formatting style (expanded, 2-space) rather than the compact one-line objects shown above, which are compact only to keep this plan short.

- [ ] **Step 2: Translate the other 28 catalogs**

For each remaining id, replace the English placeholder values under `captionShare` and `viewer` with natural translations. Rules: keep every `{{placeholder}}` exactly; keep "Sokuji", "Wi‑Fi", ".txt", "app", the key symbols in `viewer.shortcuts` (`+ −`, `B`, `F`, `End`) and the port range `7788–7797`; no empty strings; follow the tone of the same catalog's existing `subtitle.*` and `mainPanel.*` strings. `zh_TW` uses Traditional Chinese with Taiwan wording (e.g. 「字幕」「設定」「網路」「複製」).

- [ ] **Step 3: Verify**

Run: `npx vitest run src/locales src/viewer/strings.test.ts`
Expected: PASS (lockstep: same keys, same placeholders, no empty strings).

Run: `node -e "for (const id of ['ja','ko','de','zh_TW']) { const v=require('./src/locales/'+id+'/translation.json'); console.log(id, v.viewer.title, '|', v.captionShare.button) }"`
Expected: four lines with translated text, none equal to the English.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "i18n(caption-share): translate the share panel and viewer strings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Build check, render check, docs

**Files:**
- Create: `scripts/dev/caption-share-demo.mjs`
- Modify: `CLAUDE.md` (Architecture Overview: a "7. LAN caption sharing" entry), `docs/superpowers/specs/2026-10-04-lan-caption-sharing-design.md` (§3.1 note on `onReset`, §8 note on hotspot adapters)

**Interfaces:** none new.

- [ ] **Step 1: Build and check the bundle**

Run: `npx vite build && node scripts/check-viewer-bundle.mjs`
Expected: `viewer bundle ok: N files`.

- [ ] **Step 2: Write the demo server (development only, never shipped)**

```js
#!/usr/bin/env node
// scripts/dev/caption-share-demo.mjs
//
// Render check for the LAN caption viewer: serves build/ through the real
// caption-share server and feeds sample captions, so the viewer and present
// pages can be opened and looked at without the desktop app.
// Usage: npx vite build && node scripts/dev/caption-share-demo.mjs
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createCaptionShareServer } = require('../../electron/caption-share-server.js');
const { viewerAssets } = require('../../electron/caption-share-core.js');

const build = join(process.cwd(), 'build');
const manifest = JSON.parse(await readFile(join(build, 'asset-manifest.json'), 'utf8'));
const allowed = viewerAssets(manifest, 'viewer.html');
const server = createCaptionShareServer({
  assets: { allowed: async () => allowed, read: (rel) => readFile(join(build, rel)).catch(() => null) },
});

const pair = { source: 'ja', target: 'zh-CN' };
const { port } = await server.start({ phase: 'live', pair, allowSave: true });
const lines = [
  ['speaker', '今日はローカルで動く音声翻訳の話をします。', '今天讲一讲在自己电脑上跑的语音翻译。'],
  ['speaker', '会場の皆さんのスマホやパソコンで字幕が見られます。', '大家的手机和电脑都能看到字幕。'],
  ['participant', '这个延迟大概有多少？', 'この遅延はどれくらいですか？'],
  ['speaker', 'だいたい一秒ぐらいです。', '大概一秒左右。'],
];
let n = 0;
const at = Date.now();
const entry = ([leg, src, tr], i, final) => ({
  id: `demo:${i}`, leg, t: at + i * 4000,
  languages: leg === 'speaker' ? pair : { source: pair.target, target: pair.source },
  source: [{ key: `demo:${leg}:${i}a:0`, text: src, final: true }],
  translation: [{ key: `demo:${leg}:${i}b:0`, text: final ? tr : tr.slice(0, Math.ceil(tr.length / 2)), final }],
});
setInterval(() => {
  const i = n % lines.length;
  server.patch({ upsert: [entry(lines[i], n, false)], remove: [] });
  setTimeout(() => server.patch({ upsert: [entry(lines[i], n - 1, true)], remove: [] }), 1500);
  n += 1;
}, 3000);
server.setPresent({ url: `http://127.0.0.1:${port}/`, pair, phase: 'live', viewers: 3, wifi: { ssid: 'Meetup-Guest', password: 'example-pass' } });
process.stdout.write(`viewer:  http://127.0.0.1:${port}/\npresent: http://127.0.0.1:${port}/present\n`);
```

- [ ] **Step 3: Look at the pages**

Start the demo in the background: `node scripts/dev/caption-share-demo.mjs`. With the Playwright MCP browser:

1. Viewport 390×844, open the viewer URL, click "Start reading", wait 7 s, screenshot. Open "More", screenshot the sheet; switch to "Light" and "High contrast", screenshot each.
2. Viewport 1280×800, open the viewer URL, start, choose "Both languages" in the top bar, screenshot (side-by-side rows with time).
3. Viewport 1280×720, open `/present`, screenshot.
4. Host panel: start `SOKUJI_DEV_NO_ELECTRON=1 npx vite`, open `http://localhost:5173/` in a Playwright context whose user agent contains `Electron` and whose init script defines `window.electron = { osInfo: { platform: 'win32' }, invoke: async (c) => c === 'caption-share:start' ? { running: true, port: 7788, selected: '192.168.1.23', viewers: 2, addressChanged: false, addresses: [{ address: '192.168.1.23', label: 'Wi-Fi', kind: 'wifi' }, { address: '172.29.64.1', label: 'vEthernet (WSL)', kind: 'virtual' }] } : undefined, receive: () => {}, removeListener: () => {} }`. Click the toolbar's share button, screenshot the off state; turn sharing on, screenshot the on state.

Compare each against the reference board's mockups (https://claude.ai/artifact/L4XdZhs5iXK4AY7gdMMv4U) and §9 of the spec: the app's switches, buttons and segmented controls, no sound button, no disabled save row. Fix what looks wrong in the owning task's files, re-run that task's tests, and record the screenshots' findings in the slice report. Stop the demo and dev servers.

- [ ] **Step 4: Document**

In `CLAUDE.md`, under "Architecture Overview", after item 6, add:

```markdown
7. **LAN caption sharing** (spec: `docs/superpowers/specs/2026-10-04-lan-caption-sharing-design.md`)
   - Desktop only. `src/lib/share/publisher.ts` mirrors the conversation view (reset by
     `ConversationSet.onReset`) over IPC to `electron/caption-share.js`, which runs a Node
     `http` server (`caption-share-server.js`, ports 7788–7797) pushing SSE to viewers.
   - The viewer and projector pages are the second Vite input `viewer.html` (`src/viewer/`):
     strings are the `viewer` subtree of each catalog, compiled in; they load nothing from
     another origin and never import analytics. `scripts/check-viewer-bundle.mjs` checks a build.
   - Nothing about sharing is persisted; the host panel is `src/components/CaptionShare/`.
```

In the spec, add under §3.1 "Resets": "Implemented as `ConversationSet.onReset` (`runner.conversation.onReset`): `replace` and `clear` both pass through that object." Under §8 "Addresses": "Windows `Local Area Connection* N` (Mobile Hotspot) and macOS `bridgeN` (Internet Sharing) are *other*, not virtual: they are the right address when phones join the computer's own hotspot."

- [ ] **Step 5: Final verification**

Run: `npx vitest run electron src/lib/session src/lib/share src/components/MainPanel/panel src/components/CaptionShare src/lib/diagnostics src/locales src/app src/stores/captionShareStore.test.ts src/viewer`
Expected: PASS, with the 77 baseline files plus the new ones.

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `96`.

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/(lib/share|viewer|app/captionShare|stores/captionShareStore|components/CaptionShare|lib/session/conversationSet)"`
Expected: no output.

Run: `git status --short`
Expected: clean after the commit below (the `node_modules` symlink is ignored).

- [ ] **Step 6: Commit**

```bash
git add scripts/dev/caption-share-demo.mjs CLAUDE.md docs/superpowers/specs/2026-10-04-lan-caption-sharing-design.md
git commit -m "docs(caption-share): architecture note, spec refinements, demo server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Slice 4 ends here: report, with the live-test list from spec §11 for jiangzhuo.**
