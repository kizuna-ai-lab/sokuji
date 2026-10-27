# Sokuji mobile, phase 1: the Gate A prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A throwaway Expo app on both test phones that signs in by email one-time code, leases a managed Soniox key, streams the microphone and shows the tokens, so Gate A (spec §6) can be passed or failed on real devices before the MVP is planned.

**Architecture:** `mobile/` is an Expo development-client app with one screen. Metro resolves the desktop's DOM-free Soniox wire modules from `../src` (`SonioxSttStream`, `sonioxHosts`, the clock), so the prototype speaks the exact config frame and token format the desktop does. A session module owns the lease → socket → recorder chain and a reconnect loop that takes a fresh lease after a drop (spec R8), and an in-app Gate A log records every drop and gap. The app is throwaway: keeping any of it is a new request through the MVP plan.

**Tech Stack:** Expo SDK 58 (`expo-dev-client`, `expo-secure-store`, `expo-linking`, `expo-constants`, `expo-web-browser`, `expo-network`, `expo-clipboard`, `expo-build-properties`, `expo-keep-awake`), `better-auth` 1.6.33 + `@better-auth/expo` 1.6.33, `react-native-audio-api` 0.13.6, vitest for the two pure modules; shared from the desktop: `src/providers/soniox/sttStream.ts`, `src/providers/soniox/socket.ts`, `src/lib/soniox/regions.ts`, `src/lib/contract/clock.ts` (not `config.ts`: see Global Constraints).

**Spec:** `docs/superpowers/specs/2026-10-26-sokuji-mobile-design.md` (this branch). Rulings R7–R12 and §5.3, §5.5, §6 drive this plan.

**Prerequisite:** the backend plan "Mobile auth: Expo plugin and the `sokuji://` trusted origin" (kizuna-ai-lab/sokuji-backend, `docs/superpowers/plans/2026-10-26-mobile-auth-expo-origin.md`) is merged, deployed, and its probe returned `403 / 400 / 403`. Until then Task 3 fails with `403 Missing or null origin`.

**Where it runs:** Task 1 on any host (Linux included). Tasks 2–5 on the macOS build machine with both phones attached (spec R5). Branch `spike/mobile-prototype` off `main`; Task 1's commit is cherry-picked to `main` on its own if the spike is discarded.

## Global Constraints

- App name "Sokuji", URL scheme `sokuji` (R10). Prototype identifiers `ai.kizunaai.sokuji.prototype` on both platforms (the desktop's `ai.kizunaai.sokuji` must not be reused by a throwaway build; the MVP picks its own).
- Sign-in by email one-time code only (R11): `emailOtp.sendVerificationOtp({ email, type: 'sign-in' })`, then `signIn.emailOtp({ email, otp })`. No password screen, no third-party sign-in.
- Backend `https://sokuji.kizuna.ai`, production, a real account (R7).
- Managed Soniox only: `POST /api/soniox/session-key` with body `{ "mode": "participant", "textOnly": true, "bothSplit": false, "region": <'us'|'eu'|'jp'> }` and `Authorization: Bearer <session token>`; then `POST /api/soniox/session-started` `{ leaseId, role }`; on stop `POST /api/soniox/session-end` `{ leaseId }`.
- Audio: mono, 16 kHz, 16-bit PCM, 100 ms buffers → `onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 })`; the Soniox config's `sampleRate` is the rate the recorder actually delivers (`buffer.sampleRate`), never assumed.
- Soniox config: `model: 'stt-rt-v5'` (the desktop's `SONIOX_STT_MODEL`, hard-coded in the prototype: `src/providers/soniox/config.ts` is NOT DOM-free — it imports `reportWarning`, which reaches the log store, PostHog and `import.meta.env` — so the prototype must not import it; the MVP moves the constant to a dependency-free module re-exported by `config.ts`), `languageHints: [source]`, `translation: { type: 'one_way', target_language: target }`, `clientReferenceId` = the granted stream's.
- Reconnect = a fresh lease, no resume (R8). A `409` from `session-key` is retried every 3 000 ms; after 60 000 ms the loop keeps going but logs the count (the desktop's `DEFAULT_CONFLICT_RETRY_MS`, `CONFLICT_WAIT_LIMIT_MS`). Network errors (DNS, connect, timeout, 5xx) are retried at 2 s, 5 s, 10 s, then every 15 s while running; only `sign_in_required`, `microphone_denied` and `balance_exhausted` (a 402 from `session-key`) are terminal.
- A grant ends: `maxSessionDurationSeconds` is what the balance buys at the backend's conservative rate, capped at 5 h for transcription-only, so a long session is a **chain of leases**. The app rotates before each grant's end: at `expiresAt - 15 s` (checked inside the audio callback, not only by a timer — iOS throttles background timers) it calls `stream.end()` (the server flushes the final tokens and closes), then `sessionEnd(old)` → `leaseKey` → `connect` → `sessionStarted`, logging `rotation` lines. A Soniox `403 Temporary API key session duration limit exceeded` close takes the same path if the check missed. The desktop instead ends the session at the cap; mobile may not (spec §3.1 "keeps running").
- Minimum OS: Android `minSdkVersion` 29; iOS 16.4 (Expo SDK 58's floor; the spec's 16.0 is below it, so the SDK's rules).
- `mobile/**` is excluded from the root vitest suite; the prototype's own two unit tests run with `npm test` inside `mobile/`. Nothing else under `mobile/` is tested or reviewed for style.

## Review Focus

1. The OS suspends JavaScript while the phone is locked unless the audio session is live: every socket close is logged with the seconds since the last token, so Gate A.1 distinguishes "radio dropped" from "app suspended" — Task 4's `onClose` log line; Task 5 reads it.
2. The old lease is still held after a drop, so `session-key` answers `409` for up to a minute — Task 4's `leaseKey` test: `409, 409, 200` succeeds; past 60 s the loop continues and logs. A grant's end (what the balance buys, 26 min on a thin test account) must rotate into a new lease without the user noticing more than a reconnect gap — Task 4 step 5's rotation; Gate A's 60-minute run on an account with less than an hour of balance exercises it.
3. The recorder delivers a rate other than 16 000 (hardware) — Task 4 connects only after the first buffer and sends `buffer.sampleRate` as the config's `sampleRate`.
4. Float → 16-bit clipping and asymmetry — Task 4's `floatToInt16` test: `-1 → -32768`, `1 → 32767`, `0 → 0`, `1.5 → 32767`, `-1.5 → -32768`.
5. The session token is gone (signed out elsewhere, expired): `session-key` answers `401` — Task 4's `leaseKey` test throws `sign_in_required`, and the screen shows "Sign in again".

---

### Task 1: Guard the shared wire modules as DOM-free; fence `mobile/` off the root suite

**Files:**
- Create: `src/providers/soniox/domFree.test.ts`
- Modify: `vitest.config.ts:36` (the `exclude` array)

**Interfaces:**
- Consumes: `SonioxSttStream` (`src/providers/soniox/sttStream.ts`: `new SonioxSttStream(deps?: { clock?, openSocket? })`, `connect(config: SonioxSttConfig): Promise<void>`, `sendAudio(audio: Int16Array)`, `end()`, `close()`, `isOpen()`), `sonioxHosts(region)` (`src/lib/soniox/regions.ts`).
- Produces: a passing node-environment test that Tasks 2–4 may rely on; `**/mobile/**` ignored by the root suite.

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';

// The mobile app imports these modules through Metro. They must load and run
// where there is no window/document — the phone's JS runtime is not a browser.
describe('Soniox wire modules without a DOM', () => {
  it('runs in an environment with no window', () => {
    expect(typeof window).toBe('undefined');
  });

  it('imports and opens a stream through an injected socket', async () => {
    const { SonioxSttStream } = await import('./sttStream');
    const { sonioxHosts } = await import('../../lib/soniox/regions');
    const opened: Array<{ url: string; protocols: string[] }> = [];
    const fake = { readyState: 1, send() {}, close() {} } as unknown as WebSocket;
    const stream = new SonioxSttStream({
      openSocket: (url, protocols) => {
        opened.push({ url, protocols });
        queueMicrotask(() => fake.onopen?.(new Event('open')));
        return fake;
      },
    });
    await stream.connect({
      apiKey: 'snx_temp_test',
      region: 'us',
      model: 'stt-rt-v5',
      sampleRate: 16000,
      translation: { type: 'one_way', target_language: 'zh' },
    });
    expect(opened[0].url).toBe(`wss://${sonioxHosts('us').sttRt}/transcribe-websocket`);
    expect(opened[0].protocols).toEqual(['soniox-api-key', 'snx_temp_test']);
    stream.close();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/providers/soniox/domFree.test.ts`
Expected: PASS. If it fails with a `window`/`document` reference thrown at import time, the offending module is named in the stack: route that reference through an injected dependency (as `getApiUrl` already is in `lease.ts`) and re-run. If `src/setupTests.ts` itself fails under the node environment, add a second vitest project named `node` (`environment: 'node'`, no `setupFiles`, `include: ['src/**/*.node.test.ts']`) and rename the file to `domFree.node.test.ts`.

- [ ] **Step 3: Exclude `mobile/` from the root suite**

In `vitest.config.ts` change the exclude line to:
```ts
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/native/build/**', '**/mobile/**'],
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, same count as before plus 2.

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox/domFree.test.ts vitest.config.ts
git commit -m "test(soniox): guard the wire modules as DOM-free; fence mobile/ off the root suite"
```

---

### Task 2: Scaffold the Expo app and resolve the shared code (macOS)

**Files:**
- Create: `mobile/` (template), `mobile/app.json`, `mobile/metro.config.js`, `mobile/tsconfig.json`, `mobile/vitest.config.ts`, `mobile/package.json` scripts

**Interfaces:**
- Produces: `import { SonioxSttStream } from '@shared/providers/soniox/sttStream'` etc. resolving in Metro and in `tsc`; `npm test` inside `mobile/` runs vitest in the node environment; a dev client installed on both phones.

- [ ] **Step 1: Create the app and install the dependencies**

Run (repo root):
```bash
npx create-expo-app@latest mobile --template blank-typescript
cd mobile
npx expo install expo-dev-client expo-secure-store expo-linking expo-constants expo-web-browser expo-network expo-clipboard expo-build-properties expo-keep-awake react-native-audio-api
npm install better-auth@1.6.33 @better-auth/expo@1.6.33
npm install -D vitest
```
Expected: `mobile/package.json` lists Expo SDK 58 packages and `react-native-audio-api` 0.13.x.

- [ ] **Step 2: Configure `mobile/app.json`**

Set exactly these keys (keep the template's others):
```json
{
  "expo": {
    "name": "Sokuji",
    "slug": "sokuji",
    "scheme": "sokuji",
    "ios": {
      "bundleIdentifier": "ai.kizunaai.sokuji.prototype",
      "infoPlist": { "UIBackgroundModes": ["audio"] }
    },
    "android": { "package": "ai.kizunaai.sokuji.prototype" },
    "plugins": [
      "expo-secure-store",
      ["expo-build-properties", { "android": { "minSdkVersion": 29 } }],
      ["react-native-audio-api", {
        "iosBackgroundMode": true,
        "iosMicrophonePermission": "Sokuji listens to the room to show you subtitles.",
        "androidForegroundService": true,
        "androidFSTypes": ["mediaPlayback", "microphone"],
        "androidPermissions": [
          "android.permission.RECORD_AUDIO",
          "android.permission.POST_NOTIFICATIONS",
          "android.permission.FOREGROUND_SERVICE",
          "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
          "android.permission.FOREGROUND_SERVICE_MICROPHONE"
        ]
      }]
    ]
  }
}
```
The iOS deployment target stays at the SDK's floor (16.4 for SDK 58); do not set it lower.

- [ ] **Step 3: Write `mobile/metro.config.js` and the TypeScript path**

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
// The desktop's platform-neutral modules, imported as `@shared/...`.
config.watchFolders = [path.join(root, 'src')];
config.resolver.extraNodeModules = { '@shared': path.join(root, 'src') };
// This app's node_modules first; the desktop's only for what the shared
// modules import themselves (never react).
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')];
module.exports = config;
```
In `mobile/tsconfig.json` add `"baseUrl": "."` and `"paths": { "@shared/*": ["../src/*"] }` under `compilerOptions`.

`mobile/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(__dirname, '../src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```
Add `"test": "vitest run"` to `mobile/package.json` scripts.

- [ ] **Step 4: Prove the shared import resolves**

In `mobile/App.tsx` add `import { sonioxHosts } from '@shared/lib/soniox/regions';` and render `<Text>{sonioxHosts('us').sttRt}</Text>`.
Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Build the dev client onto both phones**

Run:
```bash
npx expo prebuild
npx expo run:ios --device
npx expo run:android --device
```
Expected: the app opens on both phones showing `stt-rt.soniox.com`.

- [ ] **Step 6: Commit**

```bash
git add mobile
git commit -m "chore(mobile): throwaway Expo prototype scaffold for Gate A"
```

---

### Task 3: Sign in by email one-time code

**Files:**
- Create: `mobile/src/auth.ts`, `mobile/src/SignIn.tsx`
- Modify: `mobile/App.tsx`

**Interfaces:**
- Produces (`mobile/src/auth.ts`):
  - `export const BACKEND_URL = 'https://sokuji.kizuna.ai'`
  - `export const authClient` — `createAuthClient({ baseURL: BACKEND_URL, plugins: [emailOTPClient(), expoClient({ scheme: 'sokuji', storagePrefix: 'sokuji', storage: SecureStore })] })` from `better-auth/react`, `better-auth/client/plugins`, `@better-auth/expo/client`, `expo-secure-store`
  - `export async function sendCode(email: string): Promise<void>` — `authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })`; throws `Error(result.error.message)` on error
  - `export async function signInWithCode(email: string, otp: string): Promise<void>` — `authClient.signIn.emailOtp({ email, otp })`; throws on error
  - `export async function signInWithPassword(email: string, password: string): Promise<void>` — `authClient.signIn.email({ email, password })`; throws on error. **Prototype only**: it spares the tester a code email per install; the backend already serves it for the desktop, and the MVP keeps one-time code only (R11).
  - `export async function sessionToken(): Promise<string | null>` — `(await authClient.getSession()).data?.session.token ?? null`
  - `export async function signOut(): Promise<void>`

- [ ] **Step 1: Write `auth.ts` to the interface above**

- [ ] **Step 2: Write `SignIn.tsx`**

One screen: an email field and "Send code"; after a successful send, a code field and "Sign in"; below a divider, a password field and "Sign in with password" (prototype only, see `auth.ts`); errors shown as text under the buttons. On success it calls `onSignedIn(email)`.

- [ ] **Step 3: Wire `App.tsx`**

On launch call `sessionToken()`: a token → the main screen (Task 4; until then, a `Text` with "signed in" and a Sign out button); none → `SignIn`.

- [ ] **Step 4: Verify on a phone against production**

Run: `npx expo run:ios --device` (then Android).
Expected: the code email arrives; sign-in succeeds; killing and relaunching the app keeps the session (SecureStore). A `403` with "Missing or null origin" means the backend prerequisite is not deployed yet.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/auth.ts mobile/src/SignIn.tsx mobile/App.tsx
git commit -m "feat(mobile): email one-time-code sign-in (prototype)"
```

---

### Task 4: Lease → microphone → Soniox → tokens, with reconnect and the Gate A log

**Files:**
- Create: `mobile/src/pcm.ts`, `mobile/src/pcm.test.ts`, `mobile/src/lease.ts`, `mobile/src/lease.test.ts`, `mobile/src/session.ts`, `mobile/src/Main.tsx`
- Modify: `mobile/App.tsx`

**Interfaces:**
- Consumes: `sessionToken()` (Task 3); `SonioxSttStream`, `SonioxSttConfig`, `SonioxToken` (`@shared/providers/soniox/sttStream`); `SonioxRegion` (`@shared/lib/soniox/regions`); `AudioRecorder`, `AudioManager`, `RecordingNotificationManager` (`react-native-audio-api`). The model name is the literal `'stt-rt-v5'` (Global Constraints).
- Produces:
  - `pcm.ts`: `export function floatToInt16(samples: Float32Array): Int16Array` — clamp to [-1, 1]; negative × 32768, non-negative × 32767 (the desktop's `float32ToInt16` in `src/lib/modern-audio/gtcrn/audio-utils.ts`, copied: that module drags an FFT import with it).
  - `lease.ts`:
    - `export interface Grant { leaseId: string; clientReferenceId: string; region: SonioxRegion; maxSessionDurationSeconds: number; streams: Array<{ role: string; apiKey: string; clientReferenceId: string }> }`
    - `export async function leaseKey(o: { token: string; region: SonioxRegion; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }): Promise<Grant>` — POST `${BACKEND_URL}/api/soniox/session-key` with the Global Constraints body; `200` → parsed `Grant` (throw `Error('bad_grant')` if `leaseId`, `clientReferenceId`, `region`, `maxSessionDurationSeconds` or a non-empty `streams` is missing); `409` → `sleep(3000)` and retry while `now() - start < 60000`, then throw `Error('lease_conflict')`; `401` → throw `Error('sign_in_required')`; anything else → throw `Error(\`session-key ${status}\`)`.
    - `export async function sessionStarted(o: { token: string; leaseId: string; role: string; fetch?: typeof fetch }): Promise<void>`
    - `export async function sessionEnd(o: { token: string; leaseId: string; fetch?: typeof fetch }): Promise<void>` — a failure is logged, not thrown.
  - `session.ts`:
    - `export type Status = 'leasing' | 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error'`
    - `export type SessionEvent = { type: 'status'; status: Status; detail?: string } | { type: 'tokens'; tokens: SonioxToken[] } | { type: 'log'; line: string }`
    - `export function startSession(o: { token: string; region: SonioxRegion; source: string; target: string; onEvent: (e: SessionEvent) => void }): { stop(): Promise<void> }`

- [ ] **Step 1: Write the failing tests**

`mobile/src/pcm.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { floatToInt16 } from './pcm';

describe('floatToInt16', () => {
  it('maps the full range and clamps', () => {
    const out = floatToInt16(new Float32Array([-1, 0, 1, 1.5, -1.5, 0.5]));
    expect(Array.from(out)).toEqual([-32768, 0, 32767, 32767, -32768, 16383]);
  });
});
```

`mobile/src/lease.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { leaseKey } from './lease';

const grant = {
  leaseId: 'lease-1', clientReferenceId: 'ref-1', region: 'us', maxSessionDurationSeconds: 7200,
  streams: [{ role: 'par_stt', apiKey: 'snx_temp_1', clientReferenceId: 'ref-1-par' }],
};
const respond = (statuses: number[]) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? JSON.stringify(grant) : '{}', { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };

describe('leaseKey', () => {
  it('posts the participant body with the bearer token and returns the grant', async () => {
    const { fetch, calls } = respond([200]);
    const g = await leaseKey({ token: 'tok', region: 'jp', fetch, ...clock() });
    expect(g.streams[0].apiKey).toBe('snx_temp_1');
    expect(calls[0].url).toBe('https://sokuji.kizuna.ai/api/soniox/session-key');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ mode: 'participant', textOnly: true, bothSplit: false, region: 'jp' });
  });

  it('retries a 409 every 3 s and succeeds when the old lease is released', async () => {
    const { fetch, calls } = respond([409, 409, 200]);
    const c = clock();
    await leaseKey({ token: 'tok', region: 'us', fetch, ...c });
    expect(calls.length).toBe(3);
    expect(c.now()).toBe(6000);
  });

  it('gives up on 409 after 60 s', async () => {
    const { fetch } = respond(new Array(30).fill(409));
    await expect(leaseKey({ token: 'tok', region: 'us', fetch, ...clock() })).rejects.toThrow('lease_conflict');
  });

  it('reports a lost session as sign_in_required', async () => {
    const { fetch } = respond([401]);
    await expect(leaseKey({ token: 'tok', region: 'us', fetch, ...clock() })).rejects.toThrow('sign_in_required');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd mobile && npm test`
Expected: FAIL — `Cannot find module './pcm'` / `'./lease'`.

- [ ] **Step 3: Implement `pcm.ts` and `lease.ts` to the interfaces above**

- [ ] **Step 4: Run the tests**

Run: `cd mobile && npm test`
Expected: 5 PASS.

- [ ] **Step 5: Implement `session.ts`**

`startSession`:
1. `AudioManager.setAudioSessionOptions({ iosCategory: 'record', iosMode: 'default', iosOptions: [] })` — no `allowBluetoothHFP`: the first version always records from the phone's own microphone, even with a headset connected (a headset mic is far from the speaker; a headset-input setting is a later item); `AudioManager.observeAudioInterruptions(true)`; `await AudioManager.requestRecordingPermissions()` — not `Granted` → `status: 'error', detail: 'microphone_denied'` and return a no-op `stop`.
2. `const recorder = new AudioRecorder()`; `recorder.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => …)`: on the first buffer remember `buffer.sampleRate` and start `connect()`; afterwards, if `stream?.isOpen()`, `stream.sendAudio(floatToInt16(buffer.getChannelData(0)))`. On Android, before starting: `await AudioManager.requestNotificationPermissions()` and `await RecordingNotificationManager.show({ title: 'Sokuji', contentText: 'Listening', showStopAction: true })` (`react-native-audio-api`'s `system/notification` export) — the library's foreground service carries the `microphone` type only while this notification is up (`CentralizedForegroundService.activeNotificationServiceTypes`), and Android 14 kills background capture without it. Then `await recorder.start()`.
3. `connect()`: `status: 'leasing'` → `grant = await leaseKey({ token, region })` (the `409` wait is inside); `status: 'connecting'` → `stream = new SonioxSttStream()`; `stream.setHandlers({ onMessage: m => m.tokens?.length && onEvent({ type: 'tokens', tokens: m.tokens }), onError: (code, message) => log(\`error ${code} ${message}\`), onClose: ({ code, reason }) => { log(\`close ${code} ${reason} — ${secondsSinceLastToken}s since last token\`); if (running) { droppedAt = Date.now(); status 'reconnecting'; connect(); } } })`; `await stream.connect({ apiKey: grant.streams[0].apiKey, region: grant.region, model: 'stt-rt-v5', sampleRate, languageHints: [source], translation: { type: 'one_way', target_language: target }, clientReferenceId: grant.streams[0].clientReferenceId })`; `await sessionStarted({ token, leaseId: grant.leaseId, role: grant.streams[0].role })`; if `droppedAt`, `log(\`reconnected after ${Date.now() - droppedAt} ms\`)`; `status: 'listening'`. Any throw → `status: 'error', detail: err.message` (a `sign_in_required` detail is what the screen turns into "Sign in again").
4. `stop()`: `running = false`; `stream?.end()`; `await recorder.stop()`; on Android `await RecordingNotificationManager.hide()`; `stream?.close()`; `await sessionEnd({ token, leaseId })`; `status: 'stopped'`.
5. Grant rotation and retries, per Global Constraints: remember `expiresAt = Date.now() + grant.maxSessionDurationSeconds * 1000` on every grant; in the `onAudioReady` callback, when `running && Date.now() >= expiresAt - 15_000 && !rotating`, set `rotating`, log `rotation: grant ends in 15 s`, call `stream.end()`, and let the resulting `onClose` run the normal reconnect (`sessionEnd` old → `leaseKey` → `connect` → `sessionStarted`), logging the gap as for a drop. A thrown network error anywhere in `connect()` schedules a retry (2 s, 5 s, 10 s, then 15 s) instead of `status: 'error'`; `leaseKey` `402` → `status: 'error', detail: 'balance_exhausted'`.
Every `onEvent({ type: 'log' })` line is prefixed with an ISO timestamp and also written with `console.log`.

- [ ] **Step 6: Implement `Main.tsx` and wire `App.tsx`**

`Main.tsx`: two text inputs `source` (default `en`) and `target` (default `zh`), a region picker (`us`/`eu`/`jp`, default `us`), Start/Stop; the status line; two scrolling blocks "Heard" and "Translation": final tokens appended as text, a token whose `text` is `<end>` or `<fin>` starts a new line, non-final tokens drawn in grey after the final text. **Bounded rendering** (a 60-minute run froze the Pixel's UI when every token re-rendered two hour-long strings): keep the full line arrays in refs, render only the last 50 lines of each block, and batch token updates into one `setState` per 250 ms. `expo-keep-awake` active while listening; the Gate A log is appended to a file (`expo-file-system`, `gate-a.log` in the document directory) as well as shown (last 20 lines) with a "Copy log" button (`expo-clipboard`); the file is read from the Mac afterwards (`adb pull` on Android; the iOS Files app via `UIFileSharingEnabled`). A "Sign out" button. `App.tsx` shows `Main` when `sessionToken()` is non-null.

- [ ] **Step 7: Verify on both phones**

Run: `npx expo run:ios --device`, `npx expo run:android --device`.
Expected: Start → status `listening` within ~5 s; speaking produces "Heard" text and a translation; Stop → `stopped`; the backend's session list shows the session. Lock the phone for two minutes: tokens keep arriving (the Gate proper is Task 5).

- [ ] **Step 8: Commit**

```bash
git add mobile/src mobile/App.tsx
git commit -m "feat(mobile): managed Soniox session with reconnect and Gate A log (prototype)"
```

---

### Task 5: Run Gate A and record it

**Files:**
- Create: `mobile/GATE-A.md`

- [ ] **Step 1: Write the record template**

`mobile/GATE-A.md` with one table per phone (iPhone / Android), rows: `60 min locked (Wi-Fi)` (decides), `airplane 30 s` (decides), `another app in front, 5 min` (decides), `incoming call` (optional: does capture resume after hang-up), `BT headset in/out` (optional: does the callback survive the route change; input stays the phone mic), columns: `date`, `drops (count)`, `longest gap (s)`, `memory at 0 / 30 / 60 min (MB, `adb shell dumpsys meminfo <package>` TOTAL on Android; Xcode's memory gauge or `footprint` on iOS)`, `pass?`, `log file name`. A run whose memory climbs steadily or whose UI stops taking input is not a pass even if capture never stopped (the first Pixel run: 775 MB and a frozen UI after 66 minutes of unbroken capture). Battery/heat and the 120-minute cellular run move to Gate B (the owner's own 90-minute session).

- [ ] **Step 2: Run the gate on both phones (spec §6, Gate A)**

For each phone: start a session, lock the phone, play speech (a podcast on another device) for 60 min; then, unlocked, airplane mode for 30 s and back; then switch to another app (Notes) for 5 min with the screen on. Optional, one minute each: an incoming call (hang up, check capture resumes); a Bluetooth headset connected and disconnected (check the callback keeps running and the input stays the phone mic). After each run, "Copy log" and paste it into `GATE-A.md`.
Pass: 60 min locked and 5 min behind another app without a gap longer than one reconnect; the airplane-mode drop recovers with a fresh lease and the lines already shown are kept.

- [ ] **Step 3: Decide and report**

Post the two tables' pass/fail and the longest reconnect gap in #sokuji:4348e24c. iOS fails after `UIBackgroundModes: audio` and the `record` session are confirmed in the built `Info.plist` → the Swift fallback (spec §4, row 2) and this plan is rewritten; both pass → the MVP plan (phase 2) is written against the measured reconnect gap.

- [ ] **Step 4: Commit the record**

```bash
git add mobile/GATE-A.md
git commit -m "docs(mobile): Gate A results"
```
