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

## 5. Slice 2 — Backend: billing and display

### 5.1 Billing needs no change to the money path

Verified line by line:

| Concern | Finding |
| --- | --- |
| Does the SKU misprice a preview? | No. Under `pricing: "cost_times_k"` the amount is `cost × K`; the SKU does not enter the arithmetic. |
| Could it be charged at a session rate? | No. The time-based floor is confined to STT because `buildCharge` gives every non-STT log `billableSeconds: 0`. |
| Does an unknown role break parsing? | No. `parseClientRefId` accepts any non-empty `rawRole`; it only sets `role: null`. |
| Does a missing lease raise the reconciler alarm? | No. The `matched === 0` alarm is gated on `kind === "stt"`; a `tts-` log never reaches the lease path. |

### 5.2 Display is wrong today and must change

Ledger rows are grouped by `LEDGER_GROUP_KEY_EXPR = COALESCE(reference_id, id)`,
and `reference_id` is exactly the `sessionRef` (`<accountId>:<leaseId>`) that
`BillingService.charge` writes. A preview carries a synthetic lease id, so each
preview forms its own group. Left alone, three things are visibly wrong:

1. **A session that never happened.** `USAGE_KINDS` contains `"tts"`, and
   `deriveGroupKind` calls any group with a consumption entry a `"session"`.
   Every preview would add a phantom session to the user's billing history.
2. **…labelled "text only".** `buildCharge` uses `sku: leaseSku ?? "soniox:text_only"`,
   and a preview has no lease, so it always takes the fallback — which is what
   `isTextOnlyBilled` reads to set `group.textOnly`.
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
- **New SKU `soniox:voice_preview`**, selected by `buildCharge` when
  `rawRole === "preview_tts"` instead of the `text_only` fallback, so
  `isTextOnlyBilled` no longer mislabels it. It **must be registered in the rate
  table**: an unregistered SKU makes `chargeMicroUsd` throw and the whole charge
  fail. The registered rate never affects money here — that path is reached only
  when the provider cost is unusable and `billableSeconds` is 0, giving 0.
- **A label for `voice_preview`** in the frontend billing history.

### 5.3 New endpoint

`POST /api/soniox/voices/preview-key`, mounted under the existing
`sonioxVoiceRoutes` (so it inherits the `?region=` handling).

- Auth: Better Auth session token, as the sibling endpoints do.
- Balance gate before minting, following `sonioxManagedMinBalance`'s precedent
  with a floor far below a session's: enough for a few seconds of TTS. Below it,
  `402`, and the client greys the button.
- Mints a temporary key with `usage_type: "tts_rt"`, `single_use: true`,
  `expires_in_seconds: 30`, and
  `client_reference_id = sokuji1:<accountId>:<previewId>:preview_tts` where
  `<previewId>` is freshly minted per request.
- Returns `{ apiKey, expiresAt }`. Audio never passes through the Worker.

The voice id is not a parameter: the account holds at most one voice, exactly as
`GET /mine` and `DELETE /mine` already assume.

## 6. Slice 3 — Frontend: managed preview

- `managedVoiceSource.canPreview` becomes `true`.
- Its `preview()` calls the new endpoint, then `synthesizeOnce` with the returned
  key. A 402 maps to a "top up to preview" message; everything else reuses
  `mapTtsError`.
- `manageNote` forks: BYOK keeps "previewing spends your own Soniox quota";
  managed says the preview is charged to the account balance.
- The existing in-memory `previewCacheRef` (keyed `id|language|speed`) is kept
  and is what stops a second click from spending again.

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

**Slice 2** — `soniox-voices.test.ts`: 402 below the balance floor, the minted
key's shape (`single_use`, TTL, `client_reference_id`), region pass-through.
`soniox-reconcile.test.ts`: a `preview_tts` reference produces a charge with SKU
`soniox:voice_preview`, and raises no lease alarm. `wallet-ledger.test.ts`: a
preview row derives `tts_preview`, its group derives `voice_preview` and not
`session`, and it is not marked `textOnly`; plus the **new** pin enumerating the
TypeScript `ROLE_KINDS` against the SQL `LEDGER_USE_KIND_EXPR`, which does not
exist today (§5.2). One test for the §7 alarm gate on `output_audio_duration_ms`.

**Slice 3** — `voiceLibrarySource.test.ts`: `preview()` for both sources, the 402
path, and abort.

## 9. Sequencing

1. **Shared shell + Local Native** (`kizuna-ai-lab/sokuji`) — self-contained,
   shippable alone.
2. **Backend billing/display + `preview-key`** (`kizuna-ai-lab/sokuji-backend`).
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
