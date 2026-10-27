# Sokuji mobile, phase 2: the first version (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Gate A prototype under `mobile/` into the first shippable version of spec §3.1: sign in by email code, pick two languages, press Start, read bilingual subtitles for an hour or two with the phone locked, export the transcript, see the balance — on iOS and Android, ready for TestFlight and a Play closed test.

**Architecture:** The prototype's chain stays (sign-in → lease → 16 kHz microphone → Soniox socket → tokens, with lease rotation and retries); around it the app adopts the desktop's own transcript pipeline, all of it Metro-clean: `Utterances` turns tokens into segment events, `Conversation` keeps the leg, `createProjector()` makes the `Entry[]` the subtitle list and the exporters render, `renderTranscriptTxt/Json` write the files. Screens are React Native over one Zustand store persisted with AsyncStorage; strings come from the desktop's 30 catalogs through i18next with `expo-localization`.

**Tech Stack:** Expo SDK 58 (dev client; `expo-secure-store`, `expo-localization`, `expo-file-system`, `expo-sharing`, `expo-keep-awake`, `expo-network`, `expo-build-properties`), `better-auth` 1.6.33 + `@better-auth/expo`, `react-native-audio-api` 0.13.x, `zustand` + `@react-native-async-storage/async-storage`, `i18next` + `react-i18next`, `posthog-react-native`; shared from `src/`: `providers/soniox/{sttStream,socket,utterances,leaseRequest,lease,model}`, `lib/soniox/regions`, `lib/contract/{clock,events}`, `lib/conversation/Conversation`, `lib/projection/project`, `lib/export/transcript`, `locales/*/translation.json`.

**Spec:** `docs/superpowers/specs/2026-10-26-sokuji-mobile-design.md` — §3.1 (what is in), §5 (design), §6 Gate B, rulings R8, R10, R11, R12. Phase 1 plan and its outcome: `docs/superpowers/plans/2026-10-26-sokuji-mobile-phase1-prototype.md`.

**Prerequisites:** Gate A passed (iOS: 60 min locked, airplane-mode recovery, another app in front; Android: 66 min locked without a drop; reconnect ≈ 9 s after a drop). The prototype branch `spike/mobile-prototype` is the base of this work. The backend accepts the app's origin (`sokuji://`, shipped).

**Where it runs:** pure-logic tasks (1, 2, 3, 5, 8) on any host with `npm test` inside `mobile/`; device verification and store tasks (4, 6, 7, 9, 10, 11) on the macOS machine with both phones.

## Global Constraints

- Scheme `sokuji`; app name "Sokuji" (R10). Production identifier `ai.kizunaai.sokuji` on both platforms (owner, 2026-10-27: no such App ID existed yet). Development builds sign with the team's wildcard profile and register nothing; the explicit App ID is created in Task 10. The prototype's `ai.kizunaai.sokuji.prototype` is dropped there.
- Sign-in and sign-up by email one-time code only (R11): `emailOtp.sendVerificationOtp({ email, type: 'sign-in' })`, `signIn.emailOtp({ email, otp })`. The prototype's password path is removed. No third-party sign-in.
- Managed Soniox only: `POST /api/soniox/session-key` `{ mode: 'participant', textOnly: true, bothSplit: false, region }` with `Authorization: Bearer <session token>`; `session-started { leaseId, role }`; `session-end { leaseId }`. Model `'stt-rt-v5'` as `SONIOX_STT_MODEL` from `src/providers/soniox/sttStream.ts`.
- Audio: the phone's own microphone always (no Bluetooth voice input); 16 kHz mono, 100 ms buffers (`bufferLength: 1600`); the Soniox config's `sampleRate` is the delivered `buffer.sampleRate`.
- Language pair, as the desktop (owner, 2026-10-27): default source `auto` (Soniox language identification is always on; `languageHints: [source]` only when the user chose a specific language) and default target `en`; the user's choice persists as one pair and overrides the default from then on.
- Reconnect: fresh lease (R8): old lease `session-end` (4 s budget) → `session-key` (409 every 3 s) → connect → `session-started`; network errors retried at 2 s, 5 s, 10 s then 15 s, and at once on the OS "network restored" event; grant rotation 15 s before `maxSessionDurationSeconds` checked in the audio callback; terminal only for `sign_in_required`, `microphone_denied`, `balance_exhausted` (402).
- Rendering is bounded: the subtitle list is a virtualized list of fixed-height rows; state updates are batched (250 ms) and suspended while the app is not active (`AppState !== 'active'`), where only the model updates. A 60-minute session must hold memory flat within ±50 MB after the first 5 minutes.
- Balance only (R12): the account screen shows the balance from `GET /api/wallet/status` (`balanceUsd`) and says, in words, that top-ups are made on the website. No purchase, no link.
- Every user-visible string is an i18next key present in all 30 catalogs under `src/locales/*/translation.json` (the desktop's consistency test enforces it); new keys live under the `mobile` namespace.
- Sessions are kept on the device until the user deletes them; export is text and the desktop's JSON through the system share sheet.
- Analytics: PostHog with the desktop's event names `translation_session_start` / `translation_session_end` and a `platform` super property of `ios` or `android`.
- `mobile/**` stays excluded from the root vitest; the mobile app's own `npm test` (vitest, node) covers its pure modules; screens are verified on the devices.

## Review Focus

1. The phone locks for an hour and the subtitles were never drawn: on unlock the list must show the last rows within a second and the full transcript must be exportable — Task 5's "catch-up" test (apply 3,000 entries with the UI suspended, then one render).
2. A sign-in session that expired during a lecture: the next lease answers 401 → the session ends with "sign in again", the transcript so far stays and is exportable — Task 8's test exports a session whose last status is `sign_in_required`.
3. The balance runs out mid-session: the rotation's `session-key` answers 402 → `balance_exhausted`, subtitles stay, the account screen opens with the balance and the website sentence — Task 7's test for the 402 → status mapping.
4. A phone call during the lecture: the recorder pauses on `interruption` and resumes when `shouldResume` says so; the socket is kept and the lease is not ended — Task 6's test on the interruption handler with a fake `AudioManager`.
5. Two devices on one account: the backend keeps one lease per account, so the second device's `session-key` answers 409 for as long as the first runs; after 60 s of that the second device must say "another session is running on this account" and keep trying rather than fail — Task 6's test maps a 409 past 60 s to that status.

---

### Task 1: From prototype to app: layout, no password path, no probe UI

**Files:**
- Modify: `mobile/src/*` (move into folders: `mobile/src/backend.ts`, `mobile/src/auth/{client,SignIn}.ts(x)`, `mobile/src/session/{lease,pcm,session}.ts`, `mobile/src/screens/{Main,Account,History}.tsx` (Main from the prototype; the other two are created in Tasks 7–8), `mobile/src/store/settings.ts` (Task 3), `mobile/src/i18n/index.ts` (Task 2)
- Delete: the password sign-in in `mobile/src/auth/client.ts` and `SignIn.tsx`; the on-screen Gate A log and version marker in `Main.tsx` (the file logger stays behind `__DEV__`)
- Test: the prototype's tests move with their modules (`lease.test.ts`, `pcm.test.ts`, `session`'s rotation/retry tests)

**Interfaces:**
- Consumes: the prototype's exported functions unchanged: `sendCode(email)`, `signInWithCode(email, otp)`, `sessionToken()`, `signOut()`, `leaseKey(o)`, `sessionStarted(o)`, `sessionEnd(o)`, `floatToInt16(samples)`, `startSession(o)`.
- Produces: the same names at their new paths; `startSession` additionally emits `{ type: 'tokens', tokens }` as before (Task 4 consumes it).

- [ ] **Step 1: Move the files and update imports; delete the password path and the probe UI**
- [ ] **Step 2: Run the mobile tests**

Run: `cd mobile && npm test`
Expected: the prototype's tests pass at their new paths (no behaviour change).

- [ ] **Step 3: Build the dev client on both phones and sign in by code**

Run: `cd mobile && npx expo run:ios --device && npx expo run:android --device`
Expected: sign-in by email code works; no password field exists.

- [ ] **Step 4: Commit**

```bash
git add mobile
git commit -m "refactor(mobile): app layout from the prototype; one-time code sign-in only"
```

---

### Task 2: Strings: the desktop's catalogs through i18next and the device locale

**Files:**
- Create: `mobile/src/i18n/index.ts`, `mobile/src/i18n/pickLanguage.ts`, `mobile/src/i18n/pickLanguage.test.ts`
- Modify: `src/locales/*/translation.json` (30 files: a `mobile` namespace with the keys the screens use; English first, each catalog in its own language)

**Interfaces:**
- Produces:
  - `export const CATALOGS: Record<string, () => Promise<{ default: Record<string, unknown> }>>` — one static `import()` per catalog directory in `src/locales` (Metro bundles static dynamic imports)
  - `export function pickLanguage(tags: readonly string[], available: readonly string[]): string` — the first device tag that maps to a catalog: exact (`ja`), region-specific (`zh-Hant-TW` → `zh_TW`, `zh-Hans`/`zh-CN` → `zh_CN`, `pt-BR` → `pt_BR`, `pt-PT` → `pt_PT`), then language only (`fr-CA` → `fr`); `'en'` when none
  - `export async function initI18n(): Promise<void>` — `i18next.use(initReactI18next).init({ lng: pickLanguage(getLocales().map(l => l.languageTag), Object.keys(CATALOGS)), fallbackLng: 'en', resources: { [lng]: { translation } } })` loading only the picked catalog and `en`
- Consumes: `expo-localization`'s `getLocales()`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { pickLanguage } from './pickLanguage';
import { CATALOGS } from './index';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('pickLanguage', () => {
  const available = ['en', 'ja', 'zh_CN', 'zh_TW', 'pt_BR', 'pt_PT', 'fr', 'de'];
  it.each([
    [['ja-JP'], 'ja'], [['zh-Hant-TW'], 'zh_TW'], [['zh-Hans-CN'], 'zh_CN'], [['zh-CN'], 'zh_CN'], [['zh-TW'], 'zh_TW'],
    [['pt-BR'], 'pt_BR'], [['pt-PT'], 'pt_PT'], [['pt'], 'pt_PT'], [['fr-CA'], 'fr'], [['xx'], 'en'], [[], 'en'],
    [['xx', 'de-AT'], 'de'],
  ])('%j → %s', (tags, expected) => expect(pickLanguage(tags, available)).toBe(expected));
});

describe('CATALOGS', () => {
  it('names every catalog directory the desktop ships', () => {
    const dirs = readdirSync(resolve(__dirname, '../../../src/locales'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(Object.keys(CATALOGS).sort()).toEqual(dirs);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd mobile && npm test -- pickLanguage`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `pickLanguage.ts` and `index.ts` to the interface; add the `mobile` keys to the 30 catalogs**

The keys (English): `mobile.signIn.title` "Sign in", `mobile.signIn.email` "Email", `mobile.signIn.sendCode` "Send code", `mobile.signIn.code` "Code from the email", `mobile.signIn.submit` "Sign in", `mobile.main.hear` "I hear", `mobile.main.read` "I read", `mobile.main.start` "Start", `mobile.main.stop` "Stop", `mobile.main.bilingual` "Show both languages", `mobile.main.status.listening` "Listening", `mobile.main.status.reconnecting` "Reconnecting…", `mobile.main.status.signInRequired` "Please sign in again", `mobile.main.status.balanceExhausted` "Your balance is used up", `mobile.main.status.micDenied` "Sokuji needs the microphone", `mobile.main.status.otherSession` "Another session is running on this account", `mobile.account.balance` "Balance", `mobile.account.topUp` "Top-ups are made on the Sokuji website.", `mobile.account.signOut` "Sign out", `mobile.history.title` "Sessions", `mobile.history.export` "Export", `mobile.history.delete` "Delete", `mobile.settings.region` "Soniox region", `mobile.settings.textSize` "Subtitle size", `mobile.settings.keepAwake` "Keep the screen on". Each other catalog gets the same keys in its language (translate; the desktop's existing wording for the same ideas — `update.*`, `settings.*` — is the reference for tone).

- [ ] **Step 4: Run the mobile tests and the desktop's locale consistency test**

Run: `cd mobile && npm test -- i18n` and, at the repo root, `npx vitest run src/locales`
Expected: PASS in both (every catalog has every key).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/i18n src/locales
git commit -m "feat(mobile): i18n from the desktop's catalogs, language from the device"
```

---

### Task 3: Settings store, persisted

**Files:**
- Create: `mobile/src/store/settings.ts`, `mobile/src/store/settings.test.ts`

**Interfaces:**
- Produces: `export interface Settings { source: string; target: string; region: SonioxRegion; bilingual: boolean; textSize: 'small' | 'medium' | 'large'; keepAwake: boolean }` — `source` is a Soniox language code or `'auto'`; `export const DEFAULT_SETTINGS: Settings = { source: 'auto', target: 'en', region: 'us', bilingual: true, textSize: 'medium', keepAwake: true }` (the desktop's initial pair for Soniox); `export function createSettingsStore(storage: StateStorage)` returning a Zustand store with `persist` (`name: 'sokuji.settings'`) and `set(partial)`; `export const useSettings = createSettingsStore(AsyncStorage)`.
- Consumes: `zustand`, `zustand/middleware` (`persist`, `createJSONStorage`), `@react-native-async-storage/async-storage`.

- [ ] **Step 1: Write the failing test** — a fake in-memory `StateStorage`; `set({ target: 'ja' })` then a second store on the same storage reads `target: 'ja'`; unknown keys in stored JSON are ignored; a missing store gives `DEFAULT_SETTINGS`.
- [ ] **Step 2: Run it to verify it fails** (`npm test -- settings`)
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run it to verify it passes**
- [ ] **Step 5: Commit** — `feat(mobile): persisted settings`

---

### Task 4: One transcript model with the desktop

**Files:**
- Create: `mobile/src/session/transcript.ts`, `mobile/src/session/transcript.test.ts`
- Modify: `mobile/src/session/session.ts` (feed tokens into the model instead of emitting raw tokens)

**Interfaces:**
- Consumes: `Utterances` (`@shared/providers/soniox/utterances`: `new Utterances({ sink, clock, legFor, targetFor })`, `message(tokens)`, `abandon()`), `Conversation` (`@shared/lib/conversation/Conversation`: `new Conversation({ leg: 'participant', session: sessionId, languages: { source, target }, clock, retention: { keepPcm: false, maxPcmBytes: 0 } })`, `apply(event)`, `snapshot(): Leg`, `subscribe(listener)`, `clear()`), `createProjector()` and `DEFAULT_PROJECTION` (`@shared/lib/projection/project`), `Entry` (`@shared/lib/projection/types`), `realClock` (`@shared/lib/contract/clock`). All audited Metro-clean; Step 3 adds them to the allowlist.
- Produces (`transcript.ts`):
  - `export interface Transcript { message(tokens: readonly SonioxToken[]): void; reconnected(): void; entries(): readonly Entry[]; leg(): Leg; subscribe(listener: () => void): () => void; end(): void }`
  - `export function createTranscript(o: { source: string; target: string; sessionId: string; clock?: Clock }): Transcript` — `Utterances` with a sink that forwards `segmentOpened/segmentText/segmentClosed` into `Conversation.apply` (the event objects are structurally `AdapterEvent`s), `legFor` always `'participant'`, `targetFor` the target; `speak`/`endSpeech` ignored (no TTS); `reconnected()` calls `utterances.abandon()` (a new socket renumbers speakers); `entries()` projects `[conversation.snapshot()]` with `DEFAULT_PROJECTION`, memoised per conversation version.
- `session.ts`: `startSession` gains `transcript: Transcript` in its options and calls `transcript.message(m.tokens)` on every message and `transcript.reconnected()` after a reconnect; the `tokens` event is removed. Its Soniox config sends `languageHints: [source]` only when `source !== 'auto'` (language identification is always on in `SonioxSttStream`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createTranscript } from './transcript';

const tok = (text: string, status: 'original' | 'translation', is_final = true) => ({ text, is_final, translation_status: status, language: status === 'original' ? 'en' : 'zh' });

describe('createTranscript', () => {
  it('turns original and translation tokens into one exchange entry', () => {
    const t = createTranscript({ source: 'en', target: 'zh', sessionId: 's1' });
    t.message([tok('Good ', 'original'), tok('morning.', 'original'), tok('<end>', 'original')]);
    t.message([tok('早上好。', 'translation'), tok('<end>', 'translation')]);
    const entries = t.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'exchange', leg: 'participant' });
    expect(entries[0].kind === 'exchange' && entries[0].source.map((r) => r.text).join('')).toBe('Good morning.');
    expect(entries[0].kind === 'exchange' && entries[0].translation.map((r) => r.text).join('')).toBe('早上好。');
  });

  it('keeps non-final text visible as the open row', () => {
    const t = createTranscript({ source: 'en', target: 'zh', sessionId: 's1' });
    t.message([tok('Good ', 'original', false)]);
    expect(t.entries()).toHaveLength(1);
  });

  it('notifies subscribers once per message, not per token', () => {
    const t = createTranscript({ source: 'en', target: 'zh', sessionId: 's1' });
    let n = 0;
    t.subscribe(() => { n += 1; });
    t.message([tok('a', 'original'), tok('b', 'original'), tok('c', 'original')]);
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** (`npm test -- transcript`)
- [ ] **Step 3: Implement `transcript.ts`; wire `session.ts`** — the exact `<end>`/`<fin>` handling, speaker labels and the fin-grace timer are `Utterances`' own; do not reimplement them. Add `src/lib/conversation/Conversation.ts`, `src/lib/projection/project.ts`, `src/lib/projection/types.ts`, `src/lib/contract/events.ts` and `src/lib/export/transcript.ts` to `MOBILE_SHARED_ROOTS` in `src/lib/mobileShared.test.ts` (repo root), so the root suite keeps them Metro-clean.
- [ ] **Step 4: Run the mobile tests** — PASS, including the prototype's session tests updated for the new option.
- [ ] **Step 5: Commit** — `feat(mobile): the desktop's transcript model (Utterances → Conversation → entries)`

---

### Task 5: The subtitle list: virtualized, batched, silent in the background

**Files:**
- Create: `mobile/src/screens/Subtitles.tsx`, `mobile/src/session/entriesFeed.ts`, `mobile/src/session/entriesFeed.test.ts`
- Modify: `mobile/src/screens/Main.tsx` (replace the two text blocks)

**Interfaces:**
- Consumes: `Transcript.entries()/subscribe()` (Task 4); React Native `FlatList`, `AppState`.
- Produces (`entriesFeed.ts`, pure): `export function createEntriesFeed(o: { transcript: Pick<Transcript, 'entries' | 'subscribe'>; isActive: () => boolean; onActiveChange(cb: (active: boolean) => void): () => void; now: () => number; schedule: (fn: () => void, ms: number) => () => void; batchMs?: number }): { subscribe(listener: (entries: readonly Entry[]) => void): () => void; stop(): void }` — forwards the transcript's entries to UI listeners at most once per `batchMs` (250) while active; while inactive forwards nothing; on becoming active forwards once immediately (the catch-up).
- `Subtitles.tsx`: `FlatList` with `getItemLayout` (fixed row height per `textSize`), `inverted` with the newest at the bottom, `maxToRenderPerBatch` 10, `windowSize` 5, `removeClippedSubviews`; each exchange renders a source row and, when `bilingual`, a translation row; non-final text in a muted colour; `keyExtractor` = entry id.

- [ ] **Step 1: Write the failing tests** — (a) 10 transcript notifications within 250 ms → 1 UI update; (b) inactive → 0 updates even for 3,000 entries; becoming active → exactly 1 update carrying all entries; (c) `stop()` → no further updates.
- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement `entriesFeed.ts`, `Subtitles.tsx`; wire `Main.tsx`** — Main keeps the screen awake while listening when the setting is on (`expo-keep-awake`).
- [ ] **Step 4: Run the mobile tests; on both phones a 20-minute session with the screen on and a 20-minute one locked** — memory (Android `dumpsys meminfo`, iOS Xcode gauge) flat within ±50 MB after minute 5; unlock shows the latest rows at once.
- [ ] **Step 5: Commit** — `feat(mobile): virtualized subtitles, batched and silent in the background`

---

### Task 6: Session robustness: interruptions, network return, one session per account

**Files:**
- Modify: `mobile/src/session/session.ts`
- Create: `mobile/src/session/interruptions.ts`, `mobile/src/session/interruptions.test.ts`

**Interfaces:**
- Consumes: `AudioManager.addSystemEventListener('interruption', cb)` (`{ type, shouldResume }`), `('routeChange', cb)`; `AudioRecorder.pause()/resume()`; `expo-network` `addNetworkStateListener(({ isConnected }) => …)`; the prototype's retry loop.
- Produces (`interruptions.ts`, pure): `export function createInterruptionHandler(o: { pauseCapture(): void; resumeCapture(): void; log(line: string): void }): { onInterruption(e: { type: 'began' | 'ended'; shouldResume: boolean }): void; onRouteChange(e: { reason: string }): void }` — `began` pauses capture; `ended` with `shouldResume` resumes; `ended` without it leaves capture paused and logs; a route change neither pauses nor resumes (the input stays the phone's microphone).
- `session.ts`: subscribes the handler to the two system events; a network-restored event triggers an immediate retry when a retry is pending; a 409 that persists past 60 s sets `status: 'error', detail: 'other_session'` (the loop continues; the screen says "another session is running on this account").

- [ ] **Step 1: Write the failing tests** — the handler's four cases; the 409 → `other_session` mapping in the retry loop (fake fetch answering 409 for 61 s of fake time).
- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the mobile tests; on the iPhone, an incoming call during a session** — subtitles continue after hang-up without a reconnect line in the log.
- [ ] **Step 5: Commit** — `feat(mobile): pause on interruptions, retry on network return, say when another session holds the account`

---

### Task 7: Account and settings screen: balance, the website sentence, settings, sign out

**Files:**
- Create: `mobile/src/account/wallet.ts`, `mobile/src/account/wallet.test.ts`, `mobile/src/screens/Account.tsx`
- Modify: `mobile/src/screens/Main.tsx` (an account button), `mobile/src/session/session.ts` (402 → `balance_exhausted`, already from the prototype; the screen reacts)

**Interfaces:**
- Produces: `export async function fetchWallet(o: { token: string; fetch?: typeof fetch }): Promise<{ balanceUsd: number; frozen: boolean }>` — `GET ${BACKEND_URL}/api/wallet/status` with the bearer token; `balanceUsd` from the response (`balanceMicroUsd / 1e6` when `balanceUsd` is absent); 401 → throws `sign_in_required`.
- `Account.tsx`: the balance formatted in the device locale (`Intl.NumberFormat`), the sentence `mobile.account.topUp`, the sign-out button (`signOut()` then the sign-in screen); opened automatically on `balance_exhausted`. Below it the settings (Task 3's store): Soniox region (`us`/`eu`/`jp`), subtitle size, keep the screen on, show both languages — the language pair itself stays on the main screen.

- [ ] **Step 1: Write the failing test** — response `{ balanceMicroUsd: 2500000, frozen: false }` → `{ balanceUsd: 2.5, frozen: false }`; `{ balanceUsd: 1.25 }` → 1.25; 401 → `sign_in_required`.
- [ ] **Step 2: Run it to verify it fails**
- [ ] **Step 3: Implement `wallet.ts` and `Account.tsx`**
- [ ] **Step 4: Run the mobile tests; on a phone: the balance matches the website; wording reviewed against spec §5.4 (no purchase, no link); each setting takes effect on the next Start (region) or at once (size, keep awake, bilingual)**
- [ ] **Step 5: Commit** — `feat(mobile): account screen with the balance (R12)`

---

### Task 8: Sessions on the device, and export through the share sheet

**Files:**
- Create: `mobile/src/history/store.ts`, `mobile/src/history/store.test.ts`, `mobile/src/history/export.ts`, `mobile/src/history/export.test.ts`, `mobile/src/screens/History.tsx`

**Interfaces:**
- Produces:
  - `export interface StoredSession { id: string; startedAt: number; endedAt: number | null; source: string; target: string; leg: Leg; lastStatus: string }`
  - `export function createHistoryStore(fs: { read(path: string): Promise<string | null>; write(path: string, body: string): Promise<void>; removeDir(path: string): Promise<void>; listDirs(path: string): Promise<string[]> })` with `save(session: StoredSession)`, `list(): Promise<Array<Pick<StoredSession, 'id' | 'startedAt' | 'endedAt' | 'source' | 'target'>>>`, `load(id)`, `delete(id)` — one directory per session under the document directory (`sessions/<id>/session.json`, `expo-file-system`), written at session end and every 60 s during a session (so a killed app loses at most a minute). The directory, not a bare file, because a later version adds the recording beside the JSON (owner, 2026-10-27); the first version stores no audio and keeps every session until the user deletes it (no cap: text only, tens of KB an hour).
  - `export function exportText(s: StoredSession, labels: TranscriptLabels, header: TranscriptHeaderLabels, meta: TranscriptMeta): string` and `exportJson(...)`: `renderTranscriptTxt(createProjector().project([s.leg], DEFAULT_PROJECTION), [s.leg], { labels, formatTime, header: { labels: header, meta, formatDateTime } })` and `renderTranscriptJson(...)` likewise.
  - `export async function shareExport(s: StoredSession, kind: 'txt' | 'json'): Promise<void>` — writes `Sokuji-<startedAt as yyyyMMdd-HHmm>.<txt|json>` to the cache directory and calls `Sharing.shareAsync(uri)`.
- `History.tsx`: the list with date, languages, duration; per session Export (txt/json) and Delete.

- [ ] **Step 1: Write the failing tests** — the store round-trips a session through a fake fs and lists newest first; `exportText` of a one-exchange session contains the source and translation lines and the header title; a session whose `lastStatus` is `sign_in_required` still exports.
- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the mobile tests; on a phone, export a session to Files and open it on a computer**
- [ ] **Step 5: Commit** — `feat(mobile): sessions kept on the device; export as text and JSON`

---

### Task 9: Analytics

**Files:**
- Create: `mobile/src/analytics/index.ts`, `mobile/src/analytics/events.test.ts`
- Modify: `mobile/src/session/session.ts` (start/end events), `mobile/App.tsx` (provider)

**Interfaces:**
- Produces: `export function sessionStartProperties(o: { sessionId: string; source: string; target: string; platform: 'ios' | 'android' }): AnalyticsEvents['translation_session_start']` → `{ session_id, source_language, target_language, provider: 'kizunaai_soniox', transport: 'websocket', platform, participant_speech: false }`; `export function sessionEndProperties(o: { sessionId: string; durationMs: number; errorCount: number }): AnalyticsEvents['translation_session_end']`; `export const posthog` — `new PostHog(key, { host })` from `posthog-react-native`, created only when the key is set, with `platform` registered as a super property. The `AnalyticsEvents` type is imported with `import type` from `@shared/lib/analytics` (erased; the module itself is not bundled).

- [ ] **Step 1: Write the failing test** — the two property builders produce exactly the keys above.
- [ ] **Step 2: Run it to verify it fails**
- [ ] **Step 3: Implement; capture at session start and end**
- [ ] **Step 4: Run the mobile tests; one session on a phone appears in PostHog with `platform`**
- [ ] **Step 5: Commit** — `feat(mobile): PostHog with the desktop's session events`

---

### Task 10: Store readiness

**Files:**
- Modify: `mobile/app.json` (production identifiers, icons, splash, `locales` for the microphone permission string, `android.permission`s unchanged), `mobile/eas.json` (create: `preview` and `production` profiles) or the local build scripts the macOS machine uses
- Create: `mobile/assets/` (icon, adaptive icon, splash), `mobile/PrivacyInfo.xcprivacy` through `expo-build-properties` or the config plugin

- [ ] **Step 1: Set the identifier `ai.kizunaai.sokuji` on both platforms, the display name "Sokuji", version `1.0.0`, build numbers; register the explicit App ID `ai.kizunaai.sokuji` in the Apple developer portal (Identifiers → +; no capabilities needed in the first version) — App Store Connect's "new app" form lists only registered bundle IDs, and the wildcard profile used for development registers none**
- [ ] **Step 2: Icons and splash from the desktop's artwork (`assets/icon.*` in this repository)**
- [ ] **Step 3: Permission strings** — `NSMicrophoneUsageDescription` localized (`app.json` `locales`), the Android foreground-service notification title from `mobile.main.status.listening`
- [ ] **Step 4: Build release candidates for both platforms (iOS archive for TestFlight; Android `.aab`)**

Run: on the macOS machine, `eas build --profile preview` for both platforms (or the local equivalents: `xcodebuild -exportArchive`, `./gradlew bundleRelease`).
Expected: an installable TestFlight build and a Play internal-testing bundle.

- [ ] **Step 5: Commit** — `chore(mobile): store identifiers, artwork, permission strings, build profiles`

---

### Task 11: Gate B

**Files:**
- Create: `mobile/GATE-B.md`

- [ ] **Step 1: The owner's own 90-minute session on cellular, phone in a pocket, on each platform** — battery and heat written down; at least one forced drop (airplane mode 30 s) recovered with the subtitles kept; export opened on a computer.
- [ ] **Step 2: A fresh account's one-time-code sign-up, trial credit and first session, from the phone's cellular connection**
- [ ] **Step 3: The balance screen's wording checked against spec §5.4**
- [ ] **Step 4: TestFlight internal testers; Play closed test started (12 testers, 14 days)**
- [ ] **Step 5: Commit the record** — `docs(mobile): Gate B results`

## Open for the owner

1. **Production identifiers.** Settled 2026-10-27: `ai.kizunaai.sokuji` on both platforms (no App ID of that name existed in the developer portal; the macOS app's Developer ID signing never registered one).
2. **Default languages.** Settled 2026-10-27: as the desktop — `auto` → `en`, the user's last pair remembered.
3. **Session retention.** Settled 2026-10-27: no cap, text only; the per-session directory leaves room for the recording a later version adds.
