import {
  type Candidate, type CandidateSource, type DirectionResult, type ResolutionNote, type ResolutionReason,
  type Selections, type Stage, type StageResult, EMPTY_STAGE, splitDirection,
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

  let reason: ResolutionReason | null = null;
  let prune: true | undefined;

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
    // Why not? `has` is language-agnostic, so it is the only thing that can tell
    // "exists but wrong for this direction" (revivable) from "gone" (never).
    if (!candidates.has(stage, sel.modelId)) {
      reason = 'not-in-catalog';
      prune = true;
    } else if (!c) {
      reason = 'lang-incompatible';
    } else if (!c.ready) {
      reason = c.needsKey ? 'needs-key' : 'not-downloaded';
    } else {
      reason = 'hardware-gated';
    }
  }

  const usable = pool.filter((c) => c.ready && c.hardwareOk && c.autoEligible).sort(byRank);
  const best = usable[0];
  const resolved = best ? { modelId: best.id, variant: undefined, source: 'auto' as const } : null;

  let note: ResolutionNote | undefined;
  if (reason) {
    note = { direction, stage, from: sel.modelId, to: best?.id ?? null, reason };
  } else if (!resolved) {
    note = { direction, stage, from: null, to: null, reason: 'no-candidate' };
  }

  return { resolved, note, prune };
}

const STAGES: Stage[] = ['asr', 'translation', 'tts'];

/**
 * One direction's three stages. Called once per live direction — speaker
 * (`src→tgt`) and participant (`tgt→src`) — with nothing shared between the two
 * calls beyond `selections` and `candidates`. There is deliberately no path by
 * which one direction can influence the other.
 */
export function resolveDirection(
  direction: string,
  selections: Selections,
  candidates: CandidateSource,
): DirectionResult {
  const out: DirectionResult = {
    asr: null, translation: null, tts: null, notes: [], prunes: [],
  };
  for (const stage of STAGES) {
    const r = resolveStage(direction, stage, selections, candidates);
    out[stage] = r.resolved;
    if (r.note) out.notes.push(r.note);
    if (r.prune) out.prunes.push({ direction, stage });
  }
  return out;
}
