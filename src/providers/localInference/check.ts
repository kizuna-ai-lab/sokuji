import { useModelStore } from '../../stores/modelStore';
import { guardAstCrossStage } from '../../services/providers/astGuard';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import type { Selections } from '../../lib/local-inference/selection/types';
import type { LocalInferenceSettings } from './settings';

/** The mandatory direction lacks ASR or translation: the code for this check's "selected language pair" refusal. */
export const LOCAL_MODELS_MISSING = 'local_models_missing';

/**
 * LocalInference's readiness check (spec: "Readiness is one check"). Ports
 * today's `ensureSelectionReady` (`src/stores/modelStore.ts`) without its
 * settingsStore/audioStore reads and its `applyPrunes` write: the pair and
 * legs come from `ctx` instead of a store, and a stale selection is left for
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
 */
export async function checkLocalInference(
  s: LocalInferenceSettings,
  ctx: CheckContext,
): Promise<CheckResult> {
  if (!useModelStore.getState().initialized) {
    await raceInitialize(ctx.signal);
  }

  const resolve = (src: string, tgt: string, selections: Selections) =>
    useModelStore.getState().resolve(src, tgt, selections);
  // AST cross-stage guard (see astGuard.ts): `build` applies this same guard
  // to the resolved translation stage before a session starts, which can
  // downgrade an explicit AST-mismatched pick to auto (possibly null).
  // Applying it here too, before judging readiness, keeps this verdict from
  // disagreeing with what a build would actually produce.
  const guarded = (src: string, tgt: string) => {
    const raw = resolve(src, tgt, s.selections);
    return guardAstCrossStage(src, tgt, s.selections, raw, (masked) => resolve(src, tgt, masked));
  };

  const speaker = guarded(ctx.pair.source, ctx.pair.target);
  const participantOnly = ctx.legs.length === 1 && ctx.legs[0] === 'participant';
  const participant = ctx.legs.includes('participant')
    ? guarded(ctx.pair.target, ctx.pair.source)
    : undefined;
  const mandatory = participantOnly ? participant : speaker;

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
 * Resolves once the model store finishes initializing, or rejects with the
 * abort reason if `signal` fires first (mirrors `fake/adapter.ts`'s own
 * signal race — `Adapter.start`'s `request.signal` follows the same rule,
 * and `CheckContext.signal` is documented the same way: "Aborted when the
 * start that asked is cancelled").
 */
function raceInitialize(signal?: AbortSignal): Promise<void> {
  const init = useModelStore.getState().initialize();
  if (!signal) return init;
  if (signal.aborted) {
    init.catch(() => {}); // already answered by the abort below — never surfaced
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<void>((resolveInit, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    init.then(
      () => { signal.removeEventListener('abort', onAbort); resolveInit(); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}
