import { describe, expect, it } from 'vitest';
import {
  audioTokenCount,
  buildPromptIds,
  normalizeLangForPrefix,
  splitGenerated,
  type Qwen3AsrPromptConfig,
} from './qwen3-asr-prompt';

// Mirrors prompt_config.json (layout v2) from jiangzhuo9357/Qwen3-ASR-0.6B-ONNX.
const cfg: Qwen3AsrPromptConfig = {
  layout_version: 2,
  prompt: {
    prefix_ids: [151644, 9125, 198, 151645, 198, 151644, 882, 198, 151669],
    suffix_ids: [151670, 151645, 198, 151644, 77091, 198],
    audio_pad_id: 151676,
    asr_text_id: 151704,
    eos_ids: [151643, 151645],
    max_new_tokens: 256,
  },
  language_prefix_ids: { ja: [11528, 10769, 151704], zh: [11528, 8453, 151704] },
  audio_tokens: { conv_window: 100, tokens_per_window: 13 },
  embedding: { file: 'embed_tokens.int8.bin', dtype: 'int8', shape: [151936, 1024], scales_file: 'embed_scales.f32.bin' },
  decoder: { num_layers: 28, num_key_value_heads: 8, head_dim: 128, hidden_size: 1024, vocab_size: 151936 },
  variants: {},
};

describe('audioTokenCount', () => {
  it('matches the pipeline formula: conv thrice on the remainder plus 13 per 100 frames', () => {
    expect(audioTokenCount(1100, cfg.audio_tokens)).toBe(143); // jfk.wav: 11 full windows
    expect(audioTokenCount(1, cfg.audio_tokens)).toBe(1);
    expect(audioTokenCount(100, cfg.audio_tokens)).toBe(13);
    expect(audioTokenCount(150, cfg.audio_tokens)).toBe(13 + 7); // conv(50)=25, conv(25)=13, conv(13)=7
    expect(audioTokenCount(0, cfg.audio_tokens)).toBe(0);
  });
});

describe('buildPromptIds', () => {
  it('lays out prefix, N audio pads, suffix and reports where the pads start', () => {
    const { ids, audioStart, forced } = buildPromptIds(3, cfg);
    expect(ids).toEqual([...cfg.prompt.prefix_ids, 151676, 151676, 151676, ...cfg.prompt.suffix_ids]);
    expect(audioStart).toBe(9);
    expect(forced).toBe(false);
  });
  it('appends the language prefix when forcing a known language', () => {
    const { ids, forced } = buildPromptIds(1, cfg, 'ja');
    expect(ids.slice(-3)).toEqual([11528, 10769, 151704]);
    expect(forced).toBe(true);
  });
  it('does not force an unknown language', () => {
    const { ids, forced } = buildPromptIds(1, cfg, 'xx');
    expect(forced).toBe(false);
    expect(ids.slice(-6)).toEqual(cfg.prompt.suffix_ids);
  });
});

describe('splitGenerated', () => {
  it('cuts at <asr_text> and drops eos', () => {
    expect(splitGenerated([11528, 10769, 151704, 5, 6, 151645], cfg)).toEqual({
      prefixIds: [11528, 10769],
      textIds: [5, 6],
      detectedPrefix: true,
    });
  });
  it('treats everything as text when the model skipped the prefix (forced or collapsed)', () => {
    expect(splitGenerated([5, 6, 151643], cfg)).toEqual({ prefixIds: [], textIds: [5, 6], detectedPrefix: false });
  });
  it('returns empty text for an immediate eos', () => {
    expect(splitGenerated([151645], cfg)).toEqual({ prefixIds: [], textIds: [], detectedPrefix: false });
  });
});

describe('normalizeLangForPrefix', () => {
  it('maps app language codes onto the prefix table', () => {
    expect(normalizeLangForPrefix('ja', cfg)).toBe('ja');
    expect(normalizeLangForPrefix('ja-JP', cfg)).toBe('ja');
    expect(normalizeLangForPrefix('zh_CN', cfg)).toBe('zh');
    expect(normalizeLangForPrefix('ZH-TW', cfg)).toBe('zh');
  });
  it('returns undefined for auto, empty, unknown and unsupported languages', () => {
    expect(normalizeLangForPrefix('auto', cfg)).toBeUndefined();
    expect(normalizeLangForPrefix('', cfg)).toBeUndefined();
    expect(normalizeLangForPrefix(undefined, cfg)).toBeUndefined();
    expect(normalizeLangForPrefix('fr', cfg)).toBeUndefined();
  });
  it('resolves the app aliases the catalogs use (cantonese → yue, tl → fil)', () => {
    const c = { ...cfg, language_prefix_ids: { yue: [1], fil: [2] } };
    expect(normalizeLangForPrefix('cantonese', c)).toBe('yue');
    expect(normalizeLangForPrefix('tl', c)).toBe('fil');
  });
});
