# Engine Model Selection — Design

**Date**: 2026-08-22
**Status**: Approved by jiangzhuo 2026-08-22 (brainstormed and reviewed across seven rounds; every `file:line` verified against the working tree at `14b5496f`)

## Summary

Give "choose a model" a place of its own, and make the reverse translation direction
a first-class citizen instead of something reachable only by flipping the global
language pair.

Two changes, one enabling the other:

1. **Storage and resolution.** Selections become one record per *direction*
   (`ja→en`, `en→ja`), each holding three stages. The two directions are peers —
   neither derives from the other. A single pure resolver runs per direction, and
   `''` finally means one thing: *auto*, recomputed every time, never written back.

2. **Surfaces.** For the two local providers the provider tab *becomes* an **Engine**
   page — both directions, three slots each. A slot **expands in place** to its short
   ready list, so everyday selection needs no navigation and the other slots stay on
   screen. Pushing is reserved for the two genuinely long pages, **library** and
   **storage**, which put their back control in the content area rather than competing
   for room in an already-crowded `PanelBar`. Model cards move into the library
   unchanged, and the library holds *every* model for its stage — grouped by language
   compatibility, never filtered by it.

3. **Language, in the user's terms.** `LanguageSection` states the pair as a sentence
   whose verbs follow the current mode — *I speak … they hear …* / *I read … they
   speak …* — and shows both sentences in `both` mode. Because the sentence lives
   there, the Engine page carries no prose and no language selector: it is purely
   about which model serves which stage.

Behavior changes deliberately: the reverse direction becomes visible and editable,
auto-select stops silently rewriting the user's choice, and the mandatory
"flip the language pair to configure Other" workflow is deleted — from the storage
layer, not merely hidden in the UI.

Existing selections are **not migrated**; every stage falls to auto once, in full view
on the Engine page, where re-picking takes one tap and is then protected forever. See
**No migration**.

## Scope

**In scope**
- Selection storage, resolution, and fallback for both local providers
  (`LOCAL_INFERENCE`, `LOCAL_NATIVE`)
- Surfaces for the act of choosing: Engine page → slot → library, plus storage
- `LanguageSection` mode-dependent sentence copy
- Collapsing the three drifted copies of auto-select into one resolver

**Out of scope this round** (agreed with jiangzhuo)
- **Model card content and design.** Cards move between containers unchanged.
  Human-readable titles, latency/quality metadata, and quality tiers are a
  separate round.
- **Provider renaming.** `local_native` is unreleased and unnamed; do not touch
  `Provider` enum values, `settingsSliceKey`, or locale keys for it.
- **Per-stage cloud providers.** Only the shape is reserved (a `source` field and
  a stage-slot component contract). No cloud client work here.
- **Participant TTS (the sixth slot).** The storage slot exists; the UI does not
  render it. The participant channel stays text-only.

## The problem, measured

### 1. The act of choosing has no place

Configuring the engine today crosses two tabs five times and requires a
destructive global operation in the middle:

```
Settings → general tab → LanguageSection            set the language pair
        → provider tab → ModelManagementSection     pick ASR, translation, TTS
        → general tab  → reverse the language pair  ← destructive
        → provider tab → re-pick ASR, translation   configure "Other"
        → general tab  → reverse it back
```

The instruction to do this is shipped in the product:

```
settings.participantModelHint =
  "Switch to {{source}} → {{target}} to change Other's models"
```
(`src/locales/en/translation.json:113`, rendered at `ProviderSection.tsx:622-655`)

Simple-mode users hit an extra discontinuity: the three model chips call
`setUIMode('advanced')` then `setTimeout(() => navigateToSettings('model-asr'), 100)`
(`ProviderSection.tsx:520`, `:533`, `:548`) — a forced mode switch plus a
scroll-and-flash.

### 2. The reverse direction has no storage

Participant models are not stored. They are recomputed at session start by
*borrowing* from the reverse direction's remembered speaker selection:

- `createParticipantLocalInferenceConfig` → `modelStore.getParticipantModelStatus(...)`
  which swaps the languages internally (`modelStore.ts:453-455`)
- `createParticipantLocalNativeConfig` → `autoSelectNative(revSrc, revTgt, …,
  store.recallModels(revSrc, revTgt), …)` (`localParticipantConfig.ts:161-163`)

`recallModels(revSrc, revTgt)` returns a value **only if the user once set the global
language pair to that direction and picked models there**. That is the entire reason
the flip-the-language-pair workflow exists. Hiding the hint would not fix it; the
storage layer has to change.

Worse, that memory does not survive a reload: `modelStore` and `nativeModelStore` are
created with `subscribeWithSelector` only (`modelStore.ts:151`, `nativeModelStore.ts:204`)
— no `persist` middleware. `modelPreferences` is in-memory state.

### 3. `''` means three different things

| Stage | What `''` does today | Who resolves it |
|---|---|---|
| ASR | **Nothing is selectable** — fallback failed. Start is gated. | nobody |
| Translation | Also "nothing", but a hidden default rescues it: `requiredNativeModels` substitutes the literal `'qwen2.5-0.5b'` (`nativeCatalog.ts:152`) while `resolveNativeTranslation('')` returns `undefined` so the sidecar applies its own default | sidecar + one hardcoded id |
| TTS | **Genuine auto** — `resolveNativeTts('')` → `pickNativeTts(tgt)` picks the default voice for the target language (`nativeCatalog.ts:128-132`) | `resolveNativeTts` |

The two providers also disagree on what "best" means:
- WASM: `pickBestModel` = `recommended` first, then lower `sortOrder`
  (`modelManifest.ts:3321-3331`)
- Native: `cards.find(usable)` — **whichever card sorts first in the list**
  (`nativeCatalog.ts:534`, `:545`), which depends on `nativeTranslationCards`
  ordering (multilingual before directional), only indirectly related to
  `recommended`/`sortOrder`

### 4. Auto-select is a rewriter, not a resolver — and its copies have drifted

`autoSelectModels` **writes its result back into settings** (`modelStore.ts:614-620`,
applied by callers). So on the next run the value is indistinguishable from something
the user chose. The system cannot tell "the user picked SenseVoice" from "I picked
SenseVoice for them last time", so on every language change it must re-validate and
may rewrite everything. This is the mechanism behind "the model I chose yesterday is gone".

The WASM logic exists in **three near-identical copies**:

| Location | Recall step | Readiness check | Extra effects |
|---|---|---|---|
| `modelStore.autoSelectModels` (`modelStore.ts:543-620`) | yes | `modelUsable()` | `rememberModels` |
| `ModelManagementSection.tsx:376-437` | no | `modelUsable()` | `rememberModels` |
| `ProviderSpecificSettings.tsx:297-350` | no | **raw `modelStatuses[id]==='downloaded'`** | also resets `ttsSpeakerId = 0` |

They have already drifted. The third copy bypasses `modelUsable()`, and therefore
**skips the `deviceReady` hardware gate** (`modelManifest.ts:3301-3308`) — it can
auto-select a WebGPU-only model on a machine without WebGPU. Native has two call
sites of one shared `autoSelectNative` (`nativeModelStore.ts:533`,
`localParticipantConfig.ts:161`), which is the healthier arrangement.

### 5. Fallback is silent

Nothing tells the user their selection was replaced. The `Start` gate reports a
generic `settings.localInferenceModelsRequired` / `settings.localNativeModelsRequired`
rather than naming what is missing.

### What is already fine (do not "fix")

- `settings.sessionActiveNotice` exists and renders at the top of both settings
  modes (`SimpleSettings.tsx:76-81`, `AdvancedSettings.tsx:99-104`), translated in
  30 of 32 locales. It does **not** need to be added — it needs to be *inherited*
  by pushed pages.
- Native voice preview already exists (`NativeVoiceSection.tsx:177`, `:255`).
- `modelPreferences` is **already keyed by direction** (`Record<"src→tgt", …>`,
  `modelStore.ts:87`, `nativeModelStore.ts:20`). The shape was right all along; the
  UI only ever rendered one direction. This design promotes it, it does not replace it.

## Decisions

| Decision | Choice |
|---|---|
| Unit of storage | One record per **direction** (`ja→en`), not per lane. Speaker uses `${source}→${target}`, participant uses `${target}→${source}`. |
| Direction coupling | **None.** Neither direction consults the other. Two independent calls to one resolver. No "linked/unlinked" state, no `participantLinked` flag, no 🔗 UI. |
| `''` semantics | **Auto**, uniformly, for all three stages. Recomputed on every read. |
| Auto write-back | **Never.** An auto result is a computed value, not stored state. |
| Explicit selection under failure | **Preserved.** If the user's pick fails validation for the current direction, resolution falls through to auto for this run but `selections` is left untouched — the pick revives when the obstacle clears (the direction returns, the model is re-downloaded, the GPU comes back). |
| Explicit selection whose model left the catalog | **Pruned to `''`.** This is the one case where the resolver writes: an id the catalog no longer knows can never become valid again, so keeping it only produces a note the user cannot act on. Garbage collection, not write-back. |
| When resolution runs | On every read (Engine page render, readiness check) and **once at Start**, whose result is the session's. Never re-resolved mid-session. |
| Stale `variant` pin | **Ignored at resolution, not erased.** Falls back to the auto-picked variant, mirroring `deriveVariantRepos` (`nativeModelStore.ts:130-141`); the pin stays in `selections` and revives if its variant returns. |
| Ranking | One rule for both providers: `recommended` → lower `sortOrder` → smaller size. |
| Candidate gate | Adapters (`pool`) filter by **language only** — an un-ready or hardware-gated candidate still enters the pool, carrying its `ready`/`hardwareOk` flags. The **resolver** (`resolveStage`'s `usable` filter) is what applies `ready ∧ hardware-capable ∧ autoEligible` for auto-selection. Un-ready candidates must stay in the pool: that is what lets a note distinguish `not-downloaded` (in the pool, not ready) from `no-candidate` (nothing in the pool at all). |
| Persistence | `selections` lives in each provider's settings slice (persisted via `PROVIDER_SLICE_REGISTRY`), replacing the in-memory `modelPreferences`. |
| Entries stored | **Only directions with at least one explicit stage.** All-auto directions have no entry. This is the natural cap — no LRU needed. |
| Quantization pin | Moves from the flat `translationVariantByModel` map into the stage record as `variant`. |
| Engine page placement | **It is the provider tab's content** for the two local providers, not something pushed. Replaces `ProviderSpecificSettings`' model block; the remaining controls sit below it on the same page. |
| Slot picker | **Accordion, expanded in place** — reusing the existing `ModelGroup` (`ModelManagementControls.tsx:17`), changed to default-collapsed and single-open. Keeps the other slots on screen, which is the Engine page's whole job. |
| Navigation | **Push is an escape hatch, not the primary mechanism** — only the library and storage pages, the two that are genuinely long. Everyday selection needs no navigation at all. |
| Back affordance | **A row at the top of the content area, not a `PanelBar` slot.** `PanelBar` already carries three tabs, the Quick/Advanced toggle, and close in ~360px; a fourth cluster does not fit. Full width also lets the title be complete. |
| Library scope | **All models for that stage**, grouped: compatible with the current language first, the rest in a collapsed group. Filtering it by language would recreate "change your language pair to reach a model" — the exact antipattern this design deletes. |
| Library title | `Library · ASR` — **no language.** The page contains incompatible models too; naming a language would claim a filter it does not apply. Language belongs on the group headers, where it is doing work. |
| Language pair ownership | **`LanguageSection`**, not the Engine page. It gains mode-dependent sentence copy; the Engine page shows a compact `日本語 → English` label per direction and no selector. |
| `auto ·` prefix | **Required, not decorative.** With no migration it is how a user learns their old pick is gone and which model replaced it. |
| Migration | **None.** Legacy flat keys stay in storage unread; every stage falls to auto once. See **No migration**. |
| Chips | Three chips kept, each targeting its own slot. Advanced: switch to the provider tab and expand that slot — today's `navigateToSettings` + scroll minus the forced `setUIMode`. Simple (no tabs): push the Engine page with that slot expanded. Same component, two hosts. |
| Model cards | Moved into the library page **unchanged**. |

## Part 1 — Storage

```ts
type StageSelection = {
  /** '' = auto. Otherwise a catalog model id. */
  modelId: string;
  /** Quantization pin, scoped to this slot. Absent under auto. */
  variant?: string;
  /** Reserved for per-stage cloud providers. Unset today = local. */
  source?: string;
};

type DirectionSelection = {
  asr: StageSelection;
  translation: StageSelection;
  tts: StageSelection;   // participant direction: reserved, not rendered yet
};

/** Key: `${src}→${tgt}`. Only directions the user has explicitly touched. */
type Selections = Record<string, DirectionSelection>;
```

Added to `LocalInferenceSettings` and `LocalNativeSettings` as `selections`. Each
provider keeps its own — the catalogs are disjoint.

`sourceLanguage` / `targetLanguage` stay where they are. They select which two
directions are live:

```
speakerDirection     = `${sourceLanguage}→${targetLanguage}`
participantDirection = `${targetLanguage}→${sourceLanguage}`
```

Swapping the language pair swaps which stored record each side reads. No special
handling: the records are keyed by direction, so they follow automatically.

## Part 2 — Resolution

### The adapter that lets one function serve both providers

The two providers have incompatible catalog shapes: WASM is
`MODEL_MANIFEST: ModelManifestEntry[]` filtered by `type`; native is
`Record<id, NativeModelInfo>` filtered by `kind`, with `order` where WASM has
`sortOrder` and `sizeBytes` optional. So the resolver does not read a catalog —
each provider supplies a **normalized candidate list**:

```ts
type Candidate = {
  id: string;
  recommended: boolean;
  sortOrder: number;        // native: NativeModelInfo.order
  sizeBytes: number;        // 0 when unknown (sorts last among ties)
  ready: boolean;           // downloaded, or cloud with a valid key
  hardwareOk: boolean;      // WASM deviceReady(); native !hardwareGated()
  needsKey: boolean;        // reserved: false for every local implementation today
  /** May auto pick this? False for candidates that are selectable only on
   *  purpose — today, the AST-capable ASR entries that appear in the
   *  translation pool (see the AST special case below). Explicit lookup
   *  searches the whole pool; ranking considers only autoEligible ones. */
  autoEligible: boolean;
  /** Is this pinned quantization still offered and runnable here?
   *  `undefined` (no pin) is always supported. */
  supportsVariant: (variant: string | undefined) => boolean;
};

type CandidateSource = {
  /** Candidates for this stage and direction. Already language-filtered. */
  pool: (stage: Stage, src: string, tgt: string) => Candidate[];
  /** Catalog membership, language-agnostic. Separates "wrong direction"
   *  (revivable) from "no longer exists" (never revivable). */
  has: (stage: Stage, id: string) => boolean;
};
```

`has` is not a convenience. Without it, "absent from `pool`" conflates two cases
with opposite consequences: a model that exists but is wrong for *this* direction
(revives when the direction returns) and a model the catalog has dropped in an app
update (can never revive). The first must be preserved; the second must be pruned.

`CandidateSource` is where every per-provider predicate already lives and stays:
WASM composes `getManifestByType` + `modelUsable` + the language predicates below;
native composes `nativeAsrCards` / `nativeTranslationCards` / `nativeTtsModels`
(which already pre-filter by language) + `isDownloaded` + `hardwareGated`.
Language filtering happens **inside** the candidate source, so the list handed to
the resolver is already language-compatible.

### The resolver

Pure — no store access, no I/O:

```ts
resolveStage(
  direction: string,                  // "ja→en"
  stage: 'asr' | 'translation' | 'tts',
  selections: Selections,
  candidates: CandidateSource,
): {
  resolved: { modelId: string; variant?: string; source: 'explicit' | 'auto' } | null;
  note?: ResolutionNote;
  prune?: true;            // the stored selection can never become valid — drop it
}

resolveDirection(direction, selections, candidates)
  : { asr, translation, tts,
      notes: ResolutionNote[],
      prunes: Array<{ direction: string; stage: Stage }> }
  // = resolveStage() for each of the three stages; notes and prunes concatenated
```

`resolveDirection` is called twice per session — once for `speakerDirection`, once
for `participantDirection` — with no argument shared between the two calls beyond
`selections` and `candidates`.

```
src, tgt = direction.split('→')
pool = candidates.pool(stage, src, tgt)
sel  = selections[direction]?.[stage] ?? { modelId: '' }

if sel.modelId !== '':
    c = pool.find(c => c.id === sel.modelId)
    if c ∧ c.ready ∧ c.hardwareOk:
        variant = c.supportsVariant(sel.variant) ? sel.variant : undefined
        return { modelId: sel.modelId, variant, source: 'explicit' }

    if ¬candidates.has(stage, sel.modelId):
        note({ …, reason: 'not-in-catalog' })
        prune = true                    // the ONLY case that writes
    else if ¬c:            note({ …, reason: 'lang-incompatible' })
    else if ¬c.ready:      note({ …, reason: c.needsKey ? 'needs-key' : 'not-downloaded' })
    else:                  note({ …, reason: 'hardware-gated' })
    // fall through — selections is otherwise NOT modified

usable = pool.filter(c => c.ready ∧ c.hardwareOk ∧ c.autoEligible)
usable.sort(recommended desc, sortOrder asc, sizeBytes asc)   // sizeBytes 0 = unknown, sorts last
return usable[0]
     ? { modelId: usable[0].id, variant: undefined, source: 'auto', prune }
     : { null, prune }
```

**Pruning stays pure.** `resolveStage` does not mutate — it *reports* `prune: true`,
`resolveDirection` collects `prunes: Array<{ direction, stage }>`, and the store
applies them. A direction left with three `''` stages loses its `selections` entry
entirely (matching "only directions with at least one explicit stage are stored").

**A stale `variant` is ignored, never erased.** When the pinned variant is not
supported on this machine or no longer offered, resolution falls back to the
auto-picked variant while `sel.variant` stays in `selections` — the pin revives if
its variant does. This is exactly what `deriveVariantRepos` already does for native
(`nativeModelStore.ts:130-141`); the spec promotes it to a resolver rule shared by
both providers, so `supportsVariant` joins `Candidate`.

### Why auto is never written back

Because write-back erases the difference between *the user chose this* and *the system
picked this for them* — and nearly every behavior downstream depends on that difference.
Today both end up as the same string in settings (`modelStore.ts:614-620`). Four
consequences follow:

1. **The system can no longer honor intent.** When a language change invalidates the
   stored value, it must decide whether to keep it (it might be the user's) or replace
   it (it might be a stale auto). It cannot tell, so it replaces — which is exactly the
   "the model I chose yesterday is gone" complaint.
2. **The user is credited with choices they never made.** Auto picks SenseVoice for
   `ja→en` and writes it back; later the user is told "your selection SenseVoice is
   unavailable" about a model they never selected.
3. **Auto stops improving.** A frozen auto result outranks the ranking that produced
   it, so downloading a better model, gaining a GPU, or shipping a revised
   `recommended` flag changes nothing until the user manually re-picks. Write-back
   makes auto automatic exactly once.
4. **It manufactures the `not-in-catalog` garbage at scale.** Every frozen auto value
   can outlive the catalog it was computed against. Without write-back, only ids the
   user actually chose are stored, so the set of possibly-dead entries shrinks to
   something small enough to prune.

It also makes the resolver a pure function. Today's `autoSelectModels` returns
different results depending on how many times it has run — the second call returns
`null` because the first already wrote — so it can only be tested through the store.

The costs, stated plainly:

- **Resolution runs per read rather than once.** A filter and a sort over at most a few
  hundred entries; today's equivalent already runs on every language change.
- **Behavior can change without the user touching anything** — download a better model
  and the next session uses it. This is the real trade-off. It is mitigated by showing
  the resolved value (`auto · SenseVoice`, not bare `SenseVoice`) on every slot row, so
  the change is visible rather than mysterious.
- **The capture point becomes load-bearing** — see below.

### When resolution runs

On every read — Engine page render, slot expansion, the Start readiness check —
and **once more at Start**, whose result becomes the session's configuration.

**Nothing re-resolves mid-session.** Resolution is cheap and idempotent, so running
it per render is fine, but a running session must not shift under the user. This is
already structurally true (every model control is `disabled={isSessionActive}`, and
`client.connect(config)` snapshots the config), and "never write back" makes it a
requirement rather than an accident: because the resolved value is recomputed rather
than frozen, the *capture point* is what pins it.

**Language compatibility** is per stage, applied inside `CandidateSource`, and is
the existing predicate — unchanged:

| Stage | Predicate |
|---|---|
| ASR | `multilingual ∨ languages.includes(src)` |
| Translation | `isTranslationModelCompatible(entry, src, tgt)` — multilingual models always pass; directional Opus-MT requires exact `sourceLang===src ∧ targetLang===tgt` |
| TTS | `multilingual ∨ languages.includes(tgt)` |

**Variant**: an explicit selection carries its pin; auto leaves `variant: undefined`
so the downstream picks by hardware — WASM `selectVariant(entry, deviceFeatures)`,
native sidecar `supported`/`recommended` in `_h_models_catalog`. Unchanged behavior.

**Preserved special case — AST (speech-to-text-translation)**: the translation stage's
explicit `modelId` may name an ASR model when that model declares `astLanguages`
covering the direction; translation is then performed by the ASR model and no separate
translation model is loaded. Exists today (`modelStore.ts:583-591`); keep it.

The WASM `CandidateSource` therefore puts AST-capable ASR entries into the
**translation** pool with `autoEligible: false`. Explicit selection finds them; auto
never picks one. Today's short-circuit only fires when `translationModel === asrModel`,
so letting auto reach them would be a behavior change, not a preservation.

### Notes

```ts
type ResolutionNote = {
  direction: string;
  stage: 'asr' | 'translation' | 'tts';
  from: string | null;
  to: string | null;
  reason:
    | 'not-in-catalog'     // model no longer exists here → pruned, never revives
    | 'lang-incompatible'  // exists, wrong direction → revives with the direction
    | 'not-downloaded'     // exists, right direction, deleted → revives on re-download
    | 'hardware-gated'     // exists, deleted GPU / lost CUDA → revives with the hardware
    | 'needs-key'          // reserved: no local implementation emits this yet
    | 'no-candidate';      // nothing usable at all for this stage and direction
};
```

The first four say *why the user's pick is not being used*; only `not-in-catalog` is
terminal. The distinction is what the copy is built on: "SenseVoice was deleted —
download it again to use it" versus "SenseVoice is gone from this version."

One structure feeds three surfaces:
- **Engine page** — after a language change or a deletion, highlight the changed slot
  rows and say why
- **Start gate** — `no-candidate` names what is missing, replacing the generic
  `local*ModelsRequired` strings
- **Log panel** — supersedes the existing `ParticipantNotice[]`; merge them

### Stale selections

Because auto is never written back, `selections` holds only ids the user actually
chose — so every stale entry is a real choice that stopped working, and each has a
defined fate:

| What happened | `reason` | `selections` | Recovery |
|---|---|---|---|
| User deleted the model from the Storage page | `not-downloaded` | **kept** | re-download → revives, pin and all |
| `Clear all` | `not-downloaded` ×N | **kept** | re-download → revives |
| Language pair changed; the pick is directional | `lang-incompatible` | **kept** | change back → revives |
| Machine lost the GPU the pick required | `hardware-gated` | **kept** | GPU returns → revives |
| App update dropped the model from the catalog | `not-in-catalog` | **pruned to `''`** | none — the slot goes to auto permanently |
| Pinned quantization no longer offered/runnable | *(no note)* | **kept** | resolution silently uses the auto-picked variant; pin revives if the variant does |

`Clear all` therefore lands in a coherent state rather than a broken one: every
explicit pick survives as an unmet intent, every stage falls to auto, every auto pool
is empty, and Start is gated with a `no-candidate` note naming each missing stage —
the same state as a fresh install that has selections remembered for later.

### Session gate

| Missing | Effect |
|---|---|
| speaker ASR | Block Start; note names it |
| speaker translation | Block Start |
| speaker TTS | Do not block — degrade to subtitles only (and it is not resolved at all when `textOnly` is on) |
| participant ASR or translation | Do not block — skip the participant channel, note it. Main session proceeds. |

Speaker-mandatory / participant-optional matches today's behavior
(`createParticipantLocalInferenceConfig` returns `{success:false, reason:'no_asr'}` and
the caller skips the channel). Rationale: without the speaker leg the session is
pointless; without the participant leg it still works one-way.

### Worked example

`日本語 → English`; GPU present; downloaded: SenseVoice, Qwen 2.5 0.5B, Kokoro(en),
Opus-MT (ja→en). The user explicitly picked Opus-MT for the speaker's translation.

**`ja→en`**

| Stage | `sel` | Result |
|---|---|---|
| asr | `''` | auto → pool `{SenseVoice}` → **SenseVoice** `auto` |
| translation | `opus-mt-ja-en` | passes all three gates → **Opus-MT** `explicit` |
| tts | `''` | auto → pool `{Kokoro(en)}` → **Amy** `auto` |

**`en→ja`**

| Stage | `sel` | Result |
|---|---|---|
| asr | `''` | auto → SenseVoice is multilingual → **SenseVoice** `auto` |
| translation | `''` | auto → Opus-MT(ja→en) fails `languageOk`; pool `{Qwen 2.5}` → **Qwen 2.5** `auto` |
| tts | — | not resolved (participant is text-only) |

Both directions land on SenseVoice for ASR because each independently ranked it
first — not because they are linked. The Engine page shows the two translations
differing, which the user reads directly; no explanatory copy is needed.

## Part 3 — Language, in the user's terms

`LanguageSection` owns the language pair and states it as a sentence. The verbs
follow the current `AudioMode` (`audioStore.ts:101`, persisted under
`STORAGE_KEYS.MODE`, default `'speaker'`) — a plain `useAudioStore` selector, no
state to lift.

The observation that makes `both` mode easy: **across all three modes the two
selectors are the same two fields.** Only the verbs change.

| Mode | `sourceLanguage` | `targetLanguage` |
|---|---|---|
| `speaker` | I **speak** | they **hear** |
| `participant` | I **read** | they **speak** |
| `both` | both roles | both roles |

So `both` needs no second pair of controls and no alternate layout — one extra line.

```
speaker      I speak [ 日本語 ▾ ]  →  they hear  [ English ▾ ]

participant  I read  [ 日本語 ▾ ]  ←  they speak [ English ▾ ]

both         I speak [ 日本語 ▾ ]  →  they hear  [ English ▾ ]
             They speak English    →  I read 日本語
                     ↑ plain text, derived, not editable
```

Four properties this buys:

1. **The controls never move.** The first selector is always *my* language, the second
   always *theirs*, across all three modes. Ordering the sentence by flow
   (input → output) instead would swap them in `participant` mode, and a user
   switching modes would edit the wrong field.
2. **`both` reuses the layout** — it renders one more line, nothing else.
3. **One value never has two editable copies.** The mirror line is plain text, so
   there is no "which one wins" question.
4. **The mirror line carries real information**: that the reverse channel uses the
   *same* pair. Nothing in the product says this today.

The `→` / `←` glyphs encode who is speaking and who is receiving.

**This is also where a `ResolutionNote` belongs.** When a language change drops a
model, the note renders under the affected line — at the moment of the change, rather
than waiting for the user to open the Engine page.

Copy must align with the existing `modePicker.desc*` strings
(`ModePicker.tsx:39-44`, e.g. `"Your voice → translated for the other side."`) rather
than inventing a second vocabulary for the same three modes.

`LanguageSection` renders in simple mode and in advanced's general tab exactly as it
does today. Because the sentence lives here, the Engine page needs no prose and no
selector — which is what lets it focus entirely on models.

## Part 4 — Navigation

For `LOCAL_INFERENCE` and `LOCAL_NATIVE` the **provider tab's content is the Engine
page** — not something pushed. This is a replacement, not an added level: the tab
already renders `ProviderSpecificSettings` → `Model*ManagementSection` today. The
remaining provider controls (`TtsSpeedControl`, `SpeechModeControl`,
`TranslationPromptControl`, `VadControl`) sit below the Engine block on the same page.

That the models in use are visible with **zero navigation** is what makes shipping
without a migration safe (see **No migration**).

### Accordion for slots, push only for what is long

The content here comes in two sizes an order of magnitude apart:

| Content | Rows |
|---|---|
| A slot's ready list | **3–6** — that is the entire point of splitting ready from library |
| Library | 33 ASR / 85 translation / 139 TTS |
| Storage | everything downloaded |

Accordion suits short content and fails on long; push suits long content and is heavy
for short. So the mechanism follows the size rather than being chosen once for
everything.

The deciding test is the Engine page's job — *see all five or six slots and what
serves them at a glance*:

| Mechanism | Are the other slots still visible while picking? |
|---|---|
| **Accordion** | ✅ above and below the expanded one |
| Popover | ✅ floats over, surroundings visible |
| Push | ❌ the page is replaced; the overview is gone |
| Segmented `[ASR\|MT\|TTS]` | ❌ one stage at a time; the overview never exists |

Push would discard the page's reason for existing. Accordion is bad *today* only
because expanding ASR reveals 33 rows — and that list is now short by construction:
an expansion adds roughly 200 px, so on a 600–800 px panel the neighbouring slots stay
on screen.

Popover was considered and rejected: at 360 px it is full-width anyway, so it buys no
space, adds dismiss-on-outside-click as an accidental-close risk, and cannot host the
"browse library" entry that leads somewhere else.

`ModelGroup` (`ModelManagementControls.tsx:17`) is already this control — chevron,
title, subtitle, collapsible — so this is the repo's own idiom, not a new one. Two
changes: **default collapsed** (it is `defaultExpanded = true` today, which is where
the long page comes from) and **single-open**, so expanding one collapses the others
and the page height stays predictable.

### The back affordance is not in `PanelBar`

`PanelBar` (`PanelBar.tsx:47-65`) already renders three tabs, the Quick/Advanced
toggle (two labelled buttons), and close — three clusters in ~360 px. A fourth does
not fit. The pushed pages put their back control at the **top of the content area**
instead:

```
┌────────────────────────────────────────┐
│ [General][Audio][Provider]  [Q|A]  [✕] │  ← PanelBar untouched
├────────────────────────────────────────┤
│ ←  Library · ASR                       │  ← back lives in content, full width
│                                        │
```

Full width is not just a workaround — it is the only place a complete title fits.
Pushed pages inherit the `sessionActiveNotice` banner.

The same structure serves Electron unchanged; a wide-screen master-detail variant is
explicitly **not** built.

```
┌──────────────────────────────────┐  Engine — the provider tab itself
│  Translation engine              │
│  Local engine ready ✓            │  ← native bundle gate lives here
│                                  │
│  日本語 → English                 │  ← compact label, no prose, no selector
│   ▸ ASR   auto · SenseVoice      │
│   ▾ MT    Opus-MT (ja→en)        │  ← no "auto" prefix = explicit
│      Compute [Auto][CPU][GPU]    │     per-stage device setting
│      ● Opus-MT (ja→en)     78MB  │
│      ○ Qwen 2.5 0.5B      480MB  │  ← ready implementations only
│      ○ auto                      │
│      ＋ Browse library         › │  ← the one push from here
│   ▸ TTS   auto · Amy             │
│                                  │
│  English → 日本語                 │
│   ▸ ASR   auto · SenseVoice      │
│   ▸ MT    auto · Qwen 2.5        │
│                                  │
│  Storage  796 MB used          › │  ← push
│                                  │
│  ─── Speech ─── Prompt ─── VAD   │  ← the remaining provider controls
└──────────────────────────────────┘
```

```
┌──────────────────────────────────┐  Library (pushed)
│ ←  Library · ASR                 │  ← no language in the title
│                                  │
│  Supports 日本語            (18) │
│    [ existing model cards,       │
│      moved unchanged ]           │
│    Download → then "Use"         │  ← download does NOT auto-select
│                                  │
│  ▸ Other languages          (15) │  ← collapsed by default
└──────────────────────────────────┘

┌──────────────────────────────┐   Storage (from Engine)
│ ←  Storage         [Import]  │
│  796 MB used                 │
│  Qwen 2.5 0.5B 480MB in use 🗑│  ← flat across all three stages:
│  SenseVoice    234MB in use 🗑│     the disk view does not care
│  Whisper base  142MB unused 🗑│     about ASR/MT/TTS
│  [ Clear all ]               │
└──────────────────────────────┘
```

An expanded slot listing **only ready implementations** is what structurally shortens
the list: day to day the user faces their own three-to-six, and the 189-entry WASM
manifest appears only when they deliberately open the library, where length is
appropriate.

### The library holds every model, grouped by compatibility

Filtering the library to the current language would make "download a Korean ASR
before next week's trip" require **changing the language pair first** — resurrecting,
in a new place, the exact antipattern this design deletes. So the library carries the
whole stage, in two groups:

- **Compatible with the current language** — expanded, listed first
- **Other languages** — collapsed

The default view answers the reason people open it (*give me a better model for what
I am doing now*) while the trip case is one tap away and never touches the language
pair.

The title is therefore `Library · ASR` and not `Library · ASR · 日本語`: the page
contains incompatible models, so naming a language would advertise a filter it does
not apply. The language moves to the group header — where it also does a second job.

**Each stage keys on a different language, and the group headers finally say so:**

| Stage | Keys on | Group header, for `ja→en` |
|---|---|---|
| ASR | **source** | `Supports 日本語` |
| Translation | **the pair** | `日本語 → English` |
| TTS | **target** | `Speaks English` |

Opening the ASR library and the TTS library for the same direction shows headers
naming *different* languages — which explains, with no explanatory copy at all, why
the two lists differ. That confusion is one of the things this whole design started
from.

**Downloading something incompatible needs an honest answer.** A Korean ASR fetched
while the pair is `ja→en` will not appear in any slot. Two rules:

1. Say so at the moment of download: *Downloaded. Available when your language is
   한국어.*
2. **Offer `Download` but not `Use`** for language-incompatible models. `Use` would
   write a selection that resolution rejects on the very next read, falling straight
   back to auto — a button that cannot work.

The browse affordance carries **no count** (`＋ Browse library ›`). A number there
invites "83 of what?"; the per-group counts on the library page answer precisely.

### Deleting something that is in use

The Storage page marks rows `in use`. Deleting one is allowed — but the resolver can
compute the post-deletion outcome *before* the delete, so the inline confirmation
states the consequence instead of asking the user to predict it:

```
Delete SenseVoice?
ASR falls back to Whisper base in both directions.        [ Delete ] [ Cancel ]

Delete Qwen 2.5 0.5B?
Translation has no model left — sessions cannot start.    [ Delete ] [ Cancel ]

Clear all (796 MB)?
No models remain. Sessions cannot start until you
download at least an ASR and a translation model.
Your selections are remembered and return with them.      [ Clear ] [ Cancel ]
```

Mechanically: re-run `resolveDirection` for both directions with the target id's
`ready` forced to `false`, and describe the diff. This reuses the resolver rather than
duplicating the fallback rules in the confirmation copy — which is the point of having
one.

Deletion never edits `selections` (see **Stale selections**). Nothing is silently
un-chosen; the pick becomes an unmet intent that revives on re-download.

### Where today's controls land

| Control | Today | Destination |
|---|---|---|
| Model card (radio + name + size + tier + tooltip) | `Model*ManagementSection` | **Library**, unchanged |
| `Download` / `Cancel` / progress | on the card | **Library** |
| `Delete` | on the card | **Storage** |
| Quantization `VariantSelect` | on the card | **Library** (it chooses which precision to fetch) |
| Compute device segmented control | group header | **Inside the expanded slot** (it is a stage setting, not a model's) |
| `Import` / storage used / `Clear all` | `ModelStorageFooter` | **Storage** |
| `LicenseConsentModal` | download flow | **Library** (follows download) |
| Engine bundle (`EngineSection`) | provider tab | **Engine page**, top, as a gate |

Downloading does **not** auto-select (jiangzhuo's call). The card gains a "Use"
action once ready, and the implementation appears in the expanded slot. Pre-downloading
for a trip stays possible without disturbing the current configuration.

## Part 5 — Deletions

- `settings.participantModelHint` and the `OTHER` chip row
  (`ProviderSection.tsx:622-655`)
- The `setUIMode('advanced')` + `setTimeout(…, 100)` chip jump
  (`ProviderSection.tsx:520`, `:533`, `:548`) — chips now push
- Two of the three WASM auto-select copies (`ModelManagementSection.tsx:376-437`,
  `ProviderSpecificSettings.tsx:297-350`); the third becomes a thin wrapper over
  the resolver
- The direction-reversal blocks in `localParticipantConfig.ts` — both
  `createParticipantLocalInferenceConfig` (`:60-115`) and
  `createParticipantLocalNativeConfig` (`:143-192`) collapse to
  `resolveDirection(participantDirection)`. The long comment at `:121-142`
  explaining why re-resolution is necessary goes with them.
- `modelStore.getParticipantModelStatus` (`:448-540`) and the
  `recallModels(revSrc, revTgt)` borrow
- `nativeCatalog.ts:152`'s hardcoded `'qwen2.5-0.5b'` substitution
- `translationVariantByModel` (both the field and the comments apologizing for its name)

Also fixed in passing:
- The chip value inconsistency: WASM shows a raw model id for ASR
  (`ProviderSection.tsx:526`) while everything else shows `entry.name` (`:602`)
- `session-warning` vs `session-active-notice` class-name divergence
- Two locales missing `sessionActiveNotice`
- Native language lists are derived from the sidecar catalog rather than borrowed
  from the WASM manifest (`LocalNativeProviderConfig.ts:223`)

## No migration

Existing selections are **not** carried into `selections`. This is a decision, not an
omission.

### What actually happens

`loadProviderSettings` (`settingsStore.ts:1111-1118`) reads only the keys present in a
slice's `defaults`. Once `selections` is in the defaults and `asrModel`,
`translationModel`, `ttsModel`, and `translationVariantByModel` are out of them:

- `settings.localInference.selections` is absent from storage → loads as `{}`
- `settings.localInference.asrModel` and friends stay in storage, **never read again**
- Every stage resolves to auto: the best ready candidate by
  `recommended → sortOrder → size`

**Downloaded models are untouched.** They live in IndexedDB `sokuji-models`
(`modelStorage.ts:51`) and the sidecar's HuggingFace cache — neither is keyed on
settings. Nothing is re-downloaded and the library and storage pages are unchanged.

### Who loses what

| User | Effect |
|---|---|
| Never changed a model (most) | Effectively none — auto resolves to the same recommended model |
| **Explicitly picked a non-default model** | **That pick is lost, silently.** One time. Re-picking restores it permanently |
| `LOCAL_NATIVE` users | None in practice — unreleased, gated behind `VITE_ENABLE_LOCAL_NATIVE`, so only dev machines hold values |

The loss is **discoverable, not announced**: with `selections` empty there is no `from`
to compare against, so no `ResolutionNote` can be emitted. The user finds out by
looking.

### Why that is acceptable here

Because looking costs nothing. The Engine page **is** the provider tab (Part 4), so
the first thing a user sees on opening provider settings is every stage and the model
serving it, marked `auto ·` to say *nobody chose this*. One tap expands that slot in
place, one more writes an explicit selection — which, under "never write back", is
then protected forever.

This is why the `auto ·` prefix is a requirement rather than a nicety, and why it is
listed as such in **Decisions**.

**The recovery loop closes at S2, before the Engine page exists.** In S2 the old
`Model*ManagementSection` still renders and its selected-state read already goes
through the resolver, so its radio lands on the auto-resolved model and picking
another writes an explicit selection. See / change / persist are all available from
S2 onward; S4's `auto ·` marker adds *provenance*, which recovery does not require.

### What not migrating buys

Migration would have been the highest-risk part of this change. Because the loader is
defaults-driven, a migration would have had to read the legacy keys by explicit
`service.getSetting` probe — the same workaround the Palabra `authMode` migration
already needs (`settingsStore.ts:1149-1151`). Get that wrong and every user is
silently reset, which is strictly worse than the loss above and which no naturally
occurring test would catch.

Not migrating removes that failure mode entirely.

### Consequences to keep

- **Legacy keys are never deleted**, only unread. A downgrade to an older build still
  finds `settings.*.asrModel` at its pre-migration value, so rolling back restores the
  old selections.
- **The flat fields leave the slice types and defaults** regardless. That part is not
  optional — it is what makes `selections` the single source.
- Should a migration ever be wanted later, the legacy values are still sitting in
  storage; it can be added without having lost anything.
## Testing

`resolveStage` / `resolveDirection` are pure and take a `CandidateSource`, so the
bulk of the coverage uses synthetic candidate lists and is cheap:

- Explicit selection surviving; explicit selection failing each rejection path and
  falling through **without** mutating `selections`; the same selection reviving
  when the obstacle clears
- **One test per stale-selection row**: deleted → `not-downloaded`, kept, revives on
  re-download; direction changed → `lang-incompatible`, kept, revives on change back;
  GPU lost → `hardware-gated`, kept, revives
- **`not-in-catalog` is the only path that sets `prune`**, and `has()` returning
  `false` is the only thing that distinguishes it from `lang-incompatible` —
  the two must not be confusable given identical pools
- A direction whose three stages all prune loses its `selections` entry
- Stale `variant`: `supportsVariant(pin) === false` → resolved `variant` is
  `undefined`, **`sel.variant` is still in `selections`**, and it comes back when
  `supportsVariant` returns `true` again
- `''` → auto for all three stages, uniformly
- Ranking: `recommended` > `sortOrder` > `sizeBytes`, with ties at each level, and
  `sizeBytes: 0` (unknown) sorting last among ties
- Empty pool: `null` for ASR/translation with a `no-candidate` note; `null` for TTS
  without gating Start
- Every `reason` value is produced by the path that should produce it, and by no other
- Two directions resolving independently — the worked example above as a test
- `Clear all` end state: every pick kept, every stage auto, every pool empty,
  `no-candidate` per stage, Start gated
- The delete-confirmation preview (`ready` forced `false` for one id) predicts the
  same outcome the resolver produces after the real delete

Per-provider `CandidateSource` adapters get their own tests, since that is where the
language predicates now live:

- Each stage's language predicate, including directional Opus-MT being absent from
  the pool in the reverse direction
- AST short-circuit preserved
- `ready` / `hardwareOk` matching today's `modelUsable()` and `hardwareGated()`,
  including the `deviceReady` gate that `ProviderSpecificSettings.tsx:297-350`
  currently skips
- `has()` is language-agnostic: a directional Opus-MT absent from the reverse
  direction's pool still returns `has() === true` (so it is preserved, not pruned)
- `supportsVariant` matching what the variant picker already shows disabled, and
  what `deriveVariantRepos` already ignores

No-migration tests:

- A stored blob carrying legacy flat keys loads with `selections === {}` and every
  stage resolving to auto — the intended outcome, asserted rather than assumed
- The legacy keys are still present in storage afterwards (nothing deletes them, so a
  downgrade recovers)
- Picking a model in an expanded slot writes `selections` and survives a reload as
  `source: 'explicit'` — the recovery loop, end to end

`LanguageSection` tests:

- Verb set per `AudioMode`: `speaker` → *I speak / they hear*; `participant` →
  *I read / they speak*; `both` → the speaker line plus the derived mirror line
- Both selectors bind to the same two fields in every mode, and **the first selector
  is `sourceLanguage` in all three** — the regression guard for the ordering decision
- The mirror line is plain text (no second editable control for the same value)
- A language change that drops a model renders its `ResolutionNote` under the affected
  line

Engine page and library tests:

- Slots default **collapsed**, and expanding one **collapses the others** (the guard
  against the page growing without bound)
- An expanded slot lists only `ready ∧ language-compatible` implementations, plus the
  `auto` row
- The library shows **every** model for its stage, split into compatible and
  other-languages groups, with the second collapsed — the regression guard against
  quietly reintroducing a language filter
- Group header wording follows the stage: source for ASR, the pair for translation,
  target for TTS. Asserting ASR and TTS headers name *different* languages for one
  direction is the cheapest way to pin this.
- A language-incompatible model offers `Download` and **not** `Use`
- The browse affordance renders no count

Existing tests to re-point rather than rewrite: `modelStore.test.ts` (auto-select,
remember/recall, participant status), `nativeCatalog.test.ts` (`autoSelectNative`,
`resolveNativeTts`), `participantConfig.test.ts`, `settingsStore.translationVariant.test.ts`.

The model-chip block (`ProviderSection.tsx:503-668`) has **no** test coverage today;
its replacement gets some.

Full suite must pass at every stage boundary.

## Staging

Each stage lands independently and is independently revertible.

| Stage | Content | User-visible |
|---|---|---|
| **S0** | `LanguageSection` mode-dependent sentence copy (Part 3). **Independent of everything else** — no dependency on the resolver, shippable first and alone. | the language pair reads as a sentence; `both` mode explains its reverse channel |
| **S1** | `Selections` type, `selections` field in both slices, `Candidate` / `CandidateSource` (`pool` + `has` + `supportsVariant`) plus each provider's adapter, `resolveStage` / `resolveDirection` + tests. Nothing calls the resolver yet. | none |
| **S2** | Route all existing selection reads through the resolver; the store applies `prunes`; remove the flat fields from the slice types and defaults; delete the two duplicate auto-select copies. | **existing selections fall to auto here.** The old `Model*ManagementSection` already shows the resolved model and writes explicit picks, so see / change / persist all work from this stage. Also fixes the `deviceReady` bypass in the third copy |
| **S3** | Participant reads `selections[participantDirection]` directly; delete the reversal logic in `localParticipantConfig.ts`. | participant models become deterministic (previously depended on whether the user had ever flipped the pair) |
| **S4** | Engine page becomes the provider tab's content for both local providers; slots render as `ModelGroup` accordions (default-collapsed, single-open) showing the resolved model. | both directions visible with zero navigation; `auto ·` marks what nobody chose |
| **S5** | Expanded slot gains the ready-only list + compute device; Library page pushed (in-content back row, compatible / other-languages groups, cards moved unchanged, `Use` withheld from incompatible models). | the list the user faces daily gets short; downloading for a future language no longer needs a language change |
| **S6** | Storage page; `Import` / `Clear all` / `Delete` relocated; resolver-computed delete confirmations. | deleting an in-use model states its consequence up front |
| **S7** | Chips target their slot (tab switch + expand in advanced, push in simple); delete `participantModelHint`, the `OTHER` row, and the `setUIMode` jump. | the flip-the-language-pair workflow disappears |

Two orderings worth stating, because both look wrong at a glance:

**S2 before S4 is safe.** S2 is where existing users lose their explicit picks, and
the Engine page that displays `auto ·` does not exist until S4. But recovery does not
need the marker — it needs *see the model, change it, have it stick*, and the old
`Model*ManagementSection` provides all three the moment its reads go through the
resolver. S4 adds provenance, not recovery.

**S3 before S4 is safe.** With no UI able to write the reverse direction yet,
`selections[participantDirection]` is absent and resolution goes to auto — a
deterministic best-available pick, which is at least as good as today's "borrow from
the reverse memory if it happens to exist" for everyone who never performed the flip.

## Deferred

- Model card content: human-readable titles, latency/quality metadata, quality tiers
- A first-run wizard (the Engine page's empty state may make it unnecessary)
- Per-stage cloud providers — see the recorded plan for `local_native` growing into
  a hybrid orchestrator. Only `StageSelection.source` and the stage-slot component
  contract are reserved here.
- Participant TTS (the sixth slot) — storage exists, UI does not
- Renaming `local_native`

## Amendment (2026-08-22, post-render review)

The Library push page keeps the **original main-branch model group list**: the
Recommended / Other models subgroups with full model cards (name + size, per-card
language tags, Download/Import/In-use/Delete actions) and the existing
"Show all … models (N)" collapse for language-incompatible entries. The
compatible-first "Supports {{lang}}" / "Other languages" regrouping described in the
Decisions table for Part 4 is **superseded** — per-card language tags already carry
compatibility, and the familiar structure won on sight when both were rendered.

Unchanged invariants: the Library always lists **all** models of its stage (the
incompatible ones behind the show-all toggle, never filtered out); an incompatible
model can be downloaded but not selected; a downloaded incompatible model shows the
"Downloaded. Available when your language is X." line (now rendered inside the
show-all region). The Library view renders the stage group header-less
(`ModelGroup bare`) since the surface's own title already names the stage.

## Amendment (2026-08-23, mode-scoped surfaces and gate)

Direction visibility, the missing-models warning, and the session gate now all
follow the **effective audio mode** (`lockedMode ?? mode` in the UI; the live
picker mode in the stores), superseding the mode-blind session-gate table and
the always-both-directions Engine page of the original design:

| Mode | Engine page shows | Warning checks | Gate blocks Start on |
|---|---|---|---|
| speaker | forward leg (3 slots) | forward ASR+MT | forward ASR+MT |
| participant | reverse leg (2 slots) | reverse ASR+MT | **reverse ASR+MT** (new — a participant-only session without participant models used to start and silently do nothing) |
| both | both legs | both legs' ASR+MT | forward ASR+MT (the participant leg stays non-blocking as an auxiliary leg; its gaps surface in the warning and degrade at connect) |

TTS never blocks in any mode. The fallback-notes summary is scoped to the
visible directions for the same reason the warning is: a note about a hidden
leg would deep-link to a slot that is not rendered, and the leg becomes
relevant exactly when the mode does. `ensureSelectionReady` still resolves and
prunes BOTH directions — only the verdict and the UI scope are mode-aware.

## Amendment (2026-08-23, dropdown form + short names)

The Engine page's accordion (Part 4's slot rows with inline pickers) is
superseded by the **dropdown form**: each slot is one `label + <select>` row in
the same `select-dropdown` family as the Provider selector — the two sections
now share one control language, density, and rhythm. The select lists Auto
first (showing the resolved pick as `auto · Name`), the ready candidates with
sizes, and **Browse library…** as its last option (an action: pushes the
Library for that slot without changing the selection). Deep links flash the
target row; there is no expand/collapse state anywhere on the page. The
single-open accordion, its picker option rows, and their styles are gone.

**Short names**: the engine surface (dropdowns, chips, fallback summary) shows
short model names; full names stay in the Library and Storage cards. Derivation
strips runtime-qualifier noise from parenthesized groups (WebGPU, quantized,
int8, "99+ languages") and keeps identity-bearing parens (Opus-MT directions,
TTS voice language/gender, Online); a manifest-level optional `shortName`
overrides where derivation would collide (Whisper Tiny WebGPU vs plain).
