/**
 * Prompt construction and output splitting for Qwen3-ASR (ONNX layout v2).
 *
 * Every constant comes from the model repo's `prompt_config.json`
 * (jiangzhuo9357/Qwen3-ASR-0.6B-ONNX): the fixed chat-template ids around the audio block,
 * the audio-token formula, and the per-language ids of the model's own answer prefix
 * `language <Name><asr_text>`. Pure functions — no ORT, no DOM — so they are unit-tested
 * without a worker.
 */

export interface Qwen3AsrPromptConfig {
  layout_version: number;
  prompt: {
    /** `<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<|audio_start|>` */
    prefix_ids: number[];
    /** `<|audio_end|><|im_end|>\n<|im_start|>assistant\n` */
    suffix_ids: number[];
    audio_pad_id: number;
    asr_text_id: number;
    eos_ids: number[];
    max_new_tokens: number;
  };
  /** iso code → ids of `language <Name>` + `<asr_text>`; appending them forces the prefix. */
  language_prefix_ids: Record<string, number[]>;
  audio_tokens: { conv_window: number; tokens_per_window: number };
  embedding: { file: string; dtype: 'int8' | 'float16' | 'float32'; shape: [number, number]; scales_file?: string };
  decoder: { num_layers: number; num_key_value_heads: number; head_dim: number; hidden_size: number; vocab_size: number };
  variants: Record<string, { encoder: string; decoder_init: string; decoder_step: string; weights: string; required_features: string[] }>;
}

const convOut = (t: number): number => Math.floor((t + 1) / 2);

/**
 * Number of encoder output tokens for `melFrames` log-mel frames: the encoder downsamples
 * each 100-frame window to 13 tokens and the remainder through three stride-2 convolutions.
 */
export function audioTokenCount(melFrames: number, a: Qwen3AsrPromptConfig['audio_tokens']): number {
  const remainder = melFrames % a.conv_window;
  const tail = convOut(convOut(convOut(remainder)));
  return tail + Math.floor(melFrames / a.conv_window) * a.tokens_per_window;
}

export interface BuiltPrompt {
  ids: number[];
  /** Index of the first `<|audio_pad|>`; the encoder output replaces `nAudio` rows from here. */
  audioStart: number;
  /** True when the language prefix was appended, i.e. the model's output starts with the text itself. */
  forced: boolean;
}

export function buildPromptIds(nAudio: number, cfg: Qwen3AsrPromptConfig, forceLang?: string): BuiltPrompt {
  const p = cfg.prompt;
  const ids = [...p.prefix_ids];
  const audioStart = ids.length;
  for (let i = 0; i < nAudio; i++) ids.push(p.audio_pad_id);
  ids.push(...p.suffix_ids);
  const forcedIds = forceLang ? cfg.language_prefix_ids[forceLang] : undefined;
  if (forcedIds) ids.push(...forcedIds);
  return { ids, audioStart, forced: Boolean(forcedIds) };
}

export interface SplitOutput {
  /** Tokens before `<asr_text>` (the model's `language <Name>` tag), empty when absent. */
  prefixIds: number[];
  textIds: number[];
  detectedPrefix: boolean;
}

/** Drop eos tokens and cut the generated sequence at `<asr_text>`. */
export function splitGenerated(ids: number[], cfg: Qwen3AsrPromptConfig): SplitOutput {
  const eos = new Set(cfg.prompt.eos_ids);
  const body = ids.filter((id) => !eos.has(id));
  const cut = body.indexOf(cfg.prompt.asr_text_id);
  if (cut < 0) return { prefixIds: [], textIds: body, detectedPrefix: false };
  return { prefixIds: body.slice(0, cut), textIds: body.slice(cut + 1), detectedPrefix: true };
}

/** App-side spellings that differ from the ISO codes the prefix table uses (same aliases as nativeCatalog.ts). */
const LANG_ALIASES: Record<string, string> = { cantonese: 'yue', tl: 'fil', jap: 'ja' };

/**
 * Map the app's source-language value onto a key of `language_prefix_ids`, or undefined when
 * the language is unknown / 'auto' / not one the model names — the caller then lets the
 * model detect the language itself.
 */
export function normalizeLangForPrefix(lang: string | undefined, cfg: Qwen3AsrPromptConfig): string | undefined {
  if (!lang || lang === 'auto') return undefined;
  const lower = lang.toLowerCase();
  const primary = (LANG_ALIASES[lower] ?? lower).split(/[-_]/)[0];
  return primary in cfg.language_prefix_ids ? primary : undefined;
}
