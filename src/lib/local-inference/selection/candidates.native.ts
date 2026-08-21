import {
  nativeAsrCards, nativeTranslationCards, nativeTtsModels, hardwareGated,
} from '../native/nativeCatalog';
import type { NativeModelInfo } from '../native/nativeProtocol';
import type { Candidate, CandidateSource, Stage } from './types';

export interface NativeCandidateCtx {
  catalog: Record<string, NativeModelInfo>;
  statuses: Record<string, 'ready' | 'absent' | 'downloading'>;
}

const KIND_FOR: Record<Stage, NativeModelInfo['kind']> = {
  asr: 'asr', translation: 'translate', tts: 'tts',
};

export function nativeCandidates(ctx: NativeCandidateCtx): CandidateSource {
  const toCandidate = (info: NativeModelInfo): Candidate => ({
    id: info.id,
    recommended: Boolean(info.recommended),
    sortOrder: info.order,
    sizeBytes: info.sizeBytes ?? 0,
    ready: ctx.statuses[info.id] === 'ready',
    hardwareOk: !hardwareGated(info),
    needsKey: false,
    // AST is a WASM manifest concept; the sidecar has no equivalent, so every
    // native candidate is auto-eligible.
    autoEligible: true,
    supportsVariant: (v) => v === undefined || (info.variants ?? []).some((x) => x.id === v),
  });

  const infos = (stage: Stage, src: string, tgt: string): NativeModelInfo[] => {
    // The card helpers already apply this provider's language rules, including
    // the 'multi' wildcard and the canonLang aliases.
    const ids =
      stage === 'asr' ? nativeAsrCards(src, ctx.catalog).map((c) => c.selectId)
      : stage === 'translation' ? nativeTranslationCards(src, tgt, ctx.catalog).map((c) => c.selectId)
      : nativeTtsModels(tgt, ctx.catalog).map((m) => m.id);
    return ids.map((id) => ctx.catalog[id]).filter((m): m is NativeModelInfo => Boolean(m));
  };

  return {
    pool: (stage, src, tgt) => infos(stage, src, tgt).map(toCandidate),
    has: (stage, id) => ctx.catalog[id]?.kind === KIND_FOR[stage],
  };
}
