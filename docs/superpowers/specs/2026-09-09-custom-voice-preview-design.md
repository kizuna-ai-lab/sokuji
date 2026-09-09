# Custom voice preview — synthesized audition

Design, 2026-09-09.

## Goal

Give a user who has just built a custom voice a play button that **synthesizes
one short sentence in that voice**, so they can hear the clone rather than infer
it from a successful build.

## Scope

Two surfaces:

- **Local Native** (Electron sidecar) — today its play button replays the
  *reference clip*, not a synthesis.
- **Kizuna AI / managed Soniox** — today it has no preview at all
  (`managedVoiceSource.canPreview === false`).

Explicitly out of scope:

- **Soniox BYOK** — already ships synthesized preview; this design only moves
  where its code lives (§3).
- **Local Inference / Supertonic** (browser WebGPU) — no preview today, stays
  that way. Its voices are imported style vectors, and synthesizing in the
  settings panel would mean initializing a WebGPU engine there.
- **Built-in voice preview.** `previewSampleFor`'s sentences are already
  neutral so this could land later, but nothing here builds it.

## 1. What already exists

`VoiceLibrarySection` — the shell all three voice sections render — already owns
the whole playback half:

| Concern | Where |
| --- | --- |
| `onPreview?: (id, signal) => Promise<{audio, sampleRate} \| null>` | `VoiceLibrarySection.tsx:63` |
| AudioContext lifecycle, resume, unmount close | `togglePreview` + unmount effect |
| Per-row spinner, single-playback mutex, stale-request invalidation | `previewTokenRef`, `previewAbortRef` |
| Button renders only for `removable && !disabled` rows | `VoiceLibrarySection.tsx:180` |

Current coverage:

| Entry point | Button | What it plays |
| --- | --- | --- |
| Soniox BYOK | yes | **synthesized** (`synthesizeOnce`, 28-language sample table, follows `ttsSpeed`, cached by `(id\|language\|speed)`) |
| Kizuna AI (managed) | no | — (`canPreview: false`: a managed user holds no Soniox key) |
| Local Native | yes | the stored **reference clip** (`store.resolveApply()`) |
| Local Inference (Supertonic) | no | — (`onPreview` never passed) |

So neither half needs new playback code. Each needs an `onPreview`
implementation.

## 2. Evidence from a live Soniox probe

Run 2026-09-09 against the US region with a project key, model `tts-rt-v2`,
voice `Nina`, Japanese sample sentence (3.33 s of audio). The key was passed
through an environment variable and is not recorded here or anywhere in the
repo.

**A. `single_use: true` works on the REST `/tts` path.**

```
mint (usage_type=tts_rt, single_use=true, expires_in_seconds=60)  → 201
synth #1 with that temporary key                                   → 200, 159744 bytes, 3.33 s, 760 ms
synth #2 with the same temporary key                               → 401
```

This matters because `CreateTemporaryKeyOpts.singleUse` documents that TTS
callers must pass `false` — but the stated reason is that *the session's TTS
socket reconnects after an idle-timeout drop and a single-use key 401s on the
reconnect*. A preview makes exactly one REST call and never reconnects, so the
reason does not apply and the stricter value is available to us.

**B. `client_reference_id` is carried verbatim into the usage log.** The log
row came back with `client_reference_id:
"sokuji1:pvprobe_acct:pvprobe_lease:preview_tts"`, so billing attribution works
exactly as the reconciler expects.

**C. Cost, and the shape of a TTS log.** The full row:

```json
{"uuid":"…","request_scope":"api",
 "client_reference_id":"sokuji1:pvprobe_acct:pvprobe_lease:preview_tts",
 "model":"tts-rt-v2","start_time":"…","end_time":"…",
 "input_text_tokens":19,"input_audio_tokens":0,"input_audio_duration_ms":0,
 "output_text_tokens":0,"output_audio_tokens":28,"output_audio_duration_ms":3328,
 "duration_ms":0,"cost_usd":"0.0006780000",
 "input_cost_usd":"0.0000760000","input_text_cost_usd":"0.0000760000",
 "input_audio_cost_usd":"0.0000000000","output_cost_usd":"0.0006020000",
 "output_text_cost_usd":"0.0000000000","output_audio_cost_usd":"0.0006020000",
 "duration_cost_usd":"0.0000000000"}
```

- `cost_usd` is **non-zero**: 678 µUSD, which at `REVENUE_COEFFICIENT_K = 2.0`
  charges the user ~1356 µUSD ≈ **$0.0014 per preview**.
- TTS is priced **by token**, not by duration.
- `input_audio_duration_ms` is **0**; the generated speech duration lives in
  `output_audio_duration_ms`. See §7 — this invalidates an existing alarm.

**D. Our concurrency mirrors match Soniox's real quotas.** `GET /v1/concurrency-limits`:

```json
{"organization": {"limits": {"transcribe_concurrent": 100, "tts_concurrent": 25,
                             "voice_agent_concurrent": 10},
                  "current": {"transcribe_concurrent": 0, "tts_concurrent": 0,
                              "voice_agent_concurrent": 0}},
 "project": {"limits": {"transcribe_concurrent": null, "tts_concurrent": null,
                        "voice_agent_concurrent": null}}}
```

`MAX_STT_CONCURRENT = 100` and `MAX_TTS_CONCURRENT = 25` are exactly right.
Project limits are null, i.e. inherited from the org. The endpoint also reports
live occupancy, which is what makes E measurable — but it is capped at 20 rpm,
which is why `countActive` mirrors the ceiling from our own lease table instead
of asking per issue.

**E. A one-shot REST `/tts` call does occupy an org TTS slot.** Polling
occupancy across a single synthesis:

```
before          tts_concurrent: 0
during +150ms   tts_concurrent: 0
during +400ms   tts_concurrent: 0
during +700ms   tts_concurrent: 0
during +1101ms  tts_concurrent: 1     ← occupied
synth 200, 1011712 bytes (21.1 s of audio), wall 18082 ms
after           tts_concurrent: 0     ← released when the call ends
```

Registration lags by roughly a second, but the slot is real. This is what makes
§5.3's `usesTts = 1` correct rather than merely conservative. Note also that the
hold scales with text length — 21 s of audio took 18 s of wall clock, against
3.33 s in 760 ms for a preview-sized sentence — so a real preview holds its slot
for about a second.

## 3. Shared layer

**One new prop on `VoiceLibrarySection`: `previewUnavailableReason?: string`.**
Today the button's existence is decided by whether `onPreview` was passed, which
gives only "button" or "no button". Local Native needs a third state — rendered,
disabled, with a tooltip saying why (§4). When the prop is set the row renders a
disabled preview control carrying that text; `onPreview` is not called.

**`sonioxPreviewSample.ts` moves to `src/lib/tts/previewSample.ts`** and is
shared by both halves. Its own docstring already anticipated this ("Sentences
are neutral … so the table can be reused"). The 28-code table and the English
fallback are unchanged.

**Which language a preview speaks.** The sentence is chosen by the user's
**target language** — what this voice will actually say in a session — and the
table returns the `{language, text}` pair together, never a bare string, so no
caller can hand the model a sentence in one language labelled as another. That
much is today's behaviour and it is right.

An earlier revision of this section claimed Native's narrower language set was
"covered by the existing fallback". **It is not.** The English fallback fires
when a language is *absent from the 28-code table*; Native's failure is a
language that is *present in the table and unsupported by the chosen TTS
family* — `ja` is in the table, and a family that cannot speak Japanese would
still be handed a Japanese sentence labelled `ja`. Two different sets.

The rule, therefore:

> The preview speaks the first language L for which **the engine speaks L** and
> **the table has a sentence for L**, considered in order: the target language,
> then `en`, then the engine's own language list in its own order. If no such L
> exists, there is no preview: the row renders the disabled control with
> `previewUnavailableReason`.

Ordering the engine's own list last, and requiring a table entry at every tier,
is what keeps the mismatch unconstructible — synthesising the English sentence
under some other language code would be exactly the defect the pair-return was
designed to prevent.

For **managed Soniox** the engine-speaks test is vacuous (Soniox documents
cloned voices as any-voice-any-language, which is also why the English fallback
still reads a correct timbre), so the rule collapses to target → `en`, i.e.
today's `previewSampleFor` unchanged. For **Local Native** the test is the
predicate the model picker already uses, `supportsLanguage(card, lang)`
(`src/lib/local-inference/native/nativeCatalog.ts`), which already handles the
`multi` wildcard and the alias table; the per-card `languages: string[]` it
reads is already on the wire (`nativeProtocol.ts`).

The preview language is **not** user-selectable. The target language is by
definition the language this voice will speak in production, so the app already
knows the answer; a picker would add a control for a settled question, and a
user who wants to hear another language can change the target language.

**`VoiceLibrarySource` gains `preview(language, speed, signal)`.** `byokVoiceSource`
implements it with today's `synthesizeOnce`; `managedVoiceSource` implements it
as "mint a preview key, then `synthesizeOnce`" (§6). `SonioxVoiceSection.handlePreview`
keeps its cache, its clamping and its error mapping, but stops holding the
`canPreview` branch and the direct Soniox call — those move behind the source.
This is the seam `voiceLibrarySource.ts` was created for: *"turns 'where do
voices come from' into a parameter."* `canPreview` stays as the capability flag
and becomes `true` for managed.

## 4. Local Native

**Behaviour.** The preview button synthesizes one sentence with the selected
custom voice. If synthesis is impossible or fails, it **falls back to replaying
the reference clip** — today's behaviour. That fallback is deliberate: replaying
the recording answers "did I record clearly?", synthesis answers "does the clone
sound like me", and both are worth having. Keeping the old path as the failure
mode costs nothing and loses nothing.

**New helper** in `src/stores/nativeModelStore.ts`, alongside `nativeListTtsVoices`:

```
nativePreviewTts({ modelId, voice, text, language, speed, signal })
  → tts_init(modelId)          (only when not already loaded)
  → set_voice(name) | set_voice(clip, sampleRate, refText?)
  → tts_generate(text, speed)
  → collect tts_generate_result + tts_chunk  → Float32Array
```

**Loading policy: load on demand, keep for the sitting, unload on leaving.** A
cold `tts_init` costs seconds and GB-scale memory, and the sidecar ties teardown
to connection lifetime — `_h_tts_init` registers
`conn.on_close(lambda: _tts_teardown(...))`, and there is no explicit unload op.
So `nativePreviewTts` runs on a **dedicated connection**, lazily created, closed
when the voice section unmounts. A second preview in the same sitting — record,
listen, re-record, listen again — is then warm, and the memory goes back when
the user leaves the panel. Never `nativeModelStore`'s own connection: that one
is the long-lived management channel and closing it would break model
management.

**A preview never blocks a session, and never warms one.** `_h_tts_init`'s own
comment settles both: *"A later `tts_init`, from this connection or another,
still evicts unconditionally … and simply records the new owner here."* A
session always takes ownership from the panel, which is why refusing previews
during a session (above) is the only coordination needed — and equally why the
resident model buys nothing for the next session. The benefit is repeat
previews, not a warm start.

**One recovery path is required.** Right after a session ends, the engine may
still record the session's (now closed) connection as owner, so the panel's next
`tts_generate` can come back `_not_owner_error`. Treat that as "re-`tts_init`
once, then retry" rather than as a failure: the panel cannot observe another
connection's ownership, so recovering is the only correct answer.

**Active sessions are refused, not attempted.** The sidecar's TTS engine is a
process singleton guarded by `_owner_conn`; the settings panel talks over
`nativeModelStore`'s own connection, not the session's, so a panel-issued
`tts_generate` during a session returns `_not_owner_error`. `NativeVoiceSection`
therefore passes `previewUnavailableReason` while `isSessionActive` and never
dials out.

**Voice-required families.** `qwen3_tts` and `omnivoice` need a reference
transcript, `index_tts2` needs the clip. `eligibleCustomVoices` already decides
which stored clips qualify; preview reuses it, so an ineligible clip's row is
already `disabled` and renders no preview control.

## 5. Backend: lease, billing and display

### 5.1 The money arithmetic needs no change

Verified line by line:

| Concern | Finding |
| --- | --- |
| Does the SKU misprice a preview? | No. Under `pricing: "cost_times_k"` the amount is `cost × K`; the SKU does not enter the arithmetic. |
| Could it be charged at a session rate? | No. The time-based floor is confined to STT because `buildCharge` gives every non-STT log `billableSeconds: 0`. |
| Does an unknown role break parsing? | No. `parseClientRefId` accepts any non-empty `rawRole`; it only sets `role: null`. |
| Does a preview's lease raise the reconciler's lease alarm? | No. Both the `matched === 0` alarm and the mask-clearing release are gated on `kind === "stt"`, so a `tts-` log never reaches that path — which is also why §5.3 has to release the lease explicitly. |

### 5.2 But reconciliation is lease-driven, so a bare key mint is never billed

Attribution works — §2B proves the `client_reference_id` reaches the usage log —
and §5.1 proves the arithmetic is right **once the log is fetched**. The gap is
that nothing would ever fetch it.

Soniox offers no webhook. The only way we learn a key was used is to pull
`/v1/usage-logs`, and every sweep that does so is gated on
`unreconciledRegions()`, which is:

```sql
SELECT DISTINCT region FROM session_leases
WHERE reconciled_at IS NULL AND started_at IS NOT NULL
  AND (expires_at <= ? OR end_signalled_at IS NOT NULL)
  AND expires_at > ?
```

Purely lease-driven. The once-a-minute cron is no exception: `runHeartbeat`
calls `runSweepIfOutstanding` behind that same gate. **There is no
unconditional sweep anywhere in the system.**

So a preview that mints a key without taking a lease is never reconciled. The
money is not lost immediately — the watermark holds its place, so the next sweep
triggered by *someone else's* session in that region would cover it — but the
billing time becomes a lottery decided by unrelated traffic, and
`clampWindow`'s `MAX_START_AGE_MS` (90 days) is a hard floor: a region nobody
runs a session in for 90 days loses that period's preview revenue permanently.

### 5.3 Preview is a session with one TTS stream and no STT

The fix is to stop treating preview as a special case and run it down the
session path. One coupling has to be understood first:

> **The exclusivity window and the billing window are the same window.**
> `unreconciledLeaseQuery` requires `reconciled_at IS NULL`, so the lease that
> triggers the sweep is the same lease that holds the account. Releasing early
> to shorten exclusivity throws away the billing trigger.

The window can be made short instead. Lifecycle, mirroring a session's two
phases exactly:

1. **Mint** — `SessionLeaseService.acquire` with the role set `['preview_tts']`:
   `usesTts = 1` so the org's `MAX_TTS_CONCURRENT` ceiling counts it — §2E
   measures that slot being taken, so this is accurate rather than merely
   conservative — `sttStreamCount = 0`, `sku = "soniox:voice_preview"`, and
   `startWindowS` matching the key's 30 s TTL, which puts the lease's backstop
   expiry at ~45 s (`+ LEASE_MARGIN_MS`). That zero is a legitimate value only
   after §5.4.
2. **Synthesize** — the client calls Soniox directly with the single-use key.
3. **Report** — the client POSTs `preview-done`, which sets `started_at` and
   `end_signalled_at` together. Same semantics as `session-started` +
   `session-end`, and the same trust model: lying can only extend the liar's own
   lock.
4. **Sweep** — `unreconciledLeaseQuery` now reports work, the debounced sweep
   runs, `buildCharge` charges `cost × K`.
5. **Release** — after charging a log whose role is `preview_tts`, the sweep
   releases that lease directly. **This step is new code**, and the reason is
   subtler than it first looks. `noteStreamEnded`'s release CASE has two arms:
   `stt_started_mask != 0 AND ((stt_ended_mask | ?) & stt_started_mask) =
   stt_started_mask`, and `stt_started_mask = 0 AND started_at IS NOT NULL`. The
   second arm is *exactly* the shape a preview lease has after `preview-done`, so
   it is not true that a TTS-only lease could never satisfy the predicate — what
   is true is that **the SQL evaluating it is never reached for a TTS log**,
   because `noteStreamEnded` is called only under `kind === "stt"`. Without the
   new step a preview lease would sit until its expiry backstop. The step keeps
   the existing principle intact: **the usage log is the unforgeable proof the
   work is over.** For STT that clears a mask; for a TTS-only preview it releases
   the lease outright. Scope it to the preview role rather than to
   `kind === "tts"`: a session's TTS log must not release its lease while the
   transcription stream is still running.

Measured from §2, the exclusivity window is roughly **6–20 s** (≈1 s synthesis +
the 3 s nudge delay + ~15 s for Soniox to post the log), not the 45 s backstop.

Those figures assume `preview-done` nudges the reconciler through the **delayed**
path — `poke({ delayMs: USAGE_LOG_NUDGE_DELAY_MS })`, the same one `session-end`
uses. This is load-bearing, not incidental. `SonioxReconcilerDO.fetch` reads a
poke carrying no usable options as the *cron heartbeat*, the single trigger that
also runs the unbudgeted voice reaper across every provisioned region; and only
the delayed path enters `alarm()`, where the fast-retry ladder (3/6/12 s) lives.
An immediate poke would therefore spend a voices census per preview, look once
before Soniox has posted anything, and then wait out the next cron beat — making
the window up to ~60 s rather than the numbers above. An earlier revision of
this spec named a "5 s sweep debounce"; no such mechanism exists, and the real
delay is the nudge's.

**Two costs, stated plainly:**

- Preview and session are mutually exclusive for that window. A preview during a
  live session gets the existing 409, which makes managed behave like Local
  Native (§4) rather than differently. A Start immediately after a preview may
  409 too; that path already ships `retryAfterMs: 3000` and a `blocked` poke
  that forces an immediate sweep.
- If the client obtains audio and then dies before `preview-done`, `started_at`
  stays NULL and this lease triggers no sweep of its own — so the charge is
  **deferred until unrelated traffic in that region sweeps**, not lost. §10
  works this through. Note this is *not* the same exposure a session has when a
  key is fetched and the client dies before `session-started`: there the client
  never connected, so Soniox generates no usage log at all and there is
  genuinely nothing to charge. Here the synthesis happened and the log exists.

**Why not allow multiple leases per account.** It would remove the exclusivity
window, and the per-lease lifecycle is already multi-row safe — `markStarted`,
`release`, `noteStreamEnded`, `releaseSatisfiedOrExpired` and
`getVoicePinContext` all key on `client_ref_id`, and `countActive` already SUMs
`stt_stream_count` rather than counting rows. But `account_id` is the table's
primary key and `acquire`'s atomic `ON CONFLICT(account_id)` upsert *is* the
single-session rule, so this is a full-table migration in D1, plus four
account-keyed sites. One of them fails silently: `currentLeaseId(accountId)`
takes `.first()` of the account's unreconciled leases and fences the voice-slot
unpin on it, so with a preview lease alive a session-end could unpin against the
wrong lease and leave the real session's voice slot pinned until its TTL — the
exact silent failure that function exists to prevent. A large set of schema
comments justified by "the row is reused (account_id is the PK)" would also have
to be rewritten. The trade is not worth 6–20 s. If a genuine "one user, several
concurrent sessions" requirement ever arrives, that migration should be its own
project and solve both at once.

### 5.4 The lease invariant widens: STT and TTS are peers

One lease change is needed, and it is not the one §5.3 just declined. The
primary key stays `account_id` and an account still holds at most one lease;
what changes is *what a lease is allowed to own*.

`stt_stream_count = 0` is not a legal value today, and the refusal is
deliberate on both sides:

- **Write.** `acquire` throws twice — `sttStreamCount must be >= 1 when
  provided`, and `sttRoles must contain at least one transcription role`.
- **Read.** `countActive` sums
  `COALESCE(NULLIF(stt_stream_count, 0), 1)`, so a stored `0` is read back
  as **1**.

Both encode one invariant, stated in the schema: *"A live lease always owns at
least one transcription stream."* A preview owns none, so it is unrepresentable
— and if a `0` did reach the table, every in-flight preview would silently
consume one of the 100 STT slots it never opened.

The fix is not to special-case preview on either side. It is to correct the
invariant, which was always narrower than the thing it was protecting:

> **A live lease owns at least one stream — STT or TTS. The two are peers, each
> bounded by its own ceiling.**

Under that reading `0` means zero, the read-side clamp loses its reason to
exist, and preview stops being a special case. **No schema change and no
migration**: the column is already `NOT NULL DEFAULT 0`, and writing a truthful
`0` into it is legal today.

**Changes:**

- **Delete the clamp.** `SUM(stt_stream_count)`; `SUM(uses_tts)` is untouched
  and already correct. Safe to delete because the clamp defends rows written by
  a Worker predating the column, during migration 0010's own deploy window. That
  migration shipped on 2026-08-11 and ends with
  `UPDATE session_leases SET stt_stream_count = 1 WHERE stt_stream_count = 0`, so
  every row it could have left at zero is a month old and long expired — a lease
  runs at most `MAX_TRANSCRIPTION_SESSION_S`, five hours. And `acquire` — the only
  writer — always names the column (its `?? 1` covers a caller who supplies
  neither form).
- **Relax `acquire`'s guards to the new invariant.** Drop the
  transcription-role requirement; keep the refusal of a negative count and of an
  empty role set; add the invariant itself as one check —
  `sttStreamCount + (usesTts ? 1 : 0) >= 1`.
- **Make the two ceiling checks the same shape.** Today one is additive and the
  other is a threshold, a leftover from TTS being capped at one stream per
  lease:

  ```ts
  if (sttStreamCount > 0 && counts.stt + sttStreamCount > MAX_STT_CONCURRENT) → stt_full
  if (usesTts        && counts.tts + 1                 > MAX_TTS_CONCURRENT) → tts_full
  ```

  The `sttStreamCount > 0` guard is what makes the STT check a true no-op for a
  TTS-only lease; today's form would still refuse one when the org is already
  over its STT ceiling, for a lease adding no STT stream.
- **Rewrite the comments that state the old invariant** — they are the only
  thing telling the next reader what `0` means. Five: `sttStreamCount` and the
  `issued_stt_mask` aside in `db/session.schema.ts`, `AcquireParams.sttStreamCount`,
  `countActive`'s clamp paragraph (deleted with the clamp), and
  `MAX_STT_CONCURRENT` in `config/soniox.ts`, which enumerates the shapes that
  own one stream and now needs the TTS-only case.
- **Replace the deleted defence with a test**, so the belt moves rather than
  disappears: `expandStreamRoles` yields at least one STT role for every
  *session* mode, meaning no session path can produce a zero-STT lease.

### 5.5 Display is wrong today and must change

Ledger rows are grouped by `LEDGER_GROUP_KEY_EXPR = COALESCE(reference_id, id)`,
and `reference_id` is exactly the `sessionRef` (`<accountId>:<leaseId>`) that
`BillingService.charge` writes. Every preview takes its own lease (§5.3) and so
carries its own lease id, so each preview forms its own group. Left alone, three
things are visibly wrong:

1. **A session that never happened.** `USAGE_KINDS` contains `"tts"`, and
   `deriveGroupKind` calls any group with a consumption entry a `"session"`.
   Every preview would add a phantom session to the user's billing history.
2. **…labelled "text only".** `buildCharge` uses `sku: leaseSku ?? "soniox:text_only"`.
   §5.3 gives the preview a lease carrying `soniox:voice_preview`, so the
   primary path is now correct — but the fallback still fires in the degenerate
   case the comment names, a lease already reconciled by the time its log
   arrives, and `isTextOnlyBilled` reads exactly that field to set
   `group.textOnly`.
3. **Indistinguishable from session TTS.** Unchanged, a preview's
   `metadata.role` would be `null` — the parser zeroes roles it does not
   recognise — so `LEDGER_USE_KIND_EXPR` falls through to the `tts-*`
   model-prefix branch and shows plain `tts`.

**Changes:**

- **`preview_tts` joins the `SonioxStreamRole` union.** Not a new pattern —
  `spk_tts` / `par_tts` / `mix_tts` are already members. Membership is what puts
  the role into `metadata.role`; TypeScript exhaustiveness then points at every
  site needing a branch (`sttRoleBit`, `usageTypeForRole`, `primaryRole`,
  `skuForRoles`, `expandStreamRoles`, `soniox-budget`). The existing
  `sttRoleBit(rawRole) === 0` guard in `routes/soniox.ts` keeps it out of the
  session mint path automatically.
- **New `EntryKind` `tts_preview`**, added to the TypeScript `ROLE_KINDS` map
  and the SQL `LEDGER_USE_KIND_EXPR` **in the same diff**. Note that nothing
  currently forces that: `wallet-ledger.test.ts` pins `LEDGER_EVENT_TYPES`, and a
  `getUsageSummary` sqlite fixture happens to exercise both sides at once, but no
  test enumerates the TypeScript map against the SQL `CASE`. A kind added to one
  and not the other drifts silently, on a page about money. **Add that pin as
  part of this work** — it is the same class of invariant the repo already
  chose to enforce elsewhere, and this change is the first to add a member since
  the map was written. `tts_preview` **stays inside `USAGE_KINDS`**: a preview is
  consumption, and the dashboard's Billing/Usage split is on `event_type = 'use'`
  regardless.
- **New `GroupKind` `voice_preview`.** `deriveGroupKind` returns it when every
  consumption entry in the group is `tts_preview`, checked *before* the generic
  session branch. Removing `tts_preview` from `USAGE_KINDS` instead would fall
  through to `entries[0].kind` and label the group `adjustment` — a different
  wrong answer, not a fix.
- **New SKU `soniox:voice_preview`**, produced by `skuForRoles(['preview_tts'])`
  and written onto the preview lease at `acquire` time. `buildCharge` then picks
  it up through the `leaseSku` lookup it already does — **no special case in
  `buildCharge` at all**, which is the payoff for routing preview through the
  lease rather than around it. It **must be registered in the rate table**: an
  unregistered SKU makes `chargeMicroUsd` throw and the whole charge fail. The
  registered rate never affects money here — that path is reached only when the
  provider cost is unusable and `billableSeconds` is 0, giving 0.
- **A label for `voice_preview`** in
  `web/src/pages/dashboard/wallet/ledger-labels.ts` — the dashboard sub-app
  inside this repo, not the client. Without it a preview row falls back to a
  generic "Usage" label, which breaks nothing and says nothing.

### 5.6 One route: `session-key` with a third mode

A preview travels the existing `POST /api/soniox/session-key`. A separate
`preview-key` route was considered and rejected: once §5.4 corrects the
invariant, the expensive parts — role vocabulary, pricing, the lease — are
shared either way, so a second route would buy nothing but a second copy of the
acquire → mint → release-on-failure sequence, whose ordering is load-bearing and
whose second, subtly different copy is how a lease leak gets introduced.

**Request.** `{ mode: 'voice_preview', region? }`. `normalizeSessionShape` gains
a third value in the same value-discriminated switch that already separates two
vocabularies; no `textOnly` or `bothSplit`.

**Role vocabulary** (`config/soniox.ts`). `preview_tts` joins
`SONIOX_STREAM_ROLES`, and that one edit turns `npx tsc --noEmit` into the
worklist for the rest: `ROLE_USAGE_TYPE` (→ `tts_rt`, so `roleKind` derives
"tts" from the one table rather than a suffix test), `sttRoleBit` (0),
`expandStreamRoles` (a new case returning `['preview_tts']` — its `never`
default makes a missed mode a compile error), `skuForRoles` (→
`soniox:voice_preview`), `maxSessionSecondsFor`, `maxKeyStartWindowS`.

**Pricing.** Register `soniox:voice_preview` in the rate table, or
`chargeMicroUsd` throws and the whole charge fails. `sonioxStartFloorMicroUsd`
would otherwise demand `MIN_SESSION_S` — 60 s — of TTS money to allow a ~3 s
preview, so preview takes an explicit small floor with §2C's measurement written
beside it. `computeSessionBudget` returns `durationS = 30` (the key's TTL) and
honest small numbers for `budgetMicroUsd` / `rateUsdPerHour` rather than nulls:
changing those field types would leak this change into every client.

**The frontend mirrors that floor as literals.**
`sokuji/src/services/providers/sonioxManagedMinBalance.ts` is import-free by
design — the subtitle window renders the same gate and must not pull the client
into its bundle — and its test restates the arithmetic. The preview floor lands
there in the same change, or the gate lies about its 402.

**Key parameters become a three-way table.** The mint loop branches on `isTts`
twice today, and preview needs a third answer on both lines. Two inverted
booleans in a loop is the shape that gets a third case wrong, so replace them
with one `keyParamsForRole(role, budget)` beside the role vocabulary:

| role | `expiresInSeconds` | `singleUse` |
| --- | --- | --- |
| `*_stt` | `keyStartWindowForRole(role)` | `true` |
| `spk_tts` / `mix_tts` | `ttsKeyExpiresInSeconds(budget.durationS)` | `false` |
| `preview_tts` | `30` | `true` (§2A) |

**Response.** `sttApiKey` becomes optional, and `primaryRole` is never called
without an STT leg — so the loud guard survives exactly where it applies:

```ts
const primary = sttCount > 0 ? primaryRole(roles) : null;
const primaryStream = primary ? streams.find((s) => s.role === primary) : null;
if (primary && !primaryStream) throw new Error(...);
```

No client change is required: existing clients never send the new mode, and the
two repos do not share this type.

**`POST /api/soniox/preview-done`** — one new endpoint, and unavoidable. Sets
`started_at` and `end_signalled_at` together, with no TTL extension. Fenced on
the account **and the preview SKU**, not on `client_ref_id`: the body is empty
(the server resolves the account's own lease, as `session-end` does), so there
is no reference to fence on, and scoping to the SKU is what stops a client
calling it mid-session from forging a session's `started_at`. `session-started` extends the lease to the full granted duration
and derives a mask bit from the role, both wrong for a 45-second TTS-only lease;
`session-end` sets only the second timestamp.

The voice id is not a parameter: the account holds at most one voice, exactly as
`GET /mine` and `DELETE /mine` already assume.

## 6. Frontend: managed preview

- `managedVoiceSource.canPreview` becomes `true`.
- Its `preview()` is three steps: `POST /session-key` with
  `{ mode: 'voice_preview' }` → `synthesizeOnce` with the returned `ttsApiKey`
  → `POST /preview-done`. The third step is **not** conditional on the caller
  still wanting the audio: it must run even when the user has already aborted
  the preview, because it is what makes the charge prompt and deterministic
  rather than dependent on unrelated traffic (§10), and what lets the sweep
  release the account's lease instead of leaving it to expire. Fire it from a
  `finally`, not from the success path — a user cancelling is far more common
  than a crash.
- The key it uses is `ttsApiKey`, not `sttApiKey` — for this mode the latter is
  absent by design (§5.6).
- Error mapping: `402` → "top up to preview"; `409` → "a session is running,
  try again in a moment" (the same condition Local Native words as a disabled
  button); `503` → the existing capacity message; everything else reuses
  `mapTtsError`.
- `manageNote` forks: BYOK keeps "previewing spends your own Soniox quota";
  managed says the preview is charged to the account balance.
- The existing in-memory preview cache is kept and is what stops a second
  listen from taking another lease and spending again. Two changes to it:

  **Lifetime is the app session, not the component's.** Today it is a `useRef`
  inside `SonioxVoiceSection`, so closing the settings panel, switching section
  or changing provider throws it away and the next listen pays again. That was
  tolerable while a preview only spent the user's own BYOK tokens; a managed
  preview spends wallet balance *and* takes the account's exclusivity lease for
  15-45 s, during which a real session start gets a 409. So the cache moves to
  its own module and outlives the sections.

  **It is deliberately not persisted.** Surviving a restart would mean handling
  "same id, different content", and that failure mode — a user re-records a
  reference clip, previews, and hears the OLD clone, concluding the re-record
  did not take — is worse than paying twice. Within one app session the hazard
  cannot arise: `NativeVoiceStore` exposes `rename`/`delete`/`resolveApply` and
  no in-place replacement, so a re-record is always a new id, and a re-cloned
  managed voice is a new Soniox UUID. Content is immutable per id; that is what
  makes the longer lifetime safe, and it is a property of today's stores rather
  than a guarantee anyone wrote down, so a store that gains in-place replacement
  must revisit this.

  **The key gains a namespace.** `id|language|speed` was unambiguous only
  because the `useRef` lived inside one section bound to one source. A
  module-level cache outlives that, and `custom:1` means different clips under
  different TTS models (`voiceStoreFor(custom, modelId)`), so the key becomes
  `source|id|language|speed`. The existing `useEffect(..., [source])` clear is
  kept as well: it is what stops audio cached against one voice project from
  replaying under another.

## 7. A pre-existing defect this work uncovers

The reconciler's zero-cost alarm is gated on `log.input_audio_duration_ms > 0`.
The probe in §2 establishes that a TTS log reports `input_audio_duration_ms: 0`
and puts the generated duration in `output_audio_duration_ms` — a field
`UsageLog` does not even declare. So **both branches of that alarm are
unreachable for every `tts-` log**, and its own comment says as much about its
uncertainty: *"What Soniox's `input_audio_duration_ms` typically reports on a
live tts- log is NOT established anywhere in this repo … so this alarm is
written to cover both outcomes rather than assume one."* It is now established.

Consequence: if Soniox ever reports `cost_usd` of 0 for a TTS log, the row is
given away and the alarm written to catch that cannot fire.

This is not introduced by preview, but preview makes it likelier to matter —
previews are the smallest TTS calls we will ever issue and therefore the closest
to a rounding boundary. Fix, in the backend phase: declare `output_audio_duration_ms` on
`UsageLog` and gate the alarm on it for TTS logs.

## 8. Testing

TDD throughout.

**Shared shell** — `previewUnavailableReason` renders a disabled control with the
given text and never invokes `onPreview`.

**Local Native** — `nativePreviewTts` unit tests over a mocked connection, covering
the `tts_init → set_voice → tts_generate` order, the skip when already loaded,
and abort propagation. `NativeVoiceSection`: synthesis succeeds; synthesis fails
and falls back to the reference clip; active session renders the disabled state
without dialling out.

**Backend** — `soniox.test.ts` (the session-key route): `mode: 'voice_preview'`
returns a `ttsApiKey` and no `sttApiKey`, with `single_use: true` and a 30 s TTL
on the minted key and a `client_reference_id` derived from the lease's base ref;
402 below the preview floor; 409 when the account already holds a lease; 503 on
`tts_full`; region pass-through; and `preview-done` setting both timestamps
on a preview lease while leaving a session lease untouched. A companion test that every *other* mode still
returns `sttApiKey` — the optionality must not become general.
`config/soniox.test.ts`: `expandStreamRoles` yields at least one STT role for
every session mode (the belt that replaces §5.4's deleted guard), and
`keyParamsForRole` covers all three rows of its table.
`session-lease.test.ts`: `acquire` with the `['preview_tts']` role set records
`uses_tts = 1` and `stt_stream_count = 0`; `countActive` counts it as 0 STT and
1 TTS with the clamp gone; such a lease is admitted while the STT ceiling is
full and refused only by `tts_full`; an empty role set still throws; a negative
count still throws. `soniox-reconcile.test.ts`: a `preview_tts`
reference produces a charge carrying the lease's `soniox:voice_preview` SKU with
no special-casing in `buildCharge`; the sweep **releases** that lease after
charging it (the case the `(ended & started)` predicate cannot cover); and no
lease alarm is raised. `wallet-ledger.test.ts`: a
preview row derives `tts_preview`, its group derives `voice_preview` and not
`session`, and it is not marked `textOnly`; plus the **new** pin enumerating the
TypeScript `ROLE_KINDS` against the SQL `LEDGER_USE_KIND_EXPR`, which does not
exist today (§5.5). One test for the §7 alarm gate on `output_audio_duration_ms`.

**Managed wiring** — `voiceLibrarySource.test.ts`: `preview()` for both sources, the
402/409/503 paths, and — the one that matters most — that an **aborted** preview
still issues `preview-done`. A test that only checks the happy path would let
the lease-leaking regression through.

## 9. Sequencing

**Backend first, then both frontend halves together.** The backend is
deployable on its own and reachable by nothing users run today, so it can go out
and settle before any client can call it.

1. **Backend** (`kizuna-ai-lab/sokuji-backend`), in five landable steps:
   1. **Vocabulary and pricing** (§5.6): `preview_tts` into the role union, then
      follow `tsc --noEmit`; the new SKU and its rate-table entry; the preview
      balance floor.
   2. **The lease invariant** (§5.4): drop the clamp, relax the guards, make the
      ceiling checks symmetric, rewrite the five comments. Touches the critical
      path for every paying session — write the tests first.
   3. **Display** (§5.5): the new entry and group kinds, and the TS↔SQL pin.
      Needs only step 1's SKU, so it can land beside step 2 rather than after it.
   4. **The route and `preview-done`** (§5.6). Needs steps 1 and 2.
   5. **Reconciliation** (§5.3 step 5, and §7's alarm gate).
2. **Both frontend halves together** (`kizuna-ai-lab/sokuji`): the shared shell
   and Local Native (§3, §4) alongside the managed wiring (§6). They share the
   shell change, so splitting them costs a second pass over the same file for no
   gain once the backend is already deployed. This phase also carries the two
   frontend file the backend work would otherwise have dragged along: the
   preview floor's literal mirror in `sonioxManagedMinBalance.ts`, which cannot
   be exercised until this phase ships.

   **Correction, found during phase 1's Task 4.** The `voice_preview` label was
   listed here too, on the assumption it lived in the client repo. It does not:
   the wallet ledger's user-facing labels are
   `web/src/pages/dashboard/wallet/ledger-labels.ts`, inside `sokuji-backend`'s
   own dashboard sub-app. It belongs in phase 1, beside the kinds it names.
   Until it lands, a preview row falls back to a generic "Usage" label by
   design, so nothing breaks — but the display work of §5.5 is not finished
   without it.

**Phase 1 changes nothing a shipped client can observe**, which is what makes
this order safe:

- Existing clients never send `mode: 'voice_preview'`, so the route and every
  value derived from the role set behave exactly as before. `sttApiKey` becomes
  optional in the response type but is still always present for every other
  mode — §8 pins that with its own test.
- Dropping `countActive`'s clamp is arithmetically identical for every live row:
  migration 0010 ends with
  `UPDATE session_leases SET stt_stream_count = 1 WHERE stt_stream_count = 0`,
  and the only rows the clamp could still be correcting come from a Worker that
  predates the column, which cannot still be live.
- Relaxing `acquire`'s guards only admits what was previously refused. Making
  the ceiling checks symmetric is the same inequality (`counts.tts >= MAX` is
  `counts.tts + 1 > MAX`), and the added `sttStreamCount > 0` only changes the
  answer at zero, which no session shape produces.
- The new entry and group kinds cannot occur until a preview row exists, i.e.
  until phase 2.

One consequence is not client-facing but should be expected: §7's alarm gate fix
makes a currently unreachable alarm reachable. If Soniox ever reports a
`cost_usd` of 0 on a TTS log, phase 1 is when we would start seeing it — which
is the point of fixing it.

## 10. Open items

- The preview floor's literal mirror (`sonioxManagedMinBalance.ts`) and the
  backend's own constant must state the same number and cite the same
  measurement. Nothing but a test enforces that; §8 covers the arithmetic but
  not the citation.
- The balance floor for a preview is a new constant (§5.6). §2C measures one
  preview at ~1356 µUSD charged; pick the floor from that with headroom, and
  state the measurement next to the constant — in both copies.
- **Previews and speech-to-speech compete for the same 25 TTS slots, with no
  sub-quota.** `acquire` counts a preview against `MAX_TTS_CONCURRENT` (§5.3),
  which is correct — §2E measures the slot being taken — but it means a burst of
  concurrent previews can refuse a paying session with `tts_full`.

  **Two different holds, and the longer one is the one that binds.** §2E measures
  Soniox's own occupancy: about a second for a preview-sized sentence. But
  `acquire` refuses on *our* number, and `countActive` sums `uses_tts` over every
  lease with `expires_at > now AND reconciled_at IS NULL` — so a preview occupies
  one of the 25 slots for as long as its **lease** lives, not as long as the API
  call does. That is typically **15–25 s** (a second or two to `preview-done`,
  the 3 s nudge delay, ~15 s for Soniox to post the log) and **45 s** worst
  case when the client dies before reporting. An earlier revision of this bullet
  said "about a second" and was wrong by 15–45x. The conclusion that ~25
  concurrent previews are needed to starve a session survives, but the
  probability it rests on does not, and the phase-2 sub-quota decision has to be
  made on the lease figure. The hold stays bounded even on the self-inflicted
  `session-started` path, because a preview lease's `max_duration_s` is
  `PREVIEW_KEY_TTL_S`, so `markStarted` re-extends it to only ~45 s.

  Phase 1 cannot exhibit any of this, because nothing issues previews until
  phase 2. Surfaced by the Task 3 review, corrected by the final whole-branch
  review. The phase-2 plan should decide whether a sub-quota is worth its
  complexity, rather than discovering the question in production.

- **A client that obtains audio and dies before `preview-done` has its charge
  deferred, not lost.** `started_at` gates only whether *this lease* makes its
  region report work, i.e. whether a sweep is triggered. It does not filter
  which logs a sweep charges: the loop calls `buildCharge` for every log in the
  window, attribution comes from the log's own `client_reference_id`, and
  `findLeaseSku` reads `client_ref_id` with no expiry or reconciled filter, so
  an expired, unreconciled preview row still yields the right SKU. The next
  sweep triggered by anyone's session in that region therefore charges it
  correctly — the watermark never advanced past the log. What is lost is
  determinism, not the money: the billing time becomes a lottery decided by
  unrelated traffic in that region, and the charge is lost outright only if no
  sweep runs there before `clampWindow`'s 90-day floor moves past the log. This
  is the same reasoning §5.2 gives for the no-lease design, and it applies
  unchanged here. `preview-done` is therefore what makes billing prompt and
  deterministic, not what makes it happen at all — which is still reason enough
  to fire it from a `finally` (§6), because a user cancelling a preview is far
  more common than a crash.

Two items were closed rather than left open. Whether a one-shot REST `/tts`
call occupies an org TTS slot: it does — §2E. And whether the sidecar's panel
connection is distinct from a session's: it is, stated at
`nativeModelStore.ts`'s own `const client = new NativeModelClient()` —
*"Singleton management connection (separate from session-stage clients)"* — so
§4's refusal during an active session rests on the code rather than on
inference.
