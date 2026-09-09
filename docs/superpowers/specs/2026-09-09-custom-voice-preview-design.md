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

## 3. Shared layer

**One new prop on `VoiceLibrarySection`: `previewUnavailableReason?: string`.**
Today the button's existence is decided by whether `onPreview` was passed, which
gives only "button" or "no button". Local Native needs a third state — rendered,
disabled, with a tooltip saying why (§4). When the prop is set the row renders a
disabled preview control carrying that text; `onPreview` is not called.

**`sonioxPreviewSample.ts` moves to `src/lib/tts/previewSample.ts`** and is
shared by both halves. Its own docstring already anticipated this ("Sentences
are neutral … so the table can be reused"). The 28-code table and the English
fallback are unchanged. Native's language set does not match Soniox's; the
existing fallback covers the difference.

**`VoiceLibrarySource` gains `preview(language, speed, signal)`.** `byokVoiceSource`
implements it with today's `synthesizeOnce`; `managedVoiceSource` implements it
as "mint a preview key, then `synthesizeOnce`" (§6). `SonioxVoiceSection.handlePreview`
keeps its cache, its clamping and its error mapping, but stops holding the
`canPreview` branch and the direct Soniox call — those move behind the source.
This is the seam `voiceLibrarySource.ts` was created for: *"turns 'where do
voices come from' into a parameter."* `canPreview` stays as the capability flag
and becomes `true` for managed.

## 4. Slice 1 — Local Native

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

**Loading policy: load on demand, then keep.** A cold `tts_init` costs seconds
and GB-scale memory; keeping the model resident afterwards means the next
session starts warm, so the cost is paid once and reused rather than wasted.

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

## 5. Slice 2 — Backend: lease, billing and display

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
   `usesTts = 1` so the org's `MAX_TTS_CONCURRENT` ceiling counts it,
   `sttStreamCount = 0`, `sku = "soniox:voice_preview"`, and `startWindowS`
   matching the key's 30 s TTL, which puts the lease's backstop expiry at
   ~45 s (`+ LEASE_MARGIN_MS`).
2. **Synthesize** — the client calls Soniox directly with the single-use key.
3. **Report** — the client POSTs `preview-done`, which sets `started_at` and
   `end_signalled_at` together. Same semantics as `session-started` +
   `session-end`, and the same trust model: lying can only extend the liar's own
   lock.
4. **Sweep** — `unreconciledLeaseQuery` now reports work, the debounced sweep
   runs, `buildCharge` charges `cost × K`.
5. **Release** — after charging a log whose `rawRole` is `preview_tts`, the sweep
   releases that lease directly. **This step is new code.** The existing release
   predicate is `(ended & started) = started AND started != 0`, and TTS roles
   carry no bit by design — *"a session may legitimately produce zero TTS logs
   and a bit nothing can clear would build a lease that never releases"* — so a
   TTS-only lease can never satisfy it and would otherwise sit until expiry. The
   new step keeps the existing principle intact: **the usage log is the
   unforgeable proof the work is over.** For STT that clears a mask; for a
   TTS-only preview it releases the lease outright.

Measured from §2, the exclusivity window is roughly **6–20 s** (≈1 s synthesis +
5 s sweep debounce + ~15 s for Soniox to post the log), not the 45 s backstop.

**Two costs, stated plainly:**

- Preview and session are mutually exclusive for that window. A preview during a
  live session gets the existing 409, which makes managed behave like Local
  Native (§4) rather than differently. A Start immediately after a preview may
  409 too; that path already ships `retryAfterMs: 3000` and a `blocked` poke
  that forces an immediate sweep.
- If the client obtains audio and then dies before `preview-done`, `started_at`
  stays NULL, no sweep is triggered, and that charge is lost. This is the same
  exposure a session already has when a key is fetched and the client dies
  before `session-started`, and it is tolerated there for the same reason.

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

### 5.4 Display is wrong today and must change

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
- **A label for `voice_preview`** in the frontend billing history.

### 5.5 New endpoints

Both mounted under the existing `sonioxVoiceRoutes`, so they inherit its
`?region=` handling, and both authenticated with a Better Auth session token
like their siblings.

**`POST /api/soniox/voices/preview-key`**

- Balance gate first, following `sonioxManagedMinBalance`'s precedent with a
  floor far below a session's. Below it, `402`, and the client greys the button.
- `SessionLeaseService.acquire` with the `['preview_tts']` role set (§5.3). An
  `active_lease` refusal returns the existing `409` with `retryAfterMs`; a
  `tts_full` refusal returns the existing `503`.
- Mints a temporary key with `usage_type: "tts_rt"`, `single_use: true`,
  `expires_in_seconds: 30`, and `client_reference_id` = the lease's own base ref
  plus the role segment: `sokuji1:<accountId>:<leaseId>:preview_tts`. The lease
  id is the one `acquire` just issued, not a separate identifier — that is what
  lets the sweep find the lease from the log.
- Returns `{ apiKey, expiresAt }`. Audio never passes through the Worker.

**`POST /api/soniox/voices/preview-done`**

- Sets `started_at` and `end_signalled_at` on that lease, fenced on
  `client_ref_id` the way `markStarted` already is.
- Empty body, like the shipped `session-end`: the server reads the account's
  current lease itself rather than trusting the client to name one.

This is a **separate handler from the session-key route**, not a new branch
inside it. `primaryRole` throws when a role set contains no STT leg
(`"primaryRole: role set has no STT stream"`), and the session handler calls it;
a preview has no STT leg by construction. Keeping the two paths apart is what
stops that from becoming a runtime throw on a live endpoint.

The voice id is not a parameter to either: the account holds at most one voice,
exactly as `GET /mine` and `DELETE /mine` already assume.

## 6. Slice 3 — Frontend: managed preview

- `managedVoiceSource.canPreview` becomes `true`.
- Its `preview()` is three steps: `preview-key` → `synthesizeOnce` with the
  returned key → `preview-done`. The third step is **not** conditional on the
  caller still wanting the audio: it must run even when the user has already
  aborted the preview, because it is what releases the account's lease and
  triggers the charge. Fire it from a `finally`, not from the success path.
- Error mapping: `402` → "top up to preview"; `409` → "a session is running,
  try again in a moment" (the same condition Local Native words as a disabled
  button); `503` → the existing capacity message; everything else reuses
  `mapTtsError`.
- `manageNote` forks: BYOK keeps "previewing spends your own Soniox quota";
  managed says the preview is charged to the account balance.
- The existing in-memory `previewCacheRef` (keyed `id|language|speed`) is kept
  and is what stops a second click from taking another lease and spending again.

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
to a rounding boundary. Fix, in Slice 2: declare `output_audio_duration_ms` on
`UsageLog` and gate the alarm on it for TTS logs.

## 8. Testing

TDD throughout.

**Shared shell** — `previewUnavailableReason` renders a disabled control with the
given text and never invokes `onPreview`.

**Slice 1** — `nativePreviewTts` unit tests over a mocked connection, covering
the `tts_init → set_voice → tts_generate` order, the skip when already loaded,
and abort propagation. `NativeVoiceSection`: synthesis succeeds; synthesis fails
and falls back to the reference clip; active session renders the disabled state
without dialling out.

**Slice 2** — `soniox-voices.test.ts`: 402 below the balance floor, 409 when the
account already holds a lease, 503 on `tts_full`, the minted key's shape
(`single_use`, TTL, `client_reference_id` derived from the lease's base ref),
region pass-through, and `preview-done` setting both timestamps fenced on
`client_ref_id`. `session-lease.test.ts`: `acquire` with the `['preview_tts']`
role set records `uses_tts = 1` and `stt_stream_count = 0`, and counts toward
`countActive().tts` but not `.stt`. `soniox-reconcile.test.ts`: a `preview_tts`
reference produces a charge carrying the lease's `soniox:voice_preview` SKU with
no special-casing in `buildCharge`; the sweep **releases** that lease after
charging it (the case the `(ended & started)` predicate cannot cover); and no
lease alarm is raised. `wallet-ledger.test.ts`: a
preview row derives `tts_preview`, its group derives `voice_preview` and not
`session`, and it is not marked `textOnly`; plus the **new** pin enumerating the
TypeScript `ROLE_KINDS` against the SQL `LEDGER_USE_KIND_EXPR`, which does not
exist today (§5.4). One test for the §7 alarm gate on `output_audio_duration_ms`.

**Slice 3** — `voiceLibrarySource.test.ts`: `preview()` for both sources, the
402/409/503 paths, and — the one that matters most — that an **aborted** preview
still issues `preview-done`. A test that only checks the happy path would let
the lease-leaking regression through.

## 9. Sequencing

1. **Shared shell + Local Native** (`kizuna-ai-lab/sokuji`) — self-contained,
   shippable alone.
2. **Backend: preview lease, the two endpoints, and the display fixes**
   (`kizuna-ai-lab/sokuji-backend`). The lease work (§5.3) and the display work
   (§5.4) are separable and can land as two PRs in that order — the lease is
   what makes a preview bill at all, the display work is what makes the
   resulting ledger row read correctly.
3. **Frontend managed wiring** (`kizuna-ai-lab/sokuji`) — depends on 2 being
   deployed.

## 10. Open items

- Whether the sidecar's panel connection and a session's connection are
  genuinely distinct is inferred from `nativeModelStore` holding its own client;
  confirm during Slice 1. The design's failure mode (refuse during a session) is
  correct either way, but the reason stated in the tooltip should be accurate.
- The balance floor for a preview is a new constant. §2 measures one preview at
  ~1356 µUSD charged; pick the floor from that with headroom, and state the
  measurement next to the constant.
- **Does a one-shot REST `/tts` call occupy one of Soniox's "concurrent realtime
  TTS streams"?** §5.3 charges the preview against `MAX_TTS_CONCURRENT` on the
  assumption that it does. If it does not, we are under-serving that ceiling by
  one slot per in-flight preview — conservative, and the safe direction to be
  wrong in, but worth confirming with Soniox rather than leaving as a guess.
- **A client that obtains audio and dies before `preview-done` is never
  charged** (§5.3). Accepted, because a session has the identical exposure
  between key issue and `session-started`. If preview volume ever makes this
  material, the fix is the same one that would fix it for sessions, and should
  be done for both at once rather than only here.
