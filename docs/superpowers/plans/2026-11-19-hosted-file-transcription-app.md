# Hosted File Transcription (Desktop App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Import a file" and "Transcribe again" in History work when the line-up's transcription service is Kizuna AI's Soniox (`kizunaai_soniox`), paid from the user's balance, exactly as they work today with the user's own Soniox key.

**Architecture:** The Electron main process keeps making the network calls, since it owns the recording's file. `createFileRecognizer` gains a second path for `service: 'kizunaai_soniox'` that talks to the Kizuna AI service instead of Soniox, with the sign-in token and the API URL the page passes for that one job; it reports the same phases and returns the same tokens. The page decides before starting whether the job can run (signed in, balance, length) and shows an estimated price.

**Tech Stack:** Electron (CommonJS main process), React + TypeScript renderer, zustand stores, i18next (30 locale catalogs), vitest (jsdom; `// @vitest-environment node` for main-process tests), Playwright e2e.

**Spec:** this plan carries its own requirements: the service contract below and the owner's decisions listed under Global Constraints. There is no separate spec file in this repository.

## Amended while building

The code does these things differently from the tasks below, which are left as they were written.

- When an organization pays, the page does not refuse a hosted job for its balance: the service decides. A frozen organization wallet is still refused.
- Money is compared in whole micro-USD, the estimate rounded up, as the service counts it.
- An import paid from a personal wallet that holds nothing is refused before it starts.
- A hosted job whose translation target is the recording's only spoken language asks for no translation and is priced at the untranslated rate (owner, 2026-11-19). The user's own key is still asked exactly what was chosen.
- A 403 the service does not explain as `wallet_frozen` (or `not_org_member`) is a service failure, not a frozen wallet.
- The sign-in token is sent only over https; plain http is accepted only for `localhost`, `127.0.0.1` and `[::1]`, for development.
- Polling a hosted job stops after 60 minutes without an outcome, as a service failure (the job is still ended), and it carries on through up to three failed polls in a row.
- Review Focus 2 is narrowed: when the app quits in the middle of a hosted job, the End call is not sent. The service ends a job it has not heard from for 90 seconds and deletes what it holds. A page reload or a cancel still ends the job from the main process.

## The service contract

Base: `<apiUrl>/soniox/file-jobs`, where `apiUrl` is what `getApiUrl()` returns in the page. Every call carries `Authorization: Bearer <sign-in token>`.

| Call | Request | Answer |
|---|---|---|
| Start (upload) | `POST <base>?region=<us\|eu\|jp\|in>&audio_ms=<int>&translated=<0\|1>[&later_audio_ms=<int>][&payer=<organization\|personal>]`, body = the track's bytes, `Content-Type: audio/ogg`, `Content-Length` | 201 `{ id, estimateMicroUsd, region }` |
| Transcribe | `POST <base>/<id>/transcription`, JSON `{ language_hints: string[], translation?: { type: "one_way", target_language: string }, context?: { terms?, translation_terms?, text? } }` (at most 512 KiB) | 201 `{ id, status: "queued" }` |
| State | `GET <base>/<id>` | 200 `{ id, status: "queued" \| "processing" \| "completed" \| "error", audio_duration_ms?, error_type? }` |
| Transcript | `GET <base>/<id>/transcript` | 200 `{ id, text, tokens }` (Soniox's token shape) |
| End | `DELETE <base>/<id>` | 204. Called in every outcome. |

`audio_ms` is the track's length; `later_audio_ms` the summed length of the record's tracks still to come after this one; `translated=1` exactly when a translation will be asked for. The upload is refused unless `Content-Length <= audio_ms * maxBytesPerMs + bytesSlack`.

Refusals are JSON `{ error, code, … }`:

| Status | `code` | Meaning |
|---|---|---|
| 404 | (none) | the feature is not open for this account (or an older service) |
| 401 | `sign_in_required` | |
| 400 | `invalid_request` | |
| 413 | `too_long` (+ `maxAudioMs`, `maxBytes`), `request_too_large` | |
| 402 | `insufficient_balance` (for an organization also `reason: "org_balance_held"`) | |
| 403 | `wallet_frozen` (+ `subject: "organization"` for one), `not_org_member` | |
| 409 | `file_job_running` (another job of the account runs), `wrong_state` | |
| 422 | `bad_audio` | |
| 503 | `region_unavailable`, `wallet_unavailable`, `service_unavailable` | |

`GET <apiUrl>/pricing` carries `fileTranscription: { usdPerHour, translatedUsdPerHour, maxAudioMs, maxBytes, maxBytesPerMs, bytesSlack }` (today `0.2`, `0.32`, `14400000`, `100663296`, `8`, `65536`). Absent on an older service.

## Global Constraints

- Desktop (Electron) only. The extension and the web build are untouched.
- The user's-own-key path (`service: 'soniox'`) behaves exactly as today, including its five-hour limit and its texts, except where a text is rewritten below.
- Over the hosted length limit the app says to contact us (`support@kizuna.ai`); it never suggests the user's own Soniox key (owner, 2026-11-18).
- The estimate is `length × rate` with the published rates, not padded (owner, 2026-11-18). With the user's own key no price is shown (owner, 2026-11-16).
- A job cancelled once Soniox is transcribing it is still charged (owner, 2026-11-18): the app says so beside Cancel in that phase, for a hosted job only.
- The region sent is the one saved in the Kizuna AI Soniox settings (`asSonioxRegion(settings.region)` of the `kizunaSoniox` slice), the same one live sessions use (owner, 2026-11-18).
- The payer sent is `accountPayer(useAccountStore.getState().account)`, as hosted notes send it.
- The app is safe against a service that does not have the feature: no `fileTranscription` in `/pricing`, or a 404, reads as "not available yet", never a broken Start.
- The sign-in token is used for the calls of one job only. No message, error, log line or thrown text repeats it. The main process sends it only to an `http:` or `https:` URL.
- Kept tracks are Ogg/Opus at 48 kbit/s (`OPUS_CONFIG` in `src/lib/history/recording/opusEncoder.ts`); do not change the bitrate (the upload-size rule assumes at most 64 kbit/s).
- Every new or changed text exists in all 30 locale catalogs, really translated (`locales.coverage.test.ts` and `newScreens.translated.test.ts` reject English left in place). Product names stay as they are: Kizuna AI, Soniox, Sokuji.
- No user data, internal identifiers, machine or people's names in code, tests, comments or commit messages. Comments say what the code does and why, in plain English.
- Gate before every commit: `npx vitest run <the test files touched>`. Before the PR: `npx vitest run` (the whole suite).

## Review Focus

1. **Signed out, or signed in on another account, between opening the panel and pressing Start.** Expected: the job ends with the sign-in text and a link to the account row; nothing is uploaded. Test in Task 1 (401 at upload) and Task 3.
2. **The app quits or the page reloads while a hosted job runs.** Expected: the main process still sends the End call for a job it started (as its Soniox clean-up runs today after a cancel); nothing is left for the user to do. Test in Task 1.
3. **A two-track record whose first track succeeds and whose second is refused for balance.** Expected: no transcript is created (as today when a later track fails), the failure says the balance ran out, and the record is unchanged. Test in Task 2.
4. **`/pricing` cannot be read (offline) when the panel opens.** Expected: the panel says the service could not be checked and Start is disabled; it does not start a job without knowing the limits. Test in Task 3.
5. **A recording exactly at a limit, and one millisecond or one byte over.** Expected: at the limit it starts; over it, the "contact us" text and no upload. Test in Task 3.

---

### Task 1: The main process talks to the Kizuna AI service

**Files:**
- Modify: `electron/file-recognition.js`, `electron/file-recognition.test.js`, `electron/history-ipc.js`
- Test: `electron/file-recognition.test.js`

**Interfaces:**
- Produces: `recognize(request)` accepts, beside today's `service: 'soniox'` shape, this one:
```js
{ store, recordId, source, jobId,
  service: 'kizunaai_soniox',
  apiUrl,        // string, http(s) URL without a trailing slash
  token,         // string, the sign-in token
  region,        // 'us' | 'eu' | 'jp' | 'in'
  payer,         // 'organization' | 'personal' | undefined
  laterAudioMs,  // integer >= 0, default 0
  languageHints, translateTo, context }   // as today
```
It returns `{ tokens, audioMs }` as today and reports the same phases through `status(jobId)`: `uploading`, `queued`, `processing`, `fetching`.
- The track's own length and size are read in the main process from the store (`store.getRecord(recordId).tracks`: `durationMs`, `bytes`), never taken from the page.
- New `HistoryError` codes thrown by this path (the page maps them to texts in Task 4):

| Service answer | Code |
|---|---|
| 401 | `SIGN_IN` |
| 402 with `reason: "org_balance_held"` | `ORG_BALANCE_HELD` |
| 402, payer `organization` | `ORG_NO_BALANCE` |
| 402 otherwise | `NO_BALANCE` |
| 403 `not_org_member` | `NOT_ORG_MEMBER` |
| 403 with `subject: "organization"` | `ORG_WALLET_FROZEN` |
| 403 otherwise | `WALLET_FROZEN` |
| 404 on the start call | `HOSTED_UNAVAILABLE` |
| 409 `file_job_running` | `JOB_RUNNING` |
| 413 `too_long` | `HOSTED_TOO_LONG` |
| 422 `bad_audio`; state `error` whose `error_type` matches `/audio\|decod\|format\|file/i` | `BAD_AUDIO` |
| 503, any other refusal, state `error` otherwise | `SERVICE` |
| fetch throws | `NETWORK` |
| aborted | `CANCELLED` |

- `electron/history-ipc.js` passes `apiUrl`, `token`, `payer`, `laterAudioMs` from the payload to `recognize` (beside the fields it passes today).

Behaviour:
1. Validate: `apiUrl` parses as `http:` or `https:`; `token` is a non-empty string; region as today; `laterAudioMs` a non-negative integer. Otherwise `BAD_INPUT`.
2. Start: `POST <apiUrl>/soniox/file-jobs?...` with the track's Blob (`fs.openAsBlob(file, { type: 'audio/ogg' })`) as the body; `audio_ms` = the track's `durationMs`, `translated` = `translateTo !== undefined ? 1 : 0`. Phase `uploading`.
3. Transcribe: `POST …/<id>/transcription` with `language_hints`, `translation` when `translateTo` is given, `context` when given. Phase `queued`.
4. Poll `GET …/<id>` every `POLL_MS` (the existing constant and injected `wait`): `processing` → phase `processing`; `completed` → fetch; `error` → throw by its `error_type`.
5. `GET …/<id>/transcript` → `{ tokens: transcript.tokens ?? [], audioMs: Number(state.audio_duration_ms) || 0 }`. Phase `fetching`.
6. In `finally`, once the start call returned an id: `DELETE …/<id>`, not cancellable, timed out after `cleanupTimeoutMs`, retried up to 3 times on a network failure or a 5xx with the existing `later` pause; a failure is logged with `logger.warn` (job id only). As today, a cancel answers at once and the clean-up goes on by itself; `settled()` awaits it.
7. The token is scrubbed from every error text with the existing `spoken()` helper; the service's own `error` text is not repeated in the thrown message (the code carries the meaning).

- [ ] **Step 1: Write the failing tests** in `electron/file-recognition.test.js`, in a new `describe('through the Kizuna AI service')`, with a `fakeService(o)` in the style of the file's `fakeSoniox` (records `{ method, path, query, auth, contentType, bodyBytes | json }`, scripted `statuses`, `refusals` by `"METHOD path"`, `hangs`). One `it` each:
  - the happy path: the exact call order (`POST /soniox/file-jobs`, `POST …/job-1/transcription`, three `GET …/job-1`, `GET …/job-1/transcript`, `DELETE …/job-1`); the query (`region=jp&audio_ms=1000&translated=0`, no `later_audio_ms` when 0, `payer=organization` when given); `Bearer` on every call; the uploaded bytes equal the track's; `Content-Type: audio/ogg`; the transcription body; `waits` = `[5000, 5000, 5000]`; the result's tokens and `audioMs`.
  - `translated=1` and the `translation` body when `translateTo` is given; `later_audio_ms` when positive.
  - `audio_ms` comes from the store's track row, not from the request (pass a contradicting `audioMs` in the request and assert it is ignored).
  - each row of the code table above → its code; after a refusal past the start call, `DELETE` was sent; the thrown message never contains the token (include the token in a fake refusal body).
  - (Review Focus 1) 401 at the start call → `SIGN_IN`, and no further call.
  - cancel during each phase → `CANCELLED`, and `DELETE` is still sent once the job has an id (await `settled()`).
  - (Review Focus 2) the `DELETE` runs although the recognizer's caller never awaits the result (reject the pending call, then `await recognizer.settled()`; assert the `DELETE`).
  - the `DELETE` is retried on a 503 and on a thrown fetch, at most 3 times, then given up with one warning that names the job id and not the token.
  - `BAD_INPUT` for a missing token, an `ftp:` `apiUrl`, a negative `laterAudioMs`.
  - the `soniox` path is unchanged: the file's existing tests pass untouched.
- [ ] **Step 2:** `npx vitest run electron/file-recognition.test.js` → the new tests FAIL.
- [ ] **Step 3: Implement.** Keep the two paths as two inner functions sharing `jobs`, `cleanups`, `waitFor`, `spoken`, the phase reporting and the cancel wiring; do not thread `if (hosted)` through the Soniox path. Add the four fields to the `history:recognize` handler in `electron/history-ipc.js`.
- [ ] **Step 4:** `npx vitest run electron/file-recognition.test.js electron/ipc-channels.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(history): file recognition through the Kizuna AI service (main process)`.

---

### Task 2: The page asks for a hosted job

**Files:**
- Modify: `src/lib/provider/types.ts` (`FileRecognitionSpec`), `src/lib/provider/managed.ts`, `src/providers/soniox/kizuna.ts`, `src/providers/soniox/provider.ts` (export what the twin reuses), `src/lib/history/types.ts` (`HistoryRecognizeRequest`), `src/lib/history/file/service.ts`, `src/lib/history/file/transcribe.ts`
- Test: `src/lib/provider/managed.test.ts`, `src/providers/soniox/kizuna.test.ts`, `src/providers/soniox/fileRecognition.test.ts`, `src/lib/history/file/service.test.ts`, `src/lib/history/file/transcribe.test.ts`

**Interfaces:**
- Produces:
```ts
// src/lib/provider/types.ts
interface FileRecognitionBase { region?: string; languageHint?: (code: string) => string | null; languages: readonly string[]; context?: object }
export type FileRecognitionSpec =
  | (FileRecognitionBase & { service: string; apiKey: string })                 // the user's own key (today's shape)
  | (FileRecognitionBase & { service: 'kizunaai_soniox'; hosted: true; region: string });
// Provider.fileRecognition stays `(settings, credentials, words?) => FileRecognitionSpec | { missing: 'no-key' }`
```
```ts
// src/lib/history/types.ts — HistoryRecognizeRequest gains, all optional:
apiUrl?: string; token?: string; payer?: 'organization' | 'personal'; laterAudioMs?: number;
// and `apiKey` becomes optional.
```
```ts
// src/lib/history/file/service.ts
export interface FileRecognitionMissing { missing: 'no-file-service' | 'no-key' | 'sign-in' }   // 'hosted-soniox' is gone
export interface HostedAccess { apiUrl: string; token(): Promise<string | null>; payer?: 'organization' | 'personal' }
export type FileRecognitionService = FileRecognitionSpec & { access?: HostedAccess };   // `access` present exactly when `hosted`
```
- `managed()` gains an optional override `fileRecognition` in `ManagedOverrides` and copies it to the twin only when given (the base's is never inherited: it needs a key the twin does not have). `createKizunaSonioxProvider` gives one that returns `{ service: 'kizunaai_soniox', hosted: true, region: asSonioxRegion(settings.region), languageHint, languages, context? }`, built from the same `languageHint`, `SONIOX_LANGUAGES` and `sonioxContext(words)` the own-key provider uses (export a small shared helper from `provider.ts`; do not copy the body).
- `fileRecognitionFromStores()`: for a hosted spec, `{ missing: 'sign-in' }` when `currentAuth()?.signedIn !== true`; otherwise the spec plus `access: { apiUrl: getApiUrl(), token: async () => (await currentAuth()?.getToken()) ?? null, payer: accountPayer(useAccountStore.getState().account) }`. The `id === 'kizunaai_soniox'` short-circuit is removed.
- `transcribeRecord`: for a hosted service, each track's `port.recognize` call carries `service`, `region`, `apiUrl`, `token` (read with `access.token()` just before each track; null → throw an error with code `SIGN_IN`), `payer`, and `laterAudioMs` = the sum of `durationMs` of the tracks after this one in the loop's order; no `apiKey`. For an own-key service the call is byte-for-byte what it is today.

- [ ] **Step 1: Write the failing tests.**
  - `managed.test.ts`: a twin has no `fileRecognition` unless the override gives one (the existing "takes no … member of the base it does not name" tests stay as they are).
  - `kizuna.test.ts`: `kizunaSonioxProvider.fileRecognition(settings{region:'jp'}, credentials, words)` → `service: 'kizunaai_soniox'`, `hosted: true`, `region: 'jp'`, the same `languages` as the own-key provider's, a `context` when the word list has entries, and no `apiKey` property. Update the member-list assertion at the place the map names (`kizuna.test.ts`, the list of members) to include `fileRecognition`.
  - `service.test.ts`: `kizunaai_soniox` signed out → `{ missing: 'sign-in' }`; signed in → a hosted service whose `access.apiUrl` is `getApiUrl()` and whose `access.payer` follows the account; the old `'hosted-soniox'` expectation is replaced.
  - `transcribe.test.ts`: a hosted service on a two-track record sends, for the first track, `laterAudioMs` = the second track's `durationMs` and, for the second, `0`; each call has `token`, `apiUrl`, `region`, `payer` and no `apiKey`; a null token → rejects with code `SIGN_IN` and `port.recognize` is not called; (Review Focus 3) the second track rejecting with code `NO_BALANCE` → rejects with that code and `port.createTranscript` is never called; the transcript's `origin.service` is `'kizunaai_soniox'`; the own-key call is unchanged (the existing tests pass untouched).
- [ ] **Step 2:** run the five test files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** run the five test files plus `src/lib/history/file/importFile.test.ts src/lib/history/historyPageStore.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(history): the page asks the Kizuna AI service for a file job`.

---

### Task 3: Limits, the estimate, and what blocks a start

**Files:**
- Create: `src/lib/history/file/hostedFile.ts`, `src/lib/history/file/hostedFile.test.ts`
- Modify: `src/lib/history/historyPageStore.ts` (`FileJobBlock`, `fileJobBlocked`, a new `fileEstimate`), `src/lib/history/file/importFile.ts`, `src/lib/history/file/appFiles.ts`
- Test: `src/lib/history/historyPageStore.test.ts`, `src/lib/history/file/importFile.test.ts`

**Interfaces:**
- Produces:
```ts
// src/lib/history/file/hostedFile.ts
export interface HostedFileTerms { usdPerHour: number; translatedUsdPerHour: number; maxAudioMs: number; maxBytes: number; maxBytesPerMs: number; bytesSlack: number }
/** The terms from `<apiUrl>/pricing`; null when the service has none; throws when it cannot be read. Cached like fetchNotesPricing. */
export function fetchHostedFileTerms(fetchImpl?: typeof fetch): Promise<HostedFileTerms | null>;
export interface TrackSize { durationMs: number; bytes: number }
/** Whether every track fits the hosted limits (length, size, and bytes for its length). */
export function fitsHosted(tracks: readonly TrackSize[], terms: HostedFileTerms): boolean;
/** The estimated price in USD of transcribing the tracks. */
export function hostedEstimateUsd(tracks: readonly TrackSize[], translated: boolean, terms: HostedFileTerms): number;
```
`fitsHosted` is false when any track has `durationMs > maxAudioMs`, `bytes > maxBytes`, or `bytes > durationMs * maxBytesPerMs + bytesSlack`. `hostedEstimateUsd` = Σ `durationMs / 3_600_000 × rate`.
- `FileJobBlock` gains `'sign-in' | 'no-balance' | 'wallet-frozen' | 'hosted-too-long' | 'hosted-unavailable'` and loses `'hosted-soniox'`.
- `fileJobBlocked(kind)` for a hosted service, after today's checks and in this order: terms cannot be read → `'unchecked'`; terms null → `'hosted-unavailable'`; account known and `frozen` → `'wallet-frozen'`; (for `kind === 'transcribe'` only, where the tracks are known) not `fitsHosted(open record's kept tracks)` → `'hosted-too-long'`; account known and the payer's balance in USD below `hostedEstimateUsd(tracks, false, terms)` → `'no-balance'`. An unknown or loading account does not block (the service decides). The payer's balance is the organization's when `accountPayer` says `organization`, else the user's (read the same fields the main panel's balance gate reads: see `balanceRefusal` in `src/lib/session/shape.ts`).
- `fileEstimate(kind, options): Promise<number | null>` on the store: for a hosted service and a known set of tracks, `hostedEstimateUsd(tracks, options.translateTo is set, terms)`; null for an own-key service, for an import (its length is not known before it is read), or when the terms cannot be had.
- `importFile` takes an optional `hostedTerms?: HostedFileTerms`: when given and the file's `durationMs > hostedTerms.maxAudioMs`, it throws `ImportError('HOSTED_TOO_LONG')` at the place it throws `TOO_LONG` today, before decoding. `appFiles.ts` passes the terms for a hosted service (fetched once per import; a failure to fetch them → the import fails with code `HOSTED_UNAVAILABLE`).

- [ ] **Step 1: Write the failing tests.**
  - `hostedFile.test.ts`: (Review Focus 5) with the terms above, a track of exactly 14 400 000 ms and 86 400 000 bytes fits; 14 400 001 ms does not; 100 663 297 bytes does not; a 1 000 ms track of `1000 × 8 + 65 536` bytes fits and one byte more does not; the estimate of 3 600 000 ms is `0.2`, translated `0.32`, two tracks add up; `fetchHostedFileTerms` returns the block from `/pricing`, null when the response has no `fileTranscription`, rejects on a network error or a non-200, and asks once for two calls.
  - `historyPageStore.test.ts`: one test per new block in the order above, each built from the store's existing test harness with a hosted service; (Review Focus 4) terms unreadable → `'unchecked'`; an unknown account does not block; an own-key service never asks for the terms; `fileEstimate('transcribe', …)` = the expected number for a two-track record, changes with `translateTo`, and is null for an own-key service and for an import.
  - `importFile.test.ts`: with hosted terms, a file of `maxAudioMs + 1` → `HOSTED_TOO_LONG` before `decode` is called and no record is left; without terms, the five-hour limit is unchanged.
- [ ] **Step 2:** run the three test files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** run the three test files → PASS.
- [ ] **Step 5: Commit** `feat(history): hosted file jobs know their limits and their price before they start`.

---

### Task 4: What the user reads

**Files:**
- Modify: `src/components/History/FileJobs.tsx`, `src/components/History/FileJobs.test.tsx`, `src/components/History/FileJobs.settingsLinks.test.tsx`, `src/lib/history/historyPageStore.ts` (refresh the balance after a hosted job), `src/locales/en/translation.json`
- Test: the two test files above

**Interfaces:**
- Consumes: the block codes of Task 3, the failure codes of Task 1, `fileEstimate`, `usd` from `src/lib/notes/notesPricing.ts`, `noticeText` and `orgNoticeParams` for the organization's reasons (`src/lib/view/noticeText.ts`, `src/lib/session/orgNotice.ts`), `openExternalUrl`.
- Produces — English texts (keys under `history.file`):

| Key | Text | Shown |
|---|---|---|
| `serviceHosted` | "Transcribed by Soniox through Kizuna AI, paid from your balance." | the service line of both panels, for a hosted service |
| `estimate` | "About {{price}}." | after the service line, when `fileEstimate` gives a number (updates when the options change) |
| `blockedSignIn` | "Sign in to Kizuna AI to transcribe files with it." | block `sign-in`; failure `SIGN_IN` |
| `blockedNoBalance` | "Your Kizuna AI balance does not cover this transcription." | block `no-balance`; failure `NO_BALANCE` |
| `blockedFrozen` | "Your Kizuna AI wallet is frozen." | block `wallet-frozen`; failure `WALLET_FROZEN` |
| `blockedHostedTooLong` | "This recording is longer than Kizuna AI transcribes at once ({{hours}} hours). Contact us and we will help:" | block `hosted-too-long`; failures `HOSTED_TOO_LONG`; followed by a button that opens `mailto:support@kizuna.ai` and reads `support@kizuna.ai` |
| `blockedHostedUnavailable` | "Transcribing files with Kizuna AI is not available yet." | block `hosted-unavailable`; failure `HOSTED_UNAVAILABLE` |
| `failure.JOB_RUNNING` | "Another file is being transcribed on this account. Try again when it has finished." | failure `JOB_RUNNING` |
| `cancelCharged` | "Soniox is already transcribing: cancelling now is still charged." | beside Cancel, in phase `processing`, for a hosted job |
| `blockedNotSoniox` (rewritten) | "Files are transcribed only by Soniox. Choose it for transcription in the line-up." | as today |

`{{hours}}` is `maxAudioMs / 3 600 000` (4 today). `blockedHostedSoniox` is removed from every catalog. `history.file.service` ("Transcribed by Soniox, with your own key.") stays for an own-key service.
- Organization failures reuse the existing translated notices: failure `ORG_BALANCE_HELD` → `noticeText(t, { code: 'org_balance_held', … })`, `ORG_NO_BALANCE` → `org_insufficient_balance`, `ORG_WALLET_FROZEN` → `org_wallet_frozen`, `NOT_ORG_MEMBER` → `not_org_member`, each with `orgNoticeParams(account)`.
- Fixes (the link after a block or a failure): `sign-in`, `no-balance`, `wallet-frozen` and the four organization failures → "Open Accounts and keys" to the `'user-account'` target, as `RecordNotes.tsx` does for notes; `hosted-too-long` → the mail button; `hosted-unavailable` → none.
- `FileJob` gains `hosted: boolean` (set when the job starts) so `FileJobLine` knows when to show `cancelCharged`.
- After a hosted job ends, in any outcome, the store calls `useAccountStore.getState().refreshAccount()` once.

- [ ] **Step 1: Write the failing tests** (`FileJobs.test.tsx`, in the file's existing harness; assert the English texts verbatim):
  - a hosted service: both panels show `serviceHosted`, not the own-key line; the estimate shows "About $0.20." for a one-hour record and "About $0.32." once a translation is chosen; no estimate in the import panel; an own-key service shows no estimate.
  - one test per block: its text, Start disabled, and its fix (the Accounts link navigates to `'user-account'` and closes the panel; the mail button calls `openExternalUrl('mailto:support@kizuna.ai')`; `hosted-unavailable` has no link). The `hosted-too-long` text reads "(4 hours)".
  - one test per new failure code in `FileJobLine`, including the four organization ones (assert the existing notice texts) and `JOB_RUNNING`.
  - `cancelCharged` is shown only for a hosted job in phase `processing`: not while `uploading` or `queued`, and never for an own-key job.
  - the balance is refreshed once after a hosted job that succeeded, one that failed and one that was cancelled; never after an own-key job.
  - `FileJobs.settingsLinks.test.tsx`: the `"hosted-soniox"` case is replaced by `"sign-in"` (link to `'user-account'`); `"no-file-service"` asserts the rewritten text.
- [ ] **Step 2:** run the two test files → FAIL.
- [ ] **Step 3: Implement.** Add the keys to `src/locales/en/translation.json` only in this task (the other catalogs are Task 5; `locales.consistency.test.ts` will fail until then, so run only the two component test files here).
- [ ] **Step 4:** `npx vitest run src/components/History/FileJobs.test.tsx src/components/History/FileJobs.settingsLinks.test.tsx src/lib/history/historyPageStore.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(history): the file panels speak for Kizuna AI's Soniox too`.

---

### Task 5: The texts in every language

**Files:**
- Modify: the 29 catalogs `src/locales/<locale>/translation.json` other than `en`

- [ ] **Step 1:** `node scripts/sync-locale-keys.mjs` (adds the new keys with the English text, drops `blockedHostedSoniox`).
- [ ] **Step 2: Translate** the nine new keys and the rewritten `blockedNotSoniox` in each of the 29 catalogs: ar, bn, de, es, fa, fi, fil, fr, he, hi, id, it, ja, ko, ms, nl, pl, pt_BR, pt_PT, ru, sv, ta, te, th, tr, uk, vi, zh_CN, zh_TW. Keep `{{price}}` and `{{hours}}` verbatim; keep "Kizuna AI" and "Soniox" as they are; in each catalog use the words it already uses for "transcribe", "balance", "wallet", "sign in" and "recording" (read its neighbouring `history.file.*` and `history.notesFailure.*` entries first). zh_CN for reference: 「由 Soniox 经 Kizuna AI 转写，从你的余额扣费。」「约 {{price}}。」「登录 Kizuna AI 后才能用它转写文件。」「你的 Kizuna AI 余额不够这次转写。」「你的 Kizuna AI 钱包已冻结。」「这段录音超过了 Kizuna AI 一次能转写的长度（{{hours}} 小时）。请联系我们，我们来帮你：」「Kizuna AI 的文件转写暂时还不能用。」「这个账号正在转写另一个文件，等它完成后再试。」「Soniox 已经开始转写：现在取消仍会计费。」「文件只能由 Soniox 转写。请在线路里把转写选成它。」
- [ ] **Step 3:** `npx vitest run src/locales` → PASS (key parity, placeholders, no English left, no Latin words left in zh_CN and ja beyond the product names).
- [ ] **Step 4: Commit** `i18n(history): hosted file transcription texts in every language`.

---

### Task 6: End-to-end expectations and the whole suite

**Files:**
- Modify: `e2e/specs/history-import.spec.ts` (the test that expects the "only by Soniox with your own key" text, and any that expects the hosted block), `e2e/README.md` (one line: the hosted file path is not covered end to end, because the suite has no sign-in)

- [ ] **Step 1:** Update the texts those tests expect (`blockedNotSoniox` as rewritten). If a test selects `kizunaai_soniox` and expected the old "live sessions only" text, it now expects `blockedSignIn` (the suite is signed out).
- [ ] **Step 2:** `npx vitest run` (the whole unit suite) → PASS.
- [ ] **Step 3:** Run `e2e/specs/history-import.spec.ts` the way the end-to-end suite is normally run for this repository (see `e2e/README.md`), in this worktree only, never in the main checkout; if this machine cannot run it, ask for a macOS run before the PR and say so in the PR.
- [ ] **Step 4: Commit** `test(e2e): the file notices as they read now`.

---

### Task 7: Hand over

- [ ] **Step 1:** Run the code-review tool on the branch and fix what it finds.
- [ ] **Step 2:** Ask the owner before pushing the branch `feat/managed-file-transcription` and before opening the PR to `main`. The PR says: it is inert until the service opens the feature for an account (a 404 reads as "not available yet"); the hosted path has unit tests against a faked service and no end-to-end test; what a real check needs once the service is open for one account (import a file and transcribe a record again, one of them translated and one two-sided; cancel one while it uploads and one while it is transcribed; a record over four hours).
