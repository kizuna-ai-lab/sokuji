// src/lib/local-inference/selection/resolveWithStages.ts
//
// How the local engine resolves a direction, with or without a stored line-up.
// One place, so the engine (modelStore.resolve) and the storage page's in-use
// badges and delete previews always agree.
import { getManifestEntry, isTranslationModelCompatible } from '../modelManifest';
import { wasmCandidates, type WasmCandidateCtx } from './candidates.wasm';
import { resolveDirection } from './resolveStage';
import { directionKey, type DirectionResult, type Selections, type Stage } from './types';
import type { LocalStages } from '../../lineup/localStages';

export function resolveWasmDirection(
  src: string, tgt: string, selections: Selections, ctx: Omit<WasmCandidateCtx, 'withCloud'>, stages: LocalStages | null,
): DirectionResult {
  const direction = directionKey(src, tgt);
  // No stored line-up: today's list, Bing and Edge among the local choices.
  if (!stages) return resolveDirection(direction, selections, wasmCandidates(ctx));
  // A stored line-up: Bing and Edge are providers of their own. A stage given to one runs it whatever the
  // stored local choice says (left as it is); every other stage resolves among this machine's models only.
  const out = resolveDirection(direction, selections, wasmCandidates({ ...ctx, withCloud: false }));
  const cloud: Array<[Stage, string]> = [];
  // Bing keeps its own list of languages: a pair outside it stays on this machine's models, as it would without a line-up.
  const bing = getManifestEntry('bing-translator');
  if (stages.translation === 'bing' && bing && isTranslationModelCompatible(bing, src, tgt)) cloud.push(['translation', 'bing-translator']);
  if (stages.speech === 'edge') cloud.push(['tts', 'edge-tts']);
  for (const [stage, modelId] of cloud) {
    out[stage] = { modelId, variant: undefined, source: 'explicit' };
    out.notes = out.notes.filter((n) => n.stage !== stage);
    out.prunes = out.prunes.filter((p) => p.stage !== stage);
  }
  return out;
}
