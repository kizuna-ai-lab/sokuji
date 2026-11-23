import { guardAstCrossStage } from '../../services/providers/astGuard';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import type { Selections } from '../../lib/local-inference/selection/types';
import { ALL_LOCAL_STAGES } from '../../lib/lineup/localStages';
import type { LocalStages } from '../../lib/lineup/localStages';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import type { LocalInferenceSettings } from './settings';

/** The mandatory direction lacks ASR or translation: the code for this check's "selected language pair" refusal. */
export const LOCAL_MODELS_MISSING = 'local_models_missing';

/**
 * LocalInference's readiness check (spec: "Readiness is one check"). Ports
 * today's `ensureSelectionReady` (`src/stores/modelStore.ts`) without its
 * settingsStore/audioStore reads and its `applyPrunes` write: the pair and
 * legs come from `ctx` instead of a store, and this device's models come from
 * `ctx.localModels`, not the model store; a stale selection is left for
 * `build` to resolve around — exactly as `resolve()` already does — rather
 * than pruned here.
 *
 * The mandatory direction — the one whose ASR and translation must both
 * resolve for `ok: true` — is the participant's only when the participant
 * leg runs alone; otherwise (speaker alone, or both legs) it is the
 * speaker's, matching today's audio-mode gate (`modelStore.ts:514`). With
 * both legs the participant direction's ASR is required too, but not its
 * translation: `build` refuses a direction without ASR (`no_asr`) and runs
 * one without translation transcription-only, so readiness says what a
 * start would meet rather than being refused at it. TTS never gates
 * readiness, in either direction. The participant direction is resolved at
 * all only when the participant leg is in `ctx.legs` — it is otherwise
 * never asked for by this check.
 *
 * Where this provider translates what another provider transcribes, no
 * recognition model is asked for at all: each leg that runs needs the
 * translation of its own direction, a model on this machine that is
 * downloaded.
 *
 * Where it transcribes what another provider translates, no translation
 * model is asked for: each leg that runs needs a recognition model for its
 * own source, and a leg that lacks one is named by that source (`no_asr`,
 * the code `build` refuses the same gap with).
 */
export async function checkLocalInference(
  s: LocalInferenceSettings,
  ctx: CheckContext,
): Promise<CheckResult> {
  const models = ctx.localModels;
  if (!models) throw new Error("The local check was asked without this device's models (CheckContext.localModels).");
  // The first scan of this device's models, before anything is resolved: a start pressed at launch waits for it.
  await models.scanned(ctx.signal);

  const stages = effectiveStages(ctx);
  // This provider only speaks: it needs no recognition and no translation model. A speech model that is missing
  // does not stop a start: the leg says so when it opens, and its subtitles go on.
  if (stages.translation === null && stages.transcription !== 'local') return { ok: true };
  const resolve = (src: string, tgt: string, selections: Selections) =>
    models.resolve(src, tgt, selections, stages);
  // AST cross-stage guard (see astGuard.ts): `build` applies this same guard
  // to the resolved translation stage before a session starts, which can
  // downgrade an explicit AST-mismatched pick to auto (possibly null).
  // Applying it here too, before judging readiness, keeps this verdict from
  // disagreeing with what a build would actually produce.
  const guarded = (src: string, tgt: string) => {
    const raw = resolve(src, tgt, s.selections);
    return guardAstCrossStage(src, tgt, s.selections, raw, (masked) => resolve(src, tgt, masked));
  };

  const participantOnly = ctx.legs.length === 1 && ctx.legs[0] === 'participant';

  // This provider transcribes and another translates what it heard: each leg that runs needs a recognition model for
  // its own source, and no translation model. Nothing is translated here, so no AST guard applies.
  if (stages.transcription === 'local') {
    const missing = (source: string, reverse: boolean): CheckResult => ({
      ok: false,
      reason: `A speech recognition model is not available for the ${reverse ? 'reverse' : 'selected'} language pair.`,
      code: 'no_asr',
      params: { source },
    });
    if (ctx.legs.includes('speaker') && !resolve(ctx.pair.source, ctx.pair.target, s.selections).asr) return missing(ctx.pair.source, false);
    if (ctx.legs.includes('participant') && !resolve(ctx.pair.target, ctx.pair.source, s.selections).asr) return missing(ctx.pair.target, !participantOnly);
    return { ok: true };
  }

  const speaker = guarded(ctx.pair.source, ctx.pair.target);
  const participant = ctx.legs.includes('participant')
    ? guarded(ctx.pair.target, ctx.pair.source)
    : undefined;
  const mandatory = participantOnly ? participant : speaker;

  // Another provider transcribes and this one translates what it heard: each leg that runs needs the translation
  // of its own direction, and no recognition model.
  if (stages.transcription === null) {
    const translates = (found: typeof speaker): boolean => {
      const id = found.translation?.modelId;
      // A model that turns speech straight into the translation is no translator of another provider's text.
      return !!id && (getManifestEntry(id)?.type ?? 'translation') === 'translation';
    };
    const missing = (reverse: boolean): CheckResult => ({
      ok: false,
      reason: `A translation model is not available for the ${reverse ? 'reverse' : 'selected'} language pair.`,
      code: LOCAL_MODELS_MISSING,
    });
    if (ctx.legs.includes('speaker') && !translates(speaker)) return missing(false);
    if (participant && !translates(participant)) return missing(participantOnly ? false : true);
    return { ok: true };
  }

  // `reason` is diagnostic English; `code` is what a surface words (plan 1e-3a ruling 4).
  if (!mandatory?.asr || !mandatory?.translation) {
    return {
      ok: false,
      reason: 'Required models are not available for the selected language pair.',
      code: LOCAL_MODELS_MISSING,
    };
  }
  if (participant && !participantOnly && !participant.asr) {
    return {
      ok: false,
      reason: 'Required models are not available for the reverse language pair.',
      // The code `build` uses for the same gap (config.ts).
      code: 'no_asr',
      params: { source: ctx.pair.target },
    };
  }
  return { ok: true };
}

/**
 * The one set of stages the check answers about, for its shortcut and for the resolution alike. Told the stages
 * this provider serves in the plan (`ctx.stages`), they are those: a start checks the plan it froze, which the
 * stored line-up may no longer match (or none may be stored). A stage the provider is not told is another
 * provider's, transcription included: told translation without it, it translates what another provider heard;
 * told transcription without translation, it transcribes for another provider to translate. Told none, it serves
 * every stage of its own, and never resolves with Bing and Edge among its choices.
 */
function effectiveStages(ctx: Pick<CheckContext, 'stages'>): LocalStages {
  const told = ctx.stages;
  if (!told) return ALL_LOCAL_STAGES;
  const stages: LocalStages = {
    translation: told.includes('translation') ? 'local' : null,
    speech: told.includes('speech') ? 'local' : null,
  };
  // It translates what another provider transcribes: no recognition model is asked for.
  if (stages.translation !== null && !told.includes('transcription')) stages.transcription = null;
  // It transcribes what another provider translates: a recognition model is asked for, and no translation model.
  if (stages.translation === null && told.includes('transcription')) stages.transcription = 'local';
  return stages;
}
