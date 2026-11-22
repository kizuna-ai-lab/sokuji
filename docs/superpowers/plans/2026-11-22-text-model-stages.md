# Text models for translation and notes — Implementation Plan

**Goal:** A chat-completion text model, reached with the user's own key, serves two stages: translation after another service's transcription, and the notes (after a session and live). Three providers: `openai_text`, `gemini_text`, `openai_compatible`.

**Spec:** `docs/superpowers/specs/2026-11-22-text-model-stages-design.md`. The "Decisions" sections of `2026-11-21-free-stage-combination-step-4.md` (the translation contract, the cutter, the job translator) are binding here.

**Tech Stack:** TypeScript, React, Zustand, Vitest. No new dependency.

## Global Constraints

- A line-up that runs today sends what it sends today. The end-to-end OpenAI and Gemini providers do not change.
- Public repository: no backend internals, no usage data, no machine or team names. Never a credential in a frame, a log line, an error message or a test fixture that looks real.
- Gate every push on the unit suite passing and on the type-error total not rising.

## Parts

| Part | Work | Visible |
|---|---|---|
| A | Shared client, IPC handler, job translator context + fatal code | no |
| B | Three providers, translation units, readiness, catalog rows, page and Accounts, copy | yes |
| C | Notes on the three services, per-provider notes model, `writtenBy.service` | yes |
| D | This device's recognition as a unit of its own | yes |

A and D are independent and built side by side; then B on both; then C.

## What Part A leaves for B and C

**The client** (`src/lib/textModel/client.ts`):

```ts
type TextModelService = 'openai' | 'gemini' | 'compatible';
type TextModelFailureCode = 'auth' | 'model_missing' | 'rate_limit' | 'quota' | 'server' | 'network' | 'timeout' | 'refused';
interface TextModelFailure { code: TextModelFailureCode; status?: number; message: string }
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
type TextModelTransport = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal })
  => Promise<{ status: number; text(): Promise<string> }>;
interface TextModelMemo { reasoningEffort?: string | null; responseFormat?: boolean }

chatCompletion(o: {
  service; baseUrl?: string; apiKey?: string; signal: AbortSignal; transport?: TextModelTransport;
  model: string; messages: ChatMessage[]; maxTokens: number;
  json?: boolean; temperature?: number; reasoning?: 'lowest' | 'default'; memo?: TextModelMemo;
}): Promise<{ ok: true; text: string } | { ok: false; failure: TextModelFailure }>
listModels(o: { service; baseUrl?; apiKey?; signal; transport? }): Promise<{ ok: true; ids: string[] } | { ok: false; failure }>
probeModel(o: { service; baseUrl?; apiKey?; signal; transport?; model; memo? }): Promise<{ ok: true } | { ok: false; failure }>
jsonObjectOf(text: string): Record<string, unknown> | null
textModelTimeout(message?: string): DOMException          // the abort reason that means "ran out of time"
class TextModelTransportError extends Error { code: TextModelFailureCode }
OPENAI_TEXT_BASE_URL = 'https://api.openai.com/v1'
GEMINI_TEXT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
```

**Models** (`models.ts`): `textModelIds(service, ids): string[]`, `defaultTextModel(service, ids): string | null`, `TEXT_MODEL_PREFERENCES`. **Reasoning** (`reasoning.ts`): `lowestReasoningEffort(service, model): string | null`, `takesReasoningEffort(model)`, `refusesNone(model)`. **Address** (`address.ts`): `normaliseBaseUrl(raw)`, `compatibleAddressProblem(raw): 'not_a_url' | 'not_https' | 'has_credentials' | 'has_query' | null`, `TEXT_MODEL_PATHS`. **Desktop transport** (`desktopTransport.ts`): `desktopTextModelTransport(invoke)`, `platformTextModelTransport()`, `TEXT_MODEL_REQUEST_CHANNEL`, `TEXT_MODEL_CANCEL_CHANNEL`, `TextModelIpcRequest`, `TextModelIpcAnswer`.

**The job translator** (`src/lib/translation/jobTranslator.ts`):

```ts
interface TranslatedPair { source: string; translation: string }
interface JobContext { previous: TranslatedPair[] }   // the session's last CONTEXT_PAIRS (3), oldest first
translate(text: string, signal: AbortSignal, context: JobContext): Promise<string>;
fatal?(error: unknown): boolean | { code: string };    // `{ code }` is said on `failed`
```

**The main process** (`electron/text-model-request.js`): channels `text-model:request` (`{ id?, baseUrl, path: '/models' | '/chat/completions', method, headers, body? }` → `{ status, body }` or `{ error: 'network' | 'timeout' | 'too_large' | 'refused' | 'cancelled', message }`) and `text-model:cancel` (`{ id }` → whether a request was let go).

For Part B, a translation unit's `translate` can throw an error carrying the client's failure, and its `fatal` answer `{ code }` for `auth` and `model_missing` (spec §4); its jobs share one `TextModelMemo` per session.

## Decisions made while Part A was built

**Measured 2026-11-22** (against the real services, outside the app; nothing in this part contacted a service):

- A reasoning model left at its default spends a short answer on reasoning: gpt-5-nano with 400 tokens and no `reasoning_effort` answered `''`. Turned down, all were complete and fast: gpt-5-nano 'minimal' 0.8 s, gpt-5-mini 'minimal' 1.1 s, gpt-5.4 'none' 1.0 s; Gemini's OpenAI-compatible endpoint gemini-3.8-flash 'none' 1.9 s ('low' 2.3 s), gemini-3.1-flash-lite 'none' 1.1 s; gpt-4.1-mini (no reasoning) 1.3 s.
- Gemini's OpenAI-compatible endpoints take `Authorization: Bearer <key>`: `GET /v1beta/openai/models` lists ids prefixed `models/`; `POST …/chat/completions` answers. The list holds models refused at use: gemini-2.5-flash answered 404 "This model models/gemini-2.5-flash is no longer available to new users…".
- CORS: api.openai.com and generativelanguage.googleapis.com both answer a preflight from `Origin: null` with `access-control-allow-origin: null` and allow `authorization` and `content-type`. So OpenAI and Gemini are asked from the page; the main process path is for the compatible service only.
- The lists hold many ids that are not chat text models (OpenAI: transcribe, tts, search, codex, pro, image, audio, realtime; Gemini: image, tts, embedding and more).

**The client**

- **`baseUrl` is optional, and read for `compatible` only.** OpenAI and Gemini always go to their documented endpoints, whatever `baseUrl` says, so their key is never sent elsewhere; notes and the providers need not carry an endpoint constant.
- **Reasoning: `reasoning?: 'lowest' | 'default'`, 'lowest' when absent.** 'lowest' sends OpenAI gpt-5, gpt-5-mini, gpt-5-nano (and dated snapshots) 'minimal'; gpt-5.1 and later 'none' ('low' to the two listed models the notes found refuse 'none'); the o-series 'low'; a model that does not reason (gpt-4.x, gpt-4o, gpt-5-chat-latest) nothing. Gemini and a compatible service: 'none'. 'default' sends no `reasoning_effort`.
- **A refused member is asked again, never more than needed.** A 400 whose body names `reasoning_effort` is asked again with 'low', then without it (every service). A 400 naming `response_format` from Gemini or a compatible service is asked once more without it; OpenAI takes it and is not asked again. Both may happen in one call (at most four requests). `memo` (one per session, the caller's) keeps what was learned, so later calls start from it instead of meeting the refusals again.
- **Body members by service.** OpenAI: `max_completion_tokens`. Gemini and compatible: `max_tokens`. `temperature` only when given (an OpenAI reasoning model refuses one other than its default; the caller chooses).
- **Abort vs timeout.** A caller's abort rejects with the signal's reason, before the request, during it, or as its answer lands, so the job translator's deadline and stop keep their meaning. An abort whose reason is named `TimeoutError` (what `textModelTimeout()` and `AbortSignal.timeout()` make) answers `{ code: 'timeout' }`: a caller that bounds a request itself (live notes, a check) says so by its reason. The main process's own 60-second cap also answers `timeout`. The reason is read by its name, not its class, so a DOMException of another realm counts.
- **Refusals.** 401/403 `auth`; Gemini's 400 "API key not valid" `auth`; 402 `quota`; 429 `quota` when the code or type is `insufficient_quota`, else `rate_limit` (nothing is waited out); 5xx `server`; 404, a `model_not_found` code, or words that name the model as unknown (not found, does not exist, no longer available, not a valid model…) `model_missing`; any other status `refused`, with it. A 200 that cannot be read, or holds an error and no choices, is `server`; a model's `refusal` is `refused`; a choice with no content is an empty text (the job translator says a blank answer as `translation_empty`). A network failure is `network`.
- **The service's words.** Read from `{ error: { message } }`, `{ error: '…' }`, Gemini's `[{ error }]` and plain text; a page of markup is not words (`The service answered 503.` instead). Trimmed, cut at 500 characters, the key replaced by `[key]`.
- **The model list.** `data[].id`, Gemini's without `models/`, each once. A compatible service's 404 is `{ ok: true, ids: [] }` (the user types the model); another service's 404 is `refused`. A list is no proof a model works: `probeModel` asks the model for one token ('Hi', lowest reasoning), for Part B's readiness.
- **`textModelIds` and `defaultTextModel`.** OpenAI keeps the `gpt-`, `chatgpt-` and o-series ids without transcribe, tts, search, codex, `-pro`, image, audio, realtime, embedding, moderation, instruct, computer-use or deep-research; Gemini keeps `gemini-` and `gemma-` without image, tts, embedding, audio, live, imagen, veo, aqa, robotics or computer-use. A compatible service's list is kept whole. Preferences: OpenAI gpt-5-mini, gpt-5-nano, gpt-4.1-mini; Gemini gemini-3.1-flash-lite, gemini-flash-lite-latest, gemini-3.8-flash; the first listed wins, and none listed (or a compatible service) is `null`, for Part B to decide.
- **`jsonObjectOf`** reads a JSON object from the whole text, a fenced block, or the outermost braces, for a service that took no `response_format`.
- **The notes are untouched.** `takesReasoningEffort` and the list of models that refuse 'none' moved from `src/lib/notes/chat.ts` to `src/lib/textModel/reasoning.ts`; `chat.ts` imports and re-exports them, and sends what it sent.

**The compatible service from the main process**

- **The address.** https anywhere; http only to `localhost`, `127.0.0.1` and `[::1]`; no name or password, query or fragment. The client reads it trimmed, without trailing slashes, and without a pasted `/chat/completions` or `/models`; nothing is added (an address that ends with `/v1` is used as it is, and one that does not gets no `/v1`). The page refuses before asking (`refused`, with words per problem); the main process checks again whatever it is handed. Each holds its own copy of the rule; `address.consistency.test.ts` keeps them the same over a table of addresses.
- **The channel's shape.** `{ id?, baseUrl, path, method, headers, body? }`: the path must be one of the two and its method its own (`GET /models`, `POST /chat/completions`, a body only with the POST), the headers only `Authorization`, `Content-Type` and `Accept` (no CR or LF), the body at most 2 MB, and only the main page may ask (`isMainPageSender`, as History's channels). It answers `{ status, body }` with the service's status as it came, so the client maps refusals the same way on every path, or `{ error, message }`.
- **A second channel, `text-model:cancel`.** The spec names one handler; a job given up at its 20-second deadline would otherwise keep a local server generating (and its queue held) for up to 60 seconds. The page names each request (`text-model-<n>`) and cancels it by that name when its signal aborts; the main process keys requests by sender and name.
- **Caps.** 60 seconds for the whole request, the body's reading included; 2 MB of answer, judged from `Content-Length` and again as it streams (the reading stops at the cap). A redirect is not followed: it is `refused`, with words asking for the address it names (a key is never carried to another host).
- **Words.** A service not reached is said by the system's code alone (`ECONNREFUSED`, `ENOTFOUND`), never the words around it; no answer or message repeats the key.
- **Outside the desktop app** a compatible service is `refused` ("A compatible service can be reached from the desktop app only."), without a request.

**The job translator**

- **Context.** Each job is handed `{ previous }`: the last three stretches the session translated with their translations, of any origin, oldest first, in the order the jobs ran (strictly serial, so that is the order of the leg's speech). A pair counts once its answer is had, before any listener hears it, so a listener that throws does not unmake it. A job that failed, timed out or came back blank adds nothing. Each job gets its own copy; the pairs are forgotten when the session ends. Existing units (local translation, the fake translator) ignore the third argument.
- **The fatal code: `fatal?(error): boolean | { code: string }`.** The smallest change that keeps every existing `fatal` compiling and behaving: `true` says `failed` as before (no `code` member), `{ code }` says it with the code.

**The session-side rule**

- **`TRANSLATION_SESSIONS` beside `VOICE_SESSIONS`**: `src/providers/localInference/translationSession.ts` and the fake translator's session. Neither broke a rule (no store, no reporter, no global timer).
- **The fake translator's session moved to `src/providers/fake/translatorSession.ts`.** Walked from `translator.ts`, the walk reached `provider.ts`, its settings view and the scripts, the fake's settings side, and the existing assertion that the fake's session side holds no `script.ts` failed. The session (its settings type, its fault knobs, its clock wait) now has a file of its own and `translator.ts` keeps the unit and the provider and re-exports what its importers read. No behaviour changed.

## Existing tests changed in Part A

- `src/lib/translation/jobTranslator.test.ts`: the test helper records the third argument of `translate` beside the text and the signal. No existing expectation changed.
- `src/providers/sessionSide.consistency.test.ts`: the walk seeds `TRANSLATION_SESSIONS`; the assertions about the fake's and the local provider's session sides gained the translation sessions. No existing expectation changed.
- `src/lib/notes/chat.test.ts`: untouched, and passing.

## Not verified in Part A

- No request of this code reached a real service: every test runs over a fake transport or a fake fetch. The measurements above were made outside the app.
- CORS from the packaged app itself (the preflight was measured from `Origin: null`, not from a packaged build's page).
- The main process sends with Node's `fetch`, as file recognition does: it does not follow the system's proxy settings, as Chromium's network stack (`net.fetch`) would.
- A one-token probe on every reasoning model; Gemini's `max_tokens` with thinking left on; how compatible servers take `reasoning_effort: 'none'` (some may ignore it, some may refuse it with another status than 400, which is not asked again).
- Gemini's refusal of a bad key from the compatible endpoint (mapped to `auth` from the wording of Gemini's API).
- Electron was not started: the handler's wiring in `main.js` is held by the guard tests (the channel list, the entry map, undeclared names) only. The E2E suite was not run.

## Decisions made while Part B was built

**The owner's rulings (2026-11-22 23:30Z), as built**

- **The model, per provider and per stage: `translationModel: { listed, typed }`.** `listed` is a choice from the service's own text models (`textModelIds`), `''` standing for Automatic: `defaultTextModel`, else the first text model listed. `typed` is a name typed by hand and wins when filled. A compatible service has no Automatic: its model is chosen or typed (`text_model_unset` otherwise); with no list (Part A answers `[]`) only the name is shown.
- **The reasoning, per provider and per stage: `translationReasoning: { level, typed }`**, `level` one of Off, Lowest, Low, Medium, High (Lowest by default), `typed` a value sent as it is, winning when filled. Lowest is Part A's `'lowest'`, lowered where refused (a compatible service is sent nothing). Any other choice is the client's new `reasoning: { exact }`: sent exactly, never asked again with another value, and the session's memo is neither read nor written for it. Off is `'none'`.
- **Part C adds a pair beside these**, `notesModel` and `notesReasoning`, of the same two shapes (`ModelChoice`, `ReasoningChoice`, `src/lib/textModel/choice.ts`); the check reads `checkReads` (`translationModel`, `translationReasoning`) and will read the notes' pair too.

**The providers**

- **All three are offered in the desktop app only** (`platforms: ['electron']`), as the spec's table says ("Where: desktop") and its out-of-scope list (the extension). The brief named the compatible service only; the extension's `host_permissions` lack OpenAI, and nothing was tried there.
- **The shared parts live in `src/lib/textModel/`** (a provider never imports another's folder): the session (`translation.ts`), the check (`check.ts`), the unit and its config (`unit.ts`), the prompt (`prompt.ts`), the choices (`choice.ts`), the languages (`languages.ts`), the page's model list (`modelList.ts`) and the ids (`ids.ts`). Each provider's `adapter.ts` starts the shared session for its service; it is registered in `TRANSLATION_SESSIONS`, and the session-side test holds the shared session, the client, the prompt and the desktop transport to the same rules by name (no store, no reporter, no global timer).
- **Keys.** `openai_text` declares `OPENAI_KEY_STORED_AT`. `GEMINI_KEY_STORED_AT = { key: 'gemini', fallbacks: [] }` is declared by Gemini Live and `gemini_text`: the store reads `settings.gemini.apiKey` as before (the shared path reads it without a default, then turns a non-string back into text), so a key saved before serves both with no migration. `openai_compatible` keeps `baseUrl` (required, held to `compatibleAddressProblem`, refused as `address_missing` / `address_invalid`) and `apiKey` (optional: `CredentialField.optional`, which the line-up page, the Accounts row and the credential form skip) under `settings.compatibleText.*`, not `openaiCompatible`: that prefix is the retired OpenAI Compatible's, whose key was for another endpoint.
- **The retired OpenAI Compatible's id.** A stored `settings.common.provider` of `openai_compatible` used to name nothing offered. It now names a provider that only translates, so a load picks among the providers whose option serves every stage (`runsByItself`, the catalog's), and the wizard among those that run a session by themselves (`runsAlone`, the units'): such a selection still falls to the first provider offered.
- **Their own `languages`** are the app's common languages (`LANGUAGE_PRIORITY`), read only where nothing else answers (the entry's pair, the registry's checks): a run's offer is the transcriber's.

**The session**

- **The prompt.** One system prompt per leg: the two languages by their English names (`englishLanguageName`), "answer with its translation … and nothing else: no notes, no explanations, no quotation marks", the earlier turns are context only, an incomplete stretch is translated as it stands; then the background, the terms to keep and the translations to use (`text_model` row: 100 entries, 1,000 characters of background). Earlier turns: the job's `previous` pairs as user/assistant messages, then the stretch. A `<think>…</think>` block a local reasoning model writes first is dropped.
- **The budget (`maxTokensFor`):** 1,024 tokens where the model reasons not at all or minimally; 2,048 for `low`; 4,096 for `medium`, and for a compatible service at Lowest (sent nothing, it reasons as it likes); 8,192 for `high` or a typed value. OpenAI counts reasoning in `max_completion_tokens`.
- **Temperature 0.2 only where safe (`translationTemperature`):** OpenAI's models that do not reason (gpt-4.x, gpt-4o, a `-chat` model), Gemini before 3 and Gemma. None to OpenAI's reasoning models (they refuse it), to Gemini 3 and later (Google asks that they keep their own) or to a compatible service.
- **Fatal: `auth`, `model_missing` and `quota`.** Quota was the brief's open question: an account out of credit fails every next sentence too, so the leg ends with one notice instead of a stream of them. Everything else (429, 5xx, network, a deadline, any other refusal, a blank answer) is that sentence's `translation_failed`, in the service's words. The deadline is the job translator's 20 s.
- **The run names the provider of a stage refused for its account.** A `failed` of the three-unit leg whose stage is another provider's and whose code is `auth` or `quota` gets `params.provider` from the run (`namingItsProvider`); the adapter contract's `failed` gained an optional `params`, which L1 and the run's notice read (as a give-up's params before). `auth` and `quota` lead to the named provider's row in Accounts and keys only when a provider is named, so the end-to-end providers' notices of those codes offer nothing, as before.

**Readiness**

- **The check** lists the models (bounded 15 s, its own timer on the check's clock), resolves the model as the build does, and asks it once with the chosen reasoning (`probeModel`, extended to take the choice). Codes: `auth` and `quota` (naming the provider), `model_missing` (also a key that lists no text model), `rate_limit`, `server`, `refused` (a reasoning value or any other 400, worded by an alias of `client`: "The provider rejected the request: …"), and `text_model_unset`. The check answers these rather than throwing, so the card and Start say them in every locale. A service not reached, or not answering within the bound, is no answer (review of #853): the check throws in the failure's words, as `Provider.check` asks, and the store shows a check that could not find out: "Key not verified" on the card and the row, the words in the credential form and in Start's `not_ready`, the last models kept. Ready answers the key's text models, which the build resolves Automatic from (`shared.models`).
- **New notice words, in thirty locales:** `model_missing`, `quota`, `text_model_unset`, `address_missing`, `address_invalid`; targets: the address codes to the provider's row, `model_missing` and `text_model_unset` to the line-up (where the model is chosen). `address_missing` and `address_invalid` are account codes, named like `credentials_missing`.

**The catalog and choosing**

- **Three rows:** `stages: ['translation']`, host = id, `account: 'key'`, `takesVoice: true`, `voiceAlone: false`, no `joint`, no `translatesOwn`. The compatible row is in the catalog everywhere (the invariants want every released provider); off the desktop its provider is not present, so the page lists it nowhere and a stored line-up naming it is `lineup_not_offered`.
- **The `choose` rule: a host that serves some stages only takes this device's defaults for the others (`hostDefaults`).** Choosing a text model for translation where the transcriber is an end-to-end provider (whose stages go together) moves transcription to this device's recognition and speech to Edge: free, no key, no sign-in, and composed as this device's recognition unit (Part D), the text model, and this device's speech unit. Under Soniox (either) or this device, the transcriber and the voice stay, as for Bing. This also gives the E2E build's one-stage fakes defaults (step 4's open risk).
- **The reachable line-ups** whose transcription and translation are apart are now Soniox (either) under Bing or this device, and Soniox (either) or this device under any of the three text models, each with any voice the text side takes; none reachable is refused by the composer.

**Languages**

- **No change to `planLanguages`:** with a translator whose `translates` takes any two languages, the sources are the transcriber's but the automatic one, and the targets the transcriber's own for the source, less the source. The targets cannot be wider than the transcriber's list: the provider store keeps the pick within the transcription provider's own offer (Part D's finding). For Soniox that is its sixty languages, Basque and the others Bing lacks included; for this device, its list. The voice's languages are intersected on the page as before; an automatic source is `lineup_source_not_fixed`, naming the text model.

**The page**

- **The Translation card**, under its provider's options fold: the model select (Automatic first, then the service's text models; a model chosen before that the list no longer holds stays shown), the name field (the select is set aside while it is filled), the reasoning select and the value field. The list is the page's own (`textModelList`: one kept per service and address, for the key it was asked with, known by a digest of it and never the key; asked afresh each time the card opens and by "Find models"; meanwhile the check's ready models, when that check was made with the same key and address), so another model can be chosen while the chosen one is refused. The card's state: "Needs a key" / "Needs an address" (to the provider's row), "Key not accepted" (to the row), else "Not ready" with the check's words under it.
- **A compatible service with no address may be chosen** (its card says "Needs an address" and leads to its row), where a provider with no key is held back in the list: its address is the first thing entered after it is chosen.
- **Accounts:** one row per key. OpenAI's row also serves `openai_text` and Gemini's `gemini_text`; their tags gain "Translation" (no new words). The compatible service's row: address, optional key, Check, and Find models (the count, the first twelve ids, "lists no models", or the refusal in the service's words). The Words page names the `text_model` row by the three providers' names.

**New copy keys (English):** `providers.openai_text.name` "OpenAI text model", `.description` "Translates any language pair with your OpenAI key"; `providers.gemini_text.name` "Gemini text model", `.description` "Translates any language pair with your Gemini key"; `providers.openai_compatible.name` "OpenAI-compatible service", `.description` "OpenRouter, DeepSeek, Ollama and others, at the address you enter"; `notices.model_missing`, `notices.quota`, `notices.text_model_unset`, `notices.address_missing`, `notices.address_invalid` (as in `NOTICE_WORDS`); `setup.credentials.baseUrl` "Address", `.baseUrlPlaceholder` "Address, such as https://openrouter.ai/api/v1", `.apiKeyOptional` "API key (optional)"; `settingsPage.textModel.automatic` "Automatic", `.automaticModel` "Automatic ({{model}})", `.chooseModel` "Choose a model", `.modelName` "Or type a model name", `.off` "Off", `.lowest` "Lowest", `.reasoningTooltip`, `.reasoningValue` "Or type a value, sent as it is", `.listing` "Finding models…", `.listEmpty` "This service lists no models: type the model's name."; `settingsPage.lineup.state.needsAddress` "Needs an address", `.notReady` "Not ready"; `settingsPage.accounts.findModels` "Find models". Reused: `settings.model`, `settings.reasoningEffort`, `settings.low/medium/high`, `settings.modelsFound`, `notices.client`.

## Existing tests changed in Part B

- `src/lib/lineup/catalog.test.ts`: "runs every host's defaults on that host" holds for hosts that serve every stage; a one-stage host runs beside this device.
- `src/lib/lineup/choose.test.ts`: the reachable separate line-ups gain this device and the two Soniox under the three text models.
- `src/providers/localInference/provider.test.ts` (Part D's "no released line-up changes"): line-ups that ran still run the same, and the ones that newly run are exactly this device transcribing for a text model under each voice that stands alone; the reworded refusals gain a text model beside an end-to-end voice.
- `src/providers/registry.test.ts`: the release order and `checkReads` list the three.
- `src/providers/openai/provider.test.ts`: "OpenAI Compatible is registered nowhere" is now "nowhere as a provider that runs a session", and the stored selection is read among the providers that run by themselves.
- `src/providers/palabraai/provider.test.ts`: Palabra sits last of the providers that run a session by themselves.
- `src/stores/lineUpStore.test.ts`: the retired id's comment says why it still falls to the first provider.
- `src/components/SettingsPage/AccountsCategory.test.tsx`: the rows matching "OpenAI" are OpenAI's and the compatible service's. `WordsCategory.editing.test.tsx`: seven word-list services.
- `src/providers/sessionSide.consistency.test.ts`: the three text-model folders and the shared session's files are walked.

## Not verified in Part B

- No request reached a real service: every test runs over a fake transport, a fake fetch or the E2E build's fake in the page. The E2E specs and the two `@real` cases were written and type-checked, not run.
- The prompt's wording was not measured against real models (quality, or a model that answers with notes or quotes anyway); nor the budgets, nor whether gpt-5.1-and-later models at reasoning `none` would take a temperature (none is sent).
- A compatible service's model list: some list embedding or other non-chat models, which the select offers as they come.
- The model list on the page is asked from the page directly for OpenAI and Gemini (CORS measured in Part A from `Origin: null` only).
- The setup wizard's line "This one key serves OpenAI Realtime, Translate and Live" does not name the text models: left, so as not to retranslate it.
- The twenty-nine non-English translations of the new strings were not reviewed by native speakers.

## Decisions made while Part C was built

**Settings and the old notes model**

- **Per provider, beside the translation's: `notesModel: { listed, typed }` and `notesReasoning: { level, typed }`** (`settings.openaiText.*`, `settings.geminiText.*`, `settings.compatibleText.*`), the shapes of Part B. Defaults: Automatic, and Medium. The check reads them (`TEXT_MODEL_CHECK_READS` gains both), so a change of either checks again.
- **The old global `settings.notes.model`** (chosen in History and notes; default `gpt-6-luna`) is read by OpenAI's text model's `migrate` through `legacyKeys` while `settings.openaiText.notesModel` was never stored: nothing stored, a value that is not a name, or the default is Automatic; one of the old list (`gpt-6-luna`, `-astra`, `-sol`, `gpt-6.1-sol`, `-terra`) is `listed`; anything else (typed under Other) is `typed`. Nothing is written back, and nothing writes the old key any more, so reading it at every load until the user chooses is the one migration. The old default is kept as OpenAI's notes default: it is a real OpenAI model id (the notes were measured with it on OpenAI's own endpoint with an own key; the old notes tests record two of its series refusing `none` there), and the relay asks OpenAI for the same id. So it heads OpenAI's notes preferences, and a user who never touched the setting writes with it as before wherever the key lists it, and with it when no list can be read.
- **The notes' Automatic has its own preferences** (`NOTES_MODEL_PREFERENCES`): OpenAI `gpt-6-luna`, then the translation's (`gpt-5-mini`, `gpt-5-nano`, `gpt-4.1-mini`); Gemini `gemini-3.8-flash`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest` (the stronger flash first: notes are not real time). The first one the key lists wins, else its first text model. At notes time the list is the page's own (`textModelList`, asked once per key, bounded 15 s); with no list to read (the service out of reach, the key refused), the first preference, and the request then says what is wrong. A compatible service has no Automatic: with no model chosen the notes fail as `notes:no-model`, and the Notes card says `text_model_unset` before.

**The reasoning (the rule for the default)**

- **Medium, the notes' default, stands for the notes' own measured levels**, the most of which is medium: each part `low`, the finishing call `medium`, the names step `medium`, each live update `low` (`write.ts`, `live/loop.ts`, the owner's 2026-11-18 measurements). Sent per service: OpenAI exactly as the notes always sent it, only to the models that take a `reasoning_effort` (`takesReasoningEffort`, `low` for `none` to the two that refuse it), nothing to any other, so a line-up that wrote notes before sends what it sent (the plan's global constraint); Gemini the call's own level; a compatible service nothing (its model is unknown; an unexpected member may fail every request).
- **The default is lowered where refused; nothing else is.** The client's new `reasoning: { preferred }` sends the value and, on a 400 that names `reasoning_effort`, asks again with `low`, then without one, as the lowest is lowered. The run's memo keeps, per value asked, what it was lowered to (`memo.preferredEffort`, review: a lowered `medium` was otherwise refused again on every call, live notes every 20 s), and a `low` refused on the way down as refused, so a later default above it goes straight to none; a value taken as it is teaches nothing. It is apart from the lowest's `reasoningEffort`: neither reads the other's. Any other level (Off, Low, High) and any value typed is sent exactly to every call, never asked again with another; the Notes card's check asks the model with it, so a refusal is said in the service's words before the notes are asked. Lowest stays Part B's lowest (the least the model takes). Medium chosen from the list is the default: the list cannot tell a Medium chosen from the default it already shows, and choosing it is going back to it. A user who wants `medium` on every call types it (typed `medium` is exact).
- **The check asks the default with the lowest** (`notesProbeAsk`): a default cannot be refused, so the check asks only whether the model answers.

**Budgets**

- Each call keeps its own budget (parts 32,000, finishing 12,000, names 8,000, live 2,500), which already leaves its own level room (OpenAI counts reasoning in it), plus Part B's room for the level asked beyond the call's own (`maxTokensFor` less the answer's 1,024: low 1,024, medium 3,072, high or a typed value 7,168). So: the default as before; a part at Medium 34,048, at High 38,144; the finishing call or the names step at High 16,096 / 12,096; a live update at Medium 4,548, at High 8,644. A compatible service at the default is sent nothing and reasons as it likes: the room of Medium (a part 34,048, a live update 4,548), as Part B gives its Lowest.

**The chat port** (`src/lib/notes/textModelChat.ts`)

- **One port for the three own-key services over the shared client**, `json: true`, the notes' prompts and payloads unchanged (the system prompt, the user's part as compact JSON). One port per run, so one memo per run: `notesChatFromStores` is called once per after-session version and once per live loop. Its answer is read with `jsonObjectOf` after a leading `<think>…</think>` is dropped (a service that took no `response_format` may wrap its JSON).
- **Waits.** A 429 that is not `insufficient_quota` is still waited out, 15 s longer each time, four times, now on a clock the port is given (`wait(ms, signal, clock)`, the real one in the app); the relay's waits are unchanged. Live notes keep their 20 s: the loop's own timeout aborts the request and any wait.
- **Failures.** With the service's status: its own words (a refusal whose only words are the client's `The service answered N.` is said by its status, `notes:refused:N`, as before); final (not tried again) for 400, 401, 403, 404 and for `auth`, `quota`, `model_missing` whatever the status (Gemini's refused key is a 400; 402 is quota). Without one: `notes:network`, `notes:timeout` (new: the main process's minute for a compatible service), an answer that cannot be read `notes:no-answer`, and a refusal before any request (a compatible service's address, the desktop app only) in its words, final.
- **`openAiChat` is retired**: its one caller moved. `chat.ts` keeps the port's contract, `ChatError`, the relay's body (`chatBody`), `answerOf` and the wait; the relay is untouched.
- **Request ids** of an own-key version are now the completion's own id from the answer's body (`chatcmpl-…`), not the `x-request-id` header the client does not read; nothing but the stored version reads them.

**Services and the line-up**

- **`NOTES_SERVICES`**: `kizunaai_openai`, `openai` (served by `openai_text`: its key, settings and check), `gemini_text`, `openai_compatible`; the last two are a choice only where Gemini's text model is offered (the desktop app). Default: Kizuna AI where offered and signed in, else OpenAI once keyed (the key read from `openai_text` or `openai`), else Gemini once keyed (`gemini_text` or `gemini`), else the one to set up as before; a compatible service never.
- **Readiness for the notes is the provider's own check told about the notes** (`CheckContext.notes: true`, `stages: []`): the key, then the notes' model with `notesProbeAsk`. A check told `stages` without `translation` no longer asks the translation's model; one told nothing asks it as before. The notes' answer is kept apart from the run's readiness (`src/components/SettingsPage/notesReadiness.ts`): notes are no run stage, so what they lack never holds back Start, and a provider that also translates keeps its own answer for that. The Notes card asks it while shown and not during a session (as it asked OpenAI's before): at once, then 800 ms after the notes' model, reasoning, key or address last changed; an answer is kept for the inputs it was given, but one that could not reach the service, or a check that threw, is asked again the next time the card is shown. The inputs hold a 53-bit fingerprint of the credentials, never a key (review: a second copy of every key in memory otherwise). The sign-in is not among them, though the review asked for it: the card gives this check only the services with the user's own key, whose `credentials.read` takes no sign-in, and a text model's check is told none, so a sign-in change cannot change its answer and would only send the key again; Kizuna AI's state on the card is the sign-in itself, not this check. A test holds that.
- **The Notes card**: Kizuna AI, OpenAI, Gemini text model (once its key is there), OpenAI-compatible service (always, where offered: its address is entered after it is chosen, as on the Translation card); each stays listed while chosen. The state reads the notes' answer as a stage's does ("Needs a key" / "Needs an address" to the row, "Key not accepted", "Checking the key…", "Not ready" with the service's words under the choice, "Ready"), the link to the notes service's account row. "<service> options" folds the Translation card's controls for the notes' fields (`TextModelSettingsView` with `stage: 'notes'`, fields with ids of their own). The hints about an OpenAI key show only where OpenAI or Kizuna AI would write the notes; Gemini's text model with no key and a compatible service with no address have hints of their own (review).
- **Live notes** run on every own-key service through the same port: no change was needed in the session (it already asks `notesChatFromStores`).

**History**

- **`writtenBy.service`** beside `model`; older versions have none and read as before. The record's notes show "Written by <service> with <model>" under the title where it is kept (nothing showed the writer before). The export prints no writer and is unchanged.
- **History and notes**: the notes model select is retired with the global setting; for Kizuna AI the line naming its model stays; for an own-key service the row says the model is chosen on the Notes card and opens Languages and line-up. Gemini and a compatible service are named in its sentences and in the once-only explanation.

**New copy keys (English):** `history.notesFailure.timeout` "The notes service did not answer in time.", `history.notesFailure.no-model` "No notes model is chosen. Choose one on the Notes card of Languages and line-up.", `history.notesWrittenBy` "Written by {{service}} with {{model}}", `history.notesModelLineUp` "Chosen with the notes service, on the Notes card of Languages and line-up.", `settingsPage.lineup.notesGeminiLine` "Writes the notes with your own Gemini key.", `settingsPage.lineup.notesCompatibleLine` "Writes the notes with the service at the address you enter.", `settingsPage.textModel.notesReasoningTooltip` "Medium, the default, asks each step of the notes for the reasoning it was tested with: Low for each part and for the live notes, Medium to finish them, and less where the model takes less. Any other choice, or a value typed, is sent exactly as it is with every request: if the model refuses it, the Notes card says so." Added after review: `settingsPage.lineup.notesNeedGeminiKey` "Add a Gemini key in Accounts and keys to have notes written.", `settingsPage.lineup.notesNeedAddress` "Add the compatible service's address in Accounts and keys to have notes written." Removed with the History select: `history.notesModelLine`, `history.notesModelOther`, `history.notesModelName`. Reused: `providers.gemini_text.name`, `providers.openai_compatible.name`, `settingsPage.lineup.options`, `history.file.openSettings`, `settingsPage.categories.lineup`.

## Existing tests changed in Part C

- `src/lib/notes/chat.test.ts`: `openAiChat` is retired; the test now holds what `chat.ts` keeps (the relay's body and its reasoning rule, `answerOf`, which refusals are final, the wait on a clock). The own-key cases (endpoint, key, waits, quota, cancel, request id) moved to `textModelChat.test.ts`, against the shared client.
- `src/lib/notes/relayChat.test.ts`: the relay's body is compared with what the own-key port sends for the relay's model with the default reasoning, instead of `openAiChat`'s.
- `src/lib/notes/appNotes.test.ts`: the notes read OpenAI's text model's entry (key, notes model, reasoning), not OpenAI Realtime's and the global setting; Gemini and a compatible service added.
- `src/lib/notes/notesService.test.ts`: `NotesDefaults` gains `geminiKeyed` and `textModelsOffered`.
- `src/components/SettingsPage/HistoryCategory.test.tsx`: the model select's three cases replaced by the row that leads to the Notes card; the desktop environment mocked (`getEnvironment`) so Gemini's text model is offered.
- `src/components/SettingsPage/LineUpCategory.test.tsx`: the notes card's check is the notes' own (`useNotesReadiness`, mocked here and tested in `notesReadiness.test.tsx`), not OpenAI Realtime's `refreshReadiness`; the "already checked" case moved there; the option lists gain the compatible service; the OpenAI key is set in both entries, as the app loads it.
- `src/components/SettingsPage/OpenAIKeyStatus.test.tsx`: "the notes card reuses the answer Accounts and keys got" no longer holds: the card asks OpenAI's text model about the notes (its model too), apart from the Realtime check; the two notes-card cases say that.
- `src/app/session.test.ts`, `src/app/session.quit.test.ts`: the live notes' key and notes model are OpenAI's text model's entry (a model chosen, so no list is asked).
- `src/lib/textModel/unit.test.ts`, `src/providers/registry.test.ts`, `src/providers/openai_compatible/provider.test.ts`: the settings and `checkReads` gain the notes' pair.
- `e2e/specs/notes-openai.spec.ts`: the key's model list is asked once before the chat requests (Automatic), and the model is the old default.

## Not verified in Part C

- No request reached a real service: the unit tests run over fake transports and stubbed fetches; the E2E specs (`notes-text-model.spec.ts`, the changed `notes-openai.spec.ts`) and the two `@real` cases (`real-notes-text-model.spec.ts`) were written and type-checked, not run.
- Whether `gemini-3.8-flash` and the other preferred models take `reasoning_effort` `low` and `medium` on Gemini's OpenAI-compatible endpoint (they are lowered if refused), and whether Gemini's `max_tokens` counts thinking as OpenAI does; the notes' quality with any model but `gpt-6-luna`.
- A compatible service writing the notes: the main process gives a request 60 s, and a local model writing a twenty-minute part may take longer (`notes:timeout`); the cap was not raised.
- The notes' requests ids changed form for own-key versions (the completion's id); nothing reads them today.
- The twenty-nine non-English translations of the new strings were not reviewed by native speakers.
