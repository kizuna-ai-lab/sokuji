# Free combination of stages, step 3 — Implementation Plan

**Goal:** Kizuna AI's Soniox voice is offered alone: another provider's transcription and translation (Soniox with an own key, this device) can be read aloud by `kizunaai_soniox`'s voice, paid from the user's wallet through a lease that holds speech keys only.

**Spec:** `docs/superpowers/specs/2026-11-19-free-stage-combination-design.md` (§6, §11 step 3). Step 2's plan (`2026-11-21-free-stage-combination-step-2.md`): its "Decisions made while Part … was built" sections are binding here.

**Tech Stack:** TypeScript, React, Zustand, Vitest. No new dependency.

## Global Constraints

- Stacked on step 2 (`feat/free-speech-surfaces`). Nothing merges to `main` and nothing is released until step 4 is done.
- Provider ids never change. A session on Kizuna AI's Soniox for all three stages, and its text read by another voice, send what they send today, byte for byte.
- Public repository: no backend internals, no usage data, no machine or team names in code, comments, commits or PR text.
- Gate every push on the unit suite passing and on the type-error total not rising.

## The wire contract, as the client sees it

All requests carry the sign-in's bearer token.

**`POST {apiUrl}/soniox/session-key`**, sent when the plan's speech stage is served by `kizunaai_soniox` and its transcription stage is not:

```json
{ "mode": "voice_only", "legs": "speaker" | "participant" | "both", "region": "us", "payer": "organization" }
```

- `legs`: the legs that speak in this run. The speaker's leg speaks unless the run is text-only; the participant's speaks under the rule a whole session's request already reads. `payer` is present for an organization member only.
- When no leg would speak, no request is sent at all.

Answer:

```json
{
  "leaseId": "…", "clientReferenceId": "…", "region": "us", "maxSessionDurationSeconds": 3600,
  "streams": [{ "role": "spk_tts" | "par_tts", "apiKey": "…", "clientReferenceId": "…" }]
}
```

- Speech roles only, one per speaking leg, each with its own client reference. A transcription role, a role that was not asked for, a speaking leg with no role, or an unknown role is a contract break: the start fails.
- Refusals (401, 402, 403, 409, 502, 503, the organization codes) and the wait on a 409 are those of any start. A 400 means the service does not know this request yet: the start fails as "service unavailable".

**`POST {apiUrl}/soniox/session-started`** `{ "leaseId", "role": "spk_tts" | "par_tts", "clientReferenceId" }`: once per leg, when that leg's voice connection first opens. Retried as today's report is (after a transport failure or a 5xx; a 4xx is final).

**`POST {apiUrl}/soniox/session-end`** `{ "leaseId" }`: as today, with keepalive and up to three tries. For this lease it is what frees the account, so the client also remembers the lease and ends it at the next launch if it could not.

No key of such a lease is reissued. The grant ends by its time (`maxSessionDurationSeconds`), which is also the countdown.

## Parts

**Part A: the client can run such a plan.** The request, the lease, the voice's report, the floor, the run's bookkeeping and the recovery after a crash. The catalog still says `voiceAlone: false` for `kizunaai_soniox`, so the composer refuses the line-up exactly as before and nothing a user can see changes. Tests compose under a catalog whose option offers the voice.

**Part B: the option is offered.** The catalog flag flips; the tests that pin the refusal change with it; the line-up page, the "speech follows" rule, the notices and the surfaces that must know a hosted voice is in the plan (sign-in, wallet gate, records) follow. One case against the real service is written; no fake service was built for the end-to-end build (see Part B's decisions).

## Decisions made while Part A was built

- **The request is a union told apart by `mode`.** `LeaseRequest = SessionLeaseRequest | VoiceOnlyLeaseRequest`. `leaseRequest()` still builds a session's request and its bodies are unchanged; `voiceOnlyRequest()` builds the new one; `startRequest()` picks between them from the plan (`asksVoiceAlone`) and answers null when a voice alone would have no leg to speak on. The lease and the floor both go through `startRequest`, so they agree.
- **A plan reader was added:** `servesTranscription(plan, provider)`, beside `servesSpeech`. "The voice alone" is "serves speech and does not serve transcription".
- **No speaking leg: `acquire` resolves without asking anything.** Before the token is read: no request, no granted time, a `release` that does nothing, and credentials that hold a region only. The run's code is untouched; no voice is started on a leg that does not speak, so nothing reads the missing key. The floor for such a start is 0.
- **A separate voice-credentials type, not an optional `stt`.** `SonioxVoiceCredentials` is `{ region, tts?, clientReferenceId?, voiceLease? }`: all the voice unit reads. `SonioxCredentials` is unchanged, so the transcription side needs no guard and no assertion. The voice unit is typed on the smaller one; an own key's and a session lease's credentials satisfy it as they are. The lease hook's signature names the provider's one key type, so the voice-only branch hands its bundle on through a single commented cast in `lease.ts`.
- **The voice's port is named `voiceLease`, not `lease`.** `SonioxVoiceLeasePort` has one member, `streamAccepted()`. A session's lease puts its port under `lease`, which the voice never reads, so the transcription socket stays the only reporter there and a start is never reported twice. This is the discriminator; the voice unit does not look at the plan.
- **`LegSpeech` says `opened` once**, when its socket opens for the first time, through an optional callback. A socket reopened after an idle drop or a recycle is the same voice on the same key and is not reported again. A start whose socket fails reports when the first text's socket opens.
- **A report of a voice is tried until answered, the grant ends, or the lease is released.** The voice has no "stream ended" call: its socket closing between utterances is normal.
- **A role the request did not ask for is a contract break**, a speech role included (`par_tts` when only the speaker speaks, `mix_tts`).
- **A 400 to the voice-only request maps to `soniox_service_unavailable`.** No new code and no new words. A 400 to a session's request stays what it was.
- **The floor prices the speech roles asked for** with the existing per-role function; the cap and the words at the grant's end are those of any session that speaks.
- **A lease's end is filed under the provider whose lease it was.** `api_error.provider` for a lease end was the transcription provider's id; it is now the leased provider's. For a session on one provider the two are the same.
- **The composer takes an optional catalog** (`ComposeInput.catalog`; `optionFor` and `caps` take one too). The app passes none. It exists so a test can compose a line-up the app does not offer yet without stubbing a module.
- **Recovery.** A granted voice-only lease is remembered as `{ leaseId, apiUrl }` under the settings key `soniox.voiceOnlyLease`, device-local in the extension. It is forgotten when `session-end` is answered, a refusal included, and kept when no attempt was answered. At launch the remembered value is read once, when the page attaches; once the sign-in is there, `session-end` is sent for it with a fresh token, then it is forgotten once the service has answered about the lease and kept otherwise (no answer within 10 s, a 5xx, or a 401, 408 or 429, which say nothing about the lease), with one warning line. It is tried once per launch. A lease remembered since is never forgotten for an older one.
- **A lease asked of another API root than the one this build talks to is left alone.** No token is sent to an address read from storage that is not the build's own.
- **Only voice-only leases are remembered.** The lease takes its memory as a dependency (`KizunaLeaseDeps.voiceLeases`), so the shared lease module imports no storage.

### Not done in Part A

- The catalog flag, every surface, the locale files and the tests that pin the refusal.
- A plan with two leases: the composer still refuses two managed providers.
- The reconnect events' `managed` flag follows the transcription credentials, so it is false for an own-key text side with a hosted voice.
- The remembered lease does not record whose account it was. Ended under another account, the service refuses it and it is forgotten without having been ended.
- No run against the real service: the new request does not exist there yet.

## Decisions made while Part B was built

- **The flag.** `kizunaai_soniox` has `voiceAlone: true`. Nothing else in the catalog changed. Which text sides take the voice is the text side's `takesVoice`, as before: Soniox with an own key and this device (with its own translation or Bing's). An end-to-end provider does not, Kizuna AI's Qwen included, so `{kizunaai_qwen, kizunaai_qwen, kizunaai_soniox}` is refused with `lineup_voice_not_taken` before the two managed providers are counted. `twoManaged` and `lineup_two_managed` stay and are still reached only by stub providers in tests.
- **The "speech follows" rule is unchanged, and no released option triggers it any more.** It moves speech only when the chosen text side leaves a line-up refused for its voice. With the flag on, own-key Soniox or this device chosen for the text under Kizuna AI's Soniox on every stage keeps the hosted voice: the result runs, so nothing follows and nothing is said. A text side that takes no other voice holds all three stages jointly and takes speech with the choice itself. The rule, the line "Speech switched to {{provider}}…" (`settingsPage.lineup.voiceFollowed`) and their tests are kept for a voice that reads only its own translation; the tests reach them through a catalog in which the hosted voice is not offered alone (`ComposeInput.catalog`, and in the page's and the store's tests a mock of `choiceInput` that adds it).
- **`lineup_voice_not_alone` is produced by no released line-up.** The only voices still not offered alone are the end-to-end providers', and they have no unit for speech alone, so the composer answers `lineup_stage_split` before it looks at the voice. The code, its notice in thirty locales, its short reason (`settingsPage.lineup.voiceNotAlone`), the card tag and the target are kept: another voice may use them later, and the E2E build's `fake` option still declares `voiceAlone: false`. The property test over every line-up and every choice now runs under both catalogs and says so: no reason at all under the app's, `lineup_voice_not_alone` alone under the other. The matching test over options says no option is kept out from any line-up on one provider.
- **The line-up page needed no change and no new words.** The Speech list already listed `kizunaai_soniox`; it is now enabled beside another text side when signed in, and says "needs a sign-in" when signed out (the existing check, which runs before the composer is asked). Each card says its own service's state, so own-key text read by the hosted voice shows both requirements without anything added: the text card says the key's state ("Needs a key", "Key not verified", "Ready") and the speech card the sign-in's ("Needs a sign-in", "Ready"), each a way to its own row in Accounts and keys. The speech card's options are Kizuna AI's own (its region, voice and speed); the text card's are the own key's. The card has no state for the wallet: a balance below the floor is said by Start and by the title bar's dot, as for a whole session.
- **Start.** Nothing was wrong; tests were added at each level. The run reads every provider's credentials, so signed out the start is refused with `sign_in_required` naming `kizunaai_soniox` (its account row opens), though Soniox's key is there; readiness before Start says the same for the speech stage alone. `balanceRefusal`, `gate`, `liveGate` and `useBalanceShortfall` hold the wallet to the floor of the speech streams asked for (Part A's floor: one speech stream where a whole speaking session asks three times as much), refuse a frozen wallet, and ask no balance at all when Text Only is on. The balance notice names no provider, as today: the wallet is the account's.
- **The countdown is the voice lease's.** `Run.budget` comes from the one lease there is, capped at an hour; the footers show it as they show any budget. At its end the whole run ends with today's notices: "This segment has ended…" at the cap, "Your session balance is used up…" before it. **Known limit:** the text side, on the user's own key, could go on without the voice; it does not. A session of own-key text that had no time limit gets one once the hosted voice reads it.
- **Analytics: `managed` stays "the connection that dropped runs on a lease's key".** Reconnect events are only ever about the transcription connection; a voice reports no drop, reconnect or failure of its own (it reopens on the next text, and says `tts_degraded` when it cannot speak). So nothing was added: for own-key text with a hosted voice the events read `provider: soniox`, `managed: false`, which is true of the connection, and their `stages` name `kizunaai_soniox` for speech, which is how such a run is told apart. The lease's end is filed under `kizunaai_soniox` (Part A). Recorded in `Run.reconnectEvent`'s comment and pinned by a test.
- **Records.** Nothing was wrong. The run hands the conversation `{ provider: 'soniox', stages: { …, speech: 'kizunaai_soniox' } }`; the record stores it; the export prints `Provider: transcription=soniox, translation=soniox, speech=kizunaai_soniox` and carries `stages` in its JSON. The History page still has no service line (step 2, Part E).
- **End to end.** `e2e/specs/real-mixed-line-up.spec.ts` gains one `@real` case: Soniox with an own key read by Kizuna AI's Soniox voice, signed in. It asserts that a connection to Soniox's voice is opened, that a row can be replayed (the voice was heard), and that the record names the stages. The helpers that put the key in and sign in are shared by the three cases, and the check of the voice's connection follows the line-up's speech id. No fake service was written: the end-to-end build has none for the hosted routes, and a fake of them would be a second implementation of the contract to keep true.

## What this step leaves

Known limits:

- The whole run ends when the voice's lease does (above).
- One lease per run: two managed providers in one plan are still refused, and the only pair that could meet is refused earlier.
- With a hosted voice in the plan and Text Only on, the start still needs the sign-in, and a wallet that is loading, could not be loaded or is frozen still refuses it, though no lease would be asked. Only the floor knows that nothing is leased.
- An organization member's start below the floor is not refused by the client, as for a whole session: the service answers.
- The remembered voice-only lease does not record whose account it was (Part A).
- The words kept for a voice that is not offered alone are reached by no released option.

Not verified:

- Any run against the real service: the unit suite runs the line-up on fake sockets and a stub of the service. The new `@real` case was written and type-checked, never run. Until the service answers the voice-only request, a start of this line-up is refused as "service unavailable" (a 400, Part A), so the option must not reach users before it does.
- This device's text read by the hosted voice beyond the composer and the line-up page: no run of it, on fake sockets or real.
- macOS and Windows.
