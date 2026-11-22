// src/lib/local-inference/selection/resolveWithStages.ts
//
// How the local engine resolves a direction, with or without a stored line-up.
// One place, so the engine (modelStore.resolve) and the storage page's in-use
// badges and delete previews always agree.
import { wasmCandidates, type WasmCandidateCtx } from './candidates.wasm';
import { resolveDirection } from './resolveStage';
import { directionKey, type DirectionResult, type Selections } from './types';
import { unservedStages, type LocalStages } from '../../lineup/localStages';

export function resolveWasmDirection(
  src: string, tgt: string, selections: Selections, ctx: Omit<WasmCandidateCtx, 'withCloud'>, stages: LocalStages | null,
): DirectionResult {
  const direction = directionKey(src, tgt);
  // No stored line-up: today's list, Bing and Edge among the choices (the line-up migration asks it).
  if (!stages) return resolveDirection(direction, selections, wasmCandidates(ctx));
  // A stored line-up: Bing and Edge are providers of their own, so every stage resolves among this machine's models only.
  const out = resolveDirection(direction, selections, wasmCandidates({ ...ctx, withCloud: false }));
  // A stage another provider serves runs no model of this machine: nothing resolves for it, nothing is noted about
  // it, and the stored choice is left as it is, for when this machine serves the stage again.
  for (const stage of unservedStages(stages)) {
    out[stage] = null;
    out.notes = out.notes.filter((n) => n.stage !== stage);
    out.prunes = out.prunes.filter((p) => p.stage !== stage);
  }
  return out;
}
