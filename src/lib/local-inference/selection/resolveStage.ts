import {
  type Candidate, type CandidateSource, type Selections, type Stage,
  type StageResult, EMPTY_STAGE, splitDirection,
} from './types';

/** Unknown size (0) sorts last among ties rather than first. */
const size = (c: Candidate): number => (c.sizeBytes > 0 ? c.sizeBytes : Number.POSITIVE_INFINITY);

/** recommended desc -> sortOrder asc -> sizeBytes asc. One rule, both providers. */
export const byRank = (a: Candidate, b: Candidate): number =>
  Number(b.recommended) - Number(a.recommended)
  || a.sortOrder - b.sortOrder
  || size(a) - size(b);

export function resolveStage(
  direction: string,
  stage: Stage,
  selections: Selections,
  candidates: CandidateSource,
): StageResult {
  const [src, tgt] = splitDirection(direction);
  const pool = candidates.pool(stage, src, tgt);
  const sel = selections[direction]?.[stage] ?? EMPTY_STAGE;

  if (sel.modelId !== '') {
    const c = pool.find((x) => x.id === sel.modelId);
    if (c && c.ready && c.hardwareOk) {
      return {
        resolved: {
          modelId: sel.modelId,
          variant: c.supportsVariant(sel.variant) ? sel.variant : undefined,
          source: 'explicit',
        },
      };
    }
  }

  const usable = pool.filter((c) => c.ready && c.hardwareOk && c.autoEligible).sort(byRank);
  const best = usable[0];
  return { resolved: best ? { modelId: best.id, variant: undefined, source: 'auto' } : null };
}
