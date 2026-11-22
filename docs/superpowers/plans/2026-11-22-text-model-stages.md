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
