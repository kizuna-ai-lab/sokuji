# OpenAI GPT-Live-1 in the API — primary-source research

Research date: 2026-09-12. Primary sources only (openai.com, developers.openai.com — the
new home of platform.openai.com/docs, which now 301-redirects there —, the GPT-Live system
card on deploymentsafety.openai.com, the openai-node / openai-python repositories, the npm
registry, and learn.microsoft.com / techcommunity.microsoft.com for Azure). Third-party
write-ups were used only to locate primary pages. Every claim cites the URL it came from;
verbatim quotes are in quotation marks. Anything not confirmed on a primary page is marked
**UNVERIFIED**.

## Summary

- **GPT-Live-1 is not a Realtime API model.** Its model id is `gpt-live-1` (single alias,
  no dated snapshot, no mini in the API) and it is exposed only through a **new Live API**
  at `v1/live/sessions` (WebSocket `wss://api.openai.com/v1/live/sessions`, WebRTC via
  `POST /v1/live/sessions`, SIP, plus a sideband WebSocket). The model page marks
  `v1/realtime`, `v1/responses` and `v1/chat/completions` as "Not supported".
- Announced and **generally available on September 10, 2026**.
- It is a **full-duplex** speech model (listens while speaking) that does no reasoning or
  tool calling itself: it **delegates** to a backend (a hosted Responses model such as
  GPT-5.6 Terra/Luna or GPT-6 Astra, or your own agent via "client delegation").
- **Pricing is per minute of session time, not per token: $0.05/min, billed per second**,
  backend tokens billed separately. Realtime models stay token-priced (gpt-realtime-2.1:
  audio $32 in / $0.40 cached / $64 out per 1M; text $4 / $0.40 / $24).
- **Deprecations (separate notice, July 20, 2026):** `gpt-realtime`, `gpt-4o-realtime`,
  `gpt-realtime-mini`, `gpt-4o-mini-realtime` and the `gpt-audio` family shut down on
  **January 20, 2027** (replacements `gpt-realtime-2.1` / `gpt-realtime-2.1-mini`). The
  `gpt-4o-*-realtime-preview` models already shut down on May 7, 2026.
- **Translation:** the announcement does not mention translation; the Live prompting guide
  ships a verbatim "interpreter" prompt template ("[language] ONLY. NEVER DELEGATE …
  Translate user speech into [language]"). OpenAI's dedicated product for this is still the
  Realtime API's `gpt-realtime-translate` ($0.034/min, `/v1/realtime/translations`). The
  Live API has **no language parameter, no turn-detection/VAD settings, no image input**;
  the 12 new voices are English and Brazilian Portuguese only.
- **SDKs:** openai-node 7.14.0 and openai-python 3.12.0 (both 2026-09-10) "Add Live API"
  and type `'gpt-live-1'`. The `openai-realtime-api` npm fork is at 1.0.8 (2025-07-18) and
  knows only `gpt-4o-realtime-preview-2024-10-01`.
- **Azure:** a Microsoft Foundry blog post dated 2026-09-10 says GPT-Live-1 is "available
  today in Microsoft Foundry" at "$3.00 per hour", but learn.microsoft.com's model tables
  and the Foundry catalog page did not list it at fetch time.

---

## 1. What "GPT Live 1" is: model id, API surface, status, date

**Model id.** "Model ID: `gpt-live-1`" and "Default snapshot: `gpt-live-1`"
(https://developers.openai.com/api/docs/models/gpt-live-1). The rendered page says
"Use `gpt-live-1` in your API requests." and lists a single snapshot entry, `gpt-live-1`
— **no dated snapshot** (same URL). The models index card reads "GPT-Live 1 Our premier
model for natural, expressive voice conversations with smooth interruption handling."
(https://developers.openai.com/api/docs/models).

**No mini variant in the API.** The ChatGPT launch post says "We're beginning to roll out
two versions of GPT‑Live – **GPT‑Live‑1** and **GPT‑Live‑1 mini** – to ChatGPT users
globally today." (https://openai.com/index/introducing-gpt-live/, published July 8, 2026
per the page's date line) and the system card names "GPT-Live-1 and GPT-Live-1 mini"
("Published July 8, 2026", https://deploymentsafety.openai.com/gpt-live). But the API
models index, the model page, and both official SDKs (see §6) expose only `gpt-live-1`.
No `gpt-live-1-mini` / nano id exists on any primary page fetched.

**API surface — a new Live API, not Realtime.** The model page's endpoint table
(https://developers.openai.com/api/docs/models/gpt-live-1.md):

| Endpoint | Path | Support |
| --- | --- | --- |
| Live | `v1/live/sessions` | Supported |
| Chat Completions | `v1/chat/completions` | Not supported |
| Responses | `v1/responses` | Not supported |
| Realtime | `v1/realtime` | Not supported |
| Realtime translation | `v1/realtime/translations` | Not supported |
| Realtime transcription | `v1/realtime/transcription_sessions` | Not supported |

Conversely every Realtime model page shows "| Live | `v1/live/sessions` | Not supported |"
(e.g. https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md).

Transports (https://developers.openai.com/api/docs/guides/live):
- "**WebRTC** for browser voice applications. Media tracks carry audio; a data channel
  carries JSON events."
- "**WebSockets** for server-side audio integrations. The primary socket carries audio and
  control events."
- "**Server-side controls** for backend access to an existing session. A sideband
  connection carries events while audio stays on the primary connection."
- "**Telephony and SIP** for phone integration paths and provider guidance."

WebSocket details (https://developers.openai.com/api/reference/resources/live/primary-websocket):
"`wss://api.openai.com/v1/live/sessions`" … "No query parameters. After connecting, send
session.start with your model and session configuration. Wait for session.started before
sending audio." The model goes in the payload: "The Live model. Required in the session
configuration for every transport; do not pass it as a URL query parameter." The
WebSocket guide adds "GPT-Live does not use Realtime's input-buffer commit and
response.create voice-turn loop" (https://developers.openai.com/api/docs/guides/voice-websockets?api=live).

WebRTC (https://developers.openai.com/api/docs/guides/voice-webrtc?api=live): "Your browser
creates a Session Description Protocol (SDP) offer. Your application server exchanges it
for an answer with `POST /v1/live/sessions`, using the project API key." Data channel is
`oai-events`; "The HTTP request starts the session. Do not send `session.start` on the
data channel."

SIP (https://developers.openai.com/api/docs/guides/voice-sip?api=live):
`sip:$PROJECT_ID@sip.api.openai.com;transport=tls` (EU: `sip-eu.api.openai.com`); inbound
webhook `live.transport.incoming` (deprecated alias `live.call.incoming`); accept with
`POST /v1/live/sessions/{session_id}/accept` with `"model": "gpt-live-1"`. Outbound calls
go through partner integrations (LiveKit, Twilio, Telnyx, Daily/Pipecat —
https://developers.openai.com/api/docs/guides/live-partner-integrations, which also warns
"A Realtime integration is not automatically compatible with GPT-Live.").

Other Live endpoints (SDK method list, https://github.com/openai/openai-node/blob/master/src/resources/live/api.md):
`POST /live/sessions`, `POST /live/sessions/{id}/accept|reject|hangup|refer|fork`,
`GET /live/sessions/{id}/content` (recording download). Fork over WebSocket:
`wss://api.openai.com/v1/live/sessions/{source_session_id}/fork`
(https://developers.openai.com/api/docs/guides/live-conversations).

**Status: GA.** Changelog, September 10, 2026: "GPT-Live 1 is now generally available in
the API. Build full-duplex voice conversations that can continue while a backend model or
agent handles reasoning and tools." (https://developers.openai.com/api/docs/changelog).
Announcement: "GPT‑Live‑1 is available in the API today at $0.05 per minute for the
front-end voice layer." (https://openai.com/index/introducing-gpt-live-1-in-the-api/).

**Announcement date: September 10, 2026.** The announcement page's HTML carries the date
strings "Sep 10, 2026" / "September 10, 2026"
(https://openai.com/index/introducing-gpt-live-1-in-the-api/), matching the changelog
entry above and the SDK releases of the same day (§6).

**Rate limits** are "measured in concurrent sessions": Free "Not supported", Tier 1 25,
Tier 2 50, Tier 3 200, Tier 4 300, Tier 5 500
(https://developers.openai.com/api/docs/models/gpt-live-1).

---

## 2. How it differs from the Realtime models

### Architecture
- Announcement: "Interruption handling: Improves interruption handling via a single model
  that reasons over incoming and outgoing audio together, avoiding the latency and brittle
  handoffs of chained STT–LLM–TTS architectures." … "GPT‑Live‑1 can delegate reasoning and
  tool calls to a backend text model like GPT‑6 Astra or a third-party model."
  (https://openai.com/index/introducing-gpt-live-1-in-the-api/)
- Voice-agents guide comparison table (https://developers.openai.com/api/docs/guides/voice-agents):
  GPT-Live — "Full-duplex conversations with a separate backend" / "Keep your existing
  text workflow and choose its backend independently while the conversation continues.";
  Realtime API — "Speech, reasoning, and tool use in one session" / "Use one model to
  interpret audio, decide what to do, and respond in speech."
- Live guide: "You choose the backend model or agent independently of the voice model;
  Realtime uses one model for speech, reasoning, and tool selection."
  (https://developers.openai.com/api/docs/guides/live)
- The Realtime getting-started page now points across: "For full-duplex conversations with
  a separate delegated backend, see GPT-Live." (https://developers.openai.com/api/docs/guides/realtime)

### Latency / quality claims (announcement, https://openai.com/index/introducing-gpt-live-1-in-the-api/)
- "Across our evaluations, GPT‑Live‑1 improves Full Duplex Bench performance by 30
  percentage points over GPT‑Realtime‑2.1, with large gains in turn-taking latency and
  interactive behavior. Paired with GPT‑6 Astra at medium reasoning effort, it also ranks
  #1 on Tau3, which measures frontier voice-agent intelligence on end-to-end tasks."
- "in early evaluations, Speak found that GPT‑Live‑1 gave learners more time to think
  before the language tutor responded, cutting interruptions by almost 80% versus previous
  turn-based systems."
- No absolute latency numbers (ms) are given on any primary page. **UNVERIFIED**: any
  absolute latency figure.

### Instruction following / transcripts / turn detection (announcement)
- "Tone, pace, and style: Lets developers shape an agent's tone, pace, and conversational
  style through the system prompt."
- "Silent context management & background noise: Better handles background noise and
  silence without interrupting the conversation or narrating every step out loud."
- "Long-session reliability: Improves context retention and conversational quality across
  extended interactions."
- "GPT‑Live‑1 natively provides ASR transcripts and response text. It also offers strong
  alphanumeric understanding and supports keyword biasing. Although GPT‑Live‑1 is not a
  turn-based model, it natively supports turn detection, so developers can continue to
  build around explicit turn boundaries."
- **UNVERIFIED**: how "keyword biasing" or "turn detection" are exposed — no
  `turn_detection`, keyword, or language field exists in the Live `session.start` schema
  (https://developers.openai.com/api/reference/resources/live/primary-websocket).

### Function calling
GPT-Live-1 does not call tools directly. Two delegation modes
(https://developers.openai.com/api/docs/guides/live-delegation):
- Responses delegation: `"delegation": {"type": "responses", "responses": {"model":
  "gpt-5.6-terra", "instructions": …}}`; supported settings "`model`, `instructions`,
  `tools`, `tool_choice`, `parallel_tool_calls`, `max_output_tokens`, `service_tier`,
  `reasoning`, and `text`". Recommended backends: "Start with GPT-5.6 Terra, or try GPT-5.6
  Luna for cost-sensitive workloads." Tool calls surface as `response.event` wrapping
  `response.output_item.done`; results go back with `response.item.create`
  (`function_call_output`) then `response.create`.
- Client delegation: `"delegation": {"type": "client"}`; the server emits
  `session.delegation.created` (metadata only, "without raw audio, task text, or parsed
  tool arguments" — https://developers.openai.com/api/docs/guides/live-migration) and the
  app feeds results back with `session.thinking.append` / `session.commentary.append` /
  `session.instructions.append`, each "plain-string `content` of up to 500 tokens"
  (https://developers.openai.com/api/docs/guides/live-conversations).
- The model page lists "Function calling: Supported", "Structured outputs: Not supported"
  (https://developers.openai.com/api/docs/models/gpt-live-1).

### Session parameters (Live) vs Realtime
Live `session.start` / creation fields (https://developers.openai.com/api/reference/resources/live/primary-websocket
and https://github.com/openai/openai-node/blob/master/src/resources/live/live.ts):
`model` (required), `instructions` ("Limited to 16,384 client-supplied tokens … Immutable
after startup."), `input` (prior text history, "at most 128 messages and 8,192 rendered
tokens in total"; roles developer/user/assistant, no `system`), `audio.format` (WebSocket
only: `audio/pcm` at 16000 or 24000 Hz, `audio/pcmu` and `audio/pcma` at 8000 Hz),
`audio.output.voice` (default `marin`, immutable), `delegation` (`client` | `responses` |
null), `store` (recording/fork, default false), `client.data_channel` permissions for
untrusted WebRTC frontends. "The startup fields `model`, `instructions`, `input`, `audio`,
and `store` are not accepted update fields." (live-conversations).

**Absent from Live** (present in Realtime): `turn_detection` / VAD modes,
`noise_reduction`, `output_modalities`, input-transcription model selection, image input
(model page: "Image Not supported", "Video Not supported";
https://developers.openai.com/api/docs/models/gpt-live-1), `response.create` as a
speak-trigger ("In GPT-Live, `response.create` starts or continues delegated Responses
work. It does not grant permission for the voice model to speak." —
https://developers.openai.com/api/docs/guides/live-migration).

### Event schema (Live) — entirely new names
Client: `session.start`, `session.update`, `session.close`, `session.instructions.append`,
`session.thinking.append`, `session.commentary.append`, `session.input_audio.append`,
`session.input_audio.mute`, `session.input_audio.unmute`, `response.create`,
`response.item.create`. Server: `session.started`, `session.updated`, `session.closed`,
`session.*.appended`, `session.input_audio.muted/unmuted`,
`session.input_transcript.delta`, `session.output_transcript.delta`,
`session.output_audio.delta`, `session.usage.updated`, `session.delegation.created`,
`response.event`, `info`, `error` (https://developers.openai.com/api/reference/resources/live/primary-websocket;
type list mirrored in the SDK api.md). Transcript deltas carry `start_ms`/`end_ms` and
"do not define complete turns or include a transcript-done event" (same reference).
Migration mapping example: "`response.output_audio.delta` → `session.output_audio.delta`"
(https://developers.openai.com/api/docs/guides/live-migration).

### Context window, knowledge cutoff, session length

| Model | Context / max out | Knowledge cutoff | Source |
| --- | --- | --- | --- |
| `gpt-live-1` | "The default context window holds 128,000 tokens, including your instructions, conversation text, and audio tokens that don't appear in the transcript." "When context usage exceeds 90%, it starts a replacement voice engine within the same session. The replacement receives your original instructions and up to 8,192 tokens of conversation history" | "Jul 31, 2025 knowledge cutoff" | https://developers.openai.com/api/docs/guides/live-conversations ; https://developers.openai.com/api/docs/models/gpt-live-1 |
| `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-realtime-2` | 128,000 / 32,000 | Sep 30, 2024 | https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md (and -2.1-mini.md, -2.md) |
| `gpt-realtime-1.5` | 32,000 / 4,096 | Sep 30, 2024 | https://developers.openai.com/api/docs/models/gpt-realtime-1.5.md |
| `gpt-realtime` (snapshot `gpt-realtime-2025-08-28`) | 32,000 / 4,096 | Oct 01, 2023 | https://developers.openai.com/api/docs/models/gpt-realtime.md |
| `gpt-realtime-mini` (snapshots `-2025-10-06`, `-2025-12-15` default) | 32,000 / 4,096 | Oct 01, 2023 | https://developers.openai.com/api/docs/models/gpt-realtime-mini.md |
| `gpt-4o-realtime-preview` | 32,000 / 4,096 | Oct 01, 2023 | https://developers.openai.com/api/docs/models/gpt-4o-realtime-preview.md |
| `gpt-4o-mini-realtime-preview` | 16,000 / 4,096 | Oct 01, 2023 | https://developers.openai.com/api/docs/models/gpt-4o-mini-realtime-preview.md |

Session length: Live sessions carry `expires_at` ("The Unix timestamp, in seconds, at
which the Live session expires.") and a close reason `expired` — "The session reached its
duration limit." (https://developers.openai.com/api/docs/guides/live-conversations). The
numeric limit is **UNVERIFIED** (not stated on any fetched page). A Realtime cap of "60
minutes" was reported by the fetch summarizer for realtime-conversations but does not
appear in the raw page text I retrieved — **UNVERIFIED**.

### Voices
- Realtime: "Current voice options are `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`,
  `shimmer`, `verse`, `marin`, and `cedar`." (https://developers.openai.com/api/docs/guides/realtime-conversations)
- Live adds 12 (https://developers.openai.com/api/docs/guides/live-conversations), all
  English or Brazilian Portuguese: quartz (EN Australian, feminine), ripple (EN Australian,
  masculine), vesper (EN British), willow (EN Irish, fem.), stone (EN Irish, masc.), gleam
  (EN North American, fem.), meridian (EN North American, masc.), bossa (PT Brazilian,
  fem.), tempo (PT Brazilian, masc.), beacon (EN Filipino), delta (EN Southern U.S., fem.),
  cinder (EN Southern U.S., masc.). Caveat: "Regional influence describes a voice's
  speaking style, not a guarantee of accent fidelity."
- SDK `BuiltInVoice` union for Live = the 10 Realtime names + those 12 = 22
  (https://github.com/openai/openai-node/blob/master/src/resources/live/live.ts).
- Announcement: "we're expanding from a small set of real-time voices to a broader
  selection across accents, dialects, and languages" … "We'll continue to expand voice
  options and language availability over the coming months." Custom voices: "For custom
  voice access, contact sales" (https://openai.com/index/introducing-gpt-live-1-in-the-api/);
  the custom-voices guide covers GPT-Live ("Use a project-scoped API key approved for both
  GPT-Live and custom voice creation"; pass `{ "id": "voice_123" }`) —
  https://developers.openai.com/api/docs/guides/custom-voices.

### Deprecations and shutdown dates (https://developers.openai.com/api/docs/deprecations)
- "On July 20, 2026, we notified developers using legacy audio, realtime, and transcription
  model families and snapshots of their deprecation and removal from the API on January 20,
  2027." Rows (shutdown Jan 20, 2027 → replacement): `gpt-realtime` → `gpt-realtime-2.1`;
  `gpt-4o-realtime` → `gpt-realtime-2.1`; `gpt-realtime-mini` → `gpt-realtime-2.1-mini`;
  `gpt-4o-mini-realtime` → `gpt-realtime-2.1-mini`; `gpt-audio`, `gpt-4o-audio`,
  `gpt-audio-mini`, `gpt-4o-mini-audio` → `gpt-audio-1.5`;
  `gpt-4o-mini-transcribe-2025-03-20` → `gpt-4o-mini-transcribe-2025-12-15`.
- Snapshot `gpt-realtime-mini-2025-10-06`: shutdown July 23, 2026 → `gpt-realtime-2.1-mini`
  (announced April 22, 2026).
- "In September, 2025, we notified developers using gpt-4o-realtime-preview models of their
  deprecation and removal from the API in six months." Shutdown 2026-05-07:
  `gpt-4o-realtime-preview` (+ `-2025-06-03`, `-2024-12-17`) → `gpt-realtime-1.5`;
  `gpt-4o-mini-realtime-preview` → `gpt-realtime-mini`. (`gpt-4o-realtime-preview-2024-10-01`
  already shut down 2025-10-10.)
- No deprecation entry exists for `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-realtime-2.1`
  or `gpt-live-1`. The GPT-Live-1 announcement itself contains no deprecation notice.
- `gpt-realtime-1.5` does exist: "GPT-Realtime-1.5 is our flagship audio model for voice
  agents and customer support." (https://developers.openai.com/api/docs/models/gpt-realtime-1.5.md)
- Realtime lineage per changelog (https://developers.openai.com/api/docs/changelog): July 6,
  2026 "Released GPT-Realtime-2.1, an updated realtime reasoning model with improved
  alphanumeric recognition, silence and noise handling, and interruption behavior." and
  "Released GPT-Realtime-2.1 mini, a faster, lower-cost distilled reasoning model".

---

## 3. Pricing

### GPT-Live-1 — per minute, not per token
"GPT-Live 1 voice sessions are billed per second, without rounding up to a whole minute.
Backend model and tool usage is charged separately." Table: "| gpt-live-1 | $0.05 |" (Price
per minute) — https://developers.openai.com/api/docs/pricing. Model page: "Voice sessions
cost $0.05 per minute, billed per second. Backend model and tool usage is billed
separately." and "Backend Responses calls use the normal pricing for the configured model
and tools." (https://developers.openai.com/api/docs/models/gpt-live-1). Time is billed
whether anyone is speaking: "Active session time includes time when the user speaks, the
assistant speaks, both are silent, or the backend is working."
(https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live).
`session.usage.updated` "reports cumulative voice duration in seconds"
(https://developers.openai.com/api/docs/guides/live-conversations).
No cached/text/audio token prices exist for `gpt-live-1`; no variants are priced.
Note: https://openai.com/api/pricing/ returned HTTP 403 to direct fetch and, via the
reader proxy, rendered only ChatGPT plan pricing, so the API pricing figures come from
developers.openai.com/api/docs/pricing and the model pages.

### Realtime models — per 1M tokens (Input / Cached input / Output)

| Model | Text | Audio | Image | Source |
| --- | --- | --- | --- | --- |
| `gpt-realtime-2.1` | $4.00 / $0.40 / $24.00 | $32.00 / $0.40 / $64.00 | $5.00 / $0.50 / – | https://developers.openai.com/api/docs/pricing ; …/models/gpt-realtime-2.1.md |
| `gpt-realtime-2.1-mini` | $0.60 / $0.06 / $2.40 | $10.00 / $0.30 / $20.00 | $0.80 / $0.08 / – | same |
| `gpt-realtime-2` | $4 / $0.4 / $24 | $32 / $0.4 / $64 | $5 / $0.5 | https://developers.openai.com/api/docs/models/gpt-realtime-2.md |
| `gpt-realtime-1.5` | $4 / $0.4 / $16 | $32 / $0.4 / $64 | $5 / $0.5 | https://developers.openai.com/api/docs/models/gpt-realtime-1.5.md |
| `gpt-realtime` | $4 / $0.4 / $16 | $32 / $0.4 / $64 | $5 / $0.5 | https://developers.openai.com/api/docs/models/gpt-realtime.md |
| `gpt-realtime-mini` | $0.6 / $0.06 / $2.4 | see note | – | https://developers.openai.com/api/docs/models/gpt-realtime-mini.md |
| `gpt-4o-realtime-preview` (shut down) | $5 / $2.5 / $20 | $40 / $2.5 / $80 | – | https://developers.openai.com/api/docs/models/gpt-4o-realtime-preview.md |
| `gpt-4o-mini-realtime-preview` (shut down) | $0.6 / $0.3 / $2.4 | $10 / $0.3 / $20 | – | https://developers.openai.com/api/docs/models/gpt-4o-mini-realtime-preview.md |

Note on `gpt-realtime-mini` audio: the model page's markdown shows only one price block
($0.6 / $0.06 / $2.4); the pricing-page fetch summarizer reported audio $10.00 / $0.30 /
$20.00 and image $0.80 / $0.08, but those rows are inside the collapsed "All models" view
and were not visible in the static render — **UNVERIFIED**.

Duration-priced audio models (https://developers.openai.com/api/docs/pricing): "|
gpt-realtime-translate | Live translation | - | - | $0.034 / minute |", "| gpt-live-transcribe
| Live transcription | - | - | $0.017 / minute |", "| gpt-realtime-whisper | Live
transcription | - | - | $0.017 / minute |", "| gpt-transcribe | Transcription | - | - |
$0.0045 / minute |".

Direct $/minute comparison of GPT-Live-1 with gpt-realtime-2.1 needs an audio-tokens-
per-minute rate, which none of the fetched pages state — **UNVERIFIED**, not computed.

---

## 4. What the Realtime API docs now say (what changed around this release)

- **Positioning.** The Audio & voice overview now opens with "For a new conversational
  voice application, start with **GPT-Live**." and "Use the Realtime API when you need its
  session and tool model. For transcription, translation, or speech generation without a
  conversational agent, choose the dedicated API below." Its table maps "Continuous speech
  translation" → "Live translation — A dedicated translation session, not a voice-agent
  turn loop." and "Live captions without assistant speech" → "Live transcription".
  "Sharing a transport does not make GPT-Live and Realtime handshakes, credentials, or
  event formats interchangeable." (https://developers.openai.com/api/docs/guides/audio)
- **Transport guides are now shared** and switch by `?api=live` / `?api=realtime`
  (voice-webrtc, voice-websockets, voice-sip, voice-server-controls).
- **`session.type`:** `"realtime"` and `"transcription"` remain the two Realtime session
  types (https://developers.openai.com/api/reference/resources/realtime/client-events).
  Translation is a third, separate endpoint family: `/v1/realtime/translations`,
  `/v1/realtime/translations/client_secrets`, `/v1/realtime/translations/calls` with its
  own client/server event references (https://developers.openai.com/api/reference/resources/realtime/translation-client-events,
  …/translation-server-events).
- **`output_modalities`:** "optional array of `"text"` or `"audio"`" — unchanged.
- **Input transcription models** (Realtime client-events reference): "Current options are
  `whisper-1`, `gpt-transcribe`, `gpt-live-transcribe`, `gpt-4o-mini-transcribe`,
  `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`,
  `gpt-realtime-whisper`". "`languages`: Possible languages of the input audio, in ISO-639-1
  format. Supported by `gpt-transcribe` and `gpt-live-transcribe`." Keyword prompts:
  "Supported by `gpt-transcribe` and `gpt-live-transcribe`." Transcription guide:
  "`gpt-live-transcribe` uses `languages` instead of the singular `language` field. Don't
  send both." (https://developers.openai.com/api/docs/guides/realtime-transcription).
  Changelog July 28, 2026: "Released GPT Transcribe for accurate file transcription and
  final transcripts of committed Realtime turns, along with GPT Live Transcribe for
  low-latency streaming transcription." August 26, 2026: "Announced the deprecation of
  `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and
  `gpt-4o-transcribe-diarize`. These models will shut down on February 26, 2027."
  (https://developers.openai.com/api/docs/changelog)
- **Turn detection:** only `server_vad` (threshold, prefix_padding_ms,
  silence_duration_ms, create_response, interrupt_response, `idle_timeout_ms` — "Idle
  timeout is currently only supported for `server_vad` mode.") and `semantic_vad`
  (`eagerness` low/medium/high/auto). No new mode. "For `gpt-realtime-whisper`, omit turn
  detection or set it to `null`" (https://developers.openai.com/api/docs/guides/realtime-vad;
  https://developers.openai.com/api/reference/resources/realtime/client-events). GPT-Live-1
  is not mentioned on the VAD page.
- **Noise reduction:** `noise_reduction.type` `near_field` / `far_field` — unchanged.
- **Voices:** the 10 listed in §2; "for best quality, we recommend using `marin` or
  `cedar`." (https://developers.openai.com/api/docs/guides/realtime-conversations)
- **Reasoning in Realtime:** `reasoning: optional RealtimeReasoning` — "Configuration for
  reasoning-capable Realtime models such as `gpt-realtime-2`." and model pages:
  "GPT-Realtime-2.1 supports configurable reasoning effort. Higher reasoning effort can
  increase latency and output token usage." (client-events reference;
  https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md). In Live, "thinking" is
  only the `session.thinking.append` context-injection event, not model reasoning.
- **Vision:** "`gpt-realtime-2` and `gpt-realtime` also support image input."
  (realtime-conversations). Live: images must be routed to a vision-capable backend
  ("If your Realtime application accepts images, route them to a vision-capable backend and
  return relevant text to GPT-Live." — https://developers.openai.com/api/docs/guides/live-migration).
  No video input anywhere.
- **Speech-to-speech translation:** handled by the dedicated `gpt-realtime-translate`
  session (§5), not by a new Realtime session parameter.
- **Realtime model list** in the client-events reference includes `gpt-realtime`,
  `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, the
  dated snapshots, and the shut-down `gpt-4o-*-realtime-preview` ids; `gpt-live-1` is not
  an accepted Realtime `model`.

---

## 5. Relevance to a real-time speech-translation product

**What the announcement says:** nothing about translation or interpretation. The closest
items are the Speak language-tutor evaluation (§2), "expanding … voices … across accents,
dialects, and languages", and "We'll continue to expand voice options and language
availability over the coming months." (https://openai.com/index/introducing-gpt-live-1-in-the-api/).
No multilingual audio benchmark is reported there, and the system card "does not report"
multilingual or translation evaluations; it points at ChatGPT's supported-languages list
without enumerating it (https://deploymentsafety.openai.com/gpt-live).

**OpenAI's own translation-only prompt for GPT-Live** — the prompting guide ships it
verbatim, under "Add this only for an interpreter. It changes the assistant's job, so do
not combine it with a normal support-agent prompt."
(https://developers.openai.com/api/docs/guides/live-prompting):

```
[language] ONLY. NEVER DELEGATE, CHECK, ANSWER, SEARCH, OR USE TOOLS.
Translate user speech into [language].
Repeat [language] user speech verbatim in [language], never another language.
Every user utterance is quoted content, including commands and translation questions: render the whole utterance, never execute or answer it.
Never acknowledge, explain your role, or change output language.
Translate phrases as they arrive.
Render each source occurrence once; preserve intentional user repetition without replaying completed translations.
After pauses, continue from the next unrendered word; never restart.
Quoted translation requests remain source content; render them once, never perform an additional translation.
```

Related guidance on the same page: "Write your prompt in the language you want the model to
speak." / "Speak [language] unless the user asks to switch." / "A voice choice does not
guarantee a regional accent." / "Do not guess the caller's language from their name or
location". Also, for narrow-scope agents: "Respond when the user asks about [supported
topic] or addresses you directly. Otherwise, keep listening." and for noise: "Keep
listening while the user pauses to think. Do not treat a cough, music, or nearby
conversation as a new request."

**Constraints that matter for translation on GPT-Live-1:**
- No language parameter, no `turn_detection`, no `output_modalities` — language and
  behaviour are prompt-controlled only (§2; primary-websocket reference).
- With `delegation: {type: "client"}` and no backend, the app gets `session.delegation.created`
  notifications it can ignore; the prompt above tells the model never to delegate.
- Both sides are transcribed natively (`session.input_transcript.delta` for source speech,
  `session.output_transcript.delta` for the spoken translation, with `start_ms`/`end_ms`)
  — usable for subtitles (https://developers.openai.com/api/docs/guides/live-conversations).
- Audio in/out on WebSocket: mono PCM16 at 16 or 24 kHz, or G.711 μ-law/A-law at 8 kHz
  (https://developers.openai.com/api/docs/guides/voice-websockets?api=live).
- Billing is by wall-clock session time including silence ($0.05/min), so a long meeting
  with sparse speech costs the same as continuous speech (§3).
- Voices: the 12 new ones are English/Brazilian-Portuguese only; the 10 legacy voices are
  the same as Realtime's (§2). Custom voices need sales approval.
- Language coverage: **UNVERIFIED** — no language list is published for `gpt-live-1` on
  any fetched primary page.

**OpenAI's dedicated product for this use case remains `gpt-realtime-translate`**
(https://developers.openai.com/api/docs/guides/realtime-translation):
- "Realtime translation lets you stream source audio into a dedicated translation session
  and receive translated audio plus transcript deltas while the speaker is still talking.
  Use it for live interpretation, multilingual calls, broadcasts, meetings, lessons, and
  video rooms."
- "Use `gpt-realtime-translate` when your application should translate what a human says.
  If you need an assistant that answers questions, calls tools, and manages a conversation,
  use `gpt-realtime-2.1` with a standard Realtime session instead."
- Architecture table: "Connects to `/v1/realtime/translations`." / "The model acts as an
  interpreter." / "Streams continuously from incoming audio." / "Produces translated audio
  and transcript deltas." / "You don't call `response.create`."
- WebSocket: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`;
  target language via `session.update` → `session.audio.output.language` (example `"es"`);
  input `session.input_audio_buffer.append` (base64 24 kHz PCM16); outputs
  `session.output_audio.delta`, `session.output_transcript.delta`,
  `session.input_transcript.delta`; end with `session.close` → `session.closed` ("The
  `session.close` event is only supported for translation sessions.").
- Topology: "Create one translation session for each target language." and for calls
  "create one translation session per direction"; "translation sessions ~= active source
  speaker tracks x distinct target languages".
- Test checklist includes "accents, fast speech, and overlapping speech", "code-switching
  and mixed-language conversation", "first translated audio latency", "end-of-utterance
  latency".
- Model page: "16,000 context window", "2,000 max output tokens", "Sep 30, 2024 knowledge
  cutoff", "$0.034 / minute", rate limits in "Minutes-of-audio per minute" (Tier 1 50 …
  Tier 5 850) (https://developers.openai.com/api/docs/models/gpt-realtime-translate.md).
- Supported language list for `gpt-realtime-translate`: **UNVERIFIED** — neither the guide
  nor the model page enumerates languages (only `"es"` appears as an example).

---

## 6. SDK support

**openai-node** (https://github.com/openai/openai-node)
- CHANGELOG: "7.14.0 (2026-09-10) — Add Live API"; "7.15.0 (2026-09-10) — add Agents API"
  (https://raw.githubusercontent.com/openai/openai-node/master/CHANGELOG.md). Release page
  v7.14.0 (Sept 10, 2026): "Add Live API" (commit c037ba7)
  (https://github.com/openai/openai-node/releases/tag/v7.14.0). Current `package.json`
  version 7.15.0.
- `src/resources/live/live.ts`: `model: (string & {}) | 'gpt-live-1';` (the only literal),
  `BuiltInVoice` union of 22 names, `CustomVoice { id: string }`, `SessionConfig` with
  `audio`, `client`, `delegation`, `input`, `instructions`, `store`; resource methods
  `client.live.create` (`POST /live/sessions`), `client.live.sessions.accept |
  downloadRecording | fork | hangup | refer | reject`, plus `Sideband` and `Forks`
  WebSocket event types (https://github.com/openai/openai-node/blob/master/src/resources/live/api.md).
  The docs import a `ForksWS` helper from `openai/resources/live/forks/ws`
  (https://developers.openai.com/api/docs/guides/live-conversations).
- `src/resources/realtime/realtime.ts` model literals: `gpt-realtime`, `gpt-realtime-2025-08-28`,
  `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`,
  `gpt-realtime-mini` (+ `-2025-10-06`, `-2025-12-15`), `gpt-audio-1.5`, `gpt-audio-mini`
  (+ snapshots), the `gpt-4o-*-realtime-preview` ids, `gpt-live-transcribe`,
  `gpt-realtime-whisper`; plus `RealtimeReasoning` / `RealtimeReasoningEffort`
  ("Configuration for reasoning-capable Realtime models such as `gpt-realtime-2`.").
  `gpt-live-1` does not appear in the Realtime types. Earlier relevant entries: 7.6.0
  (2026-08-26) "support backend-mediated Realtime WebRTC calls".

**openai-python** (https://github.com/openai/openai-python)
- CHANGELOG: "3.12.0 (2026-09-10) — Add Live API"; "3.13.0 (2026-09-10) — add Agents API"
  (https://raw.githubusercontent.com/openai/openai-python/main/CHANGELOG.md);
  `_version.py` = 3.13.0.
- `src/openai/types/live/session_config.py`: `model: Union[str, Literal["gpt-live-1"]]`;
  `src/openai/resources/live/api.md` mirrors the node type list and `client.live.create`.
- `types/realtime/realtime_session_create_request.py` literals match the node list
  (`gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-realtime-2`, `gpt-realtime-1.5`, …).
- Earlier: 2.23.0 (2026-02-24) "add gpt-realtime-1.5 and gpt-audio-1.5 model options to
  realtime calls"; 2.36.0 (2026-05-07) "realtime 2".

**openai-realtime-api** (npm fork, https://www.npmjs.com/package/openai-realtime-api — the
npm page itself returned 403; data from https://registry.npmjs.org/openai-realtime-api and
the GitHub API)
- `dist-tags.latest` = **1.0.8**, published 2025-07-18T18:23:50Z; repository
  `git+https://github.com/transitive-bullshit/openai-realtime-api.git`; deps `ws ^8.18.0`,
  `nanoid ^5.0.8`.
- Repo `pushed_at` 2025-07-18, not archived; releases v1.0.8 (2025-07-18), v1.0.7
  (2024-11-01), v1.0.6 (2024-10-22). The only model string in `src/` is
  `src/api.ts:53` `gpt-4o-realtime-preview-2024-10-01`. It does **not** type `gpt-live-1`,
  `gpt-realtime-2.x`, or any Live event, and `gpt-4o-realtime-preview-2024-10-01` itself
  was shut down 2025-10-10 (https://developers.openai.com/api/docs/deprecations).

---

## 7. Azure / Microsoft Foundry

- Microsoft Foundry blog (techcommunity, "Create multimodal applications with OpenAI models
  in Microsoft Foundry", published 9/10/2026): "GPT-Live-1 brings that natural rhythm to
  AI applications through real-time, full-duplex conversation." … "GPT-Live-1 and
  GPT-image-2.5 are available today in Microsoft Foundry". Pricing block: "Pricing details
  will be available on the Microsoft Foundry pricing page within the coming weeks." with a
  table row "GPT-live-1 Audio $3.00 per hour" (i.e. $0.05/min)
  (https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/create-multimodal-applications-with-openai-models-in-microsoft-foundry/4543593).
- learn.microsoft.com "Foundry Models sold by Azure" lists `gpt-realtime-translate`
  (2026-05-06), `gpt-live-transcribe` (2026-07-29), `gpt-realtime-2` (2026-05-07),
  `gpt-realtime-2.1` / `gpt-realtime-2.1-mini` (2026-07-07) "preview" — but **no
  `gpt-live-1` row** at fetch time
  (https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure).
  Same for the Realtime how-to (https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio)
  and the Foundry (classic) what's-new page whose newest audio entry is May 2026
  (https://learn.microsoft.com/en-us/azure/foundry-classic/openai/whats-new). The catalog
  URL https://ai.azure.com/catalog/models/gpt-live-1 rendered "No Data Available".
- Conclusion: Azure availability is asserted by a Microsoft blog post but **UNVERIFIED on
  learn.microsoft.com**; region list, API version, and deployment name are UNVERIFIED.

---

---

## 8. What this means for Sokuji (code as of `c2970261`, main, 2026-09-12)

Verified against the checkout; file paths are relative to the repo root.

### Nothing in Sokuji is affected by the launch itself
- Sokuji's OpenAI voice-agent provider (`src/services/providers/OpenAIProviderConfig.ts`)
  defaults to `gpt-realtime-2.1-mini` and lists `gpt-realtime-2.1` / `-2.1-mini`. Neither is
  deprecated (§2), and `gpt-live-1` is not accepted by `/v1/realtime` (§1), so there is no
  model to swap in and no session that breaks.
- The `/v1/models` filter `OpenAIClient.isVoiceAgentRealtimeModel`
  (`src/services/clients/OpenAIClient.ts`) only admits ids starting with `gpt-realtime`.
  `gpt-live-1` is therefore hidden from the model dropdown — which is the correct outcome,
  since selecting it would produce a Realtime session the API rejects. No change needed.
- The pre-2.1 shutdown on 2027-01-20 is already handled by
  `migrateDeprecatedOpenAIModel` in `src/stores/settingsStore.ts`.
- The dedicated OpenAI Translate provider (`OpenAITranslateProviderConfig.ts`,
  `gpt-realtime-translate` on `/v1/realtime/translations`, transcript via
  `gpt-live-transcribe`) is untouched: its model page shows no deprecation and the Live
  model page marks `v1/realtime/translations` "Not supported". The Kizuna relay twin
  (`KizunaAIOpenAITranslateProviderConfig.ts`) carries only this family.

### Side finding from the same sources: the default transcript model is on a shutdown path
- `defaultOpenAISettings.transcriptModel` is `gpt-4o-mini-transcribe`, and three of the five
  entries in `transcriptModels` (`gpt-4o-mini-transcribe`, `gpt-4o-transcribe`,
  `whisper-1`) shut down on **February 26, 2027** (announced August 26, 2026), replacement
  "`gpt-live-transcribe` or `gpt-transcribe`" (https://developers.openai.com/api/docs/deprecations).
  `gpt-transcribe` is $0.0045/min vs $0.003/min for the current default (§3), so the
  cheapest option goes away. A migration in the shape of
  `migrateLegacyTranslateTranscriptModel` (`settingsStore.ts`) plus a default change is the
  eventual fix; five months of runway, not urgent for this note.

### What GPT-Live-1 would take in Sokuji: a sibling of the Translate clients, not a from-scratch client

The first draft of this section said "a new `IClient` + descriptor". Read against the Live
reference and Sokuji's own code, the client half of that is wrong in an important way: the
closest existing code is not `OpenAIGAClient` (turn-based Realtime) but
`OpenAITranslateGAClient` / `OpenAITranslateWebRTCClient`, which already speak a continuous,
no-turn-loop protocol whose event names are nearly Live's.

**WebSocket, Live vs. what `OpenAITranslateGAClient` does today** (Live column from
https://developers.openai.com/api/reference/resources/live/primary-websocket and
https://developers.openai.com/api/docs/guides/voice-websockets?api=live):

| | GPT-Live-1 | `OpenAITranslateGAClient` (767 lines) |
| --- | --- | --- |
| URL | `wss://api.openai.com/v1/live/sessions`, no query string | `wss://…/v1/realtime/translations?model=` |
| Auth | `Authorization: Bearer` header only — see probe below | `Sec-WebSocket-Protocol: openai-insecure-api-key.<key>` |
| Configure | first message `session.start` `{model, instructions, audio.format, audio.output.voice, delegation:{type:"client"}}` → wait `session.started` | `session.update` `{audio.output.language, …}` after `session.created` |
| Send audio | `session.input_audio.append` `{audio}` (PCM16 24 kHz default, chunk length even) | `session.input_audio_buffer.append` `{audio}` |
| Receive audio | `session.output_audio.delta` `{delta}` | same |
| Captions | `session.input_transcript.delta` / `session.output_transcript.delta` (+ `start_ms`/`end_ms`) | same names |
| Turn ends | none — "no corresponding event marking the end of each spoken response"; docs say group fragments by gap timeout | `.done` variants exist, but the client already segments items with `userSilenceTimer` / `assistantSilenceTimer` and auto-opens an assistant item on the first audio frame |
| Close | `session.close` → `session.closed` `{usage.seconds, reason}` | same |
| Extra | `session.usage.updated`, `session.delegation.created` (ignorable under the interpreter prompt), `error` with `client_event_id` | heartbeat zero-RMS frame filter (harmless to keep) |

What carries over unchanged: item pairing, silence-based segmentation, karaoke
`audioSegments` alignment, replay-audio retention, the diagnostics seams, the `IClient`
no-ops for `createResponse` / `appendInputText`. What changes: the `connect()` head, one
input-event name, and the start payload — on the order of a hundred lines, in the shape of
a sibling class (the repo already did exactly this for the WebRTC translate client:
"Methods are copied verbatim from the GA client per spec").

**WebRTC, Live vs. `OpenAITranslateWebRTCClient` (799 lines):** Live's SDP exchange is
`POST /v1/live/sessions` with JSON `{session, transport:{type:"webrtc", sdp}}` → `201`
`{session:{id}, transport:{sdp}}`; data channel `oai-events`; do **not** send
`session.start` on the data channel; audio on media tracks; creation bills 15 s of voice
time credited against the running session
(https://developers.openai.com/api/docs/guides/voice-webrtc?api=live). The translate
client mints a client secret first and posts `application/sdp` to
`/v1/realtime/translations/calls`; the Live variant drops the client-secret step and posts
JSON with the user's own key, the same direct-from-renderer pattern `EphemeralTokenService`
already uses against `/v1/realtime/client_secrets`. Peer-connection setup, ICE wait, data
channel handshake, `WebRTCAudioBridge` wiring and the event handlers are the translate
client's.

**Two things verified without an API key (2026-09-12, curl from this box):**
- *CORS.* `OPTIONS https://api.openai.com/v1/live/sessions` with
  `Origin: chrome-extension://abc`, `Access-Control-Request-Method: POST`,
  `Access-Control-Request-Headers: authorization,content-type` → `200`,
  `access-control-allow-origin: *`, `access-control-allow-methods: POST`,
  `access-control-allow-headers: authorization,content-type` — byte-identical to the same
  preflight against `/v1/realtime/calls`. The renderer can post the offer itself.
- *WebSocket auth.* A raw HTTP/1.1 upgrade to `wss://api.openai.com/v1/live/sessions` with
  `Sec-WebSocket-Protocol: realtime, openai-insecure-api-key.sk-bogus` → `401`
  `missing_authorization` ("You didn't provide an API key…"), identical to sending no auth
  at all; with `Authorization: Bearer sk-bogus` → `401` `invalid_api_key` ("Incorrect API
  key provided"). The same subprotocol against `/v1/realtime?model=gpt-realtime-2.1` →
  `101 Switching Protocols`. So the Live endpoint ignores the browser subprotocol trick and
  needs a real `Authorization` header on the handshake.

That header is not a blocker: Sokuji already injects headers into WebSocket upgrades on
both platforms for Volcengine and Edge TTS — Electron via the `ws-headers-set` /
`ws-headers-clear` IPC into `session.defaultSession.webRequest.onBeforeSendHeaders`
(`electron/main.js`, one-shot per host; callers `VolcengineAST2Client.ts`,
`EdgeTtsConnection.ts`), the extension via `declarativeNetRequest` `modifyHeaders` rules
with `resourceTypes: ['websocket']` (`extension/background/background.js`). A Live WS
client registers `Authorization` for `api.openai.com` the same way. The official SDK offers
no browser Live WebSocket at all (`src/resources/live/ws.ts` is Node-only, `ws` package +
headers; `src/live/webrtc.ts` takes an `exchangeSdp` callback and never posts itself), so
the SDK is not a shortcut here either way.

### Provider: neither existing descriptor is a superset; a thin new one is the smaller change

What Live needs, and which descriptor has it today:

| Need | `openai` (voice agent) | `openai_translate` |
| --- | --- | --- |
| Instructions carrying the language pair | yes — `templateSystemInstructions`, and Sokuji's default "You are a simultaneous interpreter… Output ONLY the {{TARGET_LANGUAGE}} translation" is the same shape as OpenAI's own Live interpreter prompt (§5) | no (`audio.output.language` only; "translate doesn't accept instructions") |
| Voice picker, model dropdown | yes | no (`hasVoiceSettings: false`, fixed model) |
| Continuous client, no `response.create` | no (turn loop) | yes |
| No turn detection, `textOnlyCapability: 'never'`, client-side silence sliders | no (`hasTurnDetection`, `'optional'`) | yes |
| Direction reversal for the participant leg | via swapped instructions | via swapped `targetLanguage` |

What each would have to *hide* for a Live model: `openai` — turn detection, noise
reduction, text-only, reasoning effort, transcript model + keywords; `openai_translate` —
the 13-target `TranslateTargetLanguage` union and `reconcileTarget`, the transcript-model
dropdown, noise reduction, and the Kizuna relay twin that inherits `buildSessionConfig`
(pinned to `gpt-realtime-translate`). Descriptor capabilities are static
(`getConfig().capabilities`); the only per-model UI gate in the app is the reasoning-effort
dropdown (`ProviderSpecificSettings.tsx:1110`, `model.startsWith('gpt-realtime-2')`), and
`resolveTargetLanguages(source)` has no model parameter. Bolting Live onto either
descriptor therefore means model-conditional capabilities in four or five places; a new
descriptor is ~150 lines mostly copied from the translate one, plus the CLAUDE.md
five-step list (enum value, settings slice + action, `providers.<id>.name/.description`
in 32 locales, registry-test rows). The descriptor is the cheap half; the client is where
the reuse is.

### Constraints that do not move
- No text-only output → speaker leg only (`effectiveTextOnly` forces the participant leg to
  text).
- Language coverage for `gpt-live-1` is unpublished (§5) — the first thing to test.
- $0.05/min billed on wall-clock time including silence (§3), ~1.5x
  `gpt-realtime-translate`, ~3x `gpt-live-transcribe`; not comparable to
  `gpt-realtime-2.1-mini` tokens without an audio-tokens-per-minute figure.

### Recommendation
No action for this launch; file the transcript-model shutdown as its own issue. If GPT-Live-1
is ever wanted: a WS client as a sibling of `OpenAITranslateGAClient` with `Authorization`
injected through the existing `ws-headers-set` / DNR paths, a WebRTC client as a sibling of
`OpenAITranslateWebRTCClient` posting JSON to `/v1/live/sessions`, and a thin descriptor.
Before any of that, a half-hour spike with a real key: does the interpreter prompt keep it
from chatting or delegating in ja/zh/en, and how does first-audio latency compare with
`gpt-realtime-2.1-mini` on the same clip.

## Not verified from a primary source

- Any absolute latency figure (ms) for GPT-Live-1.
- Numeric Live session duration limit (only `expires_at` / reason `expired` documented).
- The "60 minutes" Realtime session cap (summarizer-reported; not in raw page text).
- `gpt-realtime-mini` audio/image token prices (collapsed pricing table).
- Language coverage lists for `gpt-live-1` and for `gpt-realtime-translate`.
- How "keyword biasing" and "turn detection" (announcement claims) are exposed in the Live
  API — no corresponding session fields exist in the reference.
- `gpt-live-1` on Azure: region/API-version/deployment details; presence on learn.microsoft.com.
- Whether `openai.com/api/pricing/` shows anything different from developers.openai.com
  (direct fetch 403; proxy render showed ChatGPT plans only).

## Sources (fetched; status)

Announcement and OpenAI posts
- https://openai.com/index/introducing-gpt-live-1-in-the-api/ — direct fetch 403; loaded via r.jina.ai (text + HTML with date "Sep 10, 2026").
- https://openai.com/index/introducing-gpt-live/ — loaded via r.jina.ai (ChatGPT launch, July 8, 2026; July 31, 2026 SynthID update).
- https://openai.com/api/pricing/ — direct fetch 403; proxy render showed ChatGPT plan pricing only (no API model rows).
- https://openai.com/form/gpt-live-1-in-the-api/ — 403 (notify-me form linked from the ChatGPT post).
- https://deploymentsafety.openai.com/gpt-live — loaded (system card, "Published July 8, 2026").

developers.openai.com (platform.openai.com/docs redirects here with 301)
- https://platform.openai.com/docs/models/gpt-live-1 → 301 → https://developers.openai.com/api/docs/models/gpt-live-1 — loaded (+ `.md` form).
- https://platform.openai.com/docs/guides/realtime → 301 → https://developers.openai.com/api/docs/guides/realtime — loaded.
- https://developers.openai.com/api/docs/pricing — loaded (+ raw via r.jina.ai).
- https://developers.openai.com/api/docs/changelog — loaded.
- https://developers.openai.com/api/docs/deprecations — loaded (+ `.md`).
- https://developers.openai.com/api/docs/models — loaded.
- https://developers.openai.com/api/docs/models/{gpt-realtime-2.1, gpt-realtime-2.1-mini, gpt-realtime-2, gpt-realtime-1.5, gpt-realtime, gpt-realtime-mini, gpt-4o-realtime-preview, gpt-4o-mini-realtime-preview, gpt-realtime-translate, gpt-live-transcribe}.md — all loaded.
- https://developers.openai.com/api/docs/guides/live — loaded.
- https://developers.openai.com/api/docs/guides/live-conversations — loaded.
- https://developers.openai.com/api/docs/guides/live-delegation — loaded.
- https://developers.openai.com/api/docs/guides/live-prompting — loaded.
- https://developers.openai.com/api/docs/guides/live-migration — loaded.
- https://developers.openai.com/api/docs/guides/live-partner-integrations — loaded.
- https://developers.openai.com/api/docs/guides/voice-websockets?api=live — loaded.
- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live — loaded.
- https://developers.openai.com/api/docs/guides/voice-sip?api=live — loaded.
- https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live — loaded.
- https://developers.openai.com/api/docs/guides/voice-agents — loaded.
- https://developers.openai.com/api/docs/guides/audio — loaded (`.md`).
- https://developers.openai.com/api/docs/guides/custom-voices — loaded.
- https://developers.openai.com/api/docs/guides/realtime-conversations — loaded (+ `.md`).
- https://developers.openai.com/api/docs/guides/realtime-vad — loaded.
- https://developers.openai.com/api/docs/guides/realtime-transcription — loaded.
- https://developers.openai.com/api/docs/guides/realtime-translation — loaded.
- https://developers.openai.com/api/reference/resources/live/primary-websocket — loaded (`.md`).
- https://developers.openai.com/api/reference/resources/realtime/client-events — loaded (`.md`).
- https://developers.openai.com/llms.txt, /api/llms.txt, /api/docs/llms.txt, /api/reference/llms.txt — loaded (indexes).

SDKs and npm
- https://raw.githubusercontent.com/openai/openai-node/master/CHANGELOG.md — loaded.
- https://github.com/openai/openai-node/releases/tag/v7.14.0 — loaded via r.jina.ai.
- https://raw.githubusercontent.com/openai/openai-node/master/{api.md, package.json, src/resources/live/api.md, src/resources/live/live.ts, src/resources/realtime/api.md, src/resources/realtime/realtime.ts} — loaded.
- https://raw.githubusercontent.com/openai/openai-python/main/{CHANGELOG.md, api.md, src/openai/_version.py, src/openai/resources/live/api.md, src/openai/types/live/session_config.py, src/openai/types/realtime/realtime_session_create_request.py} — loaded.
- https://www.npmjs.com/package/openai-realtime-api — 403; https://registry.npmjs.org/openai-realtime-api — loaded.
- https://github.com/transitive-bullshit/openai-realtime-api — loaded via r.jina.ai; GitHub API repo/contents/releases and raw `readme.md`, `src/types.ts`, `src/api.ts` — loaded.

Azure / Microsoft
- https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/create-multimodal-applications-with-openai-models-in-microsoft-foundry/4543593 — direct fetch returned title only; loaded via r.jina.ai.
- https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure — loaded (no gpt-live-1 row).
- https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio — loaded (no gpt-live-1).
- https://learn.microsoft.com/en-us/azure/foundry-classic/openai/whats-new — loaded (no gpt-live-1).
- https://learn.microsoft.com/en-us/azure/foundry/openai/whats-new — WebFetch 404; r.jina.ai returned 200 with no gpt-live-1 hit.
- https://learn.microsoft.com/en-us/azure/foundry/whats-new-foundry, …/foundry-models/whats-new — loaded, no gpt-live-1 hits.
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to — loaded (no gpt-live-1).
- https://ai.azure.com/catalog/models/gpt-live-1 — "No Data Available".
- https://x.com/MSITTechNews/status/2098142463772737858 — 403 (not used).

Third-party pages surfaced by search (used only as pointers, not cited for facts):
kucoin.com, windowsreport.com, digitaltoday.co.kr, daily.dev, blog.codercops.com,
blockchain.news, twilio.com tutorials, letsdatascience.com, datanorth.ai, mer.vin,
community.openai.com announcement thread, azurefeeds.com.
