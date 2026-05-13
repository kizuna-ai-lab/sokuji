# Subtitle Mode — Browser Extension (v2) — Design

**Date**: 2026-05-13
**Status**: Approved for implementation planning
**Tracking issue**: [#226](https://github.com/kizuna-ai-lab/kizuna-ai-lab/sokuji/issues/226)
**Related**: [v1 Electron design](2026-05-10-subtitle-mode-design.md), [v1 manual test plan](2026-05-10-subtitle-mode-manual-test.md), original discussion [#118](https://github.com/kizuna-ai-lab/sokuji/discussions/118), v1 PR [#225](https://github.com/kizuna-ai-lab/sokuji/pull/225)

## Context

`v0.26.0` shipped subtitle mode for the Electron desktop app: a translucent, always-on-top floating bar that streams the live bilingual translation while the user is on a video call or watching a video. The v1 design explicitly scoped the work to Electron because the implementation reshapes the single `BrowserWindow` and relies on `setBounds`, `setAlwaysOnTop`, `frame: false`, `transparent: true`, and a `subtitle:*` IPC channel — none of which exist for the browser extension.

This v2 brings an equivalent experience to the Chrome / Edge extension. The extension's surface is the side panel, which is locked to the browser window and is taller than wide. Users running Sokuji over Google Meet / Teams / Zoom either eat horizontal screen space with the panel or lose the live-translation view entirely when the call goes fullscreen. The goal of v2 is to give those users the same compact, bottom-of-screen bilingual stream as Electron users.

The v1 React components (`SubtitleApp`, `SubtitleBar`, `SubtitleStream`, `SubtitleSettingsPopover`, `SubtitleSessionEnded`) are platform-agnostic and reused verbatim: rendered in the Electron main window today, and on v2 also rendered inside an iframe injected into the active meeting tab. The v1 subtitle-related settings, currently a `subtitle: SubtitleSettings` slice on the global `settingsStore.ts`, are extracted in v2 into a dedicated `subtitleStore.ts` — see [State (subtitleStore)](#state-subtitlestore). This refactor makes `SubtitleApp` truly self-contained for its modifiable state and removes the need for cross-context settings synchronisation between the side panel and the overlay iframe.

## Why not Document Picture-in-Picture (demo findings)

An earlier draft of this spec proposed mounting `SubtitleApp` into a Document Picture-in-Picture window opened directly from the side panel via `documentPictureInPicture.requestWindow()`. A small standalone demo (see `extension/demo-subtitle-pip.{html,js}` and `extension/demo-pip-launcher.{html,js}` in this branch) refuted that approach:

- **Direct call from the side panel is broken.** `requestWindow()` resolves successfully (`closed=false`, `readyState=complete`, `visibilityState=visible`), but `pagehide` fires 5 ms later — the window is created and immediately torn down. Reproduced across three configurations on Chrome 147 (no Meet at all, Meet landing page, joined Meet call). `userActivation.isActive=true` at call time; not a gesture issue. Same outcome whether the demo runs in the side panel or as the side panel's only content.
- **Cross-evidence supports this is architectural, not a transient bug.** WICG's [Document PiP spec §requestWindow](https://wicg.github.io/document-picture-in-picture/) requires a "top-level traversable" — non-top-level contexts get `NotAllowedError`. Side panels are accepted by `requestWindow()` but immediately fail an implicit lifecycle check. Mozilla [Bug 1678979](https://bugzilla.mozilla.org/show_bug.cgi?id=1678979) documents the same broken behavior when launching PiP from Firefox's "Side View" extension surface — filed November 2020, P5/S4, untouched for 5 years.
- **A popup-window detour works but has bad UX.** Opening a host window via `chrome.windows.create({type: 'popup'})` and then calling `requestWindow()` from inside that popup does keep the PiP alive (verified empirically), including across the popup being minimized via `chrome.windows.update({state: 'minimized'})`. But: (1) `chrome.windows.create({state: 'minimized'})` is silently treated as `'normal'` in Chrome 147 — the popup always flashes visible first; (2) `chrome.windows.update` rejects bounds that aren't ≥50% on-screen, so the popup can't be hidden off-screen; (3) `userActivation` does not propagate from the side-panel click through `chrome.windows.create` to the popup, so the user must click a second button inside the popup to satisfy PiP's gesture requirement; (4) the minimized popup leaves a permanent taskbar icon. Two clicks + an extra taskbar item to deliver one subtitle bar is a worse experience than the alternative.

The picture-in-picture path is therefore deferred. The popup+PiP architecture remains a viable v2.1 option specifically for non-meeting tabs (YouTube, arbitrary pages), where content-script overlay is unavailable — see [Out of Scope](#out-of-scope-for-v2).

## Surface choice

v2 ships **a content-script in-tab overlay** that mounts the existing React `SubtitleApp` inside an `<iframe>` injected into the active meeting tab via the existing content scripts. The iframe loads a new extension page (`subtitle-overlay.html`) — same React, same components, same Zustand `subtitleStore`. Subtitle settings are owned and persisted by the iframe's own `subtitleStore` (no cross-context sync needed). Live session data (items, language pair, `isSessionActive`) is mirrored from the side panel's `sessionStore` into the iframe via a `chrome.runtime.Port`.

Why this is the right answer for issue #226's users:

- **Zero new windows, zero PiP-slot competition.** Meet's own auto-PiP, which fires when the Meet tab is inactive, never conflicts with Sokuji's surface — they are different mechanisms (DOM vs. Chrome window). User on Meet → Sokuji overlay visible inside Meet UI. User switches away → Meet's PiP appears naturally; Sokuji overlay is invisible (in the now-inactive Meet tab). User switches back → Meet's PiP closes, Sokuji overlay is visible again. The desired UX falls out of the architecture without any tab-gating code.
- **Maximum code reuse.** `SubtitleApp` and its children render unchanged. The iframe is a separate JS context but mounts the same React components. No vanilla DOM duplicate of the subtitle UI.
- **Single click activation.** Side-panel click → message → content script mounts iframe → iframe boots, opens port, renders. No second user gesture required.
- **Clean CSS isolation.** Shadow DOM around the iframe element prevents the host page from killing the iframe element with `iframe { display: none !important; }` style; the iframe's own document is naturally isolated from the host's stylesheets.

## Non-Goals

- **Non-meeting sites.** Content scripts only run on the nine sites listed in `extension/manifest.json` `content_scripts.matches`. Tabs outside that list are not supported in v2. A popup+PiP architecture for arbitrary tabs is feasible (demonstrated by the demo) but deferred to v2.1.
- Floating the subtitle bar over **non-browser** applications from the extension. (Possible via a separate desktop helper; product-level decision.)
- Replacing the existing Electron subtitle mode.
- Per-site visual integration beyond placement (e.g., docking inside Meet's bottom toolbar).
- Animating overlay show / hide.

## User-Visible Behavior

### Entering / leaving

- The conversation toolbar in `MainPanel` shows the existing `SubtitleEnterButton`. It is disabled until `sessionStore.isActive === true`.
- No additional active-tab eligibility check is needed in the extension: the existing `extension/background/background.js` already calls `chrome.sidePanel.setOptions({ enabled: true/false })` per tab so the side panel only appears at all on the nine supported meeting sites. If the user can see the side panel, they are on a supported site.
- Click → the side panel calls `getSubtitleSurface().enter()`. For the extension surface, that:
  1. Sends a `subtitle:enter` message to the content script in the active meeting tab.
  2. The content script creates a hidden host `<div id="sokuji-subtitle-host">` at the end of `<body>`, attaches a closed Shadow root, and appends an `<iframe src="chrome-extension://<id>/subtitle-overlay.html">` into the shadow root.
  3. The iframe loads, runs its React bootstrap, opens a long-lived port (`chrome.runtime.connect({ name: 'sokuji-subtitle' })`) back to the side panel.
  4. The side panel pushes the initial state (current `subtitle.*` settings, current language pair, recent `combinedItems`) over the port.
  5. Side panel state changes are mirrored to the iframe via the port for the rest of the session.
- Exit pathways:
  - `✕` button in the subtitle bar (rendered inside the iframe) → iframe sends `subtitle:user-exit` over the port → side panel exits.
  - The user closing the meeting tab → `chrome.tabs.onRemoved` listener on the side panel → side panel exits.
  - The user navigating the meeting tab to a different URL → `chrome.tabs.onUpdated` listener; if the new URL is still on a supported site, the side panel re-sends `subtitle:enter` (the previous content-script instance is gone with the page reload); otherwise, exits.
  - Session ending while subtitle is up → `<SubtitleSessionEnded>` renders inside the iframe, same as in Electron; the bar with its ✕ stays visible.

### Overlay layout

The same `SubtitleBar` from v1, with one piece hidden under `surface === 'extension-overlay'`:

- 📌 always-on-top toggle — meaningless (overlay is in-page DOM bound to the active tab; OS-level always-on-top doesn't apply).

Everything else — logo slot, timer, language pair, speaker / participant display-mode buttons, font − / +, compact toggle, ExportButton, Clear, 🔒 lock toggle, ⚙ settings popover, in-bar ✕ — renders unchanged. The Electron-specific `-webkit-app-region: drag` styling is dropped; this surface implements drag via JS (see [Drag and resize](#drag-and-resize)).

### Overlay positioning, drag, and resize {#drag-and-resize}

**Default position and size** (used on every `subtitle:enter` — position is not persisted, see [State](#state-subtitlestore)): `position: fixed`, `bottom: 80px`, `left: 50%`, `transform: translateX(-50%)`, `width: min(70vw, 1200px)`, `height: 80px`, `z-index: 2147483647`. Applied to the iframe element itself via inline style.

The `bottom: 80px` offset clears Meet's bottom toolbar (~64 px) with a small safety margin. v2 uses this fixed default for all nine sites; per-site overrides are out of scope.

**User-driven move and resize**, parity with v1 Electron (drag the bar, drag the corners), but ephemeral:

- The overlay's "drag handle" is the left-half of `SubtitleBar` (logo + quota slot area), same area that `-webkit-app-region: drag` covers in Electron.
- A `mousedown` on the drag handle in the iframe captures pointer events. `mousemove` accumulates `event.movementX` / `movementY` into a local `targetX` / `targetY` running total. On each frame, the iframe posts a `{ type: 'sokuji-subtitle:move', x, y }` message to its parent window via `window.parent.postMessage(..., '*')`.
- The content script (in the meeting page's isolated world) listens for `'message'` events from the iframe's `contentWindow`, verifies the source, clamps `x` / `y` to the current viewport so the bar can't leave the visible area, and updates `iframe.style.left` / `iframe.style.top` (after clearing the centering `transform` on first move).
- Resize is implemented the same way: four invisible 8-px corner handles inside the iframe send `{ type: 'sokuji-subtitle:resize', width, height }` messages; content script clamps and applies. Minimum size 320×60, maximum size full viewport.
- `mouseup` ends the operation. **No persistence**: the content script does not write to `chrome.storage`, the iframe does not call a store action. The applied position lives on the iframe element's inline style for as long as that iframe is mounted; the next `subtitle:enter` cycle creates a fresh iframe at the default position.
- **`window.postMessage` (not `chrome.runtime`)** for movement / resize updates: lower latency for high-frequency pointer events, no service-worker round-trip; suitable because both ends share the meeting page context.

**🔒 Lock toggle**:

- When `positionLocked === true` (read from `subtitleStore`), the iframe's drag handle does not start drag operations, and resize handles are hidden (`pointer-events: none`). No messages are posted.
- `positionLocked` **is** persisted (single boolean, sensible user preference). It survives across `subtitle:enter` cycles even though the bounds themselves don't.

### Auto-hide

Same as v1 / Electron: 1500 ms after the cursor leaves the iframe document, the bar fades to `opacity: 0`; mouse re-enter snaps it back. The iframe's `mouseenter` / `mouseleave` events fire normally on its own document.

### Subtitle stream

`SubtitleStream` renders the same way it does in Electron. The iframe's `sessionStore` mirror is populated by the port with the most recent N items (default N = 100); older items are dropped client-side. The CSS variable hooks `--subtitle-source-color` and `--subtitle-translation-color` are set on the stream root and resolve inside the iframe document.

### Settings popover (⚙)

Identical to v1 and **the action wiring is identical too**. The iframe loads the same `subtitleStore` module the Electron path does. Both platforms persist through the existing `SettingsService` (extension: `chrome.storage.sync`; Electron: `localStorage`) — same API, same key namespace. The store is the single authority for every subtitle setting in its own platform; the side panel does not read or write subtitle settings, so no cross-context synchronisation is needed. Setting changes apply in real time inside the iframe via CSS variables and React re-renders. See [State (subtitleStore)](#state-subtitlestore) for the full shape and persistence model.

### Session lifecycle inside subtitle mode

Identical to v1. When the side panel sees `sessionStore.isActive` flip to `false`, it pushes a `session-ended` flag over the port; the iframe's `SubtitleApp` switches its render to `<SubtitleSessionEnded>`. The "Return" button posts `subtitle:user-exit` and the side panel exits.

## Architecture & Lifecycle

```
[Side panel — fullpage.html]                       [Meet tab — content.js → iframe]
 React, sessionStore, settingsStore, audio          ┌── injected sokuji-subtitle-host ────────┐
 ExtensionContentScriptSubtitleSurface              │  <div id="sokuji-subtitle-host">         │
   owns: subtitleModeActive (sidepanel lifecycle)   │    #shadow-root (closed)                 │
   does NOT own subtitleStore                       │      <iframe                             │
                                                    │        src=chrome-extension://<id>/      │
 enterSubtitleMode()                                │             subtitle-overlay.html        │
   → chrome.tabs.query({active, currentWindow})     │        style=positioned per chrome.      │
   → chrome.tabs.sendMessage(tabId,                 │               storage subtitle.bounds>   │
       { type:'subtitle:enter' }) ─────────────────►│  ─────────────────────────────────────   │
                                                    │  iframe page loaded                      │
   ◄─── chrome.runtime.onConnect ──────────────────────  React + AppProviders + <SubtitleApp   │
        (port.name === 'sokuji-subtitle')                surface="extension-overlay">          │
                                                    │  subtitleStore (hydrated via             │
                                                    │    SettingsService) — read/write LOCAL,  │
   port.postMessage({initial session snapshot}) ──► │    persist via SettingsService           │
                                                    │  sessionStore mirror — receives items    │
   sessionStore subscription                        │    from port; provides read-only views   │
     → port.postMessage({items, isActive, langs})   │                                          │
                                                    │  user interactions:                      │
                                                    │   ✕ click → port.postMessage(            │
                                                    │     {type:'subtitle:user-exit'})         │
                                                    │   settings popover → subtitleStore       │
                                                    │     setter → SettingsService             │
                                                    │     (no port traffic)                    │
                                                    │   drag/resize → window.parent.postMessage│
                                                    │     to content script → updates iframe   │
                                                    │     style (ephemeral, not persisted)     │
                                                    └─────────────────────────────────────────┘

 exitSubtitleMode()
   → chrome.tabs.sendMessage(tabId, { type:'subtitle:exit' })
   → content script removes the host div (port auto-disconnects with iframe)
```

Invariants:

- One subtitle host iframe per tab; one tab at a time per side-panel window.
- `subtitleStore` is the single authority for **modifiable** subtitle state on each platform. In Electron, it's the only context running. In extension, only the iframe reads/writes it — the side panel never touches subtitle settings.
- `sessionStore` is owned by the side panel (audio pipeline / provider clients run there). The iframe gets a **read-only** mirror via the port. The only "write" action `SubtitleApp` invokes on the session — `requestClearConversation()` — is implemented in the iframe's mirror as a port message that forwards to the side panel's real store.
- `subtitleModeActive` is sidepanel-owned lifecycle state (in `settingsStore` or a small dedicated slice). The iframe does not need it.
- Closing the meeting tab, navigating away, or closing the side panel itself all converge on `subtitleModeActive=false` on the side panel.
- The port's `onDisconnect` is the canonical "iframe is gone" signal on the side-panel side. It's wired to clean up subscriptions but does NOT, by itself, flip `subtitleModeActive` — disconnects also happen on URL change while subtitle mode should stay active across content-script reload.

## Surface Abstraction

The platform branch lives behind a thin interface so that `SubtitleApp`, `SubtitleBar`, `SubtitleEnterButton`, and the store actions stay platform-agnostic.

```
src/components/Subtitle/surfaces/
  SubtitleSurface.ts                       // interface
  ElectronSubtitleSurface.ts               // wraps existing subtitle:* IPC — refactor only
  ExtensionContentScriptSubtitleSurface.ts // new — content-script + iframe
  getSubtitleSurface.ts                    // env-based factory
  index.ts                                 // re-exports
```

```ts
// SubtitleSurface.ts
export interface SubtitleSurface {
  /** Open subtitle mode. Must be called inside a user gesture. */
  enter(): Promise<void>;
  /** Exit subtitle mode. Idempotent. */
  exit(): Promise<void>;
}
```

`enterSubtitleMode()` / `exitSubtitleMode()` in `settingsStore.ts` delegate to `getSubtitleSurface().enter()` / `.exit()`. The store no longer references `window.electron.invoke('subtitle:enter', …)` directly.

No `supports()` is needed at the surface level:

- The extension's existing `background/background.js` already calls `chrome.sidePanel.setOptions({ enabled })` per tab so the side panel only renders on the nine supported sites. If the user can see the side panel, they are on a supported site, and the button can simply render.
- In Electron, the surface is always available.
- For any other context (plain web), `getSubtitleSurface()` returns a no-op that throws on `enter()`. Callers check the platform via `isElectron() || isExtension()` instead.

The Electron refactor is strictly mechanical: existing IPC payloads, channels, and clamping behaviour preserved, just relocated into `ElectronSubtitleSurface`. v1 tests pass unchanged.

## Extension Content-Script Surface Implementation

### Side-panel side (`ExtensionContentScriptSubtitleSurface.ts`)

```ts
let targetTabId: number | null = null;
let port: chrome.runtime.Port | null = null;
let unsubscribers: (() => void)[] = [];

const SUPPORTED_HOSTS = [
  'meet.google.com',
  'teams.live.com', 'teams.microsoft.com', 'teams.cloud.microsoft',
  'app.zoom.us',
  'app.gather.town', 'app.v2.gather.town',
  'whereby.com',
  'discord.com',
  'app.slack.com',
];

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try { return SUPPORTED_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}

export async function enter(): Promise<void> {
  if (targetTabId != null) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Defensive: the existing background gates the side panel by URL, but if
  // a race happened (user navigates the active tab between rendering the
  // panel and clicking the button), we still bail rather than crash.
  if (!tab?.id || !isSupportedUrl(tab.url)) throw new Error('not on supported site');

  // Register port handler BEFORE messaging the content script so we don't miss it.
  chrome.runtime.onConnect.addListener(handleConnect);

  await chrome.tabs.sendMessage(tab.id, { type: 'subtitle:enter' });
  targetTabId = tab.id;

  // Auto-clean on the meeting tab going away.
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
}

export async function exit(): Promise<void> {
  if (targetTabId == null) return;
  try {
    await chrome.tabs.sendMessage(targetTabId, { type: 'subtitle:exit' });
  } catch {
    /* tab may already be gone */
  }
  tearDown();
}

function handleConnect(p: chrome.runtime.Port) {
  if (p.name !== 'sokuji-subtitle') return;
  port = p;
  p.onMessage.addListener(handlePortMessage);
  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
    // Do NOT call tearDown here — disconnects also happen on page reload while
    // subtitle mode logically continues. The reload's new content script will
    // remount the iframe; that new iframe will open a fresh port.
  });
  pushInitialState();
  installStoreSubscriptions();
}

// Session-only initial snapshot — language pair, recent items, isSessionActive.
// Subtitle settings are NOT pushed: the iframe loads them itself via the
// SettingsService-backed subtitleStore hydration.
function pushInitialState() { /* sessionStore + provider language pair */ }

// Only session state changes are forwarded. Subtitle-store changes never
// reach the port — the iframe owns its own subtitleStore.
function installStoreSubscriptions() {
  // sessionStore: items + isSessionActive + sessionStartTime
  // settingsStore: provider + getCurrentProviderSettings (for language pair updates)
}

function handlePortMessage(msg: PortInbound) {
  // Only two inbound message types:
  //   { type: 'subtitle:user-exit' }            ✕ click in overlay
  //   { type: 'subtitle:request-clear' }        Clear button in overlay
  // No 'mutate' messages — settings are not proxied through the port.
}

function handleTabRemoved(id: number) { if (id === targetTabId) tearDown(); }
function handleTabUpdated(id, info) { /* re-send enter if URL still supported, exit if not */ }
function tearDown() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  chrome.runtime.onConnect.removeListener(handleConnect);
  chrome.tabs.onRemoved.removeListener(handleTabRemoved);
  chrome.tabs.onUpdated.removeListener(handleTabUpdated);
  port?.disconnect();
  port = null;
  targetTabId = null;
  useSettingsStore.getState().__notifySubtitleSurfaceExited();
}
```

`__notifySubtitleSurfaceExited` is a new private store action that flips `subtitleModeActive=false` without re-entering `exit()` — used when the surface tears down due to a tab close or unsupported navigation.

### Content-script side (`extension/content/subtitle-overlay.js`)

A new module loaded by the existing `content.js` (or added to the `js: ["content.js", "subtitle-overlay.js"]` array in the manifest). Listens for the two top-level messages and does only the mount / unmount of the iframe host.

```js
const HOST_ID = 'sokuji-subtitle-host';
let host = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'subtitle:enter') mountHost();
  else if (msg?.type === 'subtitle:exit') unmountHost();
});

function mountHost() {
  if (host) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('subtitle-overlay.html');
  iframe.style.cssText = [
    'position: fixed',
    'bottom: 80px',
    'left: 50%',
    'transform: translateX(-50%)',
    'width: min(70vw, 1200px)',
    'height: 80px',
    'border: none',
    'background: transparent',
    'pointer-events: auto',
    'color-scheme: dark',
  ].join(';');
  iframe.allow = 'clipboard-read; clipboard-write'; // export button
  shadow.appendChild(iframe);
  document.body.appendChild(host);
}

function unmountHost() {
  if (!host) return;
  host.remove();
  host = null;
}
```

`pointer-events: none` on the host with `pointer-events: auto` on the iframe ensures only the iframe (not the surrounding host) intercepts clicks — the meeting UI stays clickable everywhere outside the bar.

### iframe page (`extension/subtitle-overlay.html` + `src/subtitle-overlay-entry.tsx`)

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sokuji subtitle</title>
    <style> html, body { margin: 0; height: 100%; background: transparent; } </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/subtitle-overlay-entry.tsx"></script>
  </body>
</html>
```

```tsx
// src/subtitle-overlay-entry.tsx
import { createRoot } from 'react-dom/client';
import { AppProviders } from './components/AppProviders';
import SubtitleApp from './components/Subtitle/SubtitleApp';
import { installSessionPortMirror } from './stores/sessionPortMirror';

// subtitleStore self-hydrates via SettingsService — no setup needed here.
// We only need to wire the session-data port channel.
installSessionPortMirror();

createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <SubtitleApp surface="extension-overlay" />
  </AppProviders>,
);
```

`installSessionPortMirror`:

- Opens `chrome.runtime.connect({ name: 'sokuji-subtitle' })`.
- Inbound messages carry **session-only** state — items, language pair, `isSessionActive`, `sessionStartTime`, provider/locale-derived bits. The handler calls `useSessionStore.setState(...)` on the iframe-side `sessionStore` mirror to keep `SubtitleApp`'s reads identical to the Electron path.
- Outbound: `subtitle:user-exit` when `SubtitleApp` requests exit (✕ click or ESC), and `subtitle:request-clear` when the user clicks the Clear button. The iframe's `sessionStore` mirror exposes `requestClearConversation()` as a thin wrapper that sends this message; the side panel's real store does the work and the cleared `items` flow back through the normal port push.
- The iframe never touches `subtitleStore` over the port — that store reads/writes via `SettingsService` directly inside the iframe context.
- On port disconnect, the iframe's last-known session state stays — there's no value in clearing it. The iframe will be unmounted by the content script via `subtitle:exit` shortly after, so this state is briefly visible at most.

### Manifest changes

```json
"web_accessible_resources": [
  {
    "resources": [
      "subtitle-overlay.html",
      "subtitle-overlay.js",
      "assets/*"
    ],
    "matches": [
      "https://meet.google.com/*",
      "https://teams.live.com/*",
      "https://teams.microsoft.com/*",
      "https://teams.cloud.microsoft/*",
      "https://app.zoom.us/*",
      "https://app.gather.town/*",
      "https://app.v2.gather.town/*",
      "https://whereby.com/*",
      "https://discord.com/*",
      "https://app.slack.com/*"
    ]
  }
]
```

The `matches` array intentionally mirrors `content_scripts.matches`. Restricting where the iframe URL can be loaded from prevents arbitrary websites from probing for Sokuji's installed status by attempting to load the URL.

The existing `web_accessible_resources` block (currently `matches: ["<all_urls>"]` for worklets and other shared assets) stays. The subtitle entry is added as a second entry with tighter matches.

`content_scripts` stays unchanged — `content.js` already runs on the nine sites. The new subtitle-overlay handler is loaded alongside it (added to the `js` array of the universal `content_scripts` entry, gated by URL inside the file).

### Vite changes

Add `subtitle-overlay.html` to `extension/vite.config.ts` `rollupOptions.input`:

```ts
rollupOptions: {
  input: {
    fullpage: path.resolve(__dirname, 'fullpage.html'),
    popup: path.resolve(__dirname, 'popup.html'),
    'subtitle-overlay': path.resolve(__dirname, 'subtitle-overlay.html'),
  },
  output: { entryFileNames: '[name].js', ... },
},
```

`subtitle-overlay.html` lives in `extension/` and `src/subtitle-overlay-entry.tsx` lives in `src/` (similar to `fullpage`'s structure). Vite bundles the React app for the overlay as a separate entry, loaded only when the meeting tab spawns the iframe.

## State (subtitleStore) {#state-subtitlestore}

v1 kept subtitle settings as a `subtitle: SubtitleSettings` slice on the global `settingsStore`. v2 **extracts them into a dedicated `subtitleStore`** owned by the Subtitle feature. This decouples the subtitle UI's modifiable state from the rest of Sokuji's settings and lets the iframe load just the subtitle store without pulling in the full settings tree.

### Why a separate store

`SubtitleApp` reads two categories of state:

1. **Modifiable from inside the subtitle UI** — every control in `SubtitleBar` + every field in `SubtitleSettingsPopover`. v1 had these on `settingsStore.subtitle.*`, plus `speakerDisplayMode` and `participantDisplayMode` which v1 shared with `MainPanel`.
2. **Read-only session / global state** — `items`, `isSessionActive`, `sessionStartTime`, current `provider`, language pair, `turnDetectionMode`. Plus one action: `requestClearConversation()`.

The category-1 state is what `subtitleStore` owns. The category-2 state stays where it lives today (`sessionStore`, `settingsStore`) and the iframe receives it via the port mirror.

### Shape

```ts
// src/stores/subtitleStore.ts

export type DisplayMode = 'source' | 'translation' | 'both';

export interface SubtitleState {
  // ──────────── Always persisted ────────────

  // Typography & layout
  fontSize: number;                 // 16–48, default 24
  compactMode: boolean;             // default false

  // Background
  bgOpacity: number;                // 0–100, default 80
  bgColor: string;                  // hex string, default '#000000'

  // Text colours
  sourceTextColor: string;          // hex, default '#ffffff'
  translationTextColor: string;     // hex, default '#9ad0ff'

  // Display modes — SUBTITLE-LOCAL.
  // v1 shared these with MainPanel via settingsStore. v2 gives the subtitle
  // its own pair so changing the bar's display mode doesn't disturb the
  // main panel and vice versa.
  speakerDisplayMode: DisplayMode;        // default 'both'
  participantDisplayMode: DisplayMode;    // default 'both'

  // Position lock (cross-platform — both Electron and extension overlay)
  positionLocked: boolean;          // default false

  // ──────────── Electron-only persisted (ignored by extension surface) ────────────

  alwaysOnTop: boolean;
  windowBounds: { x: number; y: number; width: number; height: number } | null;

  // ──────────── Actions ────────────

  setFontSize(n: number): void;
  setCompactMode(b: boolean): void;
  setBgOpacity(n: number): void;
  setBgColor(s: string): void;
  setSourceTextColor(s: string): void;
  setTranslationTextColor(s: string): void;
  setSpeakerDisplayMode(m: DisplayMode): void;
  setParticipantDisplayMode(m: DisplayMode): void;
  togglePositionLocked(): void;
  // Electron-only setters preserved for the Electron surface
  toggleAlwaysOnTop(): void;
  saveWindowBounds(b: { x: number; y: number; width: number; height: number }): void;
}
```

**Why no `overlayBounds` for the extension**: deliberately not persisted. The overlay always opens at the default centered-bottom position on each `subtitle:enter`. Rationale: the meeting tab is small, the bottom-centered default is easy to find, and users have explicitly told us this is acceptable. Skipping persistence here removes an entire class of synchronisation work (no content-script chrome.storage read on mount, no iframe-to-storage write on mouseup, no clamp-on-reapply logic, no "stored bounds went off-screen after a resolution change" edge case). If the user drags or resizes during a session, the change applies for the rest of that session and is forgotten when the iframe unmounts.

### Persistence

`subtitleStore` writes through the **same** `ServiceFactory.getSettingsService()` API that every other Sokuji setting uses today. That single service (`src/services/SettingsService.ts`) is the only piece of code in the project that touches `chrome.storage` or `localStorage`; the store layer never branches on platform itself. Behaviour:

- **Extension**: `SettingsService` delegates to `chrome.storage.sync` (consistent with the rest of Sokuji's settings — small fields, sync-friendly, cross-device coverage). Both the side-panel and the iframe contexts go through the same `SettingsService` instance pattern; only the iframe ever writes subtitle keys.
- **Electron / non-extension**: `SettingsService` delegates to `localStorage`. Same store API, same key namespace.

The key prefix stays compatible with v1: existing `settings.common.subtitle.*` values continue to read correctly. New fields added by v2 (`speakerDisplayMode`, `participantDisplayMode`) get fresh keys at `settings.common.subtitle.speakerDisplayMode` etc. with default values on first read.

`subtitlePositionLocked` is persisted as the only new bounds-related field. No `overlayBounds` key is ever written for the extension — see [Why no `overlayBounds`](#state-subtitlestore) above.

### Lifecycle state stays on settingsStore

`subtitleModeActive: boolean` is **not** part of `subtitleStore` — it's a sidepanel-controlled lifecycle flag. It lives on `settingsStore` (or a small dedicated `subtitleLifecycle` slice if we want even tighter separation). The iframe does not need to know it. Reasoning: the iframe is *running* when subtitle mode is active and *unmounted* when it isn't; there's no intermediate state it needs to react to.

The same applies to the new private `__notifySubtitleSurfaceExited()` action and the existing `enterSubtitleMode()` / `exitSubtitleMode()` actions — these stay on `settingsStore` because they coordinate the lifecycle, not the persisted look-and-feel.

### Migration from v1

v1 had `settings.subtitle.*` in `settingsStore`. v2:

1. Adds `subtitleStore` with the new field set (including the two display-mode fields).
2. On store init, reads any pre-existing `settings.subtitle.*` values and seeds the new store with them (one-time migration).
3. Removes `subtitle.*` and the subtitle-related actions / selectors from `settingsStore`.
4. **Does not** automatically migrate the v1 `speakerDisplayMode` / `participantDisplayMode` values from `settingsStore` into the subtitle store — those start at their defaults, since the spec explicitly separates main-panel and subtitle display modes from this point forward.

v1 tests for `settingsStore.subtitle.*` move to `subtitleStore.test.ts` byte-equivalently except for the renamed module.

## Component Changes

| File | Change |
|---|---|
| `src/components/Subtitle/SubtitleEnterButton.tsx` | Replace `isElectron()` guard with `isElectron() \|\| isExtension()`. No active-tab check needed — the side panel only renders on supported sites in the first place. |
| `src/components/Subtitle/SubtitleApp.tsx` | Add `surface?: 'electron' \| 'extension-overlay'` prop (default `'electron'`). When `surface === 'extension-overlay'`, skip the `subtitle:window-bounds-changed` listener. **Rebind the ESC `keydown` listener from the module-level `window` to `rootRef.current?.ownerDocument`.** The module-level `window` is bound to the side panel's window at script load even when the component renders into a second React root (Electron) or into a same-origin iframe (extension overlay), so v1's `window.addEventListener('keydown', onKey)` would silently attach to the wrong window. The fix is single-surface — adopt a `useRef` on the root `<div>` and read `rootRef.current.ownerDocument` inside the effect. Switch all subtitle settings reads from `settingsStore` to `subtitleStore`; switch the `speakerDisplayMode` / `participantDisplayMode` reads to `subtitleStore` (subtitle-local copies, not the MainPanel ones). |
| `src/components/Subtitle/SubtitleBar.tsx` | Accept `surface`. When `surface === 'extension-overlay'`: hide 📌 (`alwaysOnTop`); keep 🔒 (`positionLocked`); drop the `-webkit-app-region: drag` styling and replace it with the JS-based drag handler from [Drag and resize](#drag-and-resize). Switch settings reads to `subtitleStore`. |
| `src/components/Subtitle/SubtitleSettingsPopover.tsx` | Switch reads/writes from `settingsStore` to `subtitleStore`. Otherwise unchanged. |
| `src/components/Subtitle/SubtitleStream.tsx` | Switch `speakerDisplayMode` / `participantDisplayMode` reads from `settingsStore` to `subtitleStore`. Otherwise unchanged. |
| `src/App.tsx` | Unchanged. The side panel keeps rendering `<MainShell>` regardless of `subtitleModeActive` — the overlay is its own React root inside an iframe. Electron path keeps the existing fork. |
| `src/index.tsx` | Extract today's provider stack (i18n, theme, Auth, etc.) into a reusable `<AppProviders>` component. Used by the main mount and by `subtitle-overlay-entry.tsx`. |
| `src/stores/settingsStore.ts` | **Remove** the `subtitle: SubtitleSettings` slice and all related actions / selectors — they move to `subtitleStore.ts`. `enterSubtitleMode` / `exitSubtitleMode` actions stay here (they coordinate lifecycle) but their bodies delegate to the surface abstraction. New private `__notifySubtitleSurfaceExited` lives here. Also note: the v1 `speakerDisplayMode` / `participantDisplayMode` stay on `settingsStore` and belong exclusively to `MainPanel` now; the subtitle gets its own pair on `subtitleStore`. |
| `src/components/MainPanel/MainPanel.tsx`, `ConversationRow.tsx` (and any other readers of `speakerDisplayMode` / `participantDisplayMode`) | Unchanged — keep reading from `settingsStore`. Display-mode reads/writes on the main panel UI are now fully independent of what the subtitle shows. |

New files:

| File | Purpose |
|---|---|
| `src/stores/subtitleStore.ts` | New dedicated subtitle store (full shape in [State (subtitleStore)](#state-subtitlestore)). Persists to platform-appropriate backend. |
| `src/stores/subtitleStore.test.ts` | Unit tests for the new store, ported from existing `settingsStore.subtitle.*` tests with module/import paths updated. |
| `src/components/Subtitle/surfaces/SubtitleSurface.ts` | Interface. |
| `src/components/Subtitle/surfaces/ElectronSubtitleSurface.ts` | Existing IPC, relocated. |
| `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts` | New surface (see implementation sketch above). |
| `src/components/Subtitle/surfaces/getSubtitleSurface.ts` | Picks via `src/utils/environment.ts`. |
| `src/components/Subtitle/surfaces/index.ts` | Barrel. |
| `src/components/AppProviders.tsx` | Extracted from `src/index.tsx`. |
| `src/stores/sessionPortMirror.ts` | Iframe-side port wiring: opens the port; mirrors inbound **session** state into `sessionStore`; wraps `requestClearConversation` as a port-forwarded call. Does NOT touch `subtitleStore`. |
| `extension/subtitle-overlay.html` | New iframe entry shell. |
| `extension/content/subtitle-overlay.js` | Content-script handler for `subtitle:enter` / `subtitle:exit` mounting the iframe host; receives the iframe's drag/resize postMessages and applies clamped values to `iframe.style`. |
| `src/subtitle-overlay-entry.tsx` | React mount for the iframe. |
| `src/components/Subtitle/useOverlayDragResize.ts` | Hook used by `SubtitleBar` inside the iframe to wire drag handle + corner resize handles → `window.parent.postMessage`. Reads `positionLocked` from `subtitleStore` to gate handlers. |

Reused unchanged: `SubtitleSessionEnded`, `ConversationRow`, `DisplayModeButton`, `ExportButton`, `conversationFilter.ts`, `sessionStore` (the side-panel sessionStore module, also used by the iframe via the port-mirror seeding), all virtual-microphone / device-emulator pieces.

## Error Handling & Edge Cases

1. **Race: user navigates the active tab between sidepanel render and click.** The side panel only renders on supported sites, but a fast navigation could leave the button visible while the tab is no longer supported. `enter()` defensively re-checks the active tab's URL and throws `'not on supported site'` if mismatched; the calling action catches and reverts `subtitleModeActive` without further side effects.
2. **User starts subtitle mode, then immediately switches tabs.** The host iframe was mounted on the original tab. It stays in that tab (now inactive). Meet's own PiP takes over the user's screen if Meet has it enabled. When the user returns to the original Meet tab, the overlay is visible again — no special handling needed.
3. **User closes the meeting tab while subtitle is up.** `chrome.tabs.onRemoved` listener calls `tearDown()`; `subtitleModeActive` flips to false. No leftover state.
4. **User navigates the meeting tab to a different URL.** `chrome.tabs.onUpdated` fires with `changeInfo.url`. If the new URL is still on a supported host, send `subtitle:enter` again — the new page's freshly-loaded content script remounts the host. If not supported, exit.
5. **Meeting tab reloaded.** Same as URL change: content script reloads, port disconnects, side panel re-sends `subtitle:enter` once `tabs.onUpdated` reports `status: 'complete'`.
6. **`chrome.tabs.sendMessage` rejects** (target content script not ready, e.g. document hasn't finished loading): retry once after 250 ms; if still failing, surface a `logStore` warning and revert `subtitleModeActive`.
7. **Multiple meeting tabs open.** Subtitle is bound to the one that was active at `enter()` time. The other meeting tabs do not get a subtitle bar. v2 does not attempt automatic migration when the user switches between meeting tabs.
8. **Port disconnects unexpectedly** (extension reload, content-script crash). `port.onDisconnect` fires on the side panel. `tearDown()` is NOT called for plain disconnects — they can be transient (e.g. page reload during scenario 5). The side panel waits for either the followup `subtitle:enter` flow (driven by `tabs.onUpdated`) to restart, or for an explicit `exit()`.
9. **CSP violations on the host page.** The iframe loads from `chrome-extension://` origin, which is not subject to the host page's CSP. The host `<div>` in the meeting page DOM is just a `<div>` with inline style — no scripts inside, nothing for CSP to block.
10. **Host page CSS targeting our iframe element.** Defense in depth: Shadow DOM around the iframe element scopes Meet's `iframe { ... }` rules out. If a meeting site adds JS that walks the DOM looking for our host div, we accept that as out of scope for v2 (no obfuscation).
11. **Auth / i18n provider issues in the iframe.** `<AppProviders>` instantiates fresh in the iframe context. i18n: same JSON resources, loaded fresh. Auth: subtitle UI does not call any authenticated endpoint directly; it only reads `sessionStore` (mirrored from the side panel) and `subtitleStore` (its own). The auth provider exists to satisfy any deep `useUserProfile()` reads inside `SubtitleApp` subtrees, but no live auth call is made in the iframe.
12. **Drag past the viewport edge.** Content script clamps `x` / `y` so the bar can't leave the visible area during dragging. Since bounds aren't persisted in the extension, there's no chance of a previously-saved off-screen position being restored on the next session.
13. **Browser without extension messaging APIs** (e.g. running the same React code in some unexpected web context): `getSubtitleSurface()` returns a no-op surface whose `enter()` throws on call; `SubtitleEnterButton` doesn't render thanks to the `isElectron() \|\| isExtension()` guard.

## Testing Strategy

### Unit tests (Vitest, automated)

- `src/stores/subtitleStore.test.ts` — full coverage of the new dedicated store: setters clamp / persist appropriately, `togglePositionLocked` flips, `saveWindowBounds` persists in Electron path, defaults applied on first hydration, v1 migration reads pre-existing `settings.subtitle.*` once.
- `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts` — mock `chrome.tabs.*`, `chrome.runtime.*`:
  - `enter()` calls `chrome.tabs.sendMessage` with `subtitle:enter`, registers `onConnect` listener.
  - On port connect, initial **session** snapshot is pushed; subsequent `sessionStore` changes trigger pushes. **No** subtitle-settings push.
  - On `subtitle:user-exit` inbound, `exitSubtitleMode` is called.
  - On `subtitle:request-clear` inbound, `sessionStore.requestClearConversation` is called.
  - `tabs.onRemoved` for the target tab calls `tearDown` and flips the store.
  - `tabs.onUpdated` with new URL on supported host re-sends `subtitle:enter`; on unsupported host calls `tearDown`.
  - `enter()` on an unsupported active tab throws and does not touch listeners.
- `src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts` — covers the existing IPC behaviour, ported from current store tests so the refactor is byte-equivalent.
- `src/stores/sessionPortMirror.test.ts` — mock `chrome.runtime.connect`:
  - Inbound session-state messages populate `sessionStore` via `setState`.
  - `requestClearConversation` wrapper sends `subtitle:request-clear` over the port.
- `src/components/Subtitle/SubtitleBar.test.tsx` — adds cases that `surface="extension-overlay"` hides 📌 but keeps 🔒; that the drag handle invokes `window.parent.postMessage` with `move`/`resize` payloads; that handlers are no-ops when `positionLocked` is true.
- `src/components/Subtitle/SubtitleEnterButton.test.tsx` — adds the case that the button renders for `isElectron() || isExtension()` and is disabled when `isSessionActive=false`.
- `src/components/Subtitle/SubtitleStream.test.tsx`, `SubtitleSettingsPopover.test.tsx` — update mocks to read from `subtitleStore` instead of `settingsStore`.

### Manual test plan

`docs/superpowers/specs/2026-05-13-subtitle-mode-extension-manual-test.md` (to be written alongside the implementation plan):

- Enter from session: button enabled when session active; appears on supported meeting sites (side panel only shows there).
- Overlay appears at bottom-center of the Meet viewport on every `subtitle:enter` (position is not remembered).
- Renders bilingual rows as audio is spoken.
- Drag side-panel resize → overlay positioning is unaffected (iframe is positioned relative to the meeting tab's viewport).
- Drag the overlay by its bar → moves within viewport, clamped at edges. Drag corners → resizes. With 🔒 locked, neither does anything.
- Position / size resets to default on exit + re-enter (deliberate, see [Drag and resize](#drag-and-resize)).
- Adjust font size / compact toggle / colors / opacity inside the overlay → applies in real time, persists across exit + re-enter, persists across browser restart.
- Change `speakerDisplayMode` / `participantDisplayMode` in the overlay → only the overlay's rendering changes; MainPanel in the side panel keeps its own setting independently.
- ESC inside the overlay exits.
- ✕ in the overlay bar exits.
- Clear button in the overlay clears the session's conversation (proves the port round-trip).
- Switch away from the Meet tab → overlay invisible (in inactive tab); Meet's PiP appears if Meet user has it enabled; both behaviors stay correct switching back and forth.
- Close the Meet tab → overlay teardown is automatic; no orphaned state.
- Reload the Meet tab → overlay reappears after the content script re-injects.
- Test on Chrome and Edge stable; macOS, Windows, Linux X11, Linux Wayland.

### Out of scope for v2

- Visual regression tests (overlay rendering depends on the host page).
- End-to-end automation with a real Meet call.

## Out of Scope for v2

- **Non-meeting tabs.** Tabs outside the nine supported sites have no content script and no place to mount the iframe. A future v2.1 can use the popup+PiP architecture (verified by the demo) — `chrome.windows.create({ type: 'popup', url: 'subtitle-host.html' })` spawns a top-level browsing context that can host Document PiP. The launcher window stays minimized for the session's duration to keep the user out of a second window's chrome. Two clicks and a permanent taskbar entry are the cost, but for YouTube / arbitrary-tab scenarios it remains the only viable option Chrome offers today.
- **Compact side-panel mode** (the third surface in the original issue analysis). Could be added as `SidePanelCompactSubtitleSurface` if browsers without DOM-overlay capability ever need a fallback. Not pursued for v2.
- **Floating over non-browser apps** from the extension. Would require a companion desktop helper. Separate product decision.
- **Per-site UI integration.** v2 uses one positioning rule for all nine sites. Future work could dock the bar inside Meet's bottom toolbar, etc.
- **Auto-migration when the user switches between two Meet tabs.** v2 keeps the overlay where it was started.
- **Replacing the Electron subtitle mode.** Electron continues to use `BrowserWindow` reshape via `ElectronSubtitleSurface`.

## Critical Files

### Created

- `src/stores/subtitleStore.ts`
- `src/stores/subtitleStore.test.ts`
- `src/stores/sessionPortMirror.ts`
- `src/stores/sessionPortMirror.test.ts`
- `src/components/Subtitle/surfaces/SubtitleSurface.ts`
- `src/components/Subtitle/surfaces/ElectronSubtitleSurface.ts`
- `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`
- `src/components/Subtitle/surfaces/getSubtitleSurface.ts`
- `src/components/Subtitle/surfaces/index.ts`
- `src/components/Subtitle/surfaces/ElectronSubtitleSurface.test.ts`
- `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts`
- `src/components/Subtitle/useOverlayDragResize.ts`
- `src/components/AppProviders.tsx`
- `src/subtitle-overlay-entry.tsx`
- `extension/subtitle-overlay.html`
- `extension/content/subtitle-overlay.js`
- `docs/superpowers/specs/2026-05-13-subtitle-mode-extension-manual-test.md` (during implementation)

### Modified

- `src/stores/settingsStore.ts` — **remove** the `subtitle.*` slice, actions, selectors (they move to `subtitleStore`). Keep / refactor `enterSubtitleMode` / `exitSubtitleMode` to delegate to the surface abstraction. Add private `__notifySubtitleSurfaceExited`. `speakerDisplayMode` / `participantDisplayMode` slices stay here and now belong exclusively to `MainPanel`.
- `src/components/Subtitle/SubtitleEnterButton.tsx` — replace `isElectron()` guard with `isElectron() || isExtension()`.
- `src/components/Subtitle/SubtitleApp.tsx` — accept `surface` prop; guard the bounds-changed listener; rebind ESC listener to `rootRef.current.ownerDocument`; switch store imports from `settingsStore` to `subtitleStore` for subtitle reads.
- `src/components/Subtitle/SubtitleBar.tsx` — accept `surface` prop; hide 📌 (keep 🔒) and drop the `-webkit-app-region: drag` styling when `surface === 'extension-overlay'`; integrate the new `useOverlayDragResize` hook; switch settings reads to `subtitleStore`.
- `src/components/Subtitle/SubtitleStream.tsx` — switch `speakerDisplayMode` / `participantDisplayMode` reads to `subtitleStore` (now subtitle-local).
- `src/components/Subtitle/SubtitleSettingsPopover.tsx` — switch reads/writes to `subtitleStore`.
- `src/index.tsx` — render through the new `<AppProviders>` wrapper.
- `extension/manifest.json` — add `subtitle-overlay.html` to `web_accessible_resources` (matched to the nine meeting hosts); add `content/subtitle-overlay.js` to the `content_scripts[0].js` array.
- `extension/vite.config.ts` — add `subtitle-overlay` rollup input; add `content/subtitle-overlay.js` to the static-copy list.
- `src/i18n/*.json` — no new keys; existing `subtitle.*` keys reused.

### Reused as-is (no modification)

- `src/components/Subtitle/SubtitleSessionEnded.tsx`
- `src/components/MainPanel/ConversationRow.tsx`
- `src/components/MainPanel/DisplayModeButton.tsx`
- `src/components/MainPanel/ExportButton.tsx`
- `src/components/MainPanel/conversationFilter.ts`
- `src/stores/sessionStore.ts`
- `electron/subtitle-window.js`
- `electron/preload.js`
- `electron/main.js`
- `extension/content/content.js`, `virtual-microphone.js`, `device-emulator.iife.js`, `site-plugins.js`, `zoom-content.js` (subtitle module is additive, doesn't touch these)
- `extension/background/background.js` (already gates the side panel to supported sites — no change needed)

## Verification

1. **Build & launch (extension)**:

   ```
   cd extension && npm run build
   ```

   Load `extension/dist` as an unpacked extension in Chrome ≥ 116.

2. **Smoke test the round trip**:
   - Open the side panel; configure a provider; start a session.
   - Open Google Meet in another tab; join a meeting (or create a test one).
   - Activate the Meet tab; the subtitle button in the conversation toolbar is enabled.
   - Click it. A subtitle bar appears at the bottom of the Meet viewport.
   - Speak / play audio; bilingual rows scroll into the bar.
   - Click the ✕ in the bar; the overlay disappears; the side panel is unaffected.

3. **Settings persistence**:
   - Enter subtitle mode, change font size and opacity inside the overlay popover, exit.
   - Re-enter subtitle mode — same font size, same opacity.

4. **Tab-switch behavior**:
   - With the overlay up on Meet, switch to a non-Meet tab. Overlay is hidden (in the inactive Meet tab). If Meet has auto-PiP enabled, Meet's PiP appears.
   - Switch back to the Meet tab. Overlay is visible again; Meet's PiP closes.

5. **Tab-close behavior**:
   - Close the Meet tab while subtitle is up. `subtitleModeActive` returns to false in the side panel. Side panel UI updates accordingly.

6. **Session-end behavior**:
   - With overlay up, stop the session from the side panel. Overlay swaps to `<SubtitleSessionEnded>`; clicking Return exits.

7. **Automated tests**:

   ```
   npm run test
   ```

8. **Manual test plan**: run `2026-05-13-subtitle-mode-extension-manual-test.md` on Chrome and Edge stable, macOS / Windows / Linux X11 / Linux Wayland, before release.
