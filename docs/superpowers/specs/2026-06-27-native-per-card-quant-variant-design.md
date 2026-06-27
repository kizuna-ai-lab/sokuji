# Native Per-Card Quant Variant (decouple download-variant from model selection)

## Problem

The native translation variant picker (FP8 / bf16) conflates two distinct
actions. Clicking a quant in a card's dropdown calls `handlePinVariant`, which
writes **both** the variant *and* the active model:

```ts
update({ translationModel: selectId, translationVariant: variantId });
```

So picking "FP8" on the HY-MT2 card also makes HY-MT2 the active translation
model. That model change then triggers the auto-select reconcile effect
(`NativeModelManagementSection.tsx:459`), which — because the just-picked model
isn't downloaded yet — bounces the selection to the first already-downloaded
model (e.g. HY-MT1.5). Net effect: **you cannot choose which quant to download;
the pick is treated as "use this model now" and gets reverted.**

Root cause: there is a single `translationVariant` setting *scoped to the active
model* (`pinnedVariantId = cardId === translationModel ? translationVariant :
undefined`), so the only way to attach a variant to a card is to first make that
card the active model.

## Goal

Make the variant dropdown a **per-card download choice** — "which quantization
to download for this model" — independent of which model is active. Picking a
quant never changes the active model and never triggers auto-select. Each model
card shows and controls its own chosen quant.

Decided behavior (from brainstorm):
- **One chosen quant per model.** Picking FP8 makes FP8 the variant this model
  downloads/uses; a previously-downloaded bf16 is just stale (deletable
  separately), not auto-used.
- **Load = downloaded.** A card can only download one variant, so the loaded
  variant *is* the downloaded one — load reads the same per-model value the
  download used; no separate load logic.
- **No migration.** The old single `translationVariant` is removed; any prior
  pin resets to the model's default (acceptable for this dev-stage feature).

## Non-Goals

- The broader auto-select bug ("a manual selection of a not-yet-downloaded model
  reverts to a downloaded one"). Decoupling removes its trigger for the variant
  flow; the reconcile logic in `autoSelectNative` is left untouched here.
- Multiple variants of one model coexisting on disk with a "use which" switch.
- Variants for non-translation stages (only HY-MT translation models have them).

## Architecture

Two changes, one in each layer:

1. **Renderer — replace the single pin with a per-model map.** The chosen quant
   becomes a property of the model id, not of the active selection. The variant
   dropdown writes only that map; selecting the active model stays a separate
   action (`selectCard`, the card body).
2. **Sidecar — make download *status* variant-aware.** Today
   `model_status(model_id)` checks the *default* (bf16) repo, so a card's
   "downloaded" badge ignores the chosen quant. Status must check *the chosen
   variant's* repo, so the card tells the truth about what's on disk and a
   "ready" model's chosen variant always equals its downloaded variant.

Download already supports a per-variant repo (`download_specs(model_id, repo)` +
`download(..., repo)`); load already accepts a `select_variant` pin. So those
two paths just read the new per-model value.

## Data model

`src/stores/settingsStore.ts` — in `LocalNativeSettings`:

```ts
// REMOVE:
translationVariant?: string;                       // single pin, scoped to active model
// ADD:
translationVariantByModel: Record<string, string>; // modelId -> chosen quant id, e.g. { 'hy-mt2-1.8b': 'fp8' }
```

- Keyed by model id, **global across language directions** (FP8-ness is a model
  property, not a pair property). Persisted in settings; default `{}`.
- A model with no entry uses its **recommended** variant (from `list_variants`).
- `buildNativeSessionConfig` (settingsStore.ts:739) changes from
  `translationVariant: settings.translationVariant` to
  `translationVariant: settings.translationVariantByModel[settings.translationModel]`
  (the active model's chosen quant — the `select_variant` load pin).

## Components / files

Renderer (`src/`):
- `stores/settingsStore.ts` — field swap + `buildNativeSessionConfig` + default.
- `components/Settings/sections/NativeModelManagementSection.tsx` —
  `handlePinVariant` writes only the map (no model switch); `pinnedVariantId` and
  the per-card status read the map; the status query passes each card's chosen
  variant repo.
- `lib/local-inference/native/NativeModelClient.ts` + `nativeProtocol.ts` — the
  `model_status` request carries an optional per-model repo override.
- `stores/nativeModelStore.ts` — `refresh()` builds the per-model repo overrides
  from the chosen variants and threads them to `client.status`.

Sidecar (`sidecar/sokuji_sidecar/`):
- `native_models.py` — `model_status(model_id, repo=None)` (repo override mirrors
  `download_specs`); `_h_model_status` reads a per-model repo map from the msg.

## Variant pick (the decouple)

`handlePinVariant(selectId, variantId)` becomes:

```ts
update({
  translationVariantByModel: { ...settings.translationVariantByModel, [selectId]: variantId },
});
// NO translationModel write, NO setAutoSelectedStages, NO rememberModels.
```

`pinnedVariantId` for every card reads the map (not just the active model):

```ts
const pinnedVariantId = settings.translationVariantByModel[c.selectId];
```

So each HY-MT card's dropdown shows and controls *its own* chosen quant, and a
pick never changes `translationModel` → the auto-select effect never fires on a
variant pick.

## Download

Unchanged. `handleDownload` already calls `download(spec.downloadId,
chosenVariant?.repo)`, and `chosenVariant` now derives from
`pinnedVariantId = translationVariantByModel[cardId]` (else recommended). The
download fetches the chosen variant's repo.

## Status (variant-aware — the new piece)

`model_status` gains a repo override, like `download_specs`:

```python
def model_status(model_id, repo=None):
    specs = download_specs(model_id, repo)   # repo=None → default; else the variant repo
    ...                                       # unchanged cache/incomplete checks
```

The status request carries an optional per-model repo override map; the handler
applies it:

```python
async def _h_model_status(state, msg, _b, conn=None):
    repos = msg.get("repos") or {}
    statuses = {m: model_status(m, repos.get(m)) for m in (msg.get("models") or [])}
    return {"type": "model_status_result", "id": msg.get("id"), "statuses": statuses}, None
```

Renderer: `nativeModelStore.refresh()` builds `repos` = `{ cardId:
chosenVariantRepo }` for HY-MT cards whose chosen variant differs from the
default (from `variantData`/`list_variants`), and passes it via
`NativeModelClient.status(models, repos)`. A card is "downloaded" ⟺ *its chosen
variant's* repo is cached; switching the dropdown to an un-fetched quant flips
the card to "not downloaded".

## Load

No new logic. `resolve_translate` for the active model already takes the
`select_variant` pin; that pin is now
`translationVariantByModel[activeModel]` (forwarded through
`buildNativeSessionConfig`). Because a card only goes "ready" when its chosen
variant is downloaded, the pinned/chosen variant always equals the on-disk
variant for a runnable model — so "load = downloaded" holds without detection.

## Testing

Renderer:
- `handlePinVariant` writes `translationVariantByModel[card]` and leaves
  `translationModel` unchanged (regression for the bounce bug).
- `pinnedVariantId` reflects per-card map entries; two different cards can hold
  different chosen quants simultaneously.
- `buildNativeSessionConfig` forwards `translationVariantByModel[activeModel]`
  as `translationVariant`.
- `refresh` sends a per-model repo override for a card with a non-default chosen
  variant.

Sidecar:
- `model_status('hy-mt2-1.8b', repo='tencent/Hy-MT2-1.8B-FP8')` checks the FP8
  repo (mocked snapshot) — `ready` when the FP8 repo is cached, `absent` when
  only the default bf16 is.
- `_h_model_status` applies the `repos` map per model and falls back to the
  default repo when a model has no override.

## Risks / caveats

- **Status request shape change.** Adding `repos` to `model_status` must stay
  backward-compatible (absent → default repo for every model), so a renderer
  that sends no `repos` behaves exactly as today.
- **The renderer needs each variant's repo to query status.** That comes from
  `list_variants` (`variantData`); a card whose variants haven't loaded yet
  queries with the default repo until they do — a brief transient, self-correcting
  on the next `refresh`.
- **No migration** means an existing `translationVariant` value is dropped; users
  with a prior FP8 pin revert to the model default until they re-pick. Accepted.
