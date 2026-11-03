# Palabra AI voice library: more voices, previews, and your own voice

Date: 2026-11-03. Status: approved by the owner (2026-11-03 13:04, task #47,
thread `#sokuji:0cdf7db3`).

## Why

Palabra AI gives Sokuji two voices today, "Default Low" and "Default High". A
user wrote in (Genzor, 2026-11-03): he had made his own voice in his Palabra
account and could not pick it in Sokuji. Palabra's API offers much more than
those two:
- 116 built-in voices;
- the account's own voices;
- creating a voice from a recording.

**Owner's rulings (2026-11-03, thread `#sokuji:0cdf7db3`):**

1. Both ways of signing in to Palabra must work: the platform API key and the
   older app Client ID / Client Secret.
2. Beyond the two voices we already have, list the voices Palabra offers.
3. Palabra has the APIs, so Sokuji does what it does for other providers:
   - preview (listen to a voice before choosing it);
   - upload or record audio;
   - make a custom voice.
4. Follow the other providers' implementation and design. In particular, show
   a voice's processing state the way Soniox does (owner, 12:17).
5. The list is narrowed by language and gender only. No accent filter
   (owner, 12:57, after seeing the attribute tally in "The built-in roster").

The reference is Soniox's voice library (`SonioxVoiceSection` over the shared
`VoiceLibrarySection`). It is the only remote provider that already lists,
previews, creates and deletes voices.

## What Palabra offers

Sources:
- the public OpenAPI document, `https://api.palabra.ai/docs/openapi.json`;
- the docs pages `voices`, `clone-voice-api`, `clone-voice-ui`, `error_codes`
  and `streaming_api/translation_settings_breakdown`;
- calls made with one platform key and one app pair the owner supplied for
  this task (2026-11-03). They are marked **(measured)** below.

**Authentication.** Every voice endpoint accepts either credential:
- `Authorization: Bearer plbr_…`, the platform key;
- `ClientId` + `ClientSecret` headers, the app pair.

This is exactly what `restHeaders()` in `src/providers/palabraai/wire.ts`
already produces. **(measured)** Both work on every endpoint below. The two
test credentials belong to different Palabra accounts, with voice limits of 50
and 10, so each sees its own voices.

| Purpose | Endpoint | Notes |
|---|---|---|
| Built-in voices | `GET /saas/voice/builtin` | Paged: `page_size` ≤ 100, then `token` from `next`. **(measured)** 116 voices, so two pages |
| The account's voices | `GET /saas/voice` | Same paging. **(measured)** Returns only the account's own voices, never built-ins |
| One voice | `GET /saas/voice/m/{voice_id}` | Polls a new voice |
| Create a voice | `POST /saas/voice/clone` | Two steps, see below |
| Delete a voice | `DELETE /saas/voice/m/{voice_id}` | |
| Quota | `GET /saas/voice/limits` | `limit`, `total` (created + pending + ready), `remaining` |

### The built-in roster (measured)

- **One language per voice.** There are 116 voices covering 38 languages. Most
  languages have one male and one female voice, and the name says which, for
  example "Hungarian Male" or "Japanese Female". Arabic and Spanish come in
  several regional variants.
- **Labels.** `gender` is Male or Female, 58 each. `age_group` is "Middle Age"
  or empty. `mood` is "Neutral" or empty. `description` is a generic phrase
  ("General", "Voice cloned from the sample") and is not worth showing.
- **Samples.** Every voice has a `tts_sample`, its canonical sample, plus one
  or two in `tts_samples[]` (one per vendor, same language).
  - The files are MP3s on `https://cdn.palabra.ai/blob/…`.
  - They need no credential and answer `Access-Control-Allow-Origin: *`, so
    they can be fetched and decoded in the extension and in Electron.
  - `audio_metadata.duration` reads 0, so it is not to be relied on.

### Creating a voice

1. `POST /saas/voice/clone` sends metadata only:
   `{ data: { name, samples: [{ filename, mime_type, lang_code, denoise? }] } }`.
   - `name` is 3–64 characters matching `^[\w\-. ()]+$`, where `\w` is
     Unicode. **(measured)** "Teszt hang ő" and "测试 声音" are both accepted.
   - There is exactly one sample.
   - `mime_type` is one of `audio/x-wav`, `audio/wav`, `audio/mp3`,
     `audio/x-m4a`, `audio/mpeg`, `audio/flac`, `video/webm`, `video/mp4` or
     `video/mpeg`.
   - `lang_code` is one of 50 languages, `SingleVoiceInstantCloneLangCode`.
     They include `hu`, `ja`, `zh`, `zh-hant` and `en`.
2. The answer holds `voice_id`, `processing_status: created` and a pre-signed
   upload: `url` plus `form_data`.
   - **(measured)** The upload goes to
     `https://palabra-prod-web-cdn.s3.amazonaws.com/` as a multipart form POST,
     the file last.
   - It answers 204 and `Access-Control-Allow-Origin: *`.
3. Poll `GET /saas/voice/m/{voice_id}`. The voice moves from `created`
   through `pending` to `ready` or `failed`. The guide says this "typically
   takes 2-5 minutes". **(measured)**
   - A clean 43 s mono 16-bit WAV was `ready` within about 30 s. Palabra had
     made two samples of it, one per vendor, in the clone's language. It was
     listed by `GET /saas/voice`, counted by `/limits`, and deleted cleanly
     (200, then 404, quota back).
   - An MP3 made by joining three copies of one file stayed `created` for
     about 12 minutes. Then Palabra deleted it: `GET` answered 404, and it was
     neither marked `failed` nor counted anywhere.
   - **A voice can therefore vanish while it is still processing**, and the
     client must treat a 404 during polling as "Palabra dropped it".

The guide sets the sample's bounds: at least 30 s, at most 10 MB, one speaker.

**Errors** (`error_codes`). The ones creating a voice can meet, all HTTP 422:
- 200200 `VoiceLimitExceeded`;
- 200040 bad file;
- 200041 unsupported MIME type;
- 200046 bad audio;
- 200047 too quiet or too loud.

The body is `{ errors: [{ title, detail, error_code }] }`.

### Using a voice

`pipeline.translations[].speech_generation.voice_id` takes any voice id,
alongside the `default_low` / `default_high` aliases. Today we send
`voice_cloning: false`, `voice_id` and `voice_timbre_detection.enabled: false`.

A missing id is not fatal. Palabra speaks a default voice and warns
`VOICE_NOT_FOUND`, which the adapter already turns into the `voice_fallback`
notice (`adapter.ts`).

## Goals

- **The voice the other side hears** (`voiceId`) can be:
  - either default;
  - any of the 116 built-ins;
  - any ready voice in the user's Palabra account, whether made in Sokuji,
    the Palabra web portal or the Palabra desktop app.
- **The voice I hear** (`participantVoiceId`) can be either default or any
  built-in, the same rule Soniox applies to its second row.
- Every built-in and every ready account voice can be previewed.
- A user can make a voice in Sokuji by recording or uploading a file.
  - While Palabra processes it, the voice is listed with its state, as Soniox
    does.
  - When it is ready, it is picked automatically, unless the user chose
    something else meanwhile.
  - It can be deleted.
- All of this works the same with either credential type, in the desktop app
  and in the extension.

## Non-goals

- **Live mimicry of the speaker** (`voice_cloning: true`). Palabra calls it
  experimental. While it is on, `voice_id` is ignored, so it would cancel the
  very choice this feature adds. It can come later as its own switch.
- **Automatic voice by timbre** (`voice_timbre_detection`).
- **Account management beyond what the picker needs.** No renaming, no
  favorites, no regenerating samples, no deleting everything.
- **Synthesizing a preview sentence.** `POST /saas/speech/tts` exists only in
  Palabra's internal SaaS document, and the stored samples already give every
  voice a free preview.

## Anti-goals

- **Never rewrite the stored voice behind the user's back.** A voice that
  vanished elsewhere shows as a placeholder. Only an in-app delete of the
  selected voice resets it to the default.
- **Never change Soniox's behaviour.** Shared components may gain optional
  props that Soniox does not pass. Nothing it passes today changes meaning.
- **Never send a credential anywhere but `api.palabra.ai`**, and never into a
  log, banner, error message or cache key.
- **Never send a recording anywhere but Palabra's own pre-signed upload.**

## Design

### 1. Settings (`src/providers/palabraai/settings.ts`)

- `PalabraVoice` becomes `string`. `voiceId` and `participantVoiceId` keep
  their defaults, `default_low` and `default_high`.
- `migratePalabraSettings` keeps any non-empty string, where today it resets
  anything but the two aliases. An empty or non-string value falls back to the
  default as now.
- `palabraParticipantVoice` (the other party's voice is never mine) is
  unchanged. It already compares strings.
- `PALABRA_VOICES` stays as the two named defaults. It is now only the head of
  the list.
- **Two new stored labels**, `voiceName` and `participantVoiceName` (default
  `''`, migrated as strings). Each is written together with its id whenever
  the user picks a voice. The Speech rows' summary (`PalabraVoiceSummary`) has
  no list to look names up in, so it shows, in order:
  - the default's name;
  - else the stored label;
  - else "Custom voice" (`settings.voiceCustom`).

### 2. Talking to Palabra (`src/providers/palabraai/voicesClient.ts`, new)

`PalabraVoicesClient`, constructed from `PalabraCredentials`, is modelled on
`SonioxVoicesClient` and `check.ts`. It uses:
- `restHeaders`;
- `boundedFetch`, with 15 s for API calls and 120 s for the upload;
- an injectable `fetch`.

| Method | Calls | Returns |
|---|---|---|
| `listBuiltin()` | `GET /saas/voice/builtin`, every page, at most 10 | `PalabraVoiceInfo[]` |
| `listMine()` | `GET /saas/voice`, every page, at most 10. Keeps `voice_type === 'instantly_cloned'` as a defence | `PalabraVoiceInfo[]` |
| `get(id)` | `GET /saas/voice/m/{id}` | `PalabraVoiceInfo` |
| `create({ name, wav, langCode, denoise })` | the clone POST, then the upload | `PalabraVoiceInfo` |
| `delete(id)` | `DELETE /saas/voice/m/{id}` | `void` |
| `limits()` | `GET /saas/voice/limits` | `{ used: total, limit }` |

**If the upload fails after the clone POST succeeded**, `create` deletes the
half-made voice, best effort, before rethrowing. Otherwise it would count
against the quota and sit at `created` forever.

`PalabraVoiceInfo` is our normalised shape:
`{ id, name, language, facets, status, sample }`.
- `language` is the sample's language.
- `status` is `'ready' | 'processing' | 'failed'`. Built-ins are always
  `ready`; `created` and `pending` map to `processing`.
- `sample` is a URL or null: the `tts_sample` URL, else the first of
  `tts_samples`, else null.
- `facets` carries `gender` only (`VoiceFacets.gender`). `age_group`, `mood`,
  `description` and `attributes` are dropped. Each has at most one real
  value across the roster, so none can narrow anything (ruling 5).

**Failures** throw `PalabraVoicesError(type, message, status)`, shaped like
`SonioxVoicesError`, so the section can map them to copy:
- 401/403 → `auth`
- 429 → `rate_limit`
- 422 with `error_code` 200200 → `limit_reached`
- 422 with 200040, 200041, 200046 or 200047 → `bad_audio`, carrying Palabra's
  words via `restWords`
- any other 4xx on create → `invalid_request`, likewise
- the upload failing → `upload_failed`
- timeout → `timeout`
- network → `network`
- abort → `aborted`
- anything else → `unknown`

### 3. The source (`src/providers/palabraai/voiceSource.ts`, new)

The section reads voices through a small interface, as Soniox's does through
`VoiceLibrarySource`:
- `list() → { builtin, mine }`
- `create(...)`
- `delete(id)`
- `get(id)`
- `limits()`
- `preview({ id, sample, signal })`
- `cacheNamespace = 'palabra'`

`VoiceLibrarySource` is typed to `SonioxVoice`, so Palabra gets its own
interface beside it rather than a generalised one (see "Calls made"). Voice
ids are global UUIDs, so one cache namespace serves every account.

**Preview** fetches the voice's `sample` URL and decodes it to a mono
`Float32Array` with its sample rate. It goes through the shared preview cache
(`previewCacheKey` / `getCachedPreview` / `setCachedPreview`). It synthesizes
nothing and costs nothing. An entry with no sample (the two defaults, or an
account voice not yet ready) has `previewable: false`.

**The source hook** is `usePalabraVoiceSource(account, settings)`, like
`useByokVoiceSource`.
- It reads the credentials with
  `readCredentials(palabraCredentials, settings, account.credentials, account.auth)`.
- It must not call `palabraCredentials.read(account.credentials)`. The saved
  values hold all three keys, so a direct read takes the app pair for the
  API-key mode.
- It memoizes on the mode plus the key, or the pair.
- With credentials missing it yields `null`. Then only the two defaults show,
  with no create, refresh or preview.

### 4. The section (`src/components/Settings/sections/PalabraVoiceSection.tsx`, new)

This is a sibling of `SonioxVoiceSection` over the shared
`VoiceLibrarySection`. It keeps Soniox's structure, and the differences are
spelled out.

**List state**
- **Remembered for the app session (owner, 2026-11-03 14:24).** One source per
  set of credentials lives for the app session (`sharedPalabraVoiceSource`,
  in memory only, keyed on the credentials themselves). It remembers its last
  successful list and quota; a create or a delete forgets them. A visit to the settings shows that at once and
  asks Palabra nothing.
- Palabra is asked again only on Refresh, after a create or a delete, on a
  change of credentials, or for a voice still processing (that voice alone).
- With nothing remembered: fetch on mount and on a source change, guarded by
  a generation counter.
- `list()` fetches the built-ins and the account's voices together. If either
  fails, the fetch fails.
- A failed fetch shows a Retry banner. An errored list is not an empty list.
- `onRefresh` sits beside the list.
- The quota call runs alongside. If it fails, it only hides the count.

**Entries**
- **The two defaults** come first, unsectioned. They are not previewable.
- **The built-ins** are grouped with `VoiceEntry.section`:
  - first, a section named after the row's language, holding the built-ins
    whose language has the same base subtag (`es-la` and `es-mx` count as
    `es`, `pt-br` as `pt`);
  - then a section "Other languages" with the rest, in the API's order.

  The row's language is the pair's target for the first row and the pair's
  source for the second. Section names are in the user's interface language.
  The facet filter is on, and has gender only (ruling 5).
- **The account's voices** are the `custom` group, labelled with their names:
  - "processing…" or "failed" is appended, as Soniox does;
  - they are `disabled` unless ready and `removable` always;
  - they are previewable when ready and they have a sample.
- **Unknown stored id.** The placeholder is disabled and never written back.
  Its label depends on what is known:
  - "(deleted voice)" only when the last fetch succeeded and a source exists;
  - otherwise the stored label (`voiceName`), or failing that the raw id.

  This deliberately differs from Soniox's code, which also says "deleted"
  after a failed fetch. Here that would mislabel every saved built-in when
  offline.

**The second row** ("the voice I hear") is shown while the participant
speaks. It lists the defaults and built-ins only, with the existing "same as
the other voice" note.

**Creating a voice.** This is Soniox's flow: record or upload, then validate,
then stage the clip. That opens the review step of the shared
`VoiceCreateModal` (name, playback, consent). On Confirm:
1. `create`.
2. Refresh, with the dialog kept open while busy.
3. Close the dialog.
4. Wait until ready in the background.

A create failure keeps the dialog open with the mapped message. Palabra
specifics:

- **Bounds.** Clips are 30–90 s of audio. Uploads are at most 10 × 10⁶ bytes.
  - Both recordings and imports are validated. Soniox validates imports only,
    so a recording stopped at 25 s gets the shared "too short" message here.
  - The 90 s ceiling keeps a 48 kHz recording's WAV under 10 MB (about
    8.6 MB).
- **Always upload WAV.** Every clip, recorded or imported, is decoded,
  downmixed to mono and re-encoded with `encodeWavPcm16`. The upload is named
  `sample.wav`, with MIME type `audio/wav`. Palabra's MIME list and filename
  pattern are strict, and the import path already decodes to validate.
- **Name.** It is checked before the request with the Unicode classes the
  server uses (`\p{Alphabetic}`, `\p{M}`, `\p{Nd}`, `\p{Pc}`, plus `-`, `.`,
  space, `(` and `)`), 3–64 characters. A refusal shows inline. The suggested
  name is the translated "My Voice {{n}}" or the file's name, cleaned of
  characters outside the pattern.
- **Sample language.** Palabra requires one, so the review step gains a
  language select. This is an optional field of `VoiceCreateModal`'s review
  phase; Soniox does not pass it and is unchanged.
  - It lists the 50 clone languages, named in the user's interface language.
  - It is prefilled with the pair's source when that is among them, else the
    interface language when that is, else nothing.
  - Confirm stays disabled until a language is chosen, which covers a source
    of `auto`.
- **`denoise`** is true for recordings and false for uploaded files.
- **Waiting for ready.**
  - Poll `get(id)` every 5 s for the first minute, then every 15 s, for up
    to 15 minutes. That outlasts the ~12 minutes after which Palabra was seen
    to drop a voice that never processed.
  - A 404 while polling means Palabra dropped the voice. Refresh the list and
    show "Palabra could not process this recording. Try another one." This
    reuses the `voice_failed` mapping.
  - A section that mounts while any account voice is `processing` polls those
    too, refreshing the list when one settles. Leaving the tab and coming back
    keeps the states moving without a manual refresh.
  - Polling stops on unmount.
  - Auto-select happens only in the mount that created the voice, and only
    if three things still hold: the source is the same, the selection is
    still the one at create time (read from the latest props), and no session
    is running.

**Quota.** Show `customQuota = { used, limit }` from `limits()` beside "Custom
voices". Omit it when that call fails. When `remaining` is 0, withdraw the
create affordances. `limit_reached` from the server is mapped to the same
message.

**Delete**
- Refused while a session uses that voice, with the same in-dialog reason as
  Soniox.
- On success, refresh. If the deleted voice was selected, reset it to the
  default and clear its label.

**Preview cost note** (`manageNote`): none. Samples are free to play.

**Copy.** New strings go under `settings.palabraVoice*` and are added to all 30
locale files. Shared `voiceLibrary.*` and `settings.voice*` copy is reused
wherever it fits.

### 5. Wiring (`src/providers/palabraai/PalabraSettings.tsx`)

`PalabraSettingsView` swaps its `VoiceField` for `PalabraVoiceField`, a thin
wrapper like `SonioxVoiceField`. It takes from `SettingsProps`:
- `account`;
- `preview`;
- the pair, as target and source;
- `participantSpeaks`;
- `disabled`.

It wraps the section in `VoicePreviewContext.Provider value={preview}`, as
`SonioxSettings.tsx` does, so previews play on the user's chosen output device.

### 6. Sessions

`config.ts` already passes `voiceId` / `participantVoiceId` through to
`speech_generation.voice_id`. With the type widened, nothing else changes.

### 7. Extension and desktop

Every call is a direct `fetch` from the page, as for every other provider.
- The extension's CSP (`connect-src` in `extension/manifest.json`) already
  covers `api.palabra.ai` and `cdn.palabra.ai` through `https://*.palabra.ai`.
- It gains `https://palabra-prod-web-cdn.s3.amazonaws.com` for the upload.

Electron needs nothing: both hosts allow any origin.

## Verified against the live API (2026-11-03)

Run with the branch's own code (`PalabraVoicesClient`, `waitUntilSettled`,
`wire.ts`) and both test credentials, each in its own Palabra account:

| Check | Platform key | App pair |
|---|---|---|
| Built-ins listed / account voices / quota | 116 / 0 / 0 of 50 | 116 / 0 / 0 of 10 |
| A 43 s mono WAV clone (`zh`) | ready after 30 s, with a sample | ready after 18 s, with a sample |
| Previews: a built-in's and the clone's samples fetched | yes | yes |
| Live session `zh → en` with a built-in (English (Australian) Female) | 99 audio chunks, 5 translations, no `VOICE_NOT_FOUND` | 99 chunks, 5 translations, no `VOICE_NOT_FOUND` |
| Live session with the fresh clone | 105 chunks, 5 translations, no `VOICE_NOT_FOUND` | 104 chunks, 5 translations, no `VOICE_NOT_FOUND` |
| Control: a made-up voice id | `VOICE_NOT_FOUND`, default voice spoke | `VOICE_NOT_FOUND`, default voice spoke |
| Delete, then quota | back to its start | back to its start |

The app pair's live session went through its REST session, as the adapter's
does. The script paced its audio slightly faster than real time, so Palabra
warned `AUDIO_STREAM_TOO_FAST`; that is the script's, not the app's.

Still to do by hand, with the owner present (it needs a microphone and the
app's own windows): the desktop app and the extension, list → preview → record
→ processing → ready → a session speaks in it → delete.

## Testing

- **Unit, client.** `voicesClient.test.ts` uses a stubbed `fetch`, like
  `check.test.ts` and Soniox's `voicesClient.test.ts`. It covers:
  - both header shapes;
  - paging;
  - normalisation, including the sample choice and the defensive
    `voice_type` filter;
  - the two-step create, and cleanup after a failed upload;
  - every error mapping.
- **Unit, source and hook.**
  - The preview decodes the sample and uses the cache.
  - The hook reads the app pair correctly. This is the regression test for
    the `readCredentials` trap.
- **Settings.**
  - Migration keeps unknown ids.
  - Labels are stored with the id.
  - The summary falls back to "Custom voice".
- **Section.** Mirrors `SonioxVoiceSection.test.tsx` with mock source
  functions. It covers:
  - list and Retry;
  - sections by language;
  - placeholder labels, including offline;
  - the second row holds built-ins only;
  - create, including bounds on recordings, the name check, the language
    select and quota withdrawal;
  - polling, both resumed on mount and stopped on unmount;
  - the auto-select guard;
  - the delete guard.
- **`VoiceCreateModal`.** The new optional language field. Existing Soniox
  tests stay green unmodified.
- **Manual, with both test credentials**, in the desktop app and in the
  extension:
  1. list;
  2. preview a built-in;
  3. record a voice;
  4. watch it go from processing to ready;
  5. a session speaks in it;
  6. a session speaks in a built-in;
  7. delete.

## Left to the builder

- File layout inside the new modules.
- How paging is cancelled on unmount.
- Poll back-off within "5 s, then 15 s, up to 15 minutes".
- Exact wording of new strings.
- Test names.

## Calls made (not the owner's)

1. **Palabra gets its own section and source interface** next to Soniox's.
   They reuse the shared `VoiceLibrarySection`, `VoiceCreateModal`, preview
   cache and WAV encoder. The Soniox-typed `VoiceLibrarySource` and
   `SonioxVoiceSection` are not generalised, so Soniox's production code stays
   untouched. A third provider with cloning is the time to extract the shared
   state machine.
2. **"The voice I hear" lists built-ins only**, as Soniox's second row does.
3. **Built-ins are grouped with the row's language first**, then "Other
   languages". Each built-in speaks one language.
4. **The sample's language is chosen in the review step**, as an optional
   field the shared dialog gains. Soniox does not use it.
5. **Every upload is WAV**, re-encoded from the decoded clip.
6. **Clips are 30–90 s and at most 10 MB.** Recordings are validated too.
   `denoise` is on for recordings and off for files.
7. **Previews play Palabra's own samples**, so they are free. The defaults
   have none.
8. **Voice labels are stored next to the ids** so the Speech rows can name any
   voice.
9. **Auto-select happens only in the mount that created the voice**, with the
   selection unchanged and no session running. A remount resumes polling but
   never auto-selects.
10. **No renaming, favorites, live mimicry or timbre detection** in this
    change.
