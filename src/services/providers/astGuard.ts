import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { directionKey, emptyDirection, type DirectionResult, type ResolutionNote, type Selections } from '../../lib/local-inference/selection/types';

/**
 * Guards the AST cross-stage hazard: `resolve()` resolves the asr and
 * translation stages of a direction independently (see resolveDirection's
 * doc comment), so a user can explicitly pick an AST-capable ASR model (e.g.
 * Granite Speech) as the TRANSLATION stage while the ASR stage of the same
 * direction resolves — auto or explicit — to a different model.
 * The LocalInference builder enters AST mode only when the translation id
 * equals the ASR id (`src/providers/localInference/config.ts`); anything
 * else constructs a real TranslationEngine (opus-mt) against AST-only model
 * files, which fails at runtime with no gate and no note.
 *
 * This runs AFTER resolution, at the config-building boundary, rather than
 * teaching the resolver itself about a cross-stage constraint — resolving
 * each stage independently is deliberate (resolveDirection's doc comment).
 *
 * When the resolved translation is AST-capable but its id doesn't match the
 * resolved ASR id, the explicit translation selection is masked back to auto
 * and just that one direction is re-resolved. The manifest already excludes
 * AST-capable entries from auto-eligibility for the translation stage
 * (candidates.wasm.ts), so the fallback can never re-select the same hazard.
 * The masked selections object is never written back to settings — the
 * user's explicit choice is still meaningful if applied as the ASR
 * selection instead.
 *
 * Pure: the re-resolution is injected as `reResolve` rather than reached via
 * a static `useModelStore` import. Its callers, the LocalInference
 * provider's `config.ts` and `check.ts`, pass a resolver bound to the
 * direction; the old descriptor, participant config and
 * `modelStore.ensureSelectionReady` that called it went with the old code
 * (Stage 2 deletion, ruling 3).
 */
export function guardAstCrossStage(
  src: string,
  tgt: string,
  selections: Selections,
  resolved: DirectionResult,
  reResolve: (selections: Selections) => DirectionResult,
): DirectionResult {
  const translationId = resolved.translation?.modelId;
  if (!translationId) return resolved;

  const entry = getManifestEntry(translationId);
  if (!entry?.astLanguages) return resolved;
  if (translationId === resolved.asr?.modelId) return resolved;

  const dir = directionKey(src, tgt);
  const masked: Selections = {
    ...selections,
    [dir]: { ...(selections[dir] ?? emptyDirection()), translation: { modelId: '' } },
  };
  const reResolved = reResolve(masked);
  // The rewrite is otherwise silent — a masked-back-to-auto substitution the
  // user never asked for deserves the same note-based visibility as every
  // other resolveStage rewrite, even though it happens a layer above
  // resolveStage itself. Reuses 'lang-incompatible' (the existing union is
  // closed on purpose — see the interface doc) since an AST-capable model
  // that doesn't match the resolved ASR is, functionally, a translation pick
  // incompatible with this direction's ASR leg.
  const note: ResolutionNote = {
    direction: dir, stage: 'translation', from: translationId, to: reResolved.translation?.modelId ?? null,
    reason: 'lang-incompatible',
  };
  return { ...resolved, translation: reResolved.translation, notes: [...resolved.notes, note] };
}
