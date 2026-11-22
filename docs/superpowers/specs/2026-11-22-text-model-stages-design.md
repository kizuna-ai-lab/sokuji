# Text models for translation and notes — design

Date: 2026-11-22. Status: approved by the owner (2026-11-21 23:06Z, answers in §12).

## 1. Goal

A chat-completion text model, reached with the user's own key, can serve two stages:

- **Translation**, after another service's transcription. First line-ups: Soniox (own key or Kizuna AI's)
  transcribes, a text model translates, any voice the text side takes reads it.
- **Notes**: the notes written after a session and the live notes during it.

Three services, each a provider of its own:

| Provider id | Service | Key | Where |
|---|---|---|---|
| `openai_text` | OpenAI's text models | the OpenAI key the user already entered (shared with Realtime, Translate and Live) | desktop |
| `gemini_text` | Google's Gemini text models | the Gemini key the user already entered (shared with Gemini Live) | desktop |
| `openai_compatible` | any service that speaks OpenAI's chat-completions protocol (OpenRouter, DeepSeek, a local Ollama or LM Studio…) | its own address, key and model | desktop |

Out of scope: speech or transcription from these services; streaming a translation token by token; the
browser extension (its `connect-src` is an allow-list, `extension/manifest.json:119-121`); any change to
the end-to-end OpenAI and Gemini providers.

Facts this rests on, from the code map (`main` 11559cc8d):

- Notes already run on the user's own OpenAI key (`src/lib/notes/notesService.ts:14`,
  `src/lib/notes/appNotes.ts:58-63`) through one non-streaming chat completion (`src/lib/notes/chat.ts:112-145`).
- The translation stage, the shared cutter and the job translator exist (step 4): a translation-only unit
  needs only `startTranslation` built on `createJobTranslator` (`src/lib/translation/jobTranslator.ts`).
- `openai` and `gemini` are end-to-end catalog rows (`src/lib/lineup/catalog.ts:30-34`): they cannot take
  translation alone, so the text models are new ids, not new units of those providers.

## 2. Providers and keys

- Each new provider has its own folder under `src/providers/` with an `adapter.ts` that exports the
  translation session (the session-side rule requires the file, `sessionSide.consistency.test.ts:186-189`).
  That test gains the translation sessions in its walk, beside `VOICE_SESSIONS`.
- The HTTP client is shared and lives in `src/lib/textModel/` (a provider never imports another's folder).
- `openai_text` stores nothing of its own for the key: it declares `storedAt: OPENAI_KEY_STORED_AT`, so the
  one OpenAI key serves it (`src/stores/providerStore.ts:126-135`).
- `gemini_text` shares the Gemini key the same way: a `GEMINI_KEY_STORED_AT` is added and declared by both
  `gemini` and `gemini_text`.
- `openai_compatible` stores a base URL, an optional key and a model list of its own.
- Settings per provider: `translationModel` and `notesModel` (the global `settingsStore.notesModel` moves
  onto the OpenAI text provider, read from the old key once).

## 3. The HTTP client (`src/lib/textModel/`)

`chatCompletion({ service, baseUrl, apiKey, model, messages, maxTokens, json?, signal })` → `{ text }` or a
typed failure `{ code: 'auth' | 'model_missing' | 'rate_limit' | 'quota' | 'server' | 'network' | 'timeout' |
'refused', status?, message }`.

- OpenAI: `POST https://api.openai.com/v1/chat/completions`, as notes do today.
- Gemini: the OpenAI-compatible endpoint of the Gemini API (`…/v1beta/openai/chat/completions`), so one body
  shape serves all three. To be verified against Google's documentation and a real key before Part B.
- Compatible: `POST {baseUrl}/chat/completions`, sent from the Electron main process (§8).
- OpenAI-only body members (`reasoning_effort`, `max_completion_tokens`) are sent only to OpenAI; the others
  get `max_tokens`. `response_format: json_object` is sent where the service is known to take it; a 400 that
  names it is retried once without it, and the JSON is then read from the text.
- `listModels(service, …)` → model ids, from `GET …/models`. A compatible service that has no `/models` is
  not an error: the user types the model name.
- Never a credential in a frame, a log line or an error message.

## 4. Translation unit

- Unit `translation`, occupies exactly `['translation']`, `startTranslation` on `createJobTranslator`.
- **Context.** `createJobTranslator`'s `translate` gains a third argument: the last three source stretches
  of this leg with their translations. The prompt carries them as earlier turns, then the new stretch.
- **Prompt.** One system prompt per session: source and target language names, "output only the
  translation, no notes, no quotes", the session background and the word list (a new `WORD_LIMITS` row,
  `text_model`, with translations). The user's per-provider instructions (`InstructionsSettings`) are not
  used: they are written for a live interpreter.
- **Deadline.** The job translator's 20 s default. A 429 is not waited out inside a job: the job fails as
  `translation_failed` with the service's words, and the next job runs.
- **Fatal.** A 401/403, a model the service does not know, or a refused key ends the leg: the job
  translator's fatal path gains a `code`, so the run says the service's own notice (`auth`, `model_missing`)
  and targets its Accounts row.
- **Languages.** `translates(source, target)` is true for every pair of the app's languages except Auto and
  a language into itself: these models translate between any of them. The pair picker's targets are the
  app's languages, intersected as today with what the voice speaks.
- **Analytics.** `translation_model` is the chosen model; `provider` stays the transcriber's.

## 5. Catalog and composer

- Three released rows: `stages: ['translation']`, host = id, `account: 'key'`, `takesVoice: true`,
  `voiceAlone: false`. They also appear in the Notes list (§6), which is not a catalog stage.
- No composer change: the exact cover of step 4 builds `transcription` (Soniox alone) + `translation` (text
  model) + `speech`. `lineup_translation_bound` and `lineup_source_not_fixed` apply as for Bing.
- A transcriber that cannot transcribe alone is refused as today (`lineup_stage_split`). Today only Soniox
  can; this device can once its recognition is a unit of its own (§12, question 1).

## 6. Notes

- `NOTES_SERVICES` becomes `kizunaai_openai`, `openai`, `gemini_text`, `openai_compatible`. The stored id
  `openai` is kept and served by `openai_text` (no migration of stored line-ups).
- `notesChatFromStores` builds the chat port through the shared client for every own-key service; the
  Kizuna relay is unchanged.
- The notes model is the provider's `notesModel`; the default is chosen from its model list by a short
  preference list per service, shown and changeable on the Notes card.
- `writtenBy` gains `service` beside `model`, so History says who wrote the notes. Old records read as
  before.
- Live notes run on every own-key service, as they do on OpenAI today.

## 7. Readiness and the line-up page

- Each provider's check lists its models and answers ready when the models chosen for the stages it serves
  in the plan exist. The OpenAI and Gemini Live checks are untouched; a key that reaches only text models is
  ready for the text provider and "not ready" for Live, as now.
- `checkReads` includes the model settings, so changing a model re-checks.
- The Translation and Notes cards show the model select for these providers; the Accounts page gets a row for
  the compatible service (address, key, a "find models" button).

## 8. The compatible service from the main process

- Packaged Electron enforces CORS from a `file://` origin (`electron/main.js:502, 566`), and a third-party
  server need not answer it. The compatible service's requests therefore go through one IPC handler in the
  main process: `text-model:request`, which accepts only the configured base URL's `/models` and
  `/chat/completions`, with a 60 s cap and a 2 MB answer cap.
- The address must be `https://`, except `http://localhost`, `http://127.0.0.1` and `http://[::1]`.
- OpenAI and Gemini stay in the renderer, as notes are today.

## 9. Failures and notices

| Failure | Where it shows | Effect |
|---|---|---|
| Missing key / address | line-up card, Start | refused before start, links to Accounts |
| Key refused (401/403) | Start, or the session's notice | leg fails, links to Accounts |
| Model unknown | line-up card, Start | refused before start |
| 429, 5xx, network, timeout, blank answer | that sentence's notice | the next sentence goes on |

New notice codes only where an existing one does not fit (`model_missing`); each in every locale.

## 10. Testing

- Unit: the client against a fake fetch for each service (bodies, error mapping, JSON fallback); the unit
  under the translation rule suite; prompts with context and words; notes per service.
- E2E: a fake text-model server answering OpenAI's protocol in the page (as `e2e/support/openai.ts` does),
  one session Soniox-fake + text model + fake voice, one notes run per service.
- Real: own-key Soniox + each text model + Edge; notes after a session with each; the compatible service
  against one real compatible endpoint.

## 11. Parts

| Part | Work | Visible |
|---|---|---|
| A | Shared client, IPC handler, job translator context + fatal code | no |
| B | Three providers, translation units, readiness, catalog rows, page and Accounts, copy | yes |
| C | Notes on the three services, per-provider notes model, `writtenBy.service` | yes |
| D (if chosen) | This device's recognition as a unit of its own | yes |

## 12. The owner's answers

1. This device transcribing for a text model: **in this work** (Part D). This device's recognition becomes a
   unit of its own (`transcription`, occupies exactly `['transcription']`), beside the whole unit, the
   translation unit and the speech unit. A line-up that is all on this device still runs through the whole
   unit (fewest units first, as in step 4), so its timing does not change.
2. Pull requests: **stacked PRs opened directly** on kizuna-ai-lab/sokuji; the owner merges.
3. Real tests: **the owner will post temporary OpenAI and Gemini keys** in the task.

Part order: A (client) and D (this device's recognition alone) are independent and built side by side; then
B (providers and translation) on both; then C (notes).
