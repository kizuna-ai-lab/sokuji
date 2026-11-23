/**
 * The translation cards (port of the translate half of sidecar/sokuji_sidecar/catalog.py): every card is a GGUF LLM
 * on the native_translate backend (the addon's llama.cpp runtime), two quant variants, three tiers each.
 */
import { deployment, translateModelCard, type Deployment, type TranslateModel } from './types';

/** "org/repo/path/to/file" → ["org/repo", "path/to/file"]; a plain repo → [repo, null]. */
export function splitArtifact(artifact: string): [repo: string, file: string | null] {
  const parts = artifact.split('/');
  if (parts.length > 2) return [parts.slice(0, 2).join('/'), parts.slice(2).join('/')];
  return [artifact, null];
}

// Upstream sources for the LLM translate cards' GGUF quants: (card_id, quant) ->
// (upstream repo, exact filename). Verified 2026-07-03 (Task-14 dry run + HF API
// size fetch). Upstream GGUF repos hold many quants each, so we must pin the
// exact filename per card-variant rather than snapshot-downloading the repo.
// NOTE the tencent filename case quirks are REAL upstream data (7B Q8 is
// `HY-MT2-...` while its siblings are `Hy-MT2-...`) — kept verbatim.
/** Keyed `${cardId}|${quant}`. */
export const GGUF_SOURCES: Readonly<Record<string, readonly [repo: string, file: string]>> = {
  'qwen2.5-0.5b|q8_0': ['Qwen/Qwen2.5-0.5B-Instruct-GGUF', 'qwen2.5-0.5b-instruct-q8_0.gguf'],
  'qwen2.5-0.5b|q4_k_m': ['Qwen/Qwen2.5-0.5B-Instruct-GGUF', 'qwen2.5-0.5b-instruct-q4_k_m.gguf'],
  'qwen3-0.6b|q8_0': ['Qwen/Qwen3-0.6B-GGUF', 'Qwen3-0.6B-Q8_0.gguf'],
  'qwen3-0.6b|q4_k_m': ['unsloth/Qwen3-0.6B-GGUF', 'Qwen3-0.6B-Q4_K_M.gguf'],
  'qwen3.5-0.8b|q4_k_m': ['unsloth/Qwen3.5-0.8B-GGUF', 'Qwen3.5-0.8B-Q4_K_M.gguf'],
  'qwen3.5-0.8b|q8_0': ['unsloth/Qwen3.5-0.8B-GGUF', 'Qwen3.5-0.8B-Q8_0.gguf'],
  'qwen3.5-2b|q4_k_m': ['unsloth/Qwen3.5-2B-GGUF', 'Qwen3.5-2B-Q4_K_M.gguf'],
  'qwen3.5-2b|q8_0': ['unsloth/Qwen3.5-2B-GGUF', 'Qwen3.5-2B-Q8_0.gguf'],
  'qwen3.5-4b|q4_k_m': ['unsloth/Qwen3.5-4B-GGUF', 'Qwen3.5-4B-Q4_K_M.gguf'],
  'qwen3.5-4b|q8_0': ['unsloth/Qwen3.5-4B-GGUF', 'Qwen3.5-4B-Q8_0.gguf'],
  'translategemma-4b|q4_k_m': ['mradermacher/translategemma-4b-it-GGUF', 'translategemma-4b-it.Q4_K_M.gguf'],
  'translategemma-4b|q8_0': ['mradermacher/translategemma-4b-it-GGUF', 'translategemma-4b-it.Q8_0.gguf'],
  // utter-project publishes no GGUFs of its own; mradermacher's are the same
  // community source the TranslateGemma rows already use.
  'eurollm-1.7b|q4_k_m': ['mradermacher/EuroLLM-1.7B-Instruct-GGUF', 'EuroLLM-1.7B-Instruct.Q4_K_M.gguf'],
  'eurollm-1.7b|q8_0': ['mradermacher/EuroLLM-1.7B-Instruct-GGUF', 'EuroLLM-1.7B-Instruct.Q8_0.gguf'],
  'hy-mt2-1.8b|q4_k_m': ['tencent/Hy-MT2-1.8B-GGUF', 'Hy-MT2-1.8B-Q4_K_M.gguf'],
  'hy-mt2-1.8b|q8_0': ['tencent/Hy-MT2-1.8B-GGUF', 'Hy-MT2-1.8B-Q8_0.gguf'],
  'hy-mt2-7b|q4_k_m': ['tencent/Hy-MT2-7B-GGUF', 'Hy-MT2-7B-Q4_K_M.gguf'],
  'hy-mt2-7b|q8_0': ['tencent/Hy-MT2-7B-GGUF', 'HY-MT2-7B-Q8_0.gguf'],
  'hy-mt15-1.8b|q4_k_m': ['tencent/HY-MT1.5-1.8B-GGUF', 'HY-MT1.5-1.8B-Q4_K_M.gguf'],
  'hy-mt15-1.8b|q8_0': ['tencent/HY-MT1.5-1.8B-GGUF', 'HY-MT1.5-1.8B-Q8_0.gguf'],
  'hy-mt15-7b|q4_k_m': ['tencent/HY-MT1.5-7B-GGUF', 'HY-MT1.5-7B-Q4_K_M.gguf'],
  'hy-mt15-7b|q8_0': ['tencent/HY-MT1.5-7B-GGUF', 'HY-MT1.5-7B-Q8_0.gguf'],
};

// Sizes are the exact upstream GGUF file byte counts (HF API size fetch,
// 2026-07-03 — see _GGUF_SOURCES). The 13 Opus-MT (CTranslate2) rows that used
// to live here were removed in slice 3 along with the ct2_opus_translate
// backend and the ctranslate2 dependency: translation now runs entirely
// through native_translate (sokuji_native's in-process llama.cpp runtime).
function ggufArtifact(mid: string, quant: string): string {
  const source = GGUF_SOURCES[`${mid}|${quant}`];
  if (!source) throw new Error(`no GGUF source for (${mid}, ${quant})`);
  return `${source[0]}/${source[1]}`;
}

/**
 * A GGUF LLM translate card: the native_translate backend, two GGUF quant variants, three tiers each (gpu-metal /
 * gpu-vulkan / cpu). The same GGUF serves every tier; rank 2.0 marks the default quant. Plan order across tiers is
 * the planner's TIER_RANK (gpu-metal 3.0 > gpu-vulkan 2.5 > cpu 1.0), not this list's. `family` selects the prompt
 * strategy (PlanConfig.promptFamily); `arch` is llama.cpp's general.architecture for this GGUF (graphFamily) —
 * unrelated to `family`, which is a prompt strategy, not a graph.
 */
export function llmTranslateRow(
  mid: string, name: string, family: string, sortOrder: number,
  defaultQuant: string, defaultBytes: number, altQuant: string, altBytes: number,
  opts: { recommended?: boolean; disableThinking?: boolean; appendNoThink?: boolean; arch?: string } = {},
): TranslateModel {
  const { recommended = false, disableThinking = false, appendNoThink = false, arch = '' } = opts;
  const deps: Deployment[] = [];
  for (const [quant, nbytes, rank] of [[defaultQuant, defaultBytes, 2.0], [altQuant, altBytes, 1.0]] as const) {
    const artifact = ggufArtifact(mid, quant);
    for (const tier of ['gpu-metal', 'gpu-vulkan', 'cpu']) deps.push(deployment('native_translate', tier, quant, artifact, rank, { estBytes: nbytes }));
  }
  return translateModelCard(mid, name, ['multi'], deps, {
    recommended, sortOrder, sizeBytes: defaultBytes, disableThinking, appendNoThink, promptFamily: family, graphFamily: arch,
  });
}

export const TRANSLATE_MODELS: readonly TranslateModel[] = [
  llmTranslateRow(
    'qwen2.5-0.5b',
    'Qwen 2.5 0.5B',
    'qwen',
    1,
    'q8_0',
    675_710_816,
    'q4_k_m',
    491_400_032,
    { recommended: true, arch: 'qwen2' },
  ),
  llmTranslateRow(
    'qwen3-0.6b',
    'Qwen 3 0.6B',
    'qwen',
    2,
    'q8_0',
    639_446_688,
    'q4_k_m',
    396_705_472,
    { recommended: true, disableThinking: true, appendNoThink: true, arch: 'qwen3' },
  ),
  llmTranslateRow(
    'qwen3.5-0.8b',
    'Qwen 3.5 0.8B',
    'qwen',
    3,
    'q4_k_m',
    532_517_120,
    'q8_0',
    811_843_840,
    { disableThinking: true, arch: 'qwen35' },
  ),
  llmTranslateRow(
    'qwen3.5-2b',
    'Qwen 3.5 2B',
    'qwen',
    4,
    'q4_k_m',
    1_280_835_840,
    'q8_0',
    2_012_012_800,
    { disableThinking: true, arch: 'qwen35' },
  ),
  // Same family and thinking handling as the 0.8B / 2B rows: Qwen3.5 has
  // no /no_think soft switch, so only the empty-<think> prefill applies.
  // The GGUF's text tower loads without the vision mmproj (added 2026-09-03).
  llmTranslateRow(
    'qwen3.5-4b',
    'Qwen 3.5 4B',
    'qwen',
    5,
    'q4_k_m',
    2_740_937_888,
    'q8_0',
    4_482_403_488,
    { disableThinking: true, arch: 'qwen35' },
  ),
  llmTranslateRow(
    'translategemma-4b',
    'TranslateGemma 4B',
    'gemma',
    6,
    'q4_k_m',
    2_489_909_760,
    'q8_0',
    4_130_417_920,
    { arch: 'gemma3' },
  ),
  // EuroLLM-1.7B-Instruct (utter-project, Apache-2.0): a translation-tuned
  // Llama-architecture model covering 35 languages (the EU set plus zh, ja,
  // ko, ru, uk, ar, hi). Its chat template is ChatML, which is what the
  // "qwen" strategy renders; no thinking mode. 4096-token context
  // (added 2026-09-03).
  llmTranslateRow(
    'eurollm-1.7b',
    'EuroLLM 1.7B',
    'qwen',
    7,
    'q4_k_m',
    1_045_157_088,
    'q8_0',
    1_763_775_712,
    { arch: 'llama' },
  ),
  llmTranslateRow(
    'hy-mt2-1.8b',
    'Hunyuan-MT2 1.8B',
    'hunyuan',
    8,
    'q4_k_m',
    1_133_080_448,
    'q8_0',
    1_908_528_192,
    { arch: 'hunyuan-dense' },
  ),
  llmTranslateRow(
    'hy-mt2-7b',
    'Hunyuan-MT2 7B',
    'hunyuan',
    9,
    'q4_k_m',
    4_624_648_896,
    'q8_0',
    7_981_928_896,
    { arch: 'hunyuan-dense' },
  ),
  llmTranslateRow(
    'hy-mt15-1.8b',
    'Hunyuan-MT1.5 1.8B',
    'hunyuan',
    10,
    'q4_k_m',
    1_133_080_512,
    'q8_0',
    1_908_528_288,
    { arch: 'hunyuan-dense' },
  ),
  llmTranslateRow(
    'hy-mt15-7b',
    'Hunyuan-MT1.5 7B',
    'hunyuan',
    11,
    'q4_k_m',
    4_624_649_312,
    'q8_0',
    7_981_929_344,
    { arch: 'hunyuan-dense' },
  ),
];

export function translateModels(): TranslateModel[] {
  return [...TRANSLATE_MODELS];
}

export function translateModel(modelId: string): TranslateModel | null {
  return TRANSLATE_MODELS.find((m) => m.id === modelId) ?? null;
}
