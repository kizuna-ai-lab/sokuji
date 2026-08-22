import {
  getManifestByType, getManifestEntry, deviceReady, isTranslationModelCompatible,
  isAstCompatible, getModelSizeMb, isVariantEligible,
  type ModelManifestEntry, type ModelStatus,
} from '../modelManifest';
import type { Candidate, CandidateSource, Stage } from './types';

export interface WasmCandidateCtx {
  modelStatuses: Record<string, ModelStatus>;
  webgpuAvailable: boolean;
  deviceFeatures: string[];
}

const asrEntries = (): ModelManifestEntry[] =>
  [...getManifestByType('asr'), ...getManifestByType('asr-stream')];

/** Language predicates, unchanged from today — only their home moved. */
const asrOk = (m: ModelManifestEntry, src: string) => Boolean(m.multilingual) || m.languages.includes(src);
const ttsOk = (m: ModelManifestEntry, tgt: string) => Boolean(m.multilingual) || m.languages.includes(tgt);

export function wasmCandidates(ctx: WasmCandidateCtx): CandidateSource {
  // modelUsable() is `downloaded && deviceReady`. The resolver needs the two
  // apart so a note can say WHICH one failed, and deviceReady is already
  // exported (modelManifest.ts:3285) — so call the halves directly rather than
  // the combined predicate.
  const toCandidate = (m: ModelManifestEntry, autoEligible = true): Candidate => ({
    id: m.id,
    recommended: Boolean(m.recommended),
    sortOrder: m.sortOrder ?? 0,
    sizeBytes: m.isCloudModel ? 0 : getModelSizeMb(m, ctx.deviceFeatures) * 1_048_576,
    ready: Boolean(m.isCloudModel) || ctx.modelStatuses[m.id] === 'downloaded',
    hardwareOk: deviceReady(m, ctx.webgpuAvailable),
    needsKey: false,
    autoEligible,
    // WASM chooses its variant from device features; a stored pin is honoured
    // only while that variant key still exists on this entry AND this
    // machine can actually run it (isVariantEligible — same requiredFeatures
    // check selectVariant uses to pick the auto variant).
    supportsVariant: (v) => v === undefined || isVariantEligible(m, v, ctx.deviceFeatures),
  });

  const pool = (stage: Stage, src: string, tgt: string): Candidate[] => {
    if (stage === 'asr') return asrEntries().filter((m) => asrOk(m, src)).map((m) => toCandidate(m));
    if (stage === 'tts') return getManifestByType('tts').filter((m) => ttsOk(m, tgt)).map((m) => toCandidate(m));
    return [
      ...getManifestByType('translation')
        .filter((m) => isTranslationModelCompatible(m, src, tgt))
        .map((m) => toCandidate(m)),
      // AST: an ASR model that translates directly. Reachable by explicit choice
      // only — today's short-circuit fires solely when translationModel === asrModel,
      // so letting auto pick one would be a behaviour change.
      ...asrEntries()
        .filter((m) => isAstCompatible(m, src, tgt))
        .map((m) => toCandidate(m, false)),
    ];
  };

  const has = (stage: Stage, id: string): boolean => {
    const entry = getManifestEntry(id);
    if (!entry) return false;
    if (stage === 'asr') return entry.type === 'asr' || entry.type === 'asr-stream';
    if (stage === 'tts') return entry.type === 'tts';
    // An asr/asr-stream entry only counts as "in" the translation catalog
    // when it is AST-capable (has astLanguages) — language-agnostic, exactly
    // like the rest of `has`; direction filtering stays in `pool`. A plain
    // (non-AST) ASR id stored as an explicit translation pick is not
    // revivable — it was never a valid translation candidate to begin with —
    // so it should prune as 'not-in-catalog', not linger as 'lang-incompatible'.
    return entry.type === 'translation'
      || ((entry.type === 'asr' || entry.type === 'asr-stream') && Boolean(entry.astLanguages));
  };

  return { pool, has };
}
