# Sokuji mobile, phase 2: the first version (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Gate A prototype under `mobile/` into the first shippable version of spec §3.1: sign in with email and password (sign-up verified by a code), pick two languages, press Start, read bilingual subtitles for an hour or two with the phone locked — or hear the translation through headphones (R13) — export the transcript, see the balance — on iOS and Android, ready for TestFlight and a Play closed test.

**Architecture:** The prototype's chain stays (sign-in → lease → 16 kHz microphone → Soniox socket → tokens, with lease rotation and retries); around it the app adopts the desktop's own transcript pipeline, all of it Metro-clean: `Utterances` turns tokens into segment events, `Conversation` keeps the leg, `createProjector()` makes the `Entry[]` the subtitle list and the exporters render, `renderTranscriptTxt/Json` write the files. Screens are React Native over one Zustand store persisted with AsyncStorage; strings come from the desktop's 30 catalogs through i18next with `expo-localization`.

**Tech Stack:** Expo SDK 58 (dev client; `expo-secure-store`, `expo-localization`, `expo-file-system`, `expo-sharing`, `expo-keep-awake`, `expo-network`, `expo-build-properties`), `better-auth` 1.6.33 + `@better-auth/expo`, `react-native-audio-api` 0.13.x, `zustand` + `@react-native-async-storage/async-storage`, `i18next` + `react-i18next`, `posthog-react-native`; shared from `src/`: `providers/soniox/{sttStream,socket,utterances}` (the lease calls stay the prototype's own `leaseKey`/`sessionStarted`/`sessionEnd`), `lib/soniox/regions`, `lib/contract/{clock,events}`, `lib/conversation/Conversation`, `lib/projection/project`, `lib/export/transcript`, `locales/*/translation.json`.

**Spec:** `docs/superpowers/specs/2026-10-26-sokuji-mobile-design.md` — §3.1 (what is in), §5 (design), §6 Gate B, rulings R8, R10, R11, R12. Phase 1 plan and its outcome: `docs/superpowers/plans/2026-10-26-sokuji-mobile-phase1-prototype.md`.

**Prerequisites:** Gate A passed on both phones (iOS: 62 min locked on a development build, airplane-mode recovery, another app in front; Android: 60 min locked in deep Doze on a release build, airplane-mode recovery with the screen off after the ticker fix, another app in front; reconnect ≈ 9 s after an ordinary drop, ≈ 45 s after a 30-second outage). The record is `mobile/GATE-A.md`. The iPhone release-build run is repeated with Task 12's audio mode. The prototype branch `spike/mobile-prototype` is the base of this work. The backend accepts the app's origin (`sokuji://`, shipped).

**Where it runs:** pure-logic tasks (1, 2, 3, 5, 8) on any host with `npm test` inside `mobile/`; device verification and store tasks (4, 6, 7, 9, 10, 11) on the macOS machine with both phones.

## Global Constraints

- Scheme `sokuji`; app name "Sokuji" (R10). Production identifier `ai.kizunaai.sokuji` on both platforms (owner, 2026-10-27: no such App ID existed yet). Development builds sign with the team's wildcard profile and register nothing; the explicit App ID is created in Task 10. The prototype's `ai.kizunaai.sokuji.prototype` is dropped there.
- Accounts are email + password, as the desktop (R11, revised 2026-10-27). Sign-up: `signUp.email({ email, password, name })` (`name` = the address's local part; the backend requires one), then `emailOtp.sendVerificationOtp({ email, type: 'email-verification' })` and `emailOtp.verifyEmail({ email, otp })`; the backend sends the app no link mail on sign-up, so a registration costs one code email, and the trial credit is granted when the code is verified. Sign-in: `signIn.email({ email, password })`, no mail. Forgotten password: `emailOtp.sendVerificationOtp({ email, type: 'forget-password' })`, then `emailOtp.resetPassword({ email, otp, password })`. An unverified account signs in and sees a verify line until it enters a code. Account deletion in the app: `deleteUser()` (Apple 5.1.1(v), Google Play's account-deletion policy). "Send again" waits 60 s between sends. No code-only sign-in, no third-party sign-in.
- Managed Soniox only: `POST /api/soniox/session-key` `{ mode: 'participant', textOnly: true, bothSplit: false, region }` with `Authorization: Bearer <session token>` — plus `participantSpeech: true` when the hear-the-translation setting is on and headphones are connected at Start (the backend's `participant-spoken` shape; the grant then carries a `par_tts` stream beside `par_stt`); `session-started { leaseId, role }` for each stream; `session-end { leaseId }`. Model `'stt-rt-v5'` as `SONIOX_STT_MODEL` from `src/providers/soniox/sttStream.ts`; speech `SONIOX_TTS_MODEL` from `src/lib/soniox/ttsCatalog.ts`.
- Audio: the phone's own microphone by default; the user may pick a wired-headset or USB input in Settings (`AudioManager.getDevicesInfo()` / `setInputDevice()`), never a Bluetooth microphone (no HFP: it would make playback mono; R14); 16 kHz mono, 100 ms buffers (`bufferLength: 1600`); the Soniox config's `sampleRate` is the delivered `buffer.sampleRate`. With hearing on: iOS category `playAndRecord` with Bluetooth output over A2DP only (never HFP, so playback stays stereo and the input stays the phone's microphone) and no `defaultToSpeaker`; speech is played only while the output route is headphones (wired or Bluetooth), never the loudspeaker (R13); Android's foreground service type is already `mediaPlayback|microphone` (the prototype's Gate A record), so nothing changes there.
- Language pair, as the desktop (owner, 2026-10-27): default source `auto` (Soniox language identification is always on; `languageHints: [source]` only when the user chose a specific language) and default target `en`; the user's choice persists as one pair and overrides the default from then on.
- Reconnect: fresh lease (R8): old lease `session-end` (4 s budget) → `session-key` (409 every 3 s; every `session-key` and `session-started` request is aborted after 15 s and retried as a network error) → connect → `session-started`, sent on the first Soniox message and not awaited (a failure is logged, and a socket is never left open on it); network errors retried at 2 s, 5 s, 10 s then 15 s, and at once on the OS "network restored" event; grant rotation 15 s before `maxSessionDurationSeconds` checked in the audio callback; terminal only for `sign_in_required`, `microphone_denied`, `balance_exhausted` (402).
- No JS timer in anything that must happen with the screen off (Gate A on the Android phone, 2026-10-27: React Native pauses `setTimeout`/`setInterval` with the activity, so a dropped socket was never retried while the microphone kept recording; iOS is unaffected). Every wait — the retry delays, the 409 wait, the request cut-offs, the rotation guard, the forced socket close, the 60-second checkpoint — hangs off the session's ticker (`mobile/src/session/ticker.ts`: `after(ms, fn)`, `sleep(ms, signal)`, `tick()`), which the recorder's audio callback advances every 100 ms and a 250 ms interval advances in the foreground; whichever comes first runs what is due.
- Rendering is bounded: the subtitle list is a virtualized list (rows wrap; no fixed height); state updates are batched (250 ms) and suspended while the app is not active (`AppState !== 'active'`), where only the model updates. A 60-minute session must hold memory flat within ±50 MB after the first 5 minutes.
- Balance only (R12): the account screen shows the balance and the last 30 days' spend from `GET /api/wallet/status`, and the hours the balance buys as the website's billing page computes them: balance ÷ the account's own spend per session hour over the last 30 days (`GET /api/wallet/usage-summary`), or, without enough history, ÷ the cost calculator's "understand others" rate from `GET /api/pricing`; shown as `< 1`, one decimal under 10, else whole hours; the frozen flag and the expiring-soon notice from the same response; and the account's ledger (sessions and credits) from `GET /api/wallet/ledger`, read-only. The account screen is native (owner, 2026-10-27): no web view of the dashboard, so the top-up part of the website never appears in the app. It says, in words, that top-ups are made on the website. No purchase, no link.
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

### Task 1: From prototype to app: layout, password accounts, no probe UI

**Files:**
- Modify: `mobile/src/*` (move into folders: `mobile/src/backend.ts`, `mobile/src/auth/{client,SignIn}.ts(x)`, `mobile/src/session/{lease,pcm,session,ticker}.ts`, `mobile/src/screens/{Main,Account,History}.tsx` (Main from the prototype; the other two are created in Tasks 7–8), `mobile/src/store/settings.ts` (Task 3), `mobile/src/i18n/index.ts` (Task 2)
- Delete: the one-time-code sign-in (`sendCode`, `signInWithCode`) in `mobile/src/auth/client.ts` and `SignIn.tsx`; the on-screen Gate A log and version marker in `Main.tsx` (the file logger stays behind `__DEV__`); the `EXPO_PUBLIC_TEST_*` hooks
- Test: the prototype's tests move with their modules (`lease.test.ts`, `pcm.test.ts`, `session`'s rotation/retry tests)

**Interfaces:**
- Consumes: the prototype's exported functions unchanged: `signInWithPassword(email, password)`, `sessionToken()`, `signOut()`, `leaseKey(o)`, `sessionStarted(o)`, `sessionEnd(o)`, `floatToInt16(samples)`, `startSession(o)`, `createTicker(now)`.
- Produces: the lease, pcm and session names at their new paths; `startSession` additionally emits `{ type: 'tokens', tokens }` as before (Task 4 consumes it). `mobile/src/auth/client.ts`: `signUp(email, password)`, `sendVerificationCode(email)`, `verifyEmail(email, otp)`, `signIn(email, password)` (the prototype's `signInWithPassword`), `requestPasswordReset(email)`, `resetPassword(email, otp, password)`, `deleteAccount()`, `emailVerified(): Promise<boolean>` (from `getSession().data.user.emailVerified`), `sessionToken()`, `signOut()` — each one call on `authClient` per Global Constraints, throwing `Error(result.error.message)` when `result.error` is set (the prototype ignored it). `SignIn.tsx`: two tabs (sign in / create account); after sign-up the code screen (the address, a 6-digit field, "send again" after 60 s); "forgot your password?" → the address → a code and a new password.

- [ ] **Step 1: Move the files and update imports; replace the code sign-in with the sign-up, verification and reset screens; delete the probe UI**
- [ ] **Step 2: Run the mobile tests**

Run: `cd mobile && npm test`
Expected: the prototype's tests pass at their new paths (no behaviour change).

- [ ] **Step 3: Build the dev client on both phones and exercise the accounts**

Run: `cd mobile && npx expo run:ios --device && npx expo run:android --device`
Expected: a new address: create account → one code email → entering the code signs the account in with the trial credit; an existing account signs in with its password; a wrong password is told so; a forgotten password is reset with a code; no code-only sign-in exists.

- [ ] **Step 4: Commit**

```bash
git add mobile
git commit -m "refactor(mobile): app layout from the prototype; email and password accounts"
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

The keys (English): `mobile.signIn.title` "Sign in", `mobile.signIn.register` "Create account", `mobile.signIn.email` "Email", `mobile.signIn.password` "Password", `mobile.signIn.submit` "Sign in", `mobile.signIn.forgot` "Forgot your password?", `mobile.signIn.codeSent` "We sent a 6-digit code to {{email}}", `mobile.signIn.code` "Code from the email", `mobile.signIn.verify` "Verify", `mobile.signIn.sendAgain` "Send again", `mobile.signIn.newPassword` "New password", `mobile.signIn.wrongPassword` "Wrong email or password", `mobile.signIn.wrongCode` "That code is wrong or has expired", `mobile.account.verify` "Verify your email to receive the trial credit", `mobile.account.usage30d` "Spent in the last 30 days", `mobile.account.hoursLeft` "About {{hours}} h left", `mobile.account.frozen` "This account is frozen", `mobile.account.expiring` "{{amount}} of your balance expires on {{date}}", `mobile.account.usage` "Usage", `mobile.usage.session` "Session", `mobile.usage.textOnly` "Text only", `mobile.usage.loadMore` "Show more", `mobile.menu.history` "History", `mobile.menu.account` "Account", `mobile.menu.settings` "Settings", `mobile.account.deleteAccount` "Delete account", `mobile.account.deleteConfirm` "Delete this account and its balance? This cannot be undone.", `mobile.settings.appearance` "Appearance", `mobile.settings.appearanceSystem` "System", `mobile.settings.appearanceLight` "Light", `mobile.settings.appearanceDark` "Dark", `mobile.history.rename` "Rename", `mobile.main.hear` "I hear", `mobile.main.read` "I read", `mobile.main.start` "Start", `mobile.main.stop` "Stop", `mobile.main.bilingual` "Show both languages", `mobile.main.status.listening` "Listening", `mobile.main.status.reconnecting` "Reconnecting…", `mobile.main.status.signInRequired` "Please sign in again", `mobile.main.status.balanceExhausted` "Your balance is used up", `mobile.main.status.micDenied` "Sokuji needs the microphone", `mobile.main.status.otherSession` "Another session is running on this account", `mobile.account.balance` "Balance", `mobile.account.topUp` "Top-ups are made on the Sokuji website.", `mobile.account.signOut` "Sign out", `mobile.history.title` "Sessions", `mobile.history.export` "Export", `mobile.history.delete` "Delete", `mobile.settings.region` "Soniox region", `mobile.settings.textSize` "Subtitle size", `mobile.settings.keepAwake` "Keep the screen on". Each other catalog gets the same keys in its language (translate; the desktop's existing wording for the same ideas — `update.*`, `settings.*` — is the reference for tone).

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
- Produces: `export interface Settings { source: string; target: string; region: SonioxRegion; bilingual: boolean; textSize: 'small' | 'medium' | 'large'; appearance: 'system' | 'light' | 'dark'; keepAwake: boolean }` — `source` is a Soniox language code or `'auto'`; `export const DEFAULT_SETTINGS: Settings = { source: 'auto', target: 'en', region: 'us', bilingual: true, textSize: 'medium', appearance: 'system', keepAwake: true }` (the desktop's initial pair for Soniox); `export function createSettingsStore(storage: StateStorage)` returning a Zustand store with `persist` (`name: 'sokuji.settings'`) and `set(partial)`; `export const useSettings = createSettingsStore(AsyncStorage)`.
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
- `Subtitles.tsx`: `FlatList`, `inverted` with the newest at the bottom (so its data is the entries newest first; rows wrap and have no fixed height, so no `getItemLayout`), `maxToRenderPerBatch` 10, `windowSize` 5, `removeClippedSubviews`; each exchange renders a source row and, when `bilingual`, a translation row; non-final text in a muted colour; `keyExtractor` = entry id.

- [ ] **Step 1: Write the failing tests** — (a) 10 transcript notifications within 250 ms → 1 UI update; (b) inactive → 0 updates even for 3,000 entries; becoming active → exactly 1 update carrying all entries; (c) `stop()` → no further updates; (d) two entries → the listener receives them newest first (the later entry at index 0).
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

### Task 7: Account and settings screens: balance, hours and usage, the website sentence, settings, verify, delete, sign out

**Files:**
- Create: `mobile/src/account/wallet.ts`, `mobile/src/account/wallet.test.ts`, `mobile/src/account/hours.ts`, `mobile/src/account/hours.test.ts`, `mobile/src/account/ledger.ts`, `mobile/src/account/ledger.test.ts`, `mobile/src/screens/Account.tsx`, `mobile/src/screens/Settings.tsx`, `mobile/src/screens/Usage.tsx`
- Modify: `mobile/src/screens/Main.tsx` (an account button), `mobile/src/session/session.ts` (402 → `balance_exhausted`, already from the prototype; the screen reacts)

**Interfaces:**
- Produces: `export async function fetchWallet(o: { token: string; fetch?: typeof fetch }): Promise<{ balanceUsd: number; frozen: boolean; last30DaysUsd: number; expiringSoon: { usd: number; expiresAt: number } | null }>` — `GET ${BACKEND_URL}/api/wallet/status` with the bearer token; `balanceUsd` from the response (`balanceMicroUsd / 1e6` when `balanceUsd` is absent), `last30DaysUsd` = `last30DaysUsageMicroUsd / 1e6`, `expiringSoon` from the response's `expiringSoon` (`microUsd / 1e6`, `expiresAt`) or `null`; 401 → throws `sign_in_required`. `ledger.ts`: `export async function fetchLedger(o: { token: string; limit?: number; before?: { at: number; groupId: string }; fetch?: typeof fetch }): Promise<{ groups: LedgerGroup[]; next: { at: number; groupId: string } | null }>` — `GET /api/wallet/ledger?limit=20` plus the cursor, the website's records card's own endpoint; `export interface LedgerGroup { id: string; kind: 'session' | string; occurredAt: number; durationSeconds: number | null; textOnly: boolean; amountUsd: number }` (a session group's duration and summed amount; any other group kind is one entry, labelled by its kind as the website labels it, amount signed); 401 → `sign_in_required`. `export async function fetchUsagePerHour(o): Promise<number | null>` — `GET /api/wallet/usage-summary`: `spendMicroUsd / 1e6 ÷ (sessionSeconds / 3600)`, `null` when `sessionSeconds` is 0. `export async function fetchFallbackUsdPerHour(o): Promise<number>` — the cost calculator's "understand others" preset priced from `GET /api/pricing`, the website's own fallback. `hours.ts` (pure): `export function hoursLeft(balanceUsd: number, usdPerHour: number | null, fallbackUsdPerHour: number): number` and `export function formatHours(h: number): string` (`< 1` under 1, one decimal under 10, else the whole number) — the website's billing page, mirrored.
- `Account.tsx`: the address, the balance and the 30-day spend formatted in the device locale (`Intl.NumberFormat`), the hours line (`mobile.account.hoursLeft`), `mobile.account.frozen` when `frozen`, `mobile.account.expiring` when `expiringSoon` is set, the sentence `mobile.account.topUp`; a Usage row → `Usage.tsx`, the ledger newest first (date, duration, amount; `mobile.usage.loadMore` fetches the next page with the cursor); a `mobile.account.verify` line with a Verify button while `emailVerified()` is false (→ Task 1's code screen); the sign-out button (`signOut()` then the sign-in screen); a Delete account row (confirm with `mobile.account.deleteConfirm` → `deleteAccount()` → the sign-in screen); opened automatically on `balance_exhausted`. `Settings.tsx` is its own screen (owner, 2026-10-27: the settings will grow, so they are not on the account screen): Soniox region (`us`/`eu`/`jp`), subtitle size, appearance, keep the screen on, show both languages, the language pair (Task 3's store); the ≡ sheet on the main screen opens History, Account and Settings.

- [ ] **Step 1: Write the failing tests** — `fetchWallet`: response `{ balanceMicroUsd: 2500000, frozen: false, last30DaysUsageMicroUsd: 1200000 }` → `{ balanceUsd: 2.5, frozen: false, last30DaysUsd: 1.2 }`; `{ balanceUsd: 1.25 }` → 1.25; 401 → `sign_in_required`. `fetchUsagePerHour`: `{ spendMicroUsd: 3000000, sessionSeconds: 7200 }` → 1.5; `sessionSeconds: 0` → `null`. `hoursLeft(12, 1.5, 4)` → 8; `hoursLeft(12, null, 4)` → 3. `formatHours`: 0.4 → `< 1`, 2.53 → `2.5`, 12.4 → `12`. `fetchLedger`: a response with one session group (two entries, 1 800 s, −$0.95 in micro-USD) and one credit group → `[{ kind: 'session', durationSeconds: 1800, amountUsd: -0.95, … }, { kind: 'topup', amountUsd: 10, … }]` with the cursor passed through; 401 → `sign_in_required`.
- [ ] **Step 2: Run it to verify it fails**
- [ ] **Step 3: Implement `wallet.ts`, `hours.ts`, `ledger.ts`, `Account.tsx`, `Settings.tsx` and `Usage.tsx`**
- [ ] **Step 4: Run the mobile tests; on a phone: the balance, the 30-day spend, the hours and the usage list match the website's billing page; wording reviewed against spec §5.4 (no purchase, no link); an unverified test account sees the verify line and loses it after the code; deleting a throwaway account returns to sign-in and its password no longer works; each setting takes effect on the next Start (region) or at once (size, appearance, keep awake, bilingual)**
- [ ] **Step 5: Commit** — `feat(mobile): account, usage and settings screens (R12), verify, delete`

---

### Task 8: Sessions on the device, and export through the share sheet

**Files:**
- Create: `mobile/src/history/store.ts`, `mobile/src/history/store.test.ts`, `mobile/src/history/export.ts`, `mobile/src/history/export.test.ts`, `mobile/src/screens/History.tsx`

**Interfaces:**
- Produces:
  - `export interface StoredSession { id: string; title?: string; startedAt: number; endedAt: number | null; source: string; target: string; leg: Leg; lastStatus: string }`
  - `export function createHistoryStore(fs: { read(path: string): Promise<string | null>; write(path: string, body: string): Promise<void>; removeDir(path: string): Promise<void>; listDirs(path: string): Promise<string[]> })` with `save(session: StoredSession)`, `list(): Promise<Array<Pick<StoredSession, 'id' | 'title' | 'startedAt' | 'endedAt' | 'source' | 'target'>>>`, `load(id)`, `rename(id, title)`, `delete(id)` — one directory per session under expo-file-system's `Paths.document` (`sessions/<id>/session.json`), written at session end and every 60 s during a session, the 60 s measured by the session's ticker, never by a JS timer (so a killed app loses at most a minute, with the screen off too). The directory, not a bare file, because a later version adds the recording beside the JSON (owner, 2026-10-27); the first version stores no audio and keeps every session until the user deletes it (no cap: text only, tens of KB an hour).
  - `export function exportText(s: StoredSession, labels: TranscriptLabels, header: TranscriptHeaderLabels, meta: TranscriptMeta): string` and `exportJson(...)`: `renderTranscriptTxt(createProjector().project([s.leg], DEFAULT_PROJECTION), [s.leg], { labels, formatTime, header: { labels: header, meta, formatDateTime } })` and `JSON.stringify(renderTranscriptJson(entries, [s.leg], { meta }), null, 2)` for JSON (it returns an object and takes no labels; `entries` = the same projection).
  - `export async function shareExport(s: StoredSession, kind: 'txt' | 'json'): Promise<void>` — writes `Sokuji-<startedAt as yyyyMMdd-HHmm>.<txt|json>` to the cache directory and calls `Sharing.shareAsync(uri)`.
- `History.tsx`: the list, newest first, each row its title or, untitled, its date, plus languages and duration; per session Rename, Export (txt/json) and Delete.

- [ ] **Step 1: Write the failing tests** — the store round-trips a session through a fake fs and lists newest first; `rename` changes the title that `list` and `load` return; `exportText` of a one-exchange session contains the source and translation lines and the header title; a session whose `lastStatus` is `sign_in_required` still exports.
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
- Modify: `mobile/app.json` (production identifiers, icons, splash, `locales` for the microphone permission string, `android.permission`s unchanged), the local build steps the macOS machine uses (no EAS)
- Create: `mobile/assets/` (icon, adaptive icon, splash), `mobile/PrivacyInfo.xcprivacy` through `expo-build-properties` or the config plugin

- [ ] **Step 1: Set the identifier `ai.kizunaai.sokuji` on both platforms, the display name "Sokuji", version `1.0.0`, build numbers; register the explicit App ID `ai.kizunaai.sokuji` in the Apple developer portal (Identifiers → +; no capabilities needed in the first version) — App Store Connect's "new app" form lists only registered bundle IDs, and the wildcard profile used for development registers none**
- [ ] **Step 2: Icons and splash from the desktop's artwork (`assets/icon.*` in this repository)**
- [ ] **Step 3: Permission strings** — `NSMicrophoneUsageDescription` localized (`app.json` `locales`), the Android foreground-service notification title from `mobile.main.status.listening`
- [ ] **Step 4: Build release candidates for both platforms (iOS archive for TestFlight; Android `.aab`)**

Run: on the macOS machine, `xcodebuild -exportArchive` for iOS and `./gradlew bundleRelease` for Android (EAS is not used).
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

---

### Task 12: Hear the translation (R13; runs after Tasks 6 and 7)

**Files:**
- Create: `mobile/src/session/speech.ts`, `mobile/src/session/speech.test.ts`, `mobile/src/session/route.ts`, `mobile/src/session/route.test.ts`, `mobile/src/screens/Listen.tsx` (the setting's sub-screen), `mobile/src/screens/Devices.tsx` (R14: the microphone list and the output row), `mobile/modules/route-picker/` (a small Expo module: iOS `AVRoutePickerView` as a view, Android an intent for the system's media output switcher)
- Modify: `mobile/src/session/session.ts` (the `participantSpeech` lease flag, the `par_tts` stream, playback), `mobile/src/session/lease.ts` (the body flag), `mobile/src/store/settings.ts` (`listen: boolean; voice: string | null; speed: number`), `mobile/src/screens/Settings.tsx` (the row), `mobile/src/screens/Main.tsx` (the status line), `mobile/app.json` only if the iOS audio session options move there (iOS `UIBackgroundModes` already has `audio`; the Android foreground service type is already `mediaPlayback|microphone`)
- Shared from `src/`: `providers/soniox/ttsStream.ts` (Soniox speech over the same socket seam, `pcm_s16le` at the rate it is asked for) and `providers/soniox/speech.ts` (`LegSpeech`: which translation text is spoken, how clauses are cut and held) — both Metro-clean once their imports are audited the way Task 4 audits `utterances`.

**Interfaces:**
- Consumes: `startSession(o)` and `SessionEvent` (Task 1), `Settings` (Task 3), the transcript's translation entries (Task 4).
- Produces: `export function createSpeechPlayer(o: { context: AudioContext; sampleRate: number }): { play(pcm: Int16Array, pan?: 'both' | 'left' | 'right'): void; stop(): void; queuedSeconds(): number }` (pure scheduling over `react-native-audio-api`'s `AudioContext`: each PCM chunk becomes a two-channel `AudioBuffer` scheduled at the end of the queue, so chunks play gaplessly and a stop clears the queue; `pan` fills one channel and leaves the other silent — the first version always passes `'both'`, the later face-to-face scene (R14) is the only caller of `'left'`/`'right'`); `export function currentRoute(): 'headphones' | 'bluetooth' | 'speaker' | 'other'` and `export function onRouteChange(cb: (route: ReturnType<typeof currentRoute>) => void): () => void` over `AudioManager`'s device/route API; `export function microphoneChoices(info: AudioDevicesInfo): Array<{ id: string; kind: 'builtin' | 'wired' | 'usb'; name: string }>` (pure: the inputs minus any Bluetooth one, the built-in first) and the chosen id applied with `AudioManager.setInputDevice()` at Start (`Settings.inputDeviceId: string | null`, `null` = the phone's own); `startSession` takes `listen: { voice: string | null; speed: number } | null`, requests `participantSpeech: true` when set and the route is headphones at Start, feeds each final translation chunk to `LegSpeech` → `SonioxTtsStream` → the player, and emits `{ type: 'status', status: 'listening', detail: 'spoken' | 'subtitles_only' }` so the main screen can show which; on a route change to the loudspeaker mid-session the player stops and the detail becomes `subtitles_only` (the lease is not changed: the `par_tts` stream idles).
- Settings copy (the desktop's words): row `mobile.settings.devices` "Audio devices", `mobile.devices.microphone` "Microphone", `mobile.devices.builtIn` "Phone microphone", `mobile.devices.wired` "Wired headset microphone", `mobile.devices.usb` "USB microphone", `mobile.devices.noBluetoothMic` "Bluetooth headsets play the translation but are not used as the microphone.", `mobile.devices.output` "Playback device" (opens the system picker); row `mobile.settings.listen` "Hear the translation", sub-screen `mobile.listen.toggle` "Read the other side's words aloud to me", `mobile.listen.voice` "Voice I hear", `mobile.listen.speed` "Speech speed", `mobile.listen.headphones` "Spoken through headphones only. On the loudspeaker you get subtitles.", main screen `mobile.main.status.spoken` "Listening · spoken", `mobile.main.status.subtitlesOnly` "Listening · subtitles only (no headphones)".

- [ ] **Step 1: Write the failing tests** — `createSpeechPlayer`: three chunks of 1 600, 1 600 and 800 samples at 16 kHz schedule back to back (start times 0, 0.1, 0.2 s on a fake context) and `queuedSeconds()` is 0.25; `stop()` leaves nothing scheduled; `play(pcm, 'left')` writes the samples to channel 0 and silence to channel 1, `'both'` writes them to both. `currentRoute`: a fake device list with a wired headset → `'headphones'`, an A2DP device → `'bluetooth'`, none → `'speaker'`. `microphoneChoices`: a list with a wired, the built-in and a Bluetooth input → the built-in then the wired one, the Bluetooth one left out. `startSession` with `listen` set and the route `'bluetooth'` sends `participantSpeech: true` in the lease body and reports `spoken`; with the route `'speaker'` it sends no flag and reports `subtitles_only`; a route change to `'speaker'` mid-session stops the player and reports `subtitles_only`.
- [ ] **Step 2: Run them to verify they fail**
- [ ] **Step 3: Implement** — the TTS socket is opened lazily by the first translation text (the shared stream does this); the player's `AudioContext` is created at Start and closed at stop.
- [ ] **Step 4: Run the mobile tests; on both phones with Bluetooth earbuds: a 20-minute session with hearing on, locked; pull the earbuds out mid-session → subtitles only, put them back → spoken again; the spoken translation never shows up as a new transcript line** (the Gate A addendum in the spec)
- [ ] **Step 5: Commit** — `feat(mobile): hear the translation through headphones (R13)`

