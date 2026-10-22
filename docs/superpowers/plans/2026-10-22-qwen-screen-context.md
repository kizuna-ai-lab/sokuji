# Screen Context for the Qwen Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With the Qwen LiveTranslate engine (own key, or KizunaAI Powered by Qwen), the user can let the model see one window, tab or screen they choose, so the names on screen come out right in the transcript and the translation.

**Architecture:** A `FrameSource` leaf on the Qwen leg's `StartRequest` is the only thing the adapter learns; the adapter declares video on the wire only when the leaf is present, sends the first frame right after the first audio chunk and forwards later frames as they come. One renderer module (`src/lib/screen/`) owns sampling, change detection, the blank-frame guard, keep-alives and the lost/back states for both platforms; Electron lists sources through `desktopCapturer.getSources` and captures the pick with `chromeMediaSourceId`, the extension captures the meeting tab through one shared tab stream. The picker runs before the run starts; a control-bar chip is the required cue. The backend budgets the managed session's video add-on from a per-second constant and publishes it.

**Tech Stack:** TypeScript, React, Zustand, vitest (jsdom), Electron 44 (`desktopCapturer`, `getUserMedia` with `chromeMediaSource: 'desktop'`), Chrome MV3 (`tabCapture.getMediaStreamId`), Hono + D1 on the backend, i18next catalogs (30 app, 12 site).

**Spec:** `docs/superpowers/specs/2026-10-22-qwen-screen-context-design.md` (this repository, same branch). Section numbers below (§3.2, §7…) are the spec's.

**Repositories and branches.** Part A and the client half of Part B land on `feat/qwen-screen-context` in kizuna-ai-lab/sokuji (this worktree, `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/qwen-keepalive`). The backend tasks (Part B's backend half, Part C) land in kizuna-ai-lab/sokuji-backend on a new branch `feat/qwen-screen-context` cut from `origin/main` (2cd323a, which already carries the Qwen setup guide and the engines pages) in the worktree `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend/.claude/worktrees/docs-kizuna-qwen` (currently on `docs/kizuna-qwen-engines`; `git -C <worktree> checkout -b feat/qwen-screen-context origin/main` first). Nothing is pushed and no PR is opened by this plan: the owner does that.

**Order.** A (Tasks 1–8) → B (Tasks 9–13) → C (Task 14). A ships the feature on an own key. Part B must land before the release that unflags `kizunaai_qwen`: a managed session with frames and no add-on in its budget overruns its grant. C's screenshots come from a dev build of A.

## Global Constraints

- The switch is off by default and lives in the provider slice: `settings.qwenLiveTranslate.screenContext` and `settings.kizunaQwen.screenContext` (boolean); the managed twin shares `QwenSettings`, `QWEN_DEFAULTS` and `migrateQwenSettings` (§3.1, §4).
- The source is never persisted; nothing about the last source is remembered or preselected; every run picks from scratch (§3.1, §7).
- The adapter declares `input_modalities: ["audio","video"]` only when its `StartRequest` carries a `frames` source; without one it never declares video and never sends an image (§3.2, hard rule).
- A frame is `{"type":"input_image_buffer.append","image":"<base64 JPEG>"}`; the client sends at most 1 frame/s; the JPEG is capped at 375 KB so its base64 stays under the server's 500 KB (execution ruling); the picture is scaled to fit inside 1280×720 and never upscaled; JPEG quality starts at 0.85 (§2, §3.2).
- The first frame goes out immediately after the first audio chunk that reaches the socket (push-to-talk: the first press's first chunk; the keepalive's silence counts, execution ruling); then on change (mean absolute difference > 6/255 on a 64×36 grey thumbnail), with a keep-alive every 60 s measured from the last send in every state; blank frames — flat ones, variance ≈ 0 on the grey thumb, black included; a dark slide with a bright title is not blank (execution ruling) — are never sent (§3.2, §6).
- A lost source stops sampling, the chip turns red ("Not available"; the card's Choose again button on the desktop), the session continues; while lost the last good frame is re-sent on the keep-alive deadline (§3.3).
- Frames are never logged: a `frame` event carries `{ bytes, reason }` only; the conformance checker refuses any byte array in a frame payload (`src/lib/contract/conformance.ts`, "carries audio") (§3.2).
- Inside the adapter: no store, no reporter, no global timer or wall clock (`src/providers/sessionSide.consistency.test.ts` pins Qwen's session side to `adapter.ts`, `endpoints.ts`, `segments.ts`, `wire.ts`); no `console.error`/`console.warn` anywhere under `src/providers` (`consoleLedger.consistency.test.ts`); elsewhere failures go through `reportWarning` (CLAUDE.md, Error Handling).
- Indicator = option D: a chip with an eye, the source's name and a green/amber/red dot; a card on hover or click; icon-only in the basic layout and the extension's side panel; no border window, no OS cue redrawn (§3.4, §7).
- App copy uses words only: no price figure, no currency sign, no percentage in any new app string (§3.5, §7). Every new key goes into all 30 catalogs under `src/locales/*/translation.json`, translated, in lockstep with `en` (`locales.consistency.test.ts`).
- Managed billing: the session-key body carries `screenContext: boolean`; the worst-case constant is 240 tokens per second of speech, per leg; `/api/pricing` publishes the add-on as `screenContextUsdPerHour`; no pre-K figure is ever published (0.55, 3.3, 0.4752, 2.8512 join the denylist) (§3.5).
- Analytics: `screen_context_on` (source kind window/screen/tab, platform) at run start and `screen_context_lost`; never a title, never pixels (§3.6).
- Electron: `desktopCapturer.getSources({ types: ['window','screen'] })` on every desktop platform; on macOS the Screen Recording status is read before the list is asked for; on Linux `WebRTCPipeWireCapturer` joins both feature lists in `electron/linux-gpu-flags.js` (the `--enable-features` switch keeps its last occurrence, and electron-audio-loopback's `initMain()` writes one too) (§3.1, §4). Windows system audio does NOT use `chromeMediaSourceId` (it goes through electron-audio-loopback's display-media handler): the desktop capture here uses `getUserMedia` with `chromeMediaSource: 'desktop'`, which never touches that handler.
- Extension: one capture per tab (a `tabCapture` stream id is consumed once); frames leave whenever the switch is on and a run is live; the frame is cropped to the largest visible `<video>` when there is one (§4, §7).
- Commits are conventional (`feat(screen-context): …`, `test: …`, `docs: …`), in English, and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Test commands: client `node_modules/.bin/vitest run <paths>` from the client worktree (jsdom, `src/setupTests.ts`; Electron and extension tests run under the same root); backend `node_modules/.bin/vitest run <paths>` from the backend worktree (one flat project: `src/**` and `web/src/**`), typecheck `npx tsc --noEmit`.

## Review Focus

1. **The picker is cancelled, or the chosen area shows nothing** (minimized, covered, black): the run must start on audio alone with video never declared — a declared modality with no frame kills the session at its first turn. Tests: Task 4 (`first()` null on blank captures), Task 7 (`start()` with a cancelled pick or a blank first frame hands the runner no `frames`).
2. **A frame arrives before any audio has gone up** (push-to-talk before the first press, a slow first chunk): it must be held and sent right after the first audio, once; a frame arriving after that goes at once. Test: Task 3.
3. **Frames after `stop()`**: a source still ticking after the leg stopped must send nothing and emit no event (`stop-silence`); a leg that failed before the first audio must unsubscribe too. Tests: Task 3 (conformance scenarios with a fake source that emits after stop; a failed start).
4. **macOS without the Screen Recording permission**: the picker must show the privacy pane button and never a list of black thumbnails; the list must not be asked for while the status is `denied`. Tests: Task 5 (handler), Task 8 (picker).
5. **A frame over the cap** (375 KB of JPEG, so the base64 stays under the server's 500 KB; a dense window at 720p): the server refuses an oversize frame; the sampler must re-encode at a lower quality and skip the frame if it is still over, never send it. Test: Task 4.

---

## Part A — the client feature (kizuna-ai-lab/sokuji)

### Task 1: The switch — `screenContext` in the Qwen settings and its view

**Files:**
- Modify: `src/providers/qwen_livetranslate/settings.ts:90-115` (`QwenSettings`, `QWEN_DEFAULTS`, `migrateQwenSettings`)
- Modify: `src/providers/qwen_livetranslate/QwenSettings.tsx:34-73` (`QwenSettingsView`, after the `PresetVoiceField` at line 54-57)
- Modify: `src/locales/*/translation.json` (30 catalogs) under `providers.qwen_livetranslate`
- Test: `src/providers/qwen_livetranslate/settings.test.ts`, `src/providers/qwen_livetranslate/QwenSettings.test.tsx`

**Interfaces:**
- Produces: `QwenSettings.screenContext: boolean` (default `false`); `migrateQwenSettings` keeps a stored boolean and defaults anything else. Both providers read it: the managed twin (`kizuna.ts`, `settingsKey: 'kizunaQwen'`) shares the base's `settings`, `migrate` and `Settings` view through `managed()`.

- [ ] **Step 1: Write the failing tests**

In `settings.test.ts`, beside the migrate test at line 20:

```ts
it('starts with screen context off, keeps a stored boolean and defaults anything else', () => {
  expect(QWEN_DEFAULTS.screenContext).toBe(false);
  expect(migrateQwenSettings({ screenContext: true }).screenContext).toBe(true);
  expect(migrateQwenSettings({ screenContext: 'yes' }).screenContext).toBe(false);
  expect(migrateQwenSettings({}).screenContext).toBe(false);
});
```

In `QwenSettings.test.tsx`, in the `QwenSettingsView` block:

```ts
it('offers Screen context as a switch under the voice, off by default, writing only that field', () => {
  const update = vi.fn();
  render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} />);
  const sw = screen.getByRole('switch', { name: 'Screen context' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(sw);
  expect(update).toHaveBeenCalledWith({ screenContext: true });
});
it('locks the switch while a run is not idle, and says in words only where frames go and how they are billed', () => {
  render(<QwenSettingsView settings={QWEN_DEFAULTS} update={() => {}} disabled />);
  expect(screen.getByRole('switch', { name: 'Screen context' })).toBeDisabled();
  const row = screen.getByTestId('qwen-screen-context');
  expect(row.textContent).toMatch(/Alibaba Cloud/);
  expect(row.textContent).not.toMatch(/[$¥%\d]/);
});
it('the managed view shows the same switch', () => {
  render(<KizunaQwenSettingsView settings={QWEN_DEFAULTS} update={() => {}} />);
  expect(screen.getByRole('switch', { name: 'Screen context' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/providers/qwen_livetranslate/settings.test.ts src/providers/qwen_livetranslate/QwenSettings.test.tsx`
Expected: FAIL — `screenContext` is not a property; no element with role `switch`.

- [ ] **Step 3: Implement the field and the row**

`settings.ts`: add `screenContext: boolean` to `QwenSettings` (doc: "Let the model see one chosen window, tab or screen (spec 2026-10-22); the source is picked at Start and never stored."), `screenContext: false` in `QWEN_DEFAULTS`, and in `migrateQwenSettings` `screenContext: typeof stored.screenContext === 'boolean' ? stored.screenContext : false`.

`QwenSettings.tsx`: after the `PresetVoiceField`, a `<div className="settings-section" id="qwen-screen-context-section" data-testid="qwen-screen-context">` holding a `SettingRow` (`src/components/Settings/shared/SettingRow.tsx`, props `label`, `tooltip`, `switch: { checked, onChange, disabled }`; its switch takes the row's label as its accessible name) with `label = t('providers.qwen_livetranslate.screenContext', 'Screen context')` and the tooltip below, and under it a `setting-description` line `t('providers.qwen_livetranslate.screenContextWhere', …)`.

Copy (en; the 29 other catalogs get translations of the same):
- `screenContext`: `Screen context`
- `screenContextTooltip`: `Lets the Qwen engine see one window, tab or screen you choose when a session starts, so the names and terms on it are recognized and translated as written. Everything inside that area is sent to Alibaba Cloud's Qwen service, in the region of this session, as pictures; Kizuna AI never receives them. With a Kizuna AI account it adds to the charge for every second of speech while it is on — in Both mode for each direction; the rate is on your account's pricing page.`
- `screenContextWhere`: `In the desktop app you pick the window or screen when the session starts. In the browser extension the meeting tab is used.`

Add the three keys to every catalog under `providers.qwen_livetranslate` (next to `vocabularyTranslationsTooltip`), translated into each catalog's language; `node scripts/sync-locale-keys.mjs` only fills English placeholders and is not a substitute.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/providers/qwen_livetranslate src/locales/locales.consistency.test.ts`
Expected: PASS (the catalog test confirms the 30 are in lockstep).

- [ ] **Step 5: Commit**

```bash
git add src/providers/qwen_livetranslate/settings.ts src/providers/qwen_livetranslate/settings.test.ts src/providers/qwen_livetranslate/QwenSettings.tsx src/providers/qwen_livetranslate/QwenSettings.test.tsx src/locales
git commit -m "feat(screen-context): the Screen context switch on both Qwen providers, off by default"
```

### Task 2: The contract — `FrameSource` on the `StartRequest`, and the test kit's fake source

**Files:**
- Modify: `src/lib/contract/adapter.ts:40-50` (`StartRequest`)
- Modify: `src/lib/contract/testing/drive.ts:51-62` (`DriveOptions`) and `:126-127` (the request literal)
- Create: `src/lib/contract/testing/fakeFrames.ts`
- Test: `src/lib/contract/testing/fakeFrames.test.ts`

**Interfaces:**
- Produces, in `adapter.ts`:

```ts
export type FrameReason = 'first' | 'changed' | 'keepalive';
/** One chosen capture area, as the Qwen adapter consumes it (spec 2026-10-22 §4): a leaf the capture layer implements. */
export interface FrameSource {
  /** For the chip and the Logs; never a frame. */
  name: string;
  kind: 'window' | 'screen' | 'tab';
  /**
   * Frames as they come, at most one a second; the loss of the source; its return.
   * A subscriber that joins while a frame is in hand gets it at once, reason 'first'.
   * Returns the unsubscribe.
   */
  subscribe(onFrame: (jpeg: Uint8Array, reason: FrameReason) => void, onLost: () => void, onBack: () => void): () => void;
}
```
  and `StartRequest.frames?: FrameSource` with the doc "The chosen capture area, for the Qwen adapter; absent: no screen context, and no adapter declares video."
- Produces, in `fakeFrames.ts` (test-only, under the kit's folder so `sessionSide.consistency.test.ts` admits it):

```ts
export interface FakeFrameSource extends FrameSource {
  /** Hands every subscriber a frame; `reason` defaults to 'changed'. */
  emit(jpeg?: Uint8Array, reason?: FrameReason): void;
  lose(): void;
  back(): void;
  /** Subscribers still attached. */
  readonly subscribers: number;
}
/** `inHand`: a frame handed to each subscriber at subscribe, reason 'first'. */
export function fakeFrameSource(o?: { name?: string; kind?: FrameSource['kind']; inHand?: Uint8Array | null }): FakeFrameSource;
export const JPEG_A: Uint8Array; // 3 bytes, distinct from
export const JPEG_B: Uint8Array;
```
  Defaults: `name: 'Fake window'`, `kind: 'window'`, `inHand: null`.
- `DriveOptions.frames?: FrameSource`, passed through to the `StartRequest` the driver builds.

- [ ] **Step 1: Write the failing test**

```ts
describe('fakeFrameSource', () => {
  it('hands a frame in hand to each subscriber at subscribe, then every emit, until unsubscribed', () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const got: Array<[Uint8Array, FrameReason]> = [];
    const off = src.subscribe((j, r) => got.push([j, r]), () => {}, () => {});
    expect(got).toEqual([[JPEG_A, 'first']]);
    src.emit(JPEG_B);
    expect(got[1]).toEqual([JPEG_B, 'changed']);
    off();
    src.emit(JPEG_A);
    expect(got).toHaveLength(2);
    expect(src.subscribers).toBe(0);
  });
  it('tells every subscriber a loss and a return', () => { /* lose() → onLost once each; back() → onBack once each */ });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node_modules/.bin/vitest run src/lib/contract/testing/fakeFrames.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types, the fake and the drive option**

The fake keeps a `Set` of subscriber triples. In `drive.ts`, add `frames?: FrameSource` to `DriveOptions` and spread it into the `adapter.start({...})` literal only when defined (so a request without a source has no `frames` key).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/lib/contract src/providers/sessionSide.consistency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contract/adapter.ts src/lib/contract/testing/drive.ts src/lib/contract/testing/fakeFrames.ts src/lib/contract/testing/fakeFrames.test.ts
git commit -m "feat(contract): a FrameSource on the StartRequest, with the kit's fake"
```

### Task 3: The wire and the adapter — declare video with a source, first frame after the first audio, forward the rest, report a lost source

**Files:**
- Modify: `src/providers/qwen_livetranslate/wire.ts:31-69` (`SessionUpdate`, `sessionUpdate`), `:71-84` (frame builders)
- Modify: `src/providers/qwen_livetranslate/adapter.ts` (`QwenLeg`: fields near `:144-157`, `open()` `:167-176`, `up()` `:251-262`, `turnDone()` `:302-319`, `handshake()` `:464-472`, `shutDown()` `:641-656`)
- Modify: `src/lib/diagnostics/clientDiagnostics.ts:26-51` (one row), `src/lib/view/noticeText.ts:62-66` (`NOTICE_WORDS`), `src/locales/*/translation.json` (`notices.screen_context_lost`, 30 catalogs)
- Test: `src/providers/qwen_livetranslate/wire.test.ts`, `src/providers/qwen_livetranslate/adapter.test.ts`, `src/lib/view/noticeText.test.ts` (unchanged, must stay green)

**Interfaces:**
- Consumes: `FrameSource`, `FrameReason`, `fakeFrameSource`, `JPEG_A/B` (Task 2); the kit in `testing.ts` (`startQwen`, `openQwen`, `qwenSession`, `SERVER`) — give `startQwen` an optional `frames?: FrameSource` it passes into the request.
- Produces:
  - `sessionUpdate(c, o: { video: boolean }): SessionUpdate` — with `video` the session gains `input_modalities: ['audio', 'video']` (placed first in `session`); without, the key is absent. `SessionUpdate.session.input_modalities?: Array<'audio' | 'video'>`.
  - `imageFrame(jpeg: Uint8Array): string` — `JSON.stringify({ type: 'input_image_buffer.append', image: <base64 of the bytes> })`.
  - `CLIENT_DIAGNOSTICS.screen_context_lost: { severity: 'warning' }` with the doc "The chosen capture area is gone (window closed, tab gone, capture failed); the session continues on audio. Frames resume if it comes back."
  - `NOTICE_WORDS.screen_context_lost = 'The screen you chose is no longer available; translation continues on audio alone. Choose again from the screen chip.'` and the same sentence under `notices.screen_context_lost` in `en` (the test at `noticeText.test.ts:160` requires `en.notices` to equal `NOTICE_WORDS`), translated in the 29 others.
  - Frame events: `out input_image_buffer.append { bytes: number, reason: FrameReason }` per image sent; `out session.screen_context_back` on return.

Adapter behaviour, pinned by the tests below: `open()` subscribes when `request.frames` is present (`this.stopFrames = frames.subscribe(...)`); `latest: { jpeg, reason } | null` holds the newest frame until the first audio has gone up; `audioWent` becomes true inside `up()` and `turnDone()` right after a `ws.send(appendFrame(...))`, and at that moment `latest` (if any) is sent with its reason; thereafter every frame is sent at once while `live()`; `onLost` → `events.degraded({ code: 'screen_context_lost', message: 'The chosen screen is no longer available; translation continues on audio alone.' })`; `onBack` → the frame above; `shutDown()` calls `stopFrames()`. The adapter never times anything for frames (the sampler owns the cadence); it never reads `frames.name` into a message.

- [ ] **Step 1: Write the failing wire tests** (in `wire.test.ts`, beside line 20-28)

```ts
it('declares video beside audio only when asked, as the first key of the session', () => {
  expect(sessionUpdate(preset, { video: true }).session.input_modalities).toEqual(['audio', 'video']);
  expect('input_modalities' in sessionUpdate(preset, { video: false }).session).toBe(false);
  expect(Object.keys(sessionUpdate(preset, { video: true }).session)[0]).toBe('input_modalities');
});
it('frames an image as base64 under input_image_buffer.append', () => {
  expect(JSON.parse(imageFrame(new Uint8Array([255, 216, 255])))).toEqual({ type: 'input_image_buffer.append', image: '/9j/' });
});
```
(Every existing `sessionUpdate(x)` call in `wire.test.ts` and `adapter.test.ts:151-163` gains `, { video: false }`.)

- [ ] **Step 2: Write the failing adapter tests** (in `adapter.test.ts`, a new `describe('the Qwen LiveTranslate adapter: screen context (spec 2026-10-22)')`)

```ts
it('without a source never declares video and never sends an image, however much audio goes up', async () => {
  const h = await qwenSession();
  expect(h.sent().find((m) => m.type === 'session.update')!.session).not.toHaveProperty('input_modalities');
  h.session.appendAudio(chunk()); h.session.appendAudio(chunk());
  expect(types(h.socket())).not.toContain('input_image_buffer.append');
});
it('with a source declares video, and sends the frame in hand right after the first audio chunk, once, framed with its size and reason', async () => {
  const src = fakeFrameSource({ inHand: JPEG_A });
  const h = await qwenSession({ frames: src });
  expect(h.sent().find((m) => m.type === 'session.update')!.session.input_modalities).toEqual(['audio', 'video']);
  expect(types(h.socket())).not.toContain('input_image_buffer.append'); // nothing before audio
  h.session.appendAudio(chunk());
  expect(types(h.socket()).slice(-2)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append']);
  h.session.appendAudio(chunk());
  expect(types(h.socket()).filter((t) => t === 'input_image_buffer.append')).toHaveLength(1);
  expect(h.frames('input_image_buffer.append')).toEqual([{ bytes: 3, reason: 'first' }]);
  noSecret(h.log);
});
it('a frame that arrives after the first audio went is sent at once; one that arrives before it waits for that audio', async () => {
  const src = fakeFrameSource({ inHand: null });
  const h = await qwenSession({ frames: src });
  src.emit(JPEG_A, 'first');
  expect(types(h.socket())).not.toContain('input_image_buffer.append');
  h.session.appendAudio(chunk());
  expect(types(h.socket()).slice(-1)).toEqual(['input_image_buffer.append']);
  src.emit(JPEG_B);
  expect(h.frames('input_image_buffer.append')).toEqual([{ bytes: 3, reason: 'first' }, { bytes: 3, reason: 'changed' }]);
});
it('push-to-talk: the first press\'s first chunk is the audio the first frame follows', async () => {
  const src = fakeFrameSource({ inHand: JPEG_A });
  const h = await qwenSession({ context: MANUAL_CTX, frames: src });
  h.session.beginTurn(); h.session.appendAudio(chunk());
  expect(types(h.socket()).slice(-2)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append']);
});
it('a lost source degrades the leg once with screen_context_lost, its return is framed, and a second loss degrades again', async () => {
  const src = fakeFrameSource({ inHand: JPEG_A });
  const h = await qwenSession({ frames: src });
  src.lose(); src.lose();
  expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['screen_context_lost']);
  src.back();
  expect(h.of('frame').map((e) => e.payload.type)).toContain('session.screen_context_back');
  src.lose();
  expect(h.of('degraded')).toHaveLength(2);
});
it('stop unsubscribes: a frame after stop sends nothing and says nothing; a start that fails unsubscribes too', async () => {
  const src = fakeFrameSource({ inHand: JPEG_A });
  const h = await qwenSession({ frames: src });
  await h.session.stop();
  expect(src.subscribers).toBe(0);
  const before = h.log.length; src.emit(JPEG_B);
  expect(h.log).toHaveLength(before);
  const failing = fakeFrameSource();
  const f = await openQwen({ frames: failing });
  f.socket().receive(/* an `error` event before the update is confirmed, as the test at adapter.test.ts:168 sends it */);
  await expect(f.starting).rejects.toBeInstanceOf(AdapterStartError);
  expect(failing.subscribers).toBe(0);
});
it('runs every conformance scenario with a source that keeps emitting, after stop included, without a violation', async () => {
  // A second harness, built as `harness()` is at adapter.test.ts:40 but with `frames: fakeFrameSource({ inHand: JPEG_A })`
  // in every scenario's drive options, and one closing step after the driver's stop that calls `emit(JPEG_B)`.
  const withFrames = harnessWithFrames();
  for (const name of scenarioNames(withFrames)) expect((await runScenario(withFrames, name)).violations).toEqual([]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/providers/qwen_livetranslate/wire.test.ts src/providers/qwen_livetranslate/adapter.test.ts`
Expected: FAIL — `sessionUpdate` takes one argument; `imageFrame` undefined; no `input_modalities`.

- [ ] **Step 4: Implement the wire, the adapter, the diagnostic row and the words**

Wire: the two functions above; `handshake()` calls `sessionUpdate(this.request.config, { video: this.request.frames !== undefined })`. Adapter: the fields `stopFrames: () => void = () => {}`, `latest`, `audioWent = false`; a private `sendImage(jpeg, reason)` that `ws.send(imageFrame(jpeg))` then `this.frame('out', 'input_image_buffer.append', { bytes: jpeg.byteLength, reason })`; a private `audioSent()` called after each `ws.send(appendFrame(...))` in `up()` and `turnDone()`. Diagnostics: the row; `NOTICE_WORDS`; the catalogs (30, translated).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/providers/qwen_livetranslate src/lib/view/noticeText.test.ts src/lib/diagnostics src/locales/locales.consistency.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/qwen_livetranslate src/lib/diagnostics/clientDiagnostics.ts src/lib/view/noticeText.ts src/locales
git commit -m "feat(screen-context): the Qwen adapter declares video with a source and sends the first frame after the first audio"
```

### Task 4: Pixels and the sampler — change detection, the blank guard, keep-alives, lost and back

**Files:**
- Create: `src/lib/screen/pixels.ts`, `src/lib/screen/sampler.ts`
- Test: `src/lib/screen/pixels.test.ts`, `src/lib/screen/sampler.test.ts`

**Interfaces:**
- Consumes: `Clock` (`src/lib/contract/clock.ts`: `now()`, `setTimeout(fn, ms): () => void`), `createVirtualClock` (`:126`), `FrameSource`, `FrameReason`.
- Produces, `pixels.ts` (pure):
  - `fitInside(width: number, height: number, max = { width: 1280, height: 720 }): { width: number; height: number }` — the largest size with the same aspect that fits; never larger than the input.
  - `greyThumb(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, thumb = { width: 64, height: 36 }): Uint8Array` — box-averaged luma (`0.299R + 0.587G + 0.114B`).
  - `meanAbsDiff(a: Uint8Array, b: Uint8Array): number` — 0..255; lengths must match.
  - `isBlank(grey: Uint8Array): boolean` — mean < 8, or variance < 1.
  - `export const CHANGE_THRESHOLD = 6`.
- Produces, `sampler.ts`:

```ts
export interface Picture { rgba: Uint8ClampedArray; width: number; height: number }
export interface Capture {
  name: string;
  kind: FrameSource['kind'];
  /** The current picture at its own size, or null when the source yields nothing (closed, minimized, ended). */
  grab(): Promise<Picture | null>;
  /** The picture fitted inside 1280×720 as a JPEG at `quality` (0..1). */
  encode(picture: Picture, quality: number): Promise<Uint8Array>;
}
export type SamplerStatus = 'idle' | 'live' | 'stale' | 'lost';
export interface SamplerState { status: SamplerStatus; name: string; kind: FrameSource['kind']; sent: number; lastSentAt: number | null; lastReason: FrameReason | null; lastJpeg: Uint8Array | null }
export interface Sampler {
  /** What the adapters subscribe to; stable across attach/detach. */
  readonly source: FrameSource;
  attach(capture: Capture): void;
  /** The capture is gone by the owner's hand (Choose again in flight): status lost, the last good frame kept. */
  detach(): void;
  /** The first non-blank frame, or null once `FIRST_FRAME_MS` has passed without one. */
  first(): Promise<Uint8Array | null>;
  state(): SamplerState;
  onState(listener: (s: SamplerState) => void): () => void;
  close(): void;
}
export const SAMPLE_MS = 1000, KEEPALIVE_MS = 60_000, FIRST_FRAME_MS = 3000, MAX_BYTES = 500_000, QUALITIES = [0.85, 0.7, 0.5] as const;
export function createSampler(clock: Clock): Sampler;
```
  Cadence: one `grab()` every `SAMPLE_MS` from `attach`; the thumb of the grab is compared with the thumb of the last SENT frame; a frame is emitted as `'first'` (none sent yet), `'changed'` (diff > `CHANGE_THRESHOLD`) or `'keepalive'` (`KEEPALIVE_MS` since the last send, unchanged); blank grabs are skipped; `grab()` null → `onLost` once, status `lost`, and the last good JPEG re-emitted every `KEEPALIVE_MS` as `'keepalive'`; a non-null grab after a loss → `onBack`, then the frame as `'changed'`; `status` is `stale` when the last emit was a keep-alive. `sent` counts emits. The fake capture in tests is a function returning pictures (solid colours, a gradient for "not blank", and `null`), with `encode` returning `quality`-sized byte arrays so the size cap can be exercised.

- [ ] **Step 1: Write the failing pixel tests**

```ts
it('fits inside 1280×720 without upscaling', () => {
  expect(fitInside(1920, 1080)).toEqual({ width: 1280, height: 720 });
  expect(fitInside(720, 1280)).toEqual({ width: 405, height: 720 });
  expect(fitInside(800, 600)).toEqual({ width: 800, height: 600 });
});
it('reduces a picture to a 64×36 grey thumb, and tells a flat or black one from a lit one', () => {
  expect(isBlank(greyThumb(solid(0, 0, 0, 128, 72), 128, 72))).toBe(true);
  expect(isBlank(greyThumb(solid(40, 40, 40, 128, 72), 128, 72))).toBe(true);   // flat
  expect(isBlank(greyThumb(gradient(128, 72), 128, 72))).toBe(false);
});
it('measures the mean absolute difference, 0 for the same picture', () => {
  const a = greyThumb(gradient(128, 72), 128, 72);
  expect(meanAbsDiff(a, a)).toBe(0);
  expect(meanAbsDiff(a, greyThumb(solid(255, 255, 255, 128, 72), 128, 72))).toBeGreaterThan(CHANGE_THRESHOLD);
});
```

- [ ] **Step 2: Write the failing sampler tests**

Fixtures: `createVirtualClock(0)`; `scripted(pictures: Array<Picture | null>)` is a `Capture` whose `grab()` returns the next entry (the last one repeating) and whose `encode(picture, quality)` returns `new Uint8Array(Math.round(quality * 1_000_000 * picture.width / 1280))` — so a 1280-wide picture is 850 000 bytes at 0.85, 700 000 at 0.7 and 500 000 at 0.5, a 640-wide one half that; `lit(seed)` a 1280×720 gradient picture whose grey thumb differs from `lit(seed + 1)` by more than 6 and from `lit(seed + 0.1)` by less than 6; `BLACK` and `FLAT` solid pictures. A recorder subscribes and keeps `[reason, bytes][]`.

```ts
it('emits the first non-blank picture as first, to late subscribers too, and resolves first() with it', async () => {
  // script [BLACK, FLAT, lit(1)]: nothing at 1 s and 2 s; at 3 s ['first', 425000]; a subscriber joining at 4 s gets ['first', 425000] at once; await first() === that frame
});
it('resolves first() with null after 3 s of blank pictures, emitting nothing', async () => {
  // script [BLACK]: advance(3000) → first() resolves null, recorder empty, state().status === 'idle'
});
it('emits changed only past the threshold, never more than once a second, and a keepalive after 60 s unchanged', async () => {
  // script [lit(1), lit(1.1), lit(2), lit(2)]: 1 s first, 2 s nothing, 3 s changed, then nothing until 63 s: keepalive; reasons === ['first','changed','keepalive'] at [1000, 3000, 63000]
});
it('a grab of nothing is a loss told once; the last good frame goes again every 60 s; the picture back is back then changed', async () => {
  // script [lit(1), null, null, …, lit(2) at 130 s]: onLost called once (at 2 s), status 'lost'; at 62 s and 122 s ['keepalive', <lit(1) bytes>]; at 130 s onBack once then ['changed', …]; status 'live'
});
it('re-encodes a frame over 500 KB at 0.7 then 0.5, and skips it when still over', async () => {
  // 1280-wide lit(1): encode asked at 0.85, 0.7, 0.5 → emitted with bytes 500000. With MAX_BYTES set by a capture that returns 1.2× the sizes: three tries, nothing emitted, first() still pending
});
it('status is live after a change, stale after a keepalive, lost after a loss; sent counts emits and lastReason names the last', async () => { /* state() after each advance of the third test */ });
it('detach is a loss by the owner, attach of a new capture is back; close leaves no timer armed', async () => {
  // detach() → onLost once, status 'lost'; attach(scripted([lit(5)])) → onBack, ['changed', …]; close() → clock's armed timers === [] and a later advance emits nothing
});
it('two subscribers each get every frame; unsubscribing one leaves the other', async () => { /* both records equal after 3 s; after off() of the first, only the second grows */ });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/lib/screen`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `pixels.ts` and `sampler.ts`**

Pure arithmetic in `pixels.ts`. In `sampler.ts` one `clock.setTimeout` chain per attached capture (re-armed after each grab resolves, so a slow grab never overlaps), one keep-alive deadline, and a subscriber `Set`; `first()` returns a promise settled by the first emit or by a `FIRST_FRAME_MS` timer. No `console.*`; nothing imported from the stores.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/lib/screen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/screen/pixels.ts src/lib/screen/pixels.test.ts src/lib/screen/sampler.ts src/lib/screen/sampler.test.ts
git commit -m "feat(screen-context): the frame sampler — change detection, blank guard, keep-alives, lost and back"
```

### Task 5: Desktop capture — the source list in the main process, the pick captured in the renderer

**Files:**
- Create: `electron/capture-sources.js`, `electron/capture-sources.test.js`
- Modify: `electron/main.js` (two `ipcMain.handle`s beside `check-screen-recording-permission` at `:1279`; `desktopCapturer` is already imported at `:1`), `electron/ipc-channels.js:33-114` (two names under a `// Screen context` comment), `electron/linux-gpu-flags.js:47-48`, `electron/linux-gpu-flags.test.js`
- Create: `src/lib/screen/desktopFrames.ts`, `src/lib/screen/canvasCapture.ts`
- Test: `src/lib/screen/desktopFrames.test.ts`, `electron/ipc-channels.test.js` (unchanged, must stay green)

**Interfaces:**
- Produces, `electron/capture-sources.js` (CommonJS, no Electron import — everything injected):
  - `pickableSources(sources, ownIds)` → `[{ id, name, kind: 'window' | 'screen', thumbnail: string /* data URL */, appIcon: string | null }]`: windows first (as listed), then screens; a source whose `id` is in `ownIds` or whose `name` is empty is dropped; `kind` from the id prefix (`window:` / `screen:`).
  - `captureSourceMode(platform, env)` → `'portal'` when `platform === 'linux'` and (`env.XDG_SESSION_TYPE === 'wayland'`, or `env.WAYLAND_DISPLAY` set with no `XDG_SESSION_TYPE`), else `'list'`. Two lines of its own; `linux-gpu-flags.js` sniffs the same variables for the GPU flags and is not reused.
  - `listCaptureSources({ screenRecording, getSources, ownIds })` → `Promise<{ ok: true, sources } | { ok: false, error }>`: when `screenRecording()` is `'denied'` it answers `{ ok: false, error: 'screen-recording-denied' }` **without calling `getSources`**; else it awaits `getSources()` (already mapped to `{ id, name, thumbnail: dataURL, appIcon: dataURL | null }`), filters with `pickableSources(…, ownIds())`, and turns a throw into `{ ok: false, error: message }`.
- `main.js`:
  - `ipcMain.handle('capture-source-mode')` → `{ mode: captureSourceMode(process.platform, process.env), screenRecording }` (`screenRecording` = `systemPreferences.getMediaAccessStatus('screen')` on macOS, `'granted'` elsewhere).
  - `ipcMain.handle('list-capture-sources')` → `listCaptureSources({ screenRecording, getSources, ownIds })` with `getSources = () => desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true }).then(map)` (each `thumbnail`/`appIcon` NativeImage → `toDataURL()`) and `ownIds = () => BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId())`. On a `'portal'` desktop the same call opens the portal and returns the single source the user picked.
- `linux-gpu-flags.js`: `VULKAN_FEATURES = 'Vulkan,SharedArrayBuffer,WebRTCPipeWireCapturer'`, `NO_VULKAN_FEATURES = 'SharedArrayBuffer,WebRTCPipeWireCapturer'`.
- Produces, `src/lib/screen/desktopFrames.ts`:

```ts
export type Invoke = (channel: string, data?: unknown) => Promise<unknown>;
export interface CaptureSourceInfo { id: string; name: string; kind: 'window' | 'screen'; thumbnail: string; appIcon: string | null }
export function captureSourceMode(invoke: Invoke): Promise<{ mode: 'list' | 'portal'; screenRecording: string }>;
export function listCaptureSources(invoke: Invoke): Promise<{ ok: true; sources: CaptureSourceInfo[] } | { ok: false; error: string }>;
/** The pick as a stream, through the desktop source id — never the display-media handler, which electron-audio-loopback owns. */
export function desktopConstraints(sourceId: string): MediaStreamConstraints; // { audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: 2 } } }
export function openDesktopCapture(source: Pick<CaptureSourceInfo, 'id' | 'name' | 'kind'>, deps: { getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>; capture(track: MediaStreamTrack): Omit<Capture, 'name' | 'kind'> }): Promise<Capture & { close(): void }>;
```
  `openDesktopCapture` calls `getUserMedia(desktopConstraints(id))`, takes the video track, builds the `Capture` with `deps.capture(track)` (the default is `canvasCapture` below), and on the track's `ended` makes `grab()` resolve null thereafter; `close()` stops the track.
- Produces, `src/lib/screen/canvasCapture.ts`: `canvasCapture(track: MediaStreamTrack): Omit<Capture, 'name' | 'kind'> & { close(): void }` — a `<video>` fed `new MediaStream([track])`, `grab()` draws the current frame onto a canvas at `fitInside(video.videoWidth, video.videoHeight)` and returns its `ImageData`; `encode(picture, quality)` draws `picture` and returns the bytes of `canvas.toBlob('image/jpeg', quality)`. Browser-only; jsdom has no canvas, so this module is exercised by the live tests (§5), not here.

- [ ] **Step 1: Write the failing tests**

`electron/capture-sources.test.js`:
```js
it('lists windows before screens, drops this app\'s own windows and nameless sources, and types by id prefix', () => {
  const out = pickableSources([
    { id: 'screen:0:0', name: 'Entire Screen', thumbnail: 'data:1', appIcon: null },
    { id: 'window:12:0', name: 'Slides — Keynote', thumbnail: 'data:2', appIcon: 'data:i' },
    { id: 'window:99:0', name: 'Sokuji', thumbnail: 'data:3', appIcon: null },
    { id: 'window:13:0', name: '', thumbnail: 'data:4', appIcon: null },
  ], ['window:99:0']);
  expect(out.map((s) => [s.id, s.kind])).toEqual([['window:12:0', 'window'], ['screen:0:0', 'screen']]);
});
it('is the portal on a Wayland session and the list everywhere else', () => {
  expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'wayland' })).toBe('portal');
  expect(captureSourceMode('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe('portal');
  expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe('list');
  expect(captureSourceMode('darwin', {})).toBe('list');
  expect(captureSourceMode('win32', {})).toBe('list');
});
it('never asks for the sources while Screen Recording is denied, and passes a failed listing through as its message', async () => {
  const getSources = vi.fn(async () => []);
  expect(await listCaptureSources({ screenRecording: () => 'denied', getSources, ownIds: () => [] })).toEqual({ ok: false, error: 'screen-recording-denied' });
  expect(getSources).not.toHaveBeenCalled();
  expect(await listCaptureSources({ screenRecording: () => 'granted', getSources: async () => { throw new Error('no portal'); }, ownIds: () => [] })).toEqual({ ok: false, error: 'no portal' });
});
```
`electron/linux-gpu-flags.test.js`: the existing expectations on the feature lists gain `,WebRTCPipeWireCapturer` on both branches.

`src/lib/screen/desktopFrames.test.ts`:
```ts
it('captures the pick through the desktop source id, video only, at most 2 fps, never the display-media path', async () => {
  const getUserMedia = vi.fn(async () => streamWith(track));
  await openDesktopCapture({ id: 'window:12:0', name: 'Slides', kind: 'window' }, { getUserMedia, capture: fakeCapture });
  expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'window:12:0', maxFrameRate: 2 } } });
});
it('a track that ends makes every later grab null, and close stops the track', ...);
it('reads the mode and the list through the two channels, passing a refusal through', ...);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run electron/capture-sources.test.js electron/linux-gpu-flags.test.js src/lib/screen/desktopFrames.test.ts`
Expected: FAIL — modules not found; the feature list lacks the capturer.

- [ ] **Step 3: Implement**

As specified above. The handler comment explains why the status is read first (the existing note at `main.js:1288-1290`: a `getSources` call turns `not-determined` into a prompt, which the picker wants; `denied` must not reach it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run electron src/lib/screen`
Expected: PASS, including `electron/ipc-channels.test.js` (both channels allowlisted and handled).

- [ ] **Step 5: Commit**

```bash
git add electron/capture-sources.js electron/capture-sources.test.js electron/main.js electron/ipc-channels.js electron/linux-gpu-flags.js electron/linux-gpu-flags.test.js src/lib/screen/desktopFrames.ts src/lib/screen/desktopFrames.test.ts src/lib/screen/canvasCapture.ts
git commit -m "feat(screen-context): desktop sources through desktopCapturer, the pick captured by its source id"
```

### Task 6: Extension capture — one tab stream for audio and video, the meeting tab's frames, the shared-screen crop

**Files:**
- Create: `src/lib/screen/tabStream.ts`, `src/lib/screen/tabFrames.ts`
- Modify: `src/lib/modern-audio/TabAudioRecorder.ts:56-77` (`acquireStream`), `:80-87` (`onCleanup`); `src/lib/modern-audio/IParticipantAudioRecorder.ts` (`ParticipantAudioOptions.video?: boolean`); `src/lib/audio/capture/tab.ts:14-25` (`TabSettings.video(): boolean`), `:30` (`begin` options), `:68` (passes `video`)
- Modify: `extension/content/content.js:194-208` (one more message)
- Test: `src/lib/screen/tabStream.test.ts`, `src/lib/screen/tabFrames.test.ts`, `src/lib/audio/capture/tab.test.ts` (existing; one case added)

**Interfaces:**
- Produces, `tabStream.ts`:

```ts
export interface TabStreamDeps {
  /** `chrome.runtime.sendMessage` to the background, as `TabAudioRecorder.sendMessageToBackground` does today. */
  background(message: { type: 'START_TAB_CAPTURE' | 'STOP_TAB_CAPTURE'; tabId: number }): Promise<{ success: boolean; streamId?: string; error?: string }>;
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
}
export interface TabStream { stream: MediaStream; release(): Promise<void> }
/**
 * One capture per tab: the first opener's `wants` decide the tracks; a later opener for the same tab shares the
 * stream (and must not want a track it lacks — that rejects), and the last release stops the tracks and tells the
 * background. A stream id from `getMediaStreamId` is consumed once, so a second capture of a tab is never attempted.
 */
export function openTabStream(tabId: number, wants: { audio: boolean; video: boolean }, deps: TabStreamDeps): Promise<TabStream>;
export const tabConstraints: (streamId: string, wants: { audio: boolean; video: boolean }) => MediaStreamConstraints;
// audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } } or false; video likewise (with maxFrameRate: 2) or false
/** The real deps: `chrome.runtime.sendMessage` (resolving `{ success: false, error }` on `lastError`, as TabAudioRecorder does today) and `navigator.mediaDevices.getUserMedia`. */
export function chromeTabStreamDeps(): TabStreamDeps;
```
- `TabAudioRecorder.acquireStream` → `openTabStream(tabId, { audio: true, video: options?.video === true }, chromeDeps)` keeping the returned `release` for `onCleanup`; `ParticipantAudioOptions.video?: boolean`; `openTab` passes `video: settings.video()`.
- Produces, `tabFrames.ts`:

```ts
export interface Box { x: number; y: number; width: number; height: number }
/** The largest visible <video> on the page, in CSS pixels, with the viewport — the content script's answer to SCREEN_CONTEXT_BBOX. */
export interface BoxAnswer { box: Box | null; viewport: { width: number; height: number } }
/** `box` mapped from CSS pixels to the frame's pixels (the frame is the viewport at some scale); null box → the whole frame. */
export function cropFor(answer: BoxAnswer | null, frame: { width: number; height: number }): Box;
export const BOX_REFRESH_MS = 5000;
export function openTabCapture(tabId: number, deps: { openStream(): Promise<TabStream>; askBox(): Promise<BoxAnswer | null>; capture(track: MediaStreamTrack): Omit<Capture, 'name' | 'kind'> & { close(): void }; tabTitle(): Promise<string>; clock: Clock }): Promise<Capture & { close(): void }>;
```
  `openTabCapture` opens the stream with `{ audio: <the run's participant source is this tab>, video: true }` through `deps.openStream` (the caller decides `audio`), builds a canvas capture on the video track, asks the box at open and every `BOX_REFRESH_MS`, and its `grab()` returns the picture cropped by `cropFor`; `name` = the tab's title, `kind: 'tab'`; `close()` releases the stream and stops the timer.
- `content.js`: on `message.type === 'SCREEN_CONTEXT_BBOX'`, `sendResponse({ box, viewport })` where `box` is the bounding client rect of the largest `<video>` by area that is visible (`getBoundingClientRect` with width ≥ 320 and height ≥ 180, not inside an element whose id starts with `sokuji`), or null; `viewport = { width: window.innerWidth, height: window.innerHeight }`. Vanilla JS, inline; checked by the live test, since `content.js` is a copied script with no module seam.

- [ ] **Step 1: Write the failing tests**

`tabStream.test.ts`:
```ts
it('asks the background for the tab\'s stream id once and captures the tracks asked for', async () => {
  const s = await openTabStream(7, { audio: true, video: true }, deps);
  expect(deps.background).toHaveBeenCalledWith({ type: 'START_TAB_CAPTURE', tabId: 7 });
  expect(deps.getUserMedia).toHaveBeenCalledWith({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'sid' } }, video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'sid', maxFrameRate: 2 } } });
});
it('a second opener of the same tab shares the stream, and only the last release stops it and tells the background', async () => {
  const a = await openTabStream(7, { audio: true, video: true }, deps);
  const b = await openTabStream(7, { audio: false, video: true }, deps);
  expect(b.stream).toBe(a.stream);
  expect(deps.getUserMedia).toHaveBeenCalledTimes(1);
  await a.release();
  expect(track.stop).not.toHaveBeenCalled();
  await b.release();
  expect(track.stop).toHaveBeenCalled();
  expect(deps.background).toHaveBeenLastCalledWith({ type: 'STOP_TAB_CAPTURE', tabId: 7 });
});
it('rejects a second opener that wants a track the open stream lacks, naming it', async () => {
  await openTabStream(7, { audio: true, video: false }, deps);
  await expect(openTabStream(7, { audio: false, video: true }, deps)).rejects.toThrow('video');
});
it('a background refusal rejects with its error and never calls getUserMedia', async () => {
  deps.background.mockResolvedValueOnce({ success: false, error: 'Tab not found' });
  await expect(openTabStream(8, { audio: false, video: true }, deps)).rejects.toThrow('Tab not found');
  expect(deps.getUserMedia).not.toHaveBeenCalled();
});
```
`tabFrames.test.ts`:
```ts
it('maps the shared video\'s box from CSS pixels to the frame, and takes the whole frame without one', () => {
  expect(cropFor({ box: { x: 100, y: 50, width: 800, height: 450 }, viewport: { width: 1000, height: 600 } }, { width: 2000, height: 1200 })).toEqual({ x: 200, y: 100, width: 1600, height: 900 });
  expect(cropFor(null, { width: 2000, height: 1200 })).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });
});
it('asks the box at open and every 5 s, and close stops asking and releases the stream', async () => {
  // askBox called once at open; clock.advance(5000) → twice; close() → stream.release called once; advance(5000) → still twice
});
it('grabs the picture cropped to the latest box, named after the tab, kind tab', async () => {
  // capture's grab returns 2000×1200; askBox resolves the box above → grab() is 1600×900; name === await tabTitle(); kind === 'tab'
});
```
`tab.test.ts`: `openTab` passes `video: true` to the recorder's `begin` when `settings.video()` is true, `false` otherwise.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/lib/screen/tabStream.test.ts src/lib/screen/tabFrames.test.ts src/lib/audio/capture/tab.test.ts`
Expected: FAIL — modules not found; `begin` called without `video`.

- [ ] **Step 3: Implement**

A module-level `Map<number, { stream, wants, refs }>` in `tabStream.ts`; `TabAudioRecorder` keeps its `getTabIdFromContext` and loses its own `getUserMedia` call; `content.js` gains the handler before `return false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/lib/screen src/lib/audio/capture src/lib/modern-audio/TabAudioRecorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/screen/tabStream.ts src/lib/screen/tabStream.test.ts src/lib/screen/tabFrames.ts src/lib/screen/tabFrames.test.ts src/lib/modern-audio/TabAudioRecorder.ts src/lib/modern-audio/IParticipantAudioRecorder.ts src/lib/audio/capture/tab.ts src/lib/audio/capture/tab.test.ts extension/content/content.js
git commit -m "feat(screen-context): the meeting tab's frames over one shared tab stream, cropped to the shared screen"
```

### Task 7: The run — the source on the shape, the picker before Start, the store, the analytics

**Files:**
- Modify: `src/lib/session/types.ts:24-47` (`RunShape.frames?: FrameSource`), `src/lib/session/run.ts:282-289` (the requests) and the point the run goes `running` (beside `connection_status` at `:497`), `src/lib/analytics.ts` (`AnalyticsEvents`), `src/lib/session/appShape.ts:116-142` (`readShapeFromStores`)
- Create: `src/stores/screenContextStore.ts`, `src/app/screenContext.ts`
- Modify: `src/app/session.ts:45-60` (`AppBridges.pickScreenSource?`), `:223-226` (`start`), `:160-170` area (the run-end hook that clears the store)
- Test: `src/lib/session/runner.test.ts`, `src/lib/session/appShape.test.ts`, `src/app/session.test.ts`, `src/app/screenContext.test.ts`

**Interfaces:**
- Consumes: `createSampler`, `Capture` (Task 4); `captureSourceMode`, `listCaptureSources`, `openDesktopCapture` (Task 5); `openTabCapture`, `openTabStream` (Task 6); `targetTabIdFromSearch` (`src/lib/audio/tabMicrophone.ts:51`).
- Produces:
  - `RunShape.frames?: FrameSource` — doc: "The chosen capture area for a provider that takes one (Qwen); run-time state, never persisted."
  - `run.ts`: each leg's `StartRequest` gains `frames: shape.frames` when present (both legs the same object); when the run goes running and `shape.frames` is set: `analytics.track('screen_context_on', { session_id, provider, source_kind: shape.frames.kind, platform: deps.platform })`; on a `degraded` whose code is `screen_context_lost`: `analytics.track('screen_context_lost', { session_id, provider, channel: leg })` beside the existing `api_error`.
  - `AnalyticsEvents['screen_context_on']: { session_id: string; provider: string; source_kind: 'window' | 'screen' | 'tab'; platform: string }` and `['screen_context_lost']: { session_id: string; provider: string; channel: LegName }`.
  - `src/stores/screenContextStore.ts` (Zustand, nothing persisted):

```ts
export interface ScreenContextStore {
  /** The sampler whose `source` the run gets; null between runs. */
  sampler: Sampler | null;
  state: SamplerState | null;
  set(sampler: Sampler | null): void;
  setState(state: SamplerState | null): void;
}
export const useScreenContextStore: UseBoundStore<StoreApi<ScreenContextStore>>;
```
  - `src/app/screenContext.ts`:

```ts
export type PickedSource = { kind: 'desktop'; source: CaptureSourceInfo } | { kind: 'portal' };
/** Why the picker is shown again: the area just picked yielded no frame. */
export type PickReason = 'nothingVisible';
/** The selected provider is a Qwen provider with its switch on. */
export function screenContextWanted(): boolean;
/**
 * Before a run. On Electron: asks `pick` (the modal) for a source — null is a cancel, the run starts without — opens the
 * capture, attaches it to a fresh sampler and waits for the first good frame (`first()`); a null first frame closes that
 * capture and asks `pick('nothingVisible')` again, until a frame comes or the user cancels. On the extension: opens the
 * meeting tab's capture (`targetTabIdFromSearch`) with `audio: shape.legs.includes('participant')` (the extension's
 * participant source is always that tab), `video: true`; a null first frame there starts the run without.
 * Puts the sampler in the store and mirrors its state there. Never throws into Start: a failed capture is a
 * `reportWarning('ScreenContext', …)` and a run without frames.
 */
export function prepareScreenContext(platform: Platform, shape: Pick<RunShape, 'legs'>, deps: { pick(reason?: PickReason): Promise<PickedSource | null>; clock: Clock; invoke: Invoke; openDesktop: typeof openDesktopCapture; openTab: typeof openTabCapture }): Promise<void>;
/** When the run is over: closes the sampler and empties the store. */
export function releaseScreenContext(): void;
/** Choose again, mid-run: a new pick replaces the capture on the same sampler (`attach`), so the legs' subscriptions stand. */
export function chooseAgain(deps: Pick<Parameters<typeof prepareScreenContext>[1], 'pick' | 'invoke' | 'openDesktop'>): Promise<void>;
```
  - `appShape.ts`: `frames: useScreenContextStore.getState().sampler?.source` on the shape (only when set).
  - `session.ts`: `AppBridges.pickScreenSource?: (reason?: PickReason) => Promise<PickedSource | null>` (set by `MainPanel` in Task 8; absent — the extension, tests — means no modal, which `prepareScreenContext` only asks for on Electron); `start(method)` awaits `prepareScreenContext(platform, { legs: readShapeFromStores(bridges.auth)?.legs ?? ['speaker'] }, …)` when `screenContextWanted()` and then `runner.start(method)`; the existing run-end path calls `releaseScreenContext()`; `TabSettings.video` (Task 6) is bound in `appCapture.ts` to `screenContextWanted()`.

- [ ] **Step 1: Write the failing tests**

`runner.test.ts` (the `setup` at `:51-121` takes `shape`):
```ts
it('hands the shape\'s frames to every leg\'s start request, the same source, and tracks screen_context_on with its kind', async () => {
  const frames = fakeFrameSource({ kind: 'window' });
  const { runner, events } = setup({ shape: { legs: ['speaker', 'participant'], frames } });
  await runner.start();
  expect(startRequests.map((r) => r.frames)).toEqual([frames, frames]);
  expect(events('screen_context_on')).toEqual([{ session_id: 'run1', provider: 'fake', source_kind: 'window', platform: 'electron' }]);
});
it('a shape without frames starts requests with no frames key and tracks nothing', async () => {
  // 'frames' in startRequests[0] === false; events('screen_context_on') === []
});
it('a leg degraded with screen_context_lost tracks screen_context_lost beside api_error', async () => {
  // the fake adapter's events.degraded({ code: 'screen_context_lost', message: 'gone' }) → events('screen_context_lost') === [{ session_id: 'run1', provider: 'fake', channel: 'speaker' }] and events('api_error') has one entry
});
```
(The fake provider at `runner.test.ts:20-50` records every `StartRequest` its `start` receives into `startRequests`.)
`appShape.test.ts`: `readShapeFromStores` carries the store's sampler source as `frames`, and no key without one.
`screenContext.test.ts` (fake `openDesktop` returning scripted `Capture`s from Task 4's fixtures, a virtual clock, a `pick` mock):
```ts
it('a cancelled pick leaves the store empty', async () => { /* pick → null; store.sampler === null; openDesktop not called */ });
it('a pick whose area shows nothing is closed and the picker asked again with the reason; the second pick with a frame wins', async () => {
  // pick: first → BLACK capture, second → lit capture; expect pick.mock.calls === [[undefined], ['nothingVisible']]; first capture's close called; store.sampler.source.name === second's
});
it('a cancel after a blank pick starts without frames', async () => { /* pick → BLACK, then null → store empty, both captures closed */ });
it('on the extension opens the tab with audio only when a participant leg runs', async () => {
  // legs ['speaker'] → openTab called with audio false; legs ['speaker','participant'] → audio true
});
it('releaseScreenContext closes the sampler and empties the store; chooseAgain swaps the capture under the same source', async () => {});
```
`session.test.ts`:
```ts
it('with the switch on, start asks the picker before the runner and the run carries the source; the run\'s end releases it', async () => {
  // order: pickScreenSource called, then readShape sees frames; after stop: store empty
});
it('with the switch off, the picker is never asked and the shape has no frames', async () => {});
```
(`createAppSession` takes `options.clock`; the switch state comes from the provider store's `qwen_livetranslate` slice.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/lib/session/runner.test.ts src/lib/session/appShape.test.ts src/app/session.test.ts`
Expected: FAIL — `frames` not on the request; events missing; module not found.

- [ ] **Step 3: Implement**

As specified. `prepareScreenContext` is the only place a sampler is created; the sampler's `onState` writes `setState`. The pick on Electron: `captureSourceMode` → `'portal'` means `pick()` resolves `{ kind: 'portal' }` and the capture id is whatever `listCaptureSources` returns first (the portal's single source); `'list'` means `pick()` resolves the chosen `CaptureSourceInfo`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/lib/session src/app src/stores src/lib/analytics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/types.ts src/lib/session/run.ts src/lib/session/appShape.ts src/lib/analytics.ts src/stores/screenContextStore.ts src/app/screenContext.ts src/app/screenContext.test.ts src/app/session.ts src/lib/audio/appCapture.ts src/lib/session/runner.test.ts src/lib/session/appShape.test.ts src/app/session.test.ts
git commit -m "feat(screen-context): the source rides the run shape, picked before Start, tracked and released with the run"
```

### Task 8: The UI — the picker, the chip and its card, the footer wiring, the strings

**Files:**
- Create: `src/components/ScreenContext/SourcePicker.tsx`, `SourcePicker.scss`, `SourcePicker.test.tsx`
- Create: `src/components/MainPanel/panel/ScreenContextChip.tsx`, `ScreenContextChip.scss`, `ScreenContextChip.test.tsx`
- Modify: `src/components/MainPanel/panel/PanelFooter.tsx:13-42` (props), `:134-205` (basic, after `ModePicker`), `:207-293` (advanced, after `{waveforms?.input}` at `:221`); `src/components/MainPanel/MainPanel.tsx:307-321` (the footer's props, the modal, `setBridges({ pickScreenSource })`)
- Modify: `src/locales/*/translation.json` (30) — a new top-level `screenContext` namespace; `CLAUDE.md` (one bullet)
- Test: `src/components/MainPanel/panel/PanelFooter.test.tsx` (two cases added)

**Interfaces:**
- Consumes: `useScreenContextStore`, `chooseAgain`, `PickedSource` (Task 7); `captureSourceMode`, `listCaptureSources`, `CaptureSourceInfo` (Task 5); `Modal` (`src/components/Modal/Modal.tsx`: `isOpen, onClose, title, children`); `Tooltip` (`src/components/Tooltip/Tooltip.tsx`, `trigger: 'hover' | 'click'`); `window.electron.invoke('open-privacy-settings', 'screen-recording')`.
- Produces:

```ts
export interface SourcePickerProps {
  open: boolean;
  mode: 'list' | 'portal';
  /** macOS: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'; elsewhere 'granted'. */
  screenRecording: string;
  sources: CaptureSourceInfo[] | null;   // null while loading
  /** Shown again because the last pick yielded no frame: the `picker.nothingVisible` line above the list. */
  reason?: PickReason;
  onPick(source: CaptureSourceInfo): void;
  onPortal(): void;                       // 'portal' mode's one button
  onCancel(): void;
  onOpenPrivacy(): void;
}
export function SourcePicker(p: SourcePickerProps): JSX.Element;

export interface ScreenContextChipProps {
  name: string; kind: 'window' | 'screen' | 'tab';
  status: 'live' | 'stale' | 'lost';
  sentCount: number; lastSentAt: number | null; now: number;
  /** An object URL of the last frame sent, or null; the chip never makes one itself. */
  thumbnail: string | null;
  iconOnly: boolean;
  onChooseAgain(): void;
}
export function ScreenContextChip(p: ScreenContextChipProps): JSX.Element;
```
  `PanelFooterProps.screenContext?: ScreenContextChipProps | null` — rendered after the input waveforms in `advanced` (full chip) and after the `ModePicker` in `basic` (`iconOnly`); `MainPanel` builds it from `useScreenContextStore` (`state.status === 'idle'` → null), makes the thumbnail's object URL from `state.lastJpeg` (revoked on change), passes `iconOnly: site === 'basic' || isExtension()`, mounts the `SourcePicker` and registers `pickScreenSource(reason?)` as a bridge that opens it (with the reason, the mode and the list it fetched) and resolves with the pick, `{ kind: 'portal' }` for the portal button, or null on cancel; `onChooseAgain` calls `chooseAgain` with the same bridge. The chip: lucide `Eye`, the name (hidden when `iconOnly`), a dot with class `live|stale|lost` whose pulse animation restarts on `sentCount` (a `key`); the card through `Tooltip` on hover and click with: the thumbnail, the source name, "Last frame {{ago}}" (seconds ago from `now − lastSentAt`), "{{count}} frames sent", and a **Choose again** button; the chip is `aria-label`ed `Screen context: {{name}}, {{status}}`.
  Picker contents: title; the privacy line verbatim from §3.1; `list` mode: two groups (Windows, Screens) of buttons (thumbnail, app icon, title), windows first; `portal` mode: the privacy line and one button `Choose a window or screen…`; `screenRecording === 'denied'` on macOS: the denied text and an **Open System Settings** button, no list; a footer **Cancel**. Styling within the settings-control dialect (28 px rows, `#ccc`), §6.
  Strings, en (`screenContext.*`; the 29 others translated): `picker.title` "Choose what Qwen may see", `picker.privacy` (the §3.1 line), `picker.windows` "Windows", `picker.screens` "Screens", `picker.portal` "Choose a window or screen…", `picker.loading` "Looking for windows…", `picker.none` "No window or screen to share was found.", `picker.deniedTitle` "Screen Recording permission needed", `picker.deniedText` "macOS lets Sokuji see the screen only with Screen Recording permission. Grant it in System Settings, then start again.", `picker.openSettings` "Open System Settings", `picker.cancel` "Start without screen context", `picker.nothingVisible` "The area you chose shows nothing right now. Pick another, or start without screen context.", `chip.live` "Live", `chip.stale` "Unchanged", `chip.lost` "Choose again", `chip.label` "Screen context: {{name}}, {{status}}", `card.lastFrame` "Last frame {{ago}} s ago", `card.frames` "{{count}} frames sent", `card.chooseAgain` "Choose again", `card.lostHint` "The source is gone; the last picture is kept until you choose again."

- [ ] **Step 1: Write the failing tests**

`SourcePicker.test.tsx`:
```ts
it('shows the privacy line and lists windows before screens, picking one', () => {
  // text contains "Alibaba Cloud"; the buttons' order is [window, window, screen]; click the first → onPick(sources[0])
});
it('on a denied macOS shows the settings button and no list', () => {
  // screenRecording 'denied': getByRole('button', { name: 'Open System Settings' }) → onOpenPrivacy; queryAllByRole('img') is empty
});
it('in portal mode shows one button that asks the desktop to choose', () => { /* one button "Choose a window or screen…" → onPortal */ });
it('says why it is back when the last pick showed nothing', () => { /* reason 'nothingVisible' → the line is rendered */ });
it('cancel starts without screen context', () => { /* "Start without screen context" → onCancel */ });
```
`ScreenContextChip.test.tsx`:
```ts
it('names the source with a green dot while live, amber when unchanged, red with Choose again when lost', () => {
  // status live → dot has class 'live' and text 'Slides'; stale → 'stale' and 'Unchanged'; lost → 'lost' and 'Choose again'
});
it('icon-only hides the name but keeps the accessible label', () => { /* no 'Slides' text; aria-label 'Screen context: Slides, Live' */ });
it('the card shows the thumbnail, the frames sent and a Choose again that calls back', () => {
  // click the chip → img src === thumbnail, '12 frames sent', 'Last frame 3 s ago' (now − lastSentAt = 3000); click "Choose again" → onChooseAgain
});
```
`PanelFooter.test.tsx`: the chip renders in both sites from `screenContext`, icon-only in basic; nothing without the prop.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/components/ScreenContext src/components/MainPanel/panel`
Expected: FAIL — modules not found; the footer ignores the prop.

- [ ] **Step 3: Implement**

As specified. In `MainPanel.tsx`, the picker's data comes from `captureSourceMode(invoke)` then `listCaptureSources(invoke)` (Task 5) when the bridge is asked; a `{ ok: false, error: 'screen-recording-denied' }` answer sets `screenRecording: 'denied'`. `CLAUDE.md`: under "Key Architectural Components" one bullet: "**Screen context** (`src/lib/screen/`, spec `docs/superpowers/specs/2026-10-22-qwen-screen-context-design.md`): a chosen window, tab or screen sampled at 1 fps into JPEG frames for the Qwen adapter (`StartRequest.frames`); the sampler owns change detection, keep-alives and the lost state; `electron/capture-sources.js` lists desktop sources, `src/lib/screen/tabStream.ts` shares one tab capture between audio and video; the chip in `PanelFooter` is the cue."

- [ ] **Step 4: Run the tests to verify they pass, and the whole client suite**

Run: `node_modules/.bin/vitest run src/components src/locales/locales.consistency.test.ts` then `node_modules/.bin/vitest run`
Expected: PASS; the whole suite green (the console ledger and the stylesheet invariants included).

- [ ] **Step 5: Commit**

```bash
git add src/components/ScreenContext src/components/MainPanel CLAUDE.md src/locales
git commit -m "feat(screen-context): the source picker and the control-bar chip"
```

---

## Part B — managed billing (sokuji-backend, then the client's lease and floor)

Backend tasks run in the backend worktree on `feat/qwen-screen-context` (cut from `origin/main`); commands from that directory.

### Task 9: The backend rate — 240 tokens per second of speech when screen context is on

**Files:**
- Modify: `src/config/qwen.ts:142` (`QWEN_WORST_TOKENS_PER_S`), `src/services/qwen-pricing.ts:121-156` (`qwenRateUsdPerHour`, `computeQwenBudget`)
- Test: `src/services/qwen-pricing.test.ts`

**Interfaces:**
- Produces: `QWEN_WORST_TOKENS_PER_S = { audioIn: 7, textOut: 4, audioOut: 12.5, imageIn: 240 }` (doc: "`imageIn`: frames of a screen-context session bill per second of speech, ~192/s measured at 720p on 2026-10-22, plus a quarter's margin"); `qwenScreenContextUsdPerHour(region: QwenRegion, cnyPerUsd: number | null): number` (one leg's add-on per hour of speech, after K; throws for CNY without a rate like the rate function); `qwenRateUsdPerHour(legs, region, cnyPerUsd, screenContext = false)` adds `QWEN_WORST_TOKENS_PER_S.imageIn * price.imageIn` to every leg when `screenContext`; `computeQwenBudget(balanceMicroUsd, legs, region, cnyPerUsd, screenContext = false)` passes it through.

- [ ] **Step 1: Write the failing tests** (in the `qwenRateUsdPerHour` and `computeQwenBudget` blocks)

```ts
it('adds the screen-context term to every leg when asked: 240 image tokens a second of speech', () => {
  expect(qwenScreenContextUsdPerHour('sg', null)).toBeCloseTo(0.66528, 9);
  expect(qwenRateUsdPerHour([speaking], 'sg', null, true)).toBeCloseTo(3.22308, 9);
  expect(qwenRateUsdPerHour([text], 'sg', null, true)).toBeCloseTo(1.33308, 9);
  expect(qwenRateUsdPerHour([speaking, text], 'sg', null, true)).toBeCloseTo(4.55616, 9);
  expect(qwenRateUsdPerHour([speaking], 'sg', null, false)).toBeCloseTo(2.5578, 9);
});
it('prices Beijing\'s screen-context term in CNY at the rate, times its K', () => {
  expect(qwenScreenContextUsdPerHour('cn', 6.678)).toBeCloseTo(0.6404, 4);
  expect(qwenRateUsdPerHour([speaking], 'cn', 6.678, true)).toBeCloseTo(2.8075, 4);
  expect(() => qwenScreenContextUsdPerHour('cn', null)).toThrow();
});
it('sizes a screen-context grant against a $1 balance', () => {
  expect(computeQwenBudget(1_000_000, [speaking], 'sg', null, true)).toMatchObject({ durationS: 1116, budgetMicroUsd: 999155, floorMicroUsd: 53718, affordable: true });
  expect(computeQwenBudget(1_000_000, [text], 'sg', null, true)).toMatchObject({ durationS: 2700, budgetMicroUsd: 999811, floorMicroUsd: 22218, affordable: true });
  expect(computeQwenBudget(1_000_000, [speaking, text], 'sg', null, true)).toMatchObject({ durationS: 790, budgetMicroUsd: 999824, floorMicroUsd: 75936, affordable: true });
  expect(computeQwenBudget(1_000_000, [speaking], 'cn', 6.678, true)).toMatchObject({ durationS: 1282, budgetMicroUsd: 999799, floorMicroUsd: 46793, affordable: true });
  expect(computeQwenBudget(50_000, [speaking], 'sg', null, true).affordable).toBe(false);
  expect(computeQwenBudget(50_000, [speaking], 'sg', null, false).affordable).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/services/qwen-pricing.test.ts`
Expected: FAIL — `qwenScreenContextUsdPerHour` is not exported; the fourth argument is ignored.

- [ ] **Step 3: Implement**

The constant, the new function (the same shape as `qwenRateUsdPerHour`'s currency branch), the parameter threaded through. `qwen-reconcile.ts:283` reads `audioIn` only and is untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/services/qwen-pricing.test.ts src/services/qwen-reconcile.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/config/qwen.ts src/services/qwen-pricing.ts src/services/qwen-pricing.test.ts
git commit -m "feat(qwen): the screen-context add-on in the session rate, 240 image tokens a second of speech"
```

### Task 10: The session-key body — `screenContext`

**Files:**
- Modify: `src/routes/qwen.ts:63-72` (a `parseScreenContext(body)` beside `parseLegs`), `:147-180` (`sessionKeyHandler`)
- Test: `src/routes/qwen-session.sqlite.test.ts` (the `session-key` block at `:203`)

**Interfaces:**
- Consumes: `computeQwenBudget(..., screenContext)` (Task 9).
- Produces: the body's `screenContext` — absent → `false`; a boolean → itself; anything else → `400 { error: "Invalid screenContext. Use true or false" }`, checked after the legs and before the region (so a bad body never reads the account). The flag reaches `computeQwenBudget` only; the lease, the SKU and the window are unchanged (the charge prices `video_tokens` already, #114).

- [ ] **Step 1: Write the failing tests**

```ts
it("400s a screenContext that is not a boolean, before the account is asked", async () => {
  const { c, out } = ctx({ ...BODY, screenContext: "yes" });
  await h().sessionKeyHandler(c);
  expect([out.status, out.body]).toEqual([400, { error: "Invalid screenContext. Use true or false" }]);
});
it("budgets the screen-context add-on: a balance that starts a plain session is short for one with the screen", async () => {
  await seedPool();
  wallet = { balanceMicroUsd: 50_000, frozen: false };
  let r = ctx({ legs: ["speaker"], speech: { speaker: true, participant: false } });
  await h().sessionKeyHandler(r.c);
  expect(r.out.status).toBe(200);
  // a fresh account state for the second start as the block's helpers do
  r = ctx({ legs: ["speaker"], speech: { speaker: true, participant: false }, screenContext: true });
  await h().sessionKeyHandler(r.c);
  expect([r.out.status, r.out.body.requiredMicroUsd]).toEqual([402, 53718]);
});
it("a screen-context grant is shorter, at the higher rate", async () => {
  // $1, speaker speaking: 1407 s without, 1116 s with; rateUsdPerHour 2.5578 vs 3.22308
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/routes/qwen-session.sqlite.test.ts`
Expected: FAIL — 200 where 400 is expected; the floor is 42630, not 53718.

- [ ] **Step 3: Implement**

`parseScreenContext(body): boolean | null` and the two lines in the handler.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/routes/qwen-session.sqlite.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/qwen.ts src/routes/qwen-session.sqlite.test.ts
git commit -m "feat(qwen): session-key takes screenContext and budgets its add-on"
```

### Task 11: `/api/pricing` publishes the add-on

**Files:**
- Modify: `src/routes/pricing.ts:96-117` (`QwenProviderPricing`), `:137-140` (`qwenShapes`), `:154-201` (`qwenPricing`)
- Test: `src/routes/pricing.test.ts` (`:87-130` key sets, `:138-160` denylist, `:190-235` exact entries)

**Interfaces:**
- Consumes: `qwenScreenContextUsdPerHour` (Task 9), `QWEN_WORST_TOKENS_PER_S.imageIn`.
- Produces, on each Qwen entry: `tokenRatesUsdPerMillion.imageIn` (sg 0.77; cn 0.74124 at 6.678), `tokenRatesCnyPerMillion.imageIn` (cn 4.95), `tokenConversions.imageInTokensPerSecondOfSpeech: 240`, and `screenContextUsdPerHour` (sg 0.66528; cn 0.640431) — "one direction's add-on per hour of speech while screen context is on". The shapes are unchanged.

- [ ] **Step 1: Write the failing tests**

Update the exact entries at `:190-212` and `:215-235` with the four new figures; add `imageIn` to `qwenRates`, `imageInTokensPerSecondOfSpeech` to `qwenConversions` and `screenContextUsdPerHour` to `qwenKeys` at `:96-100`; add `0.4752` to `kizunaai_qwen`'s and `2.8512` (its pre-K CNY hour) to `kizunaai_qwen_cn`'s forbidden lists at `:149-158` with a comment in the style of the existing ones (`240 × 0.55 × 3600 / 1e6`); one new case:

```ts
it("publishes the screen-context add-on per direction and hour of speech, after K, from the image rate", () => {
  const sg = buildPricingResponse().providers.find((p) => p.id === "kizunaai_qwen") as QwenProviderPricing;
  expect(sg.screenContextUsdPerHour).toBe(0.66528);
  expect(sg.tokenRatesUsdPerMillion.imageIn * sg.tokenConversions.imageInTokensPerSecondOfSpeech * 3600 / 1e6).toBeCloseTo(sg.screenContextUsdPerHour, 9);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/routes/pricing.test.ts`
Expected: FAIL — the entries lack the fields.

- [ ] **Step 3: Implement**

The interface fields (`imageIn` in both rate records, `imageInTokensPerSecondOfSpeech`, `screenContextUsdPerHour: number`), filled in `qwenPricing` the way the three existing rates are (`afterK(list.imageIn, k)` and `afterK(list.imageIn, k, cnyPerUsd)`), `screenContextUsdPerHour: trim(qwenScreenContextUsdPerHour(region, cnyPerUsd))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/routes/pricing.test.ts web/src/pages/dashboard/wallet/pricing-contract.test.ts`
Expected: `pricing.test.ts` PASS; `pricing-contract.test.ts` FAIL on the key sets — Task 12 fixes the web side.

- [ ] **Step 5: Commit**

```bash
git add src/routes/pricing.ts src/routes/pricing.test.ts
git commit -m "feat(pricing): publish the Qwen screen-context add-on and its image rate"
```

### Task 12: The dashboard — the pricing row, the calculator's switch, the strings

**Files:**
- Modify: `web/src/pages/dashboard/wallet/pricing-client.ts:54-71`, `cost-model.ts:46-60` (`CalcSettings`, `EngineRates`), `:84-94` (`qwenRates`), `:125-152` (`CostParts`, `costParts`, `partsTotal`), `calculator-state.ts:44-49` (an action), `CostCalculatorCard.tsx` (a switch row, Qwen only; the parts list), `PricingCard.tsx:61-71` (a row), `web/src/locales/docs/*.ts` (12 files, `dashboard.wallet.pricing.*`)
- Test: `pricing-contract.test.ts`, `cost-model.test.ts`, `calculator-state.test.ts`, `calculator-scenarios.test.ts`, `balance-estimate.test.ts` (must stay green)

**Interfaces:**
- Consumes: the four published fields (Task 11).
- Produces: `QwenProviderPricing` (web) mirrors the four fields; `EngineRates.screen?: number` (USD per hour of speech per direction with screen context; absent for Soniox and for a cached Qwen payload without the field — computed like the others from `imageInTokensPerSecondOfSpeech × imageIn`, and left out, not NaN, when either is missing); `CalcSettings.screenContext?: boolean` (default false; every preset leaves it unset); `CostParts.screen: number` = `rates.screen × spoken` when `s.screenContext` and `rates.screen` is set, else 0; `partsTotal` adds it; `CalcAction | { type: 'setScreenContext'; on: boolean }`; the card shows a **Screen context** switch only for the Qwen engine with a rate, and a fourth part line; `PricingCard` gains the row `{ labelKey: 'rateInputImage', usdPerMillion: r.imageIn, cnyPerMillion: cny?.imageIn, useKey: 'usePerScreenHour', tokensPerHour: c.imageInTokensPerSecondOfSpeech * 3600 }` after the audio-out row, when the payload has it.
  Strings (en; 11 others translated): `dashboard.wallet.pricing.rateInputImage` "Input image tokens (screen context)", `dashboard.wallet.pricing.usePerScreenHour` "{count} tokens per hour of speech with screen context", `dashboard.wallet.pricing.screenContext` "Screen context", `dashboard.wallet.pricing.screenContextHint` "The Qwen engine sees one window, tab or screen you choose; billed per hour of speech, per direction.", `dashboard.wallet.pricing.partScreen` "Screen context".

- [ ] **Step 1: Write the failing tests**

`pricing-contract.test.ts:107-160`: the Qwen key sets gain the four fields. `cost-model.test.ts`:
```ts
it('reduces Qwen\'s screen-context add-on to a rate per hour of speech, and has none without the published field', () => {
  // `sg` is the file's Singapore Qwen fixture, extended with the four new fields (imageIn 0.77, 240/s, 0.66528)
  expect(qwenRates(sg)!.screen).toBeCloseTo(0.66528, 9);
  expect(qwenRates({ ...sg, tokenConversions: { ...sg.tokenConversions, imageInTokensPerSecondOfSpeech: undefined } } as any)!.screen).toBeUndefined();
});
it('charges the screen add-on for the speech of every direction that is on, only while the switch is on', () => {
  const rates = { connection: 1, text: 1, voice: 1, screen: 0.5 };
  expect(costParts(rates, { them: 'text', me: 'off', themShare: 60, meShare: 0, screenContext: true }, false).screen).toBeCloseTo(0.3);
  expect(costParts(rates, { them: 'text', me: 'text', themShare: 60, meShare: 40, screenContext: true }, false).screen).toBeCloseTo(0.5);
  expect(costParts(rates, { them: 'text', me: 'off', themShare: 60, meShare: 0 }, false).screen).toBe(0);
  expect(costParts({ connection: 1, text: 1, voice: 1 }, { them: 'text', me: 'off', themShare: 60, meShare: 0, screenContext: true }, false).screen).toBe(0);
});
```
`calculator-state.test.ts`: `setScreenContext` writes the flag and marks the scenario custom when a preset was selected; picking Soniox clears it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run web/src/pages/dashboard/wallet`
Expected: FAIL — key sets, missing `screen`, unknown action.

- [ ] **Step 3: Implement**

As specified; the switch row in `CostCalculatorCard.tsx` follows the card's existing control markup; the 12 locale files gain the five keys (translated).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run web/src && npx tsc --noEmit`
Expected: PASS (key and placeholder parity tests included).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/dashboard/wallet web/src/locales/docs
git commit -m "feat(dashboard): the Qwen screen-context add-on on the pricing card and in the calculator"
```

### Task 13 (client): the lease asks for it, the floor includes it

**Files:**
- Modify: `src/providers/qwen_livetranslate/lease.ts:253-258` (`sent`), `src/providers/qwen_livetranslate/kizunaBudget.ts:24-41`
- Test: `src/providers/qwen_livetranslate/lease.test.ts:73-120`, `src/providers/qwen_livetranslate/kizunaBudget.test.ts`

**Interfaces:**
- Consumes: `RunShape.frames` (Task 7), `QwenSettings.screenContext` (Task 1).
- Produces: the session-key body gains `screenContext: shape.frames !== undefined` (the truth of this run: a cancelled pick sends `false`); `QWEN_SCREEN_MICRO_USD_PER_HOUR: Record<QwenRegion, number> = { sg: 665_280, cn: 534_600 }` (sg: 240 × 0.55 × 3600 × 1.4; cn: 240 × 3.3 × 3600 × 1.5 ÷ 8, the same 8 CNY per USD floor as the existing rates); `kizunaQwenMinimumBalance(shape, s: Pick<QwenSettings, 'region' | 'screenContext'>)` adds the add-on to every leg when `s.screenContext` is true (the gate reads the switch, before the pick; conservative on purpose: the backend's 402 is the authority, and a cancelled pick only lowers the real floor).

- [ ] **Step 1: Write the failing tests**

`lease.test.ts`:
```ts
it('tells the backend whether this run has a screen: true with a source on the shape, false without', async () => {
  for (const [frames, expected] of [[fakeFrameSource(), true], [undefined, false]] as const) {
    const a = acquiring(['speaker'], { frames });
    await flush();
    expect(JSON.parse(a.last().init.body as string).screenContext).toBe(expected);
  }
});
```
(and the three existing body assertions at `:77`, `:83`, `:90` gain `screenContext: false`.)
`kizunaBudget.test.ts`:
```ts
it('adds the screen-context add-on to every leg while the switch is on', () => {
  expect(QWEN_SCREEN_MICRO_USD_PER_HOUR).toEqual({ sg: 665_280, cn: 534_600 });
  expect(at('sg', ['speaker'], false, false, true)).toBe(53_718);
  expect(at('sg', ['speaker'], true, false, true)).toBe(22_218);
  expect(at('sg', ['speaker', 'participant'], false, false, true)).toBe(75_936);
  expect(at('cn', ['speaker'], false, false, true)).toBe(39_060);
  expect(at('cn', ['speaker'], true, false, true)).toBe(16_560);
  expect(at('sg', ['speaker'], false, false, false)).toBe(42_630);
});
```
(`at` gains a fifth argument that sets `screenContext` on the settings.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node_modules/.bin/vitest run src/providers/qwen_livetranslate/lease.test.ts src/providers/qwen_livetranslate/kizunaBudget.test.ts`
Expected: FAIL — no `screenContext` in the body; the floors are today's.

- [ ] **Step 3: Implement**

One line in `sent`; the constant and one term in the floor; the `KEEP IN SYNC` comment in `kizunaBudget.ts` names the backend's `imageIn` constant.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node_modules/.bin/vitest run src/providers/qwen_livetranslate src/lib/session/shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/qwen_livetranslate/lease.ts src/providers/qwen_livetranslate/lease.test.ts src/providers/qwen_livetranslate/kizunaBudget.ts src/providers/qwen_livetranslate/kizunaBudget.test.ts
git commit -m "feat(screen-context): the managed lease asks for the screen add-on and the start floor includes it"
```

---

## Part C — the site docs and the privacy policy (sokuji-backend)

### Task 14: The pages, in 12 locales, with screenshots from a dev build of Part A

**Files:**
- Modify: `web/src/pages/docs/tutorials/QwenSetup.tsx` (`SCREENSHOTS` at `:15-20`; in every locale block: a step after "Add Preferred Translations (optional)", a bullet in "What is Qwen LiveTranslate?", a bullet in "Modes and Options", a "Common Issues" item), `KizunaAIQuickStart.tsx` (the FAQ in every locale block: the "Where does my audio go?" answer gains a sentence; a new question before "How do I run the setup guide again?"), `KizunaBillingGuide.tsx` (the "Soniox and Qwen are metered differently" step gains a sentence, every locale), `web/src/locales/docs/*.ts` (`privacy.thirdParty.alibaba.content`, 12 files)
- Create: `web/public/tutorials/qwen-setup/05-screen-context.png` (the switch and its description under the voice), `06-screen-chip.png` (the control bar with the chip live and its card open)
- Test: the existing docs tests (`web/src/pages/docs/**/*.test.ts`, the locale parity tests) must stay green; no new test — prose.

**Interfaces:** none produced. Copy rules: no price figure (§3.5, §7); the privacy entry says what goes where and keeps Kizuna AI's line (§3.6).

- [ ] **Step 1: Take the screenshots**

From the client worktree on `feat/qwen-screen-context` with Part A built: `npm run electron:dev` (or the renderer-only server, `SOKUJI_DEV_NO_ELECTRON=1`, for the settings crop), the tutorial style of the existing four (2× section crops, quantized to 256 colours — `tmp/shot_process.py` in the job folder, or the same with Pillow). Save the two PNGs under `web/public/tutorials/qwen-setup/`.

- [ ] **Step 2: Write the English copy, then the 11 translations**

`QwenSetup` step `Let Qwen see your screen (optional)`: "Turn on <strong>Screen context</strong> under the voice settings. When the session starts, Sokuji asks which window, tab or screen Qwen may see (on Linux with Wayland and on macOS 15 the system's own chooser appears); pick the one that shows what is being talked about — the shared slides, a lecture's deck, a video's captions — and the names on it come out right in the transcript and the translation. Pictures of that area only go to Alibaba Cloud's Qwen service in the region of the session; Kizuna AI never receives them. A chip in the control bar shows what is being seen; if the window goes away, translation continues on audio and the chip offers <strong>Choose again</strong>. In the browser extension the meeting tab is used. With a Kizuna AI account, screen context adds to the charge for every second of speech while it is on, in Both mode for each direction; the rate is on the billing page." (screenshot `screenContext`); a "Modes and Options" bullet on what helps and what hurts ("A screen that shows something else makes recognition worse than audio alone: pick the window with the words being spoken, not the whole desktop"); a "Common Issues" item "Screen context stopped" ("The window closed or the capture failed. Click the screen chip and choose again; the session kept running on audio."); the feature bullet "Screen context: Qwen can see one window, tab or screen you choose, so on-screen names are recognized and translated as written".
`KizunaAIQuickStart` FAQ: "Where does my audio go?" + " With screen context on (Qwen engine), pictures of the one window, tab or screen you chose go the same way; Kizuna AI never receives them."; new question "Can the Qwen engine see my slides?" with the answer "Yes: turn on Screen context in the Qwen engine's settings and pick the window when the session starts. It adds to the per-second charge while it is on; the Qwen setup guide explains it."
`KizunaBillingGuide`: "With screen context on, the Qwen engine is also charged for the pictures it sees, per second of speech, in each direction." appended to the metered step.
`privacy.thirdParty.alibaba.content`: after "audio is sent", "— and, when screen context is on, pictures of the one window, tab or screen you chose —" keeping the rest of the sentence; Kizuna AI's line stays.
The 11 other locales: the same content translated, in each page's locale block and locale file.

- [ ] **Step 3: Run the docs tests**

Run: `node_modules/.bin/vitest run web/src/pages/docs web/src/locales`
Expected: PASS.

- [ ] **Step 4: Look at the pages**

Run: `web/node_modules/.bin/vite web --port 5399 --strictPort` and open `/docs/tutorials/qwen-setup`, `/docs/tutorials/kizunaai-quickstart`, `/docs/tutorials/kizunaai-billing`, `/docs/privacy` in a browser; the screenshots render at 2×, the steps read in order.
Expected: the three guides and the policy show the new text; no "$" or "¥" in the new paragraphs.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/docs web/src/locales/docs web/public/tutorials/qwen-setup
git commit -m "docs: screen context on the Qwen engine — setup guide, KizunaAI pages, privacy policy"
```

---

## Before shipping (spec §5; not tasks — the owner's live checks)

- First-word latency with and without a frame on the same clip (the A/B measured accuracy only); if video costs latency, the switch's tooltip and the setup guide say so.
- Windows (the yellow capture border, VB-CABLE present), macOS 15 (the Screen Recording flow: `not-determined` prompts on the first list, `denied` shows the pane button), Linux Wayland (the portal, `WebRTCPipeWireCapturer` on) and X11 (Sokuji's list), the extension with a shared screen and with nobody sharing (faces and a grid were never measured; if they degrade recognition, §4's extension rule is revisited).
- Both mode: both legs' chips, one source; Choose again mid-run keeps both legs' subscriptions.
- Part B lands before the release that unflags `kizunaai_qwen`.
