# LAN Caption Sharing — Design

**Date**: 2026-10-04
**Status**: Approved section by section in brainstorming with jiangzhuo; revised after his first
review (decisions 3 and 10).
**Origin**: kizuna-ai-lab/sokuji discussion #556 ("share a QR code so people can watch on their phones").
**Reference board** (private claude.ai artifact, screenshots of 30+ products and the mockups this
design follows): https://claude.ai/artifact/L4XdZhs5iXK4AY7gdMMv4U
`file:line` references are verified against `d2f8001b` (`chore(release): v0.42.3`).

## 1. Goal

One person runs Sokuji on a desktop computer. Other people on the same network open a page in a
browser, on a phone or a laptop, and read the live conversation: captions and translations, as the
Sokuji user sees them. Two settings, same feature:

- **A talk or meetup.** One speaker, tens of listeners. The QR code is projected; phones scan it,
  laptops type the address. Listeners may first need to be told which Wi‑Fi to join.
- **An office or meeting room.** One colleague runs Sokuji, a few others watch on their own
  laptops or phones. Everyone is already on the company network; the link goes into the team chat,
  or people scan the QR code on that colleague's screen. No projector, no Wi‑Fi step.

Throughout this document **host** means the person running Sokuji and sharing, and **viewer** means
a person watching on another device.

## 2. Decisions

Settled in brainstorming; each was a choice between listed alternatives.

1. **Desktop (Electron) only, same network only.** The browser extension cannot listen on a port.
   Nothing goes through Kizuna AI's servers, so the `/privacy` claim "No request carrying audio,
   transcripts or translations is ever addressed to Kizuna AI" stays true unchanged. Rejected: a
   cloud relay (breaks that claim), WebRTC peer-to-peer and third-party pub/sub (not needed while
   the scope is one network).
2. **Transport: an HTTP server in the main process, pushing with Server-Sent Events.** Node's own
   `http`, no new runtime dependency; SSE reconnects by itself, which covers phones that lock and
   come back. Rejected: WebSocket (`ws` would become a runtime dependency, and heartbeat and
   reconnect would be ours to write, for a one-way stream); serving the app's own `index.html` in a
   viewer mode (phones would download the whole app and run its sign-in and analytics start-up).
3. **The viewer page mirrors the host's conversation.** It keeps what the host keeps and loses what
   the host loses: a Stop leaves it as it is, a new Start empties it (the host's own conversation is
   replaced at that moment, `src/lib/session/runner.ts:190`), and Clear empties it, which also gives
   the host a way to take something back. Rejected: accumulating across runs while Clear clears
   viewers (chosen first, then reversed by jiangzhuo: if Clear can wipe the viewer pages, a new Start
   should too); accumulating with Clear affecting only the host.
4. **No access barrier in v1.** The address is `http://<ip>:<port>/`; anyone on the network who
   knows it can watch while sharing is on. Mitigations that remain: sharing is off at every launch,
   it ends when the host turns it off or quits, and the address is only reachable on that network.
   Rejected for v1: a 4-digit room number in the path; an optional access code (listed for v2).
5. **The viewer chooses a language, not a role.** The choices are the two languages of the pair and
   "both": 中文 / 双语 / 日本語. In a meeting the host's side speaks Japanese (Chinese is the
   translation) while the other side speaks Chinese (Chinese is the original), so "show me Chinese"
   picks the original of one entry and the translation of the other. Rejected: 译文 / 双语 / 原文.
6. **No audio in v1, and no sound button anywhere.** Translated speech for viewers is v2.
7. **Viewers can save the transcript in v1, only when the host allows it.** When the host has not
   allowed it, the save action does not exist on the viewer page: no disabled row, no "the host has
   not enabled this" text.
8. **The Wi‑Fi hint is optional, off by default, and typed by the host.** Sokuji never reads stored
   Wi‑Fi passwords or the network name: a stored password needs administrator rights on Windows
   (`netsh … key=clear` shows an empty Key Content otherwise) and a keychain prompt on macOS;
   802.1X company networks have no shared password; projecting a company password is inappropriate.
   Even the network name needs location permission on Windows 11 24H2 (a one-time "Let desktop apps
   access your precise location?" prompt) and on macOS 14.4+; asking for location to fill a hint is
   not worth it. Linux could read it silently, but the three platforms would then behave
   differently.
9. **Nothing about sharing is persisted.** "Allow saving", the Wi‑Fi hint switch, the Wi‑Fi name
   and password, and whether the Windows firewall note was seen live in memory and are gone when
   Sokuji quits. Sharing is off at every launch.
10. **Analytics on the host side only**: two events, sharing started and sharing ended (§7.5), with
    no content in them. The viewer page sends nothing to anyone.
11. **The UI uses the app's existing components and styles**, on the host panel and on the viewer
    page alike (§9).
12. **Controls appear only when they can be used.** No button for an unbuilt feature; an option the
    viewer cannot use is hidden, not disabled with an explanation.
13. **Side labels**: when both sides have spoken, the viewer page names the side "现场" / "线上"
    (English source strings "On site" / "Remote"): the host's microphone side and the meeting-audio
    side. Shown as a tag where the side changes, with a coloured stripe per line (§5.2).

## 3. Architecture

Three parts. Data flows one way: host renderer → main process → viewers.

```
Host renderer                         Main process                          Viewer browser
─────────────                         ────────────                          ──────────────
conversation view ─► share publisher ─IPC─► caption-share server ─SSE─► viewer page (/)
runner resets    ─┘   (diff, state)          (log, viewers, routes)        present page (/present,
host panel ◄──────────── status push ───────┘                               loopback only, own window)
```

### 3.1 Share publisher (renderer, `src/lib/share/`)

- **Source.** The app session's conversation view, the same `view` the subtitle feed is built from
  (`src/app/session.ts:265-270`); entries arrive at most every 50 ms (`VIEW_INTERVAL_MS`,
  `src/lib/view/conversationView.ts:29`).
- **What it sends.** Each `Entry` of kind `exchange` (`src/lib/projection/types.ts:26-47`) becomes a
  `ViewerEntry` (§4.1): id, leg, start time, the pair, and the source and translation rows with
  their text and `final` flag. Notices (errors, warnings) are not shared. No audio, no provider
  details.
- **Diff.** The publisher keeps what it last sent and posts only upserts and removals; it mirrors the
  view, so an entry that leaves the view is removed. Entry ids carry the run's session id
  (`src/lib/projection/project.ts:58, 85-88`), so a line of an old run is never mistaken for a line
  of the new one.
- **Resets.** The runner gains `onConversationReset(listener: (reason: 'clear' | 'restart') => void)`,
  fired by `runner.clear()` (`src/lib/session/runner.ts:311-314`, the one path behind the toolbar's
  Clear, `src/components/MainPanel/MainPanel.tsx:245-249`) and when a start replaces the
  conversation (`runner.ts:190`). The publisher sends `clear` with that reason and forgets what it
  sent. A reset is never inferred from entries disappearing. The view's update and the reset may
  arrive in either order; both orders end in the same page.
  Implemented as `ConversationSet.onReset` (`runner.conversation.onReset`): `replace` and `clear`
  both pass through that object.
- **State.** Alongside the entries: the phase (`live` while the runner is running, `idle`
  otherwise), the language pair, and `allowSave`. The pair is the selected provider's
  (`providerStore.entries[selected].pair`, the one the surfaces show and a run starts with), not
  the stored pick `settings.common.sourceLanguage/targetLanguage`: that is empty until the host
  picks, and may name a language the provider does not offer (final review, C1).
- **Lifetime.** The publisher exists while sharing is on. It is started and stopped by the host
  panel's store (§7).

### 3.2 Caption-share server (main, `electron/caption-share.js`)

- Listens on `0.0.0.0`, trying ports 7788 to 7797 and taking the first free one. The port stays
  fixed for the whole sharing session.
- Keeps the shared conversation: an insertion-ordered map from entry id to `ViewerEntry`, emptied on
  `clear`, capped at 5,000 entries (oldest dropped first; a two-hour talk is about 1,500).
- Serves the routes in §4.3, counts open viewer streams, and pushes status to the host renderer.
- Opens and closes the present window (§7.3).
- Registered once at module load in the `setupX(...)` shape the other main modules use
  (`electron/transcript-save.js`, `electron/subtitle-window.js`), and added to the main-process
  entry map (`vite.config.ts:136-165`).

### 3.3 Viewer bundle (`viewer.html`, `src/viewer/`)

- A second HTML input in the root Vite build (`vite.config.ts` gains
  `build.rollupOptions.input = { main: 'index.html', viewer: 'viewer.html' }`; output stays in
  `build/`, assets in `build/static/`, `vite.config.ts:271-272`).
- One small React app with two modes chosen by path: `/` is the viewer page, `/present` the
  projector page.
- It loads nothing from outside the host: no analytics, no web fonts, no CDN. A viewer device with
  no internet access works.
- It imports the shared components and SCSS it needs (§9) but none of the app's stores, providers,
  auth or session code.

## 4. Protocol

### 4.1 Types

```ts
interface ViewerRow { key: string; text: string; final: boolean }

interface ViewerEntry {
  id: string;                                   // Entry id, unique across runs
  leg: 'speaker' | 'participant';
  t: number;                                    // the exchange's `t`
  languages: { source: string; target: string }; // frozen per run; reversed on the participant leg
  source: ViewerRow[];
  translation: ViewerRow[];
}

interface ShareState {
  phase: 'live' | 'idle';
  pair: { source: string; target: string };
  allowSave: boolean;
}
```

### 4.2 Renderer → main (IPC)

Channels follow the `ns:verb` naming and are added to `INVOKE_CHANNELS`
(`electron/ipc-channels.js:33`); the status push is added to `validReceiveChannels`
(`electron/preload.js:62`). Handlers check the sender is the main window, like `main.js` does.

| Channel | Payload | Result |
|---|---|---|
| `caption-share:start` | `ShareState` | `ShareStatus` or an error code (`ports-busy`, `listen-failed`) |
| `caption-share:stop` | — | — |
| `caption-share:patch` | `{ upsert: ViewerEntry[]; remove: string[] }` | — |
| `caption-share:clear` | `{ reason: 'clear' \| 'restart' }` | — |
| `caption-share:state` | `ShareState` | — |
| `caption-share:select-address` | `{ address: string }` | `ShareStatus` |
| `caption-share:set-wifi` | `{ wifi: { ssid: string; password: string } \| null }` | — |
| `caption-share:present` | — | — (opens the present window, or focuses it) |
| push `caption-share:status` | `ShareStatus` | — |

```ts
interface ShareStatus {
  running: boolean;
  port: number | null;
  addresses: Array<{ address: string; label: string; kind: 'wifi' | 'wired' | 'other' | 'virtual' }>;
  selected: string | null;                      // the address the QR code and URL use
  viewers: number;                              // open viewer streams (present excluded)
  addressChanged: boolean;                      // the selected address went away and was replaced
}
```

### 4.3 Routes

Only `GET`. Everything else is 404.

| Path | Who | Serves |
|---|---|---|
| `/` | anyone on the network | `viewer.html` |
| `/static/*` | anyone on the network | the viewer bundle's assets, from the build output only |
| `/events` | anyone on the network | the viewer stream (§4.4); counts as one viewer |
| `/present` | loopback only | `viewer.html` (present mode) |
| `/present/events` | loopback only | the present stream; not counted as a viewer |

- **Host header**: must be an IP literal or `localhost` (with any port). Anything else is 403. This
  stops a website from reading the stream through DNS rebinding.
- **Static files**: only the files the viewer entry needs, read from Vite's build manifest (the root
  build turns on `build.manifest`); every other file under `build/`, the main app's bundle included,
  is 404. Paths that resolve outside the build directory are refused before the lookup.
- **Headers** on every response: `Content-Security-Policy: default-src 'self'; img-src 'self' data:;
  media-src 'self' data:; style-src 'self' 'unsafe-inline'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- **Production** reads the build output from `path.join(app.getAppPath(), 'build')`, inside the asar
  (the same base `main.js:469` loads `index.html` from). **Development** forwards non-stream
  requests to the Vite dev server on `localhost:5173`, which serves `viewer.html` as a second page.

### 4.4 Streams

Viewer stream `/events`, as SSE events (`event:` name, JSON `data:`):

| Event | Data | When |
|---|---|---|
| `snapshot` | `{ state: ShareState; entries: ViewerEntry[] }` | first message of every connection |
| `upsert` | `{ entries: ViewerEntry[] }` | entries added or changed |
| `remove` | `{ ids: string[] }` | entries left the host's view |
| `clear` | `{ reason: 'clear' \| 'restart' }` | the host pressed Clear, or a new run started |
| `state` | `{ state: ShareState }` | phase, pair or `allowSave` changed |
| `ended` | `{}` | sharing ended; the server closes the stream right after |

- `retry: 3000` is sent first; a comment line every 15 s keeps the connection alive and lets the
  server notice dead sockets.
- A reconnecting viewer gets a fresh `snapshot`; no event replay is kept.
- A write error drops that one viewer.

Present stream `/present/events`: one event, `present`, with
`{ url: string; pair; phase; viewers: number; wifi: { ssid; password } | null }`, sent on connect
and whenever any of it changes; `ended` as above.

## 5. Viewer page

### 5.1 Entering

- Title "Sokuji 字幕" (no event name in v1); under it the pair, e.g. "日本語 ⇄ 中文".
- "我看" with three choices, single-select rows in the app's option-row style: the source language,
  双语, the target language. Preselected: the browser language if it matches one side of the pair
  (`navigator.languages`, matched on the base subtag), otherwise 双语.
- No name field.
- A "开始看" button. The tap also starts the keep-awake video (§5.6).
- One line of small text: the address bar says "Not secure" because this is a local network
  address, and the captions come straight from the host's computer.

### 5.2 Captions

- **One language chosen**: each entry shows its text in that language: the translation rows where
  the entry's target is that language, the source rows where its source is. **Both**: the chosen
  language first and large; the other below, smaller and muted. If one side has no text yet, only
  the other shows. Tapping the selected 双语 again swaps which language leads; while selected, its
  label names the order shown, e.g. "中文 ⇄ 日语" (his ruling 2026-10-04, after the live look).
- **Sides** (revised 2026-10-04 after the live look, replacing the dots and the legend, which read
  alike): once both legs have appeared, every line carries a 3px stripe down its left edge in its
  side's colour (on site green, remote blue-violet: far apart in hue), and the line where the side
  changes carries the side's name ("现场" / "线上") above it. No legend in the bar.
- **Unfinished text** (rows with `final: false`): lighter, with a dashed underline. With "只显示完整句"
  on, unfinished rows are not drawn.
- **Following**: the list follows new text. Scrolling up (touch or wheel) stops following and shows
  a "回到当前" pill; tapping it, or End on a keyboard, resumes.
- **Text is selectable.** Every entry of the current conversation stays in the page's DOM, so the
  browser's own find (Ctrl+F) searches all of it.

### 5.3 Layout by width

| Width | Typical | Captions | Controls |
|---|---|---|---|
| < 600px | phone; a laptop window made narrow | one column, chosen language above, other below | one "Aa 显示设置" button at the right of the status line; no bottom bar (revised 2026-10-04: its 看什么 and 更多 both opened the same sheet, and it took two or three lines of captions) |
| 600–1000px | tablet; half-screen window | one centred column, about 36 CJK characters wide | top bar |
| ≥ 1000px | laptop full screen | both: side by side, one row per entry, time on the left; one language: centred column, large | top bar, shortcut hints in the footer |
| fullscreen (F) | used as a screen in the room | top bar hidden, one font step larger | Esc leaves |

Keyboard (desktop): `+` / `-` font size, `B` toggles both, `F` fullscreen, `End` back to live.

### 5.4 Settings (bottom sheet on phones, the ⋯ menu on wider screens)

- 字号: four steps (小 / 中 / 大 / 特大). Default 大 on phones, 中 on wider screens.
- 配色: 深色 (default) / 浅色 / 高对比 (yellow on black).
- 只显示完整句: off by default.
- 保持屏幕常亮: on by default.
- 保存本场字幕 (only when `allowSave`): builds a `.txt` from the entries in the page and downloads it
  with a Blob link (works over plain HTTP). Format: one block per entry, local time, then the lines
  in the chosen language(s). Reuses `formatLocalTime` and `exportFilename` from
  `src/utils/conversationExport.ts`.
- Footer line: "字幕由 AI 生成，仅供参考".
- These preferences are kept in the viewer browser's `localStorage` (`sokuji.viewer.*`), every
  access wrapped in try/catch.

### 5.5 States

Shown in the top status text and in the document title (`● 直播中 · Sokuji 字幕` and so on).

| State | Condition | Page |
|---|---|---|
| 等待开始 | connected, `phase: idle`, no entries yet | an empty list with that line |
| 直播中 | `phase: live` | green dot |
| 已暂停 | `phase: idle`, entries present | entries stay |
| 重新连接中 | the stream dropped, the browser is retrying | entries stay |
| 分享已结束 | `ended` received | reconnecting stops; save stays if it was allowed |

On `clear` the list empties and one line stays at the top until the next entry arrives:
"讲者清空了之前的字幕" for `clear`, "讲者开始了新的一轮" for `restart`.

### 5.6 Keep-awake

The page is served over plain HTTP, so the Screen Wake Lock API is unavailable (secure contexts
only). The "开始看" tap starts a tiny muted, looping, inline video embedded in the bundle, which
mobile browsers treat as playing media; it is resumed on `visibilitychange`. Whether this also
holds off a laptop's display sleep on Windows and macOS is not known and is on the live-test list.

### 5.7 Language of the page

- The page follows the browser language among the app's 30 catalogs, falling back to English.
- Its strings live under `viewer.*` in `src/locales/<lang>/translation.json` and are compiled into
  the viewer bundle through `import.meta.glob('../locales/*/translation.json', { eager: true,
  import: 'viewer' })` (Vite's JSON named exports), so only that subtree of each catalog ships.
  As built: the build shares whole catalogs with the main app, so named exports did not keep the
  other subtrees out (§13's fallback). `scripts/gen-viewer-strings.mjs` writes the `viewer`
  subtrees to `src/viewer/strings.generated.ts`, and a test fails when it drifts from the catalogs.
- The page uses a small lookup function, not i18next.

## 6. Present page

- Opened by the host into its own Electron window (§7.3), at `http://127.0.0.1:<port>/present`.
- Title "用手机或电脑看字幕" and the pair.
- Step 1, only when the host turned on the Wi‑Fi hint: the network name, the password as text when
  one was given, and a Wi‑Fi QR code (`WIFI:T:WPA;S:<ssid>;P:<password>;;`, or `WIFI:T:nopass;S:<ssid>;;`
  without a password; `\ ; , : "` escaped).
- Step 2: the share QR code, and under it the full address in large monospace type, including
  `http://` (without a scheme some browsers try HTTPS first).
- Step 3: "选你要看的语言".
- A corner line: the number of devices watching, and "这个地址只在同一个网络里打得开".
- Under it, one line for Android (his live test 2026-10-05, his pick of the projector page only):
  Chrome on Android reaches a LAN address only with its "Nearby devices" permission allowed
  (Android's local network permission), and shows `ERR_TOO_MANY_RETRIES` otherwise; the viewer
  page never loads to say so. "安卓 Chrome 打不开？在「设置 → 应用 → Chrome → 权限 → 附近设备」里允许。"
  iPhone needs no line: Chrome and Safari there work once the phone is on the same Wi‑Fi.
- `F` or a button toggles fullscreen; Esc leaves it.

## 7. Host side

### 7.1 Entry point

- A toolbar button in `.conversation-toolbar` (`src/components/MainPanel/panel/PanelToolbar.tsx:100`),
  rendered only when `isElectron()`. It uses the existing `font-size-btn` class and a lucide icon
  (`Cast`), like its neighbours.
- While sharing is on, the button shows an active state and the number of devices watching.
- It opens a popover built the way the display-settings popover is (`useFloating`, `useClick`,
  `useDismiss`, `useRole('dialog')`, `FloatingPortal`; `PanelToolbar.tsx:65-96, 197-209`).
- Nothing about sharing appears in the Settings pages.

### 7.2 Panel

**Off**
- One sentence: "让同一个网络里的人用手机或电脑看这里的字幕和译文".
- A `ToggleSwitch` "开启分享".
- On Windows only, until the first successful start in this run of the app: "开启后 Windows 可能会问
  是否允许 Sokuji 访问网络，请选『专用网络』。"

**On**
- QR code on the left. On the right the address (monospace) with a "复制" button; the clipboard
  works in the Electron renderer.
- "网络": a dropdown, shown only when there is more than one address. The recommended address
  first; virtual and VPN adapters last, marked "通常连不上".
- "在看": N 台设备.
- `ToggleSwitch` "允许听众保存本场字幕" (off).
- `ToggleSwitch` "投屏页加 Wi‑Fi 提示" (off). When on, two `FormInput`s: Wi‑Fi 名称 (placeholder
  "例如 Meetup-Guest") and 密码 (may stay empty). They are used only by the present page.
- Buttons: "打开投屏页" (secondary) and "结束分享" (turns sharing off). Under them: "结束后，听众的页面
  显示『分享已结束』。"

**Messages** (`StatusMessage`, shown only while their condition holds)
- Warning, after 2 minutes with no device ever connected: "开了 2 分钟，还没有设备连上。这个网络可能把
  设备互相隔离了（访客 Wi‑Fi、部分公司网络会这样），也可能是防火墙拦住了。可以试试：确认大家和这台电脑连的是
  同一个网络；在 Windows 上允许 Sokuji 访问专用网络；或者改用手机热点、自带的路由器。" It disappears once a
  device connects.
- Warning, when the selected address went away: "网络变了，地址已经换成 <address>，请重新发链接或重新投屏。"
- Error, when the server cannot start: "没能开启分享：端口 7788–7797 都被占用了。" or "没能开启分享：<reason>".
  The switch returns to off.

### 7.3 Present window

- A normal, resizable `BrowserWindow` titled "Sokuji 投屏", loading the loopback `/present` URL.
- "打开投屏页" focuses it if it is already open. Ending sharing closes it.
- The Wi‑Fi hint values go to main with `caption-share:set-wifi` whenever the host edits them
  (`null` while the hint is off) and reach the page through the present stream; they are never
  written to disk. `caption-share:present` only opens or focuses the window.

### 7.4 Store

`src/stores/captionShareStore.ts`, a zustand store with no persistence: `status` (the latest
`ShareStatus`), `allowSave`, `wifiHint: { enabled, ssid, password }`, `firewallNoteSeen`, the start
time and the peak viewer count of the current share (for §7.5), and the start/stop actions that also
start and stop the publisher. Persisting nothing is decision 9.

### 7.5 Analytics

Host side only, through `useAnalytics().trackEvent` and two new entries in `AnalyticsEvents`
(`src/lib/analytics.ts:8`):

| Event | Properties | When |
|---|---|---|
| `caption_share_started` | `{ address_kind: 'wifi' \| 'wired' \| 'other' \| 'virtual' }` | the server started and the panel shows the address |
| `caption_share_ended` | `{ duration_ms: number; peak_viewers: number }` | the host turned sharing off |

- No address, port, language, Wi‑Fi detail or caption text is sent. A failed start sends nothing.
- Ends caused by quitting the app, a reload or a renderer crash are not tracked: the renderer that
  would send the event is already gone.
- The viewer page imports no analytics code.

## 8. Network and lifecycle

- **Addresses.** `os.networkInterfaces()`, IPv4, not internal, not `169.254.0.0/16`. Kinds by
  interface name: Wi‑Fi (`wlan*`, `wlp*`, `Wi-Fi`, `WLAN`, macOS `en0` when it is the Wi‑Fi
  service), wired (`eth*`, `enp*`, `Ethernet`, `以太网`), virtual (`docker*`, `br-*`, `veth*`,
  `vEthernet*`, `VirtualBox*`, `vboxnet*`, `VMware*`, `vmnet*`, `utun*`, `tun*`, `tap*`, `wg*`,
  `tailscale*`, `ZeroTier*`, and any address in `100.64.0.0/10`). Order: Wi‑Fi, wired, other,
  virtual; private ranges before public within a kind. The default gateway is not looked up in v1.
  The ranking is a pure function in `electron/caption-share-net.js`.
  Windows `Local Area Connection* N` (Mobile Hotspot) and macOS `bridgeN` (Internet Sharing) are
  *other*, not virtual: they are the right address when phones join the computer's own hotspot.
- **Network changes.** While sharing, the address list is re-read every 10 s. If the selected
  address is gone, the new first choice is selected and the status carries `addressChanged: true`.
- **Ending.** Sharing ends when the host turns it off, when the app quits (`before-quit`,
  `main.js:630`), or when the main window's renderer reloads or crashes (its publisher and in-memory
  settings are gone, so the server must not run on). Ending sends `ended` to every stream, then
  closes the server and the present window.
- **Firewalls.** Listening on `0.0.0.0` makes Windows Defender Firewall ask once whether Sokuji may
  accept connections; the panel's note (§7.2) prepares the host. On macOS the application firewall,
  when enabled, may ask too. Company machines may have firewall rules managed by IT that the host
  cannot change; the 2-minute warning names the firewall as a cause.

## 9. Components and styling

Copy the nearest existing instance of each control (the markup and class names are not checked by
any tool). Both the host panel and the viewer page use:

| Need | Use |
|---|---|
| switches | `src/components/Settings/shared/ToggleSwitch.tsx` |
| buttons | `src/components/Settings/shared/Button.tsx` (`primary` / `secondary` / `ghost`, `sm` / `md`) |
| text inputs | `src/components/Settings/shared/FormInput.tsx` |
| warnings and errors | `src/components/Settings/shared/StatusMessage.tsx` |
| 2–4-way choices (字号, 配色, 我看 on wide screens) | the segmented-control archetype of `src/components/MainPanel/ModePicker.scss`, selection by `state-selected-fill` (`src/components/Settings/shared/_variables.scss:139-155`) |
| single-select rows (the 我看 rows on entering) | the `option-row` mixin (`_variables.scss`) |
| toolbar icon button | `font-size-btn` in `PanelToolbar.tsx` |
| colours, spacing, type | `src/styles/_tokens.scss` and `Settings/shared/_variables.scss` |

The viewer page's light and high-contrast schemes are additions on top of those tokens. The viewer
page has its own layout SCSS; it does not import `Settings.scss` or `MainPanel` styles wholesale.
The scheme a viewer picks colours the whole page, chrome included — the phone's settings button,
the settings sheet or menu, the desktop's top bar and footer, the entry screen — not only the
caption area (his ruling 2026-10-04, after the live look): the controls keep the app's shapes, and
their colours come from per-scheme tokens (`--v-chrome-*`, `--v-control-*`, `--v-accent*`).

## 10. Error handling

- Server start fails: the IPC result carries `ports-busy` or `listen-failed`; the panel shows the
  error and the switch returns to off. Reported once with `reportError` on the renderer side.
- An IPC call from the publisher fails: `reportError` with a `dedupeKey`, once per failing streak;
  the publisher keeps its last-sent state so the next success re-syncs by a full resend.
- Per-viewer write errors: that stream is dropped, nothing else.
- The viewer page never logs to the console; failures show as page state (重新连接中, 分享已结束).
  `src/viewer` is added to the console ledger's scanned paths at zero calls
  (`src/lib/diagnostics/consoleLedger.consistency.test.ts:54`), since the viewer cannot reach the
  app's `report()` sinks (it runs on other devices).
- Main-process code follows the existing `electron/` conventions.

## 11. Testing

Test-first, as the repo works.

1. **Pure functions** (renderer and viewer): `Entry` → `ViewerEntry` (notices dropped, rows kept
   with `final`); the publisher's diff (upsert, change, removal when an entry leaves the view) and
   resets (`clear` and `restart`, each with the view update arriving before and after); text by language (one language, both, two legs with reversed pairs); the
   viewer reducer over every stream event; default language from `navigator.languages`; follow and
   stop-following; width → layout; the `.txt` format; Wi‑Fi QR escaping; address ranking with real
   Windows, macOS and Linux interface names.
2. **Main server** (`electron/caption-share.test.js`, stubbing `electron` the way
   `electron/subtitle-window.test.js` does, with a real server on 127.0.0.1): port fallback when
   7788 is taken; snapshot then increments; viewer count up and down, present streams not counted;
   heartbeat (fake timers); Host header refusal; `..` paths refused; `/present` refused for
   non-loopback addresses (the predicate tested directly); the 5,000-entry cap; `ended` before close;
   ending on renderer reload and crash.
3. **Repository consistency tests**: new channels in `ipc-channels.js` and the preload receive list
   (`electron/ipc-channels.test.js`); the new main file in the entry map
   (`electron/entry-map.consistency.test.js`); `src/viewer` in the console ledger; the 30 catalogs in
   lockstep (`src/locales/locales.consistency.test.ts`).
4. **Components**: the host panel off and on; no network dropdown with one address; the 2-minute
   warning (fake timers); no toolbar button outside Electron; `caption_share_started` on a
   successful start only and `caption_share_ended` with duration and peak viewers on turning off
   (a mocked `trackEvent`). The viewer page: no save action unless allowed; every state, including
   both reset notes; nothing under `src/viewer` imports the analytics module or PostHog. Because the suites never load a catalog, a test checks both directions:
   every `viewer.*` key the viewer code uses exists in `en`, and every `en` `viewer.*` key is used.
5. **Build**: after `npm run build`, `build/viewer.html` exists, and the viewer bundle references no
   external origin.

### Live test (the owner's, after the build)

- iPhone Safari and Android Chrome by QR; Chrome, Edge, Safari and Firefox on laptops by typed
  address and by a link pasted into chat.
- Windows: the firewall prompt on the first start, and what happens when it is refused. macOS and
  Linux: starting sharing.
- Changing networks while sharing; quitting Sokuji; reloading the main window.
- Keep-awake on a phone and on a laptop (Windows and macOS).
- The present window dragged to a second display and made fullscreen.
- A guest Wi‑Fi with client isolation: the 2-minute warning.
- A Stop (viewer pages keep their lines), a new Start (viewer pages empty), and Clear (viewer pages
  empty).

## 12. Out of scope for v1

- Translated speech for viewers (v2).
- An access code or room number (v2).
- A fixed address that survives restarts, for printed QR codes (v2).
- A one-click A4 sheet to print (v2).
- Each viewer choosing a language outside the pair (needs extra translation legs).
- Viewer questions, viewer speech, live correction.
- An event title.
- The browser extension and the web build.

## 13. Risks and things the plan must verify first

- **JSON named exports tree-shaking.** §5.7 assumes `import: 'viewer'` keeps other catalog subtrees
  out of the bundle. The first plan task checks the built chunk; if it fails, the fallback is a
  build step that writes `src/viewer/strings.generated.ts` from the catalogs.
- **Two-input build.** Adding `rollupOptions.input` to the root config must leave `index.html`'s
  output and the Electron packaging (`forge.config.js` ignore list, `package.json` `build.files`)
  working; both already allow all of `/build`. Rollup may move modules both entries import into a
  shared chunk; the manifest-based allowlist (§4.3) follows those imports, and the plan checks that
  the main app's chunks are not on it.
- **Keep-awake on laptops** is unverified (§5.6).
- **macOS signing.** With the self-signed build, the macOS application firewall may ask again after
  an update; noted for the live test.
- **Open network.** Decision 4 accepts that anyone on the network can watch while sharing is on.
