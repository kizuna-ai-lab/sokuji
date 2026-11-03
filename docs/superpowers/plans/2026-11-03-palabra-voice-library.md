# Palabra AI Voice Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Palabra's two voice pickers offer every built-in and the account's
own voices, with free previews. Users can create a voice from a recording or a
file, and delete it. Both credential types work.

**Architecture:**
- A `PalabraVoicesClient` talks to `api.palabra.ai`, reusing `restHeaders`.
- A `PalabraVoiceSource` interface sits in front of it, with a hook that reads
  the account's credentials.
- A `PalabraVoiceSection` beside `SonioxVoiceSection` renders the shared
  `VoiceLibrarySection` and `VoiceCreateModal`. `VoiceCreateModal` gains one
  optional field, the sample language.
- Settings widen the voice ids to strings and store a display name with each.

**Tech Stack:** React 18 + TypeScript, react-i18next, Vitest +
@testing-library/react, Web Audio `decodeAudioData`.

**Spec:** `docs/superpowers/specs/2026-11-03-palabra-voice-library-design.md`,
approved 2026-11-03 13:04, task #47. Read it first. Section numbers below
("spec §4") refer to it.

## Global Constraints

- **Soniox stays unchanged.** Shared components gain optional props only, and
  every existing Soniox, VoiceCreateModal and VoiceLibrarySection test passes
  unmodified.
- **Credentials** go only to `https://api.palabra.ai`. They never appear in a
  log, a thrown message, a banner, a cache key or a test snapshot.
- **Clip bounds:** `PALABRA_MIN_CLIP_SECONDS = 30`,
  `PALABRA_MAX_CLIP_SECONDS = 90`, and
  `PALABRA_MAX_UPLOAD_BYTES = 10_000_000`.
- **Uploads** are always WAV. The upload is named `sample.wav`, its
  `mime_type` is `audio/wav`, and it is mono PCM16 made with `encodeWavPcm16`.
- **Polling:** every 5 s for the first 60 s, then every 15 s. Give up at
  15 min with `timeout`. A 404 while polling maps to `voice_failed`.
- **Filters:** language sections plus the gender facet only. No age, mood or
  accent (owner ruling 5).
- **Copy:** every new key goes into all 30 `src/locales/*/translation.json`
  files, with identical placeholders (`locales.consistency.test.ts`
  enforces this). New keys live under `settings.palabraVoice*`. Reuse
  `voiceLibrary.*` and `settings.voice*` where the wording fits.
- **Verify** with `npx vitest run <paths>` per task. At the end:
  `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, then OCR
  (`ocr review --audience agent`). Use Node 24:
  `export PATH=$HOME/.nvm/versions/node/v24.22.2/bin:$PATH`.
- **Test credentials** for manual checks live in
  `~/palabra-test/creds.json` (mode 600). Never copy them into the repo, a
  fixture or a message.

## Review Focus

1. **App credentials mistaken for the API-key mode.** `account.credentials`
   holds all three keys. Reading them without `readCredentials` must still
   produce `restHeaders` with `ClientId`/`ClientSecret`. Pinned in Task 3.
2. **Going offline with a saved built-in voice.** The picker must show the
   stored name, not "(deleted voice)". Pinned in Task 5.
3. **The user leaves the Provider tab while a voice processes.** On return,
   polling resumes. Nothing is auto-selected later. A stale wait never
   overwrites a newer choice. Pinned in Task 6.
4. **An upload that fails after the clone POST succeeded.** The half-made
   voice is deleted, and the quota is not left holding it. Pinned in Task 2.
5. **Source language `auto`, or one Palabra cannot clone from.** The language
   select starts empty, Confirm stays disabled, and nothing is sent. Pinned
   in Task 6.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/providers/palabraai/settings.ts` (modify) | String voice ids, labels, migration | 1 |
| `src/providers/palabraai/PalabraVoiceSummary.tsx` (create; summary moves out of `PalabraSettings.tsx`) | The Speech rows' voice names | 1 |
| `src/providers/palabraai/voicesClient.ts` (create) | REST calls, paging, normalisation, errors | 2 |
| `src/providers/palabraai/voiceSource.ts` (create) | Source interface, preview decode and cache, `usePalabraVoiceSource` | 3 |
| `src/providers/palabraai/cloneLanguages.ts` (create) | The 50 clone codes, matching app codes to them, the name rule | 3 |
| `src/components/Settings/sections/SonioxCloneReviewStep.tsx`, `VoiceCreateModal.tsx` (modify) | Optional sample-language select | 4 |
| `src/components/Settings/sections/PalabraVoiceSection.tsx` (create) | List, entries, preview, create, poll, delete, quota | 5, 6 |
| `src/providers/palabraai/PalabraVoiceField.tsx` (create), `PalabraSettings.tsx` (modify) | Wiring and preview context | 7 |
| `extension/manifest.json` (modify) | CSP for the upload host | 7 |
| `src/locales/*/translation.json` (modify) | New copy | 5–7, as the keys appear |

---

### Task 0: Workspace

- [ ] **Step 1: Install and check the baseline**

  Run from the worktree:
  ```bash
  export PATH=$HOME/.nvm/versions/node/v24.22.2/bin:$PATH && npm ci && npx vitest run src/providers/palabraai src/components/Settings/sections
  ```
  Expected: install succeeds and every listed test passes. Record the pass
  count in the ledger as the baseline.

---

### Task 1: Settings take any voice, and remember its name

**Files:**
- Modify: `src/providers/palabraai/settings.ts`, `src/providers/palabraai/PalabraSettings.tsx`, `src/providers/palabraai/provider.ts`
- Create: `src/providers/palabraai/PalabraVoiceSummary.tsx`
- Test: `src/providers/palabraai/settings.test.ts`, `src/providers/palabraai/PalabraVoiceSummary.test.tsx`, `src/providers/palabraai/config.test.ts`

**Interfaces:**
- Produces:
  - `type PalabraVoice = string`
  - `PalabraSettings` gains `voiceName: string` and
    `participantVoiceName: string`. `PALABRA_DEFAULTS` sets both to `''`.
  - `PALABRA_DEFAULT_VOICE_IDS: ReadonlySet<string>`, which holds
    `default_low` and `default_high`.
  - `PalabraVoiceSummary: ComponentType<VoiceSummaryProps<PalabraSettings>>`.

- [ ] **Step 1: Write the failing tests** in `settings.test.ts`:
  - `migratePalabraSettings keeps any non-empty voice id`: stored
    `{ voiceId: 'b532f7e9-…', participantVoiceId: '94d9130d-…' }` comes back
    unchanged.
  - `… falls back to the defaults for '' and non-strings`: `voiceId: ''`
    gives `default_low`; `participantVoiceId: 7` gives `default_high`.
  - `… keeps voiceName and participantVoiceName as strings, '' otherwise`.
  - Update the existing assertion that `'Default Low'` as an id is reset. It
    is now kept, because any non-empty string is a valid id. Ledger this as a
    ruling.

  And in `PalabraVoiceSummary.test.tsx`:
  - `default_low` renders "Default Low".
  - An unknown id with `voiceName: 'Hungarian Male'` renders "Hungarian
    Male".
  - An unknown id with no name renders "Custom voice".
  - The participant leg uses `palabraParticipantVoice` and
    `participantVoiceName`.

  And in `config.test.ts`:
  - `buildPalabra passes a custom voiceId through`: a UUID `voiceId` comes
    out as `voiceId` unchanged.
- [ ] **Step 2: Run, expect FAIL**:
  `npx vitest run src/providers/palabraai/settings.test.ts src/providers/palabraai/PalabraVoiceSummary.test.tsx src/providers/palabraai/config.test.ts`.
- [ ] **Step 3: Implement.**
  - Migration: `typeof v === 'string' && v !== '' ? v : default`.
  - The summary reads, in order: the `PALABRA_VOICES` name, then the stored
    label for that leg, then `t('settings.voiceCustom')`.
  - The participant leg's label is `participantVoiceName`. When
    `palabraParticipantVoice` swapped the voice to the speaker's, use the
    other leg's name instead (`voiceName`).
  - `provider.ts` points `VoiceSummary` at the new component.
- [ ] **Step 4: Run the Step 2 command, expect PASS.** Then run
  `npx vitest run src/providers/palabraai`, expect all pass.
- [ ] **Step 5: Commit**: `feat(palabra): voice ids are any string, stored with a name`.

---

### Task 2: `PalabraVoicesClient`

**Files:**
- Create: `src/providers/palabraai/voicesClient.ts`
- Test: `src/providers/palabraai/voicesClient.test.ts`

**Interfaces:**
- Consumes: `restHeaders`, `restWords` and `PALABRA_API` (`wire.ts`);
  `boundedFetch` and `Bound`; `realClock`; `PalabraCredentials`.
- Produces:
  ```ts
  export interface PalabraVoiceInfo {
    id: string; name: string; language: string | null;
    facets: { gender?: 'male' | 'female' };
    status: 'ready' | 'processing' | 'failed';
    sample: string | null;
  }
  export type PalabraVoicesErrorType = 'auth' | 'rate_limit' | 'limit_reached' | 'bad_audio' | 'invalid_request'
    | 'upload_failed' | 'not_found' | 'timeout' | 'network' | 'aborted' | 'unknown';
  export class PalabraVoicesError extends Error { constructor(readonly errorType: PalabraVoicesErrorType, message: string, readonly status: number) }
  export class PalabraVoicesClient {
    constructor(k: PalabraCredentials, deps?: { fetch?: typeof fetch; clock?: Pick<Clock, 'setTimeout'> });
    listBuiltin(signal?: AbortSignal): Promise<PalabraVoiceInfo[]>;
    listMine(signal?: AbortSignal): Promise<PalabraVoiceInfo[]>;
    get(id: string, signal?: AbortSignal): Promise<PalabraVoiceInfo>;   // 404 → PalabraVoicesError('not_found')
    create(args: { name: string; wav: Blob; langCode: string; denoise: boolean }, signal?: AbortSignal): Promise<PalabraVoiceInfo>;
    delete(id: string, signal?: AbortSignal): Promise<void>;
    limits(signal?: AbortSignal): Promise<{ used: number; limit: number; remaining: number }>;
  }
  ```

- [ ] **Step 1: Write the failing tests** with a stubbed `fetch` that records
  each `(url, init)`. Each test's fixture is a trimmed copy of a real
  response shape from spec "What Palabra offers".
  - `sends Authorization: Bearer for an API key, and ClientId + ClientSecret for an app pair`
  - `listBuiltin follows next until it is null`. Two pages; the second
    request carries only `token`, with no `page_size`.
  - `listBuiltin stops after 10 pages`
  - `normalises a built-in`: gender `'Male'` becomes `'male'`, `sample` is
    the `tts_sample.url`, `language` is `tts_sample.text.lang`, and status is
    `ready`.
  - `normalises an account voice`: `created` and `pending` become
    `processing`, and `failed` stays `failed`.
  - `sample falls back to tts_samples[0], else null`
  - `listMine keeps only voice_type instantly_cloned`
  - `create posts metadata, then uploads form_data fields then file last to the pre-signed url`.
    - Body: `{ data: { name, samples: [{ filename: 'sample.wav', mime_type: 'audio/wav', lang_code, denoise }] } }`.
    - The upload request carries no `Authorization`, `ClientId` or
      `ClientSecret` header.
  - `create deletes the voice and throws upload_failed when the upload fails`.
    The upload returns 403; the client sends `DELETE /saas/voice/m/{id}`, and
    still throws `upload_failed` if that delete also fails.
  - `maps errors`:
    - 401 and 403 → `auth`
    - 429 → `rate_limit`
    - 422 with `error_code: 200200` → `limit_reached`
    - 422 with 200046 → `bad_audio`, and the message contains Palabra's
      `detail`
    - 422 with any other code on create → `invalid_request`
    - 404 on `get` → `not_found`
    - a rejected fetch → `network`
    - an aborted signal → `aborted`
  - `thrown messages never contain the credential`. Run every failure path
    with key `plbr_SECRET` and pair `id`/`sec`, and assert none of them
    appears in `error.message`.
- [ ] **Step 2: Run, expect FAIL**:
  `npx vitest run src/providers/palabraai/voicesClient.test.ts`.
- [ ] **Step 3: Implement.**
  - Bounds: 15 s per API call and 120 s for the upload, via `boundedFetch`.
  - URLs: `${PALABRA_API}/saas/voice/builtin`, `/saas/voice`,
    `/saas/voice/m/${encodeURIComponent(id)}` and `/saas/voice/limits`.
  - The upload is a `FormData` with every `form_data` entry, then
    `file: new File([wav], 'sample.wav', { type: 'audio/wav' })`.
- [ ] **Step 4: Run the Step 2 command, expect PASS.**
- [ ] **Step 5: Commit**: `feat(palabra): voices REST client`.

---

### Task 3: The source, its hook, and the clone languages

**Files:**
- Create: `src/providers/palabraai/voiceSource.ts`, `src/providers/palabraai/cloneLanguages.ts`
- Test: `src/providers/palabraai/voiceSource.test.ts`, `src/providers/palabraai/cloneLanguages.test.ts`

**Interfaces:**
- Consumes: `PalabraVoicesClient` and `PalabraVoiceInfo` (Task 2);
  `readCredentials` and `palabraCredentials`; `previewCacheKey`,
  `getCachedPreview` and `setCachedPreview`; `ProviderAccount`.
- Produces:
  ```ts
  export interface PalabraVoiceSource {
    list(signal?: AbortSignal): Promise<{ builtin: PalabraVoiceInfo[]; mine: PalabraVoiceInfo[] }>;
    get(id: string, signal?: AbortSignal): Promise<PalabraVoiceInfo>;
    create(args: { name: string; wav: Blob; langCode: string; denoise: boolean }): Promise<PalabraVoiceInfo>;
    delete(id: string): Promise<void>;
    limits(): Promise<{ used: number; limit: number; remaining: number }>;
    preview(args: { id: string; sample: string; signal?: AbortSignal }): Promise<{ audio: Float32Array; sampleRate: number }>;
    readonly cacheNamespace: 'palabra';
  }
  export function palabraVoiceSource(client: PalabraVoicesClient, deps?: { fetch?: typeof fetch; decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer> }): PalabraVoiceSource;
  export function usePalabraVoiceSource(account: ProviderAccount | undefined, settings: PalabraSettings): PalabraVoiceSource | null;
  // cloneLanguages.ts
  export const PALABRA_CLONE_LANGUAGES: readonly string[];   // the 50 codes of SingleVoiceInstantCloneLangCode, verbatim from spec "Creating a voice"
  export function cloneLanguageFor(appCode: string | null | undefined): string | null;  // app code → clone code, or null
  export function sameLanguage(voiceLang: string | null, appCode: string): boolean;     // base-subtag match
  export const PALABRA_VOICE_NAME = /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\-. ()]{3,64}$/u;
  export function cleanVoiceName(raw: string): string;  // drops characters outside the class, trims, cuts to 64
  ```

- [ ] **Step 1: Write the failing tests.**
  - `cloneLanguageFor`:
    - `'hu' → 'hu'`, `'en-US' → 'en-us'`, `'zh_TW'` or `'zh-TW' →
      'zh-hant'`, `'pt-BR' → 'pt-br'`;
    - a code with a supported base and no exact entry falls back to the base
      (`'es-ES' → 'es'`);
    - `'auto' → null`, `'yue' → null`, `undefined → null`.
  - `sameLanguage('es-la', 'es')` is true, `('pt-br', 'pt-PT')` is true,
    `('zh-hant', 'zh-TW')` is true, and `('en', 'ja')` is false.
  - `PALABRA_VOICE_NAME`:
    - accepts "Teszt hang ő", "测试 声音", "My Voice 1" and "हिन्दी आवाज़";
    - rejects "ab", a 65-character name and "it's";
    - `cleanVoiceName("it's mine!") === 'its mine'`.
  - `preview fetches the sample once, decodes it to mono, and serves the second call from the cache`.
    The stubbed `fetch` and `decode` each count one call. The cache key is
    `previewCacheKey('palabra', id, '', 1)`.
  - `usePalabraVoiceSource reads an app pair as app headers`. Render the hook
    with account credentials `{ apiKey: 'plbr_x', clientId: 'id',
    clientSecret: 'sec' }` and settings `authMode: 'app'`. Spy on `fetch`
    after `list()`: the request carries `ClientId: 'id'` and no
    `Authorization`.
  - `usePalabraVoiceSource returns null when the mode's credentials are missing`
  - `usePalabraVoiceSource returns the same object until the credentials change`
- [ ] **Step 2: Run, expect FAIL**:
  `npx vitest run src/providers/palabraai/voiceSource.test.ts src/providers/palabraai/cloneLanguages.test.ts`.
- [ ] **Step 3: Implement.**
  - `list` runs both lists with `Promise.all`.
  - `preview` uses `fetch` and `arrayBuffer`, then decodes. The default
    `decode` uses a fresh `AudioContext` and closes it afterwards. Then
    `downmixToMono`.
  - The hook uses
    `readCredentials({ credentials: palabraCredentials }, settings, account.credentials, account.auth)`
    and `useMemo` keyed on the credential kind and its values.
- [ ] **Step 4: Run the Step 2 command, expect PASS.**
- [ ] **Step 5: Commit**: `feat(palabra): voice source, clone languages, credential hook`.

---

### Task 4: The review step can ask for the sample's language

**Files:**
- Modify: `src/components/Settings/sections/SonioxCloneReviewStep.tsx`, `src/components/Settings/sections/VoiceCreateModal.tsx`
- Test: `src/components/Settings/sections/SonioxCloneReviewStep.test.tsx` (create, or add to the existing modal test)

**Interfaces:**
- Produces: `VoiceCreateReview` and `SonioxCloneReviewStepProps` both gain an
  optional field:
  ```ts
  language?: { label: string; options: ReadonlyArray<{ value: string; label: string }>; value: string; onChange(value: string): void };
  ```
  `VoiceCreateModal` passes `review.language` through unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `without language, renders no select and Confirm needs only consent`.
    This is today's behaviour, asserted.
  - `with language, renders a labelled select listing the options with value preselected`
  - `with language value '', Confirm stays disabled even with consent ticked`
  - `changing the select calls onChange with the option value`
  - `while busy, the select is disabled`
- [ ] **Step 2: Run, expect FAIL**:
  `npx vitest run src/components/Settings/sections/SonioxCloneReviewStep.test.tsx`.
- [ ] **Step 3: Implement.** Put a `<select className="select-dropdown">`
  above the name field, with `aria-label={language.label}`. Confirm is
  disabled when `busy || !consent || (language && !language.value)`.
- [ ] **Step 4: Run the Step 2 command plus every existing Soniox and modal
  test.**
  `npx vitest run src/components/Settings/sections/SonioxCloneReviewStep.test.tsx src/components/Settings/sections/VoiceCreateModal.test.tsx src/components/Settings/sections/SonioxVoiceSection.test.tsx`.
  Expect PASS with no existing test edited.
- [ ] **Step 5: Commit**: `feat(voice-library): optional sample language in the clone review step`.

---

### Task 5: `PalabraVoiceSection`: list, entries, preview

**Files:**
- Create: `src/components/Settings/sections/PalabraVoiceSection.tsx`
- Test: `src/components/Settings/sections/PalabraVoiceSection.test.tsx`
- Modify: locales (the keys this task introduces)

**Interfaces:**
- Consumes: `PalabraVoiceSource`, `sameLanguage`, `PALABRA_VOICES`,
  `VoiceLibrarySection`, `VoiceEntry` and `languageLabel`.
- Produces:
  ```ts
  export interface PalabraVoiceSectionProps {
    settings: { voiceId: string; voiceName: string; participantVoiceId: string; participantVoiceName: string };
    onSelect(patch: { voiceId: string; voiceName: string } | { participantVoiceId: string; participantVoiceName: string }): void;
    source: PalabraVoiceSource | null;
    target: string;               // the pair's target: row 1's language
    pairSource: string;           // the pair's source: row 2's language, and the clone language's default
    participant?: { effective: string };   // present while the participant speaks; effective = palabraParticipantVoice(settings)
    isSessionActive: boolean;
  }
  ```

- [ ] **Step 1: Write the failing tests.** Copy the mock-source pattern from
  `SonioxVoiceSection.test.tsx`: `listMock`, `getMock`, `limitsMock` and
  `previewMock`.
  - `with no source, lists only Default Low and Default High, with no refresh, add or preview`
  - `lists built-ins in two sections, the target's language first`. With
    target `hu`: the first section is headed with the Hungarian language
    label and holds the `hu` voices, and the next is "Other languages".
  - `the gender facet works and no age facet is offered`
  - `account voices: processing and failed are badged, disabled and removable`
  - `selecting writes id and name together`, through
    `onSelect({ voiceId, voiceName })`.
  - `a stored id missing after a successful fetch shows "(deleted voice)"`
  - `a stored id after a FAILED fetch shows the stored name, not "(deleted voice)"`.
    This pins Review Focus 2.
  - `a failed fetch shows the Retry banner and Retry refetches`
  - `the second row lists defaults and built-ins only, sectioned by pairSource, and writes participantVoiceId/participantVoiceName`
  - `previewing a built-in calls source.preview with its sample; the defaults have no preview button`
  - `quota shows used/limit; a failed limits call hides it without a banner`
- [ ] **Step 2: Run, expect FAIL**:
  `npx vitest run src/components/Settings/sections/PalabraVoiceSection.test.tsx`.
- [ ] **Step 3: Implement.**
  - Follow `SonioxVoiceSection`'s list state: a generation counter, plus
    `listState: 'idle' | 'loading' | 'error'`.
  - Built-in entries carry `section`, `previewable: !!sample` and
    `meta: { language, facets: { gender } }`.
  - Name the target's section with `languageLabel(target, i18n.language)`.
    The other section is
    `t('settings.palabraVoiceOtherLanguages', 'Other languages')`.
  - Turn on `capability.facetFilter`.
  - Add the new keys to all 30 locales. Translate them, and do not leave
    English in other locales.
- [ ] **Step 4: Run the Step 2 command plus
  `npx vitest run src/locales`, expect PASS.**
- [ ] **Step 5: Commit**: `feat(palabra): voice picker with built-ins, own voices and previews`.

---

### Task 6: `PalabraVoiceSection`: create, poll, delete

**Files:**
- Modify: `src/components/Settings/sections/PalabraVoiceSection.tsx`, locales
- Test: `src/components/Settings/sections/PalabraVoiceSection.test.tsx`

**Interfaces:**
- Consumes: `PALABRA_CLONE_LANGUAGES`, `cloneLanguageFor`,
  `PALABRA_VOICE_NAME` and `cleanVoiceName` (Task 3);
  `VoiceCreateReview.language` (Task 4); `encodeWavPcm16`,
  `validateVoiceClip` and `downmixToMono`; and `PalabraVoicesError` (Task 2).

- [ ] **Step 1: Write the failing tests.** Use fake timers for polling.
  - `a recording shorter than 30 s is refused with the "too short" message and stages nothing`
  - `an imported file over 10 MB, or decoding to more than 90 s, is refused`
  - `an imported MP3 is re-encoded: create receives a WAV Blob and denoise false; a recording gets denoise true`
  - `the review offers the clone languages, preselected from pairSource ('hu' → 'hu')`
  - `with pairSource 'auto' the language starts empty and Confirm is disabled`.
    This pins Review Focus 5.
  - `a name outside the pattern is refused inline before any request`
  - `confirm calls create, refreshes, closes, then polls get every 5 s, then 15 s after a minute`
  - `when get turns ready, the list refreshes and the new voice is selected`, with
    its name stored.
  - `no auto-select if the user picked another voice meanwhile, or a session started, or the section unmounted`.
    Unmount, advance the timers, and assert `onSelect` is never called and
    `get` stops. This pins Review Focus 3.
  - `a section mounting with a processing voice in the list polls it and refreshes when it settles, without selecting it`
  - `get → not_found while polling: refresh and show the "could not process" message`
  - `polling gives up after 15 minutes with the timeout message`
  - `create failing with limit_reached keeps the dialog open with the limit message`
  - `remaining 0 withdraws record and upload`
  - `delete is refused while a session uses that voice; otherwise deletes, refreshes, and resets a selected voice to default_low with voiceName ''`
- [ ] **Step 2: Run, expect FAIL**:
  `npx vitest run src/components/Settings/sections/PalabraVoiceSection.test.tsx`.
- [ ] **Step 3: Implement.**
  - The pending, confirm, refresh and close flow follows
    `SonioxVoiceSection.handleConfirm` and `finishCreate`. Read the latest
    selection and session state from refs updated each render.
  - One `AbortController` per mount stops polling on unmount.
  - Map every `PalabraVoicesError` type to a message in one function, like
    Soniox's `mapCreateError`. `voice_failed` and `not_found` share the
    "could not process" copy.
  - Add the new keys to all 30 locales.
- [ ] **Step 4: Run the Step 2 command plus
  `npx vitest run src/locales src/components/Settings/sections`, expect
  PASS.**
- [ ] **Step 5: Commit**: `feat(palabra): create and delete voices, with processing state`.

---

### Task 7: Wiring, CSP

**Files:**
- Create: `src/providers/palabraai/PalabraVoiceField.tsx`
- Modify: `src/providers/palabraai/PalabraSettings.tsx`, `extension/manifest.json`
- Test: `src/providers/palabraai/PalabraSettings.test.tsx`, plus a manifest assertion in an existing extension manifest test if one exists (add one otherwise)

**Interfaces:**
- Consumes: `usePalabraVoiceSource` (Task 3) and `PalabraVoiceSection`
  (Tasks 5–6).
- Produces: `PalabraVoiceField(props: { settings; update; disabled; pair?;
  account?; participantSpeaks? })`. `target` falls back to `'en'` and
  `pairSource` to `'auto'` when `pair` is absent, as it is in tests.

- [ ] **Step 1: Write the failing tests.**
  - `PalabraSettingsView renders the voice library, not the old two-option select`
  - `it provides VoicePreviewContext from the preview prop`. Render it with a
    fake `preview` port, then assert that previewing a built-in calls
    `preview.play`.
  - `choosing a voice calls update with id and name`
  - `the extension CSP allows https://palabra-prod-web-cdn.s3.amazonaws.com`
- [ ] **Step 2: Run, expect FAIL**:
  `npx vitest run src/providers/palabraai/PalabraSettings.test.tsx`, plus
  the manifest test.
- [ ] **Step 3: Implement.** Mirror `SonioxVoiceField` and
  `SonioxSettings.tsx:38`'s `VoicePreviewContext.Provider`. Remove the
  `VoiceField` import if nothing else uses it there. Append the S3 host to
  `connect-src` in `extension/manifest.json` and nowhere else.
- [ ] **Step 4: Run the Step 2 command, then the full suite**:
  `npx vitest run`, expect PASS against the Task 0 baseline plus the new
  tests. Then `npx tsc --noEmit -p tsconfig.json`, expect no errors.
- [ ] **Step 5: Commit**: `feat(palabra): voice library in Palabra's settings; CSP for voice uploads`.

---

### Task 8: Verification with real accounts

No code unless a finding needs it. If one does, go back to the owning task's
test first.

- [ ] **Step 1: Desktop** (`npm run electron:dev` or the repo's usual dev
  command). Use the platform key from `~/palabra-test/creds.json`, typed into
  the credential form, never pasted into chat. Then:
  1. The list shows 2 + 116 voices, with the target language's section
     first.
  2. Preview a built-in.
  3. Record 35 s with "denoise".
  4. Watch "processing…" turn into a selected voice.
  5. Run a session and hear it.
  6. Run a session with a built-in.
  7. Delete the voice.
- [ ] **Step 2: The same with the app pair**, on the desktop.
- [ ] **Step 3: Extension** (`npm run extension:build`, load unpacked). With
  one credential type: list, preview, create, delete. Watch the devtools
  console for CSP violations.
- [ ] **Step 4: Record the results** in the spec's "Still to verify" section,
  as measured facts with the date.
  - If a live session fails for one credential type, **stop and ask the
    owner** (spec rule).
  - Delete every test voice. Confirm with `GET /saas/voice/limits` via
    `~/palabra-test/probe.py` that `total` is back to its starting value.
- [ ] **Step 5: Commit** the spec update: `docs(palabra): verified with both credential types`.

---

## Final

- Whole-branch review as the execution skill describes. Then OCR
  (`ocr review --audience agent --from origin/main --to HEAD`). Fix
  high-confidence findings with a failing test first.
- Do not push, open a PR or publish anything without the owner's explicit OK.
  Name the target when asking: `kizuna-ai-lab/sokuji`, branch
  `feat/palabra-voice-library`.
- After the task, delete `~/palabra-test/` and tell the owner to revoke the
  two test credentials.
