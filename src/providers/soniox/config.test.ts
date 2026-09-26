import { describe, it, expect, vi } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildSoniox, describeSoniox } from './config';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';

const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };

// leased.test.ts:36-43's literal.
const SHARED: SharedSettings = {
  instructions: () => '',
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (direction) => direction.source === 'ja',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};

const build = (patch: Partial<SonioxSettings> = {}, context: SessionContext = AUTO_CTX) =>
  buildSoniox(context, { ...SONIOX_DEFAULTS, ...patch }, SHARED);

describe('buildSoniox — stt', () => {
  it('builds stt-rt-v5 with no context and the server-default knobs at defaults', () => {
    expect(build().stt).toEqual({
      model: 'stt-rt-v5',
      endpointSensitivity: 0,
      endpointLatencyAdjustmentLevel: 0,
      endpointMaxDelayMs: 2000,
    });
  });

  it("parses the vocabulary into the wire's snake_case context", () => {
    expect(build({
      vocabularyTerms: 'Sokuji\n Sokuji \n\nKizuna',
      vocabularyTranslations: 'a=b\nno equals\n=x\nk = v = w',
    }).stt.context).toEqual({
      terms: ['Sokuji', 'Kizuna'],
      translation_terms: [{ source: 'a', target: 'b' }, { source: 'k', target: 'v = w' }],
    });
  });

  it('passes trimmed background text as context.text, and omits whitespace-only text', () => {
    expect(build({ contextText: '  Quarterly review of the Sokuji roadmap. ' }).stt.context).toEqual({
      text: 'Quarterly review of the Sokuji roadmap.',
    });
    expect(build({ contextText: '   \n\t ' }).stt.context).toBeUndefined();
  });

  it('clamps the knobs, rounds the integer ones, and falls back on non-finite input', () => {
    const hi = build({ endpointSensitivity: 5, endpointLatencyAdjustmentLevel: 2.6, endpointMaxDelayMs: 99_999, ttsSpeed: 9 });
    expect(hi.stt.endpointSensitivity).toBe(1);
    expect(hi.stt.endpointLatencyAdjustmentLevel).toBe(3);
    expect(hi.stt.endpointMaxDelayMs).toBe(3000);
    expect(hi.tts?.speed).toBe(1.3);

    // The lower bounds (SonioxProviderConfig.test.ts:106-113).
    const lo = build({ endpointSensitivity: -5, endpointLatencyAdjustmentLevel: -2, endpointMaxDelayMs: 100, ttsSpeed: 0.1 });
    expect(lo.stt.endpointSensitivity).toBe(-1);
    expect(lo.stt.endpointLatencyAdjustmentLevel).toBe(0);
    expect(lo.stt.endpointMaxDelayMs).toBe(500);
    expect(lo.tts?.speed).toBe(0.7);

    const bad = build({ endpointMaxDelayMs: Number.NaN, ttsSpeed: Number.POSITIVE_INFINITY });
    expect(bad.stt.endpointMaxDelayMs).toBe(2000);
    expect(bad.tts?.speed).toBe(1);
  });

  describe('the context wire budget (SonioxProviderConfig.test.ts:133-262, ported over build(...).stt.context)', () => {
    it('trims the vocabulary to the serialized wire budget — translations first, earlier lines win', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // 700 short unique "sNNN=tN" lines fit the 4000-char textarea but
      // serialize to ~22 KB of {source, target} objects — over the wire limit.
      const lines = Array.from({ length: 700 }, (_, i) => `s${String(i).padStart(3, '0')}=t${i}`);
      const context = build({ vocabularyTerms: 'KeepMe', vocabularyTranslations: lines.join('\n') }).stt.context!;
      const kept = context.translation_terms!;
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(700);
      expect(kept[0]).toEqual({ source: 's000', target: 't0' }); // head retained, tail dropped
      expect(context.terms).toEqual(['KeepMe']); // cheap terms survive untouched
      const serialized = JSON.stringify({ terms: context.terms, translation_terms: kept }).length;
      expect(serialized).toBeLessThanOrEqual(9000);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('leaves an under-budget vocabulary untouched by the budget guard', () => {
      expect(build({ vocabularyTerms: 'Sokuji', vocabularyTranslations: 'a=b' }).stt.context).toEqual({
        terms: ['Sokuji'],
        translation_terms: [{ source: 'a', target: 'b' }],
      });
    });

    it('truncates the background text first when the serialized context overflows, keeping vocabulary intact', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // ~200 translation pairs (~6.4 KB serialized) + 4000-char text → overflow
      // where text absorbs the whole cut and translations survive untouched.
      const lines = Array.from({ length: 200 }, (_, i) => `src${String(i).padStart(3, '0')}=tgt${i}`);
      const context = build({ vocabularyTranslations: lines.join('\n'), contextText: 'x'.repeat(4000) }).stt.context!;
      expect(context.translation_terms).toHaveLength(200);
      const text = context.text!;
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThan(4000);
      const serialized = JSON.stringify({ translation_terms: context.translation_terms, text }).length;
      expect(serialized).toBeLessThanOrEqual(9000);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('sacrifices the text entirely before touching vocabulary on extreme overflow', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // 700 pairs (~22 KB serialized) — text goes to zero, then translations trim.
      const lines = Array.from({ length: 700 }, (_, i) => `s${String(i).padStart(3, '0')}=t${i}`);
      const context = build({ vocabularyTranslations: lines.join('\n'), contextText: 'y'.repeat(4000) }).stt.context!;
      expect(context.text).toBeUndefined(); // fully truncated → omitted
      expect(context.translation_terms!.length).toBeGreaterThan(0);
      expect(context.translation_terms!.length).toBeLessThan(700);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('strips a trailing lone surrogate when the truncation cut lands mid-emoji', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // 100 CJK chars + 1950 emoji (each a surrogate pair) = 4000 UTF-16 code
      // units of background text, plus 200 translation pairs to force overflow.
      const lines = Array.from({ length: 200 }, (_, i) => `src${String(i).padStart(3, '0')}=tgt${i}`);
      const context = build({
        vocabularyTranslations: lines.join('\n'),
        contextText: '好'.repeat(100) + '😀'.repeat(1950),
      }).stt.context!;
      expect(context.translation_terms).toHaveLength(200);
      const text = context.text!;
      expect(text.length).toBeGreaterThan(0);
      expect(/[\uD800-\uDBFF]$/.test(text)).toBe(false);
      const serialized = JSON.stringify({ translation_terms: context.translation_terms, text }).length;
      expect(serialized).toBeLessThanOrEqual(9000);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('cuts escape-heavy background text exactly instead of over-truncating', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Newline-rich agenda: every second character serializes as a 2-unit
      // escape, so raw-length arithmetic would empty the text entirely; the
      // exact (binary-search) cut keeps everything that actually fits.
      const lines = Array.from({ length: 200 }, (_, i) => `src${String(i).padStart(3, '0')}=tgt${i}`);
      const context = build({ vocabularyTranslations: lines.join('\n'), contextText: 'a\n'.repeat(2000) }).stt.context!;
      expect(context.translation_terms).toHaveLength(200);
      const text = context.text!;
      expect(text.length).toBeGreaterThan(0); // the naive over-cut would have emptied it
      const serialized = JSON.stringify({ translation_terms: context.translation_terms, text }).length;
      expect(serialized).toBeLessThanOrEqual(9000);
      expect(serialized).toBeGreaterThan(8990); // maximal: the cut wastes no meaningful capacity
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });
});

describe('buildSoniox — tts', () => {
  it("speaks only when the context speaks: the region's voice, the speed clamped", () => {
    expect(build({}, { ...AUTO_CTX, speech: false }).tts).toBeUndefined();
    expect(build({ region: 'jp', voiceJp: 'Clone-UUID' }).tts).toEqual({ voice: 'Clone-UUID', speed: 1 });
    expect(build({ region: 'eu', voiceEu: '' }).tts?.voice).toBe('Adrian');
  });
});

describe('buildSoniox — sharedBoth', () => {
  it('carries the shared-Both choice', () => {
    expect(build({ bothModeSharedSession: false }).sharedBoth).toBe(false);
  });
});

describe('describeSoniox', () => {
  it('describes the STT model always, and the TTS model only for a leg that speaks', () => {
    expect(describeSoniox(build())).toEqual({ asrModel: 'stt-rt-v5', ttsModel: 'tts-rt-v2' });
    expect(describeSoniox(build({}, { ...AUTO_CTX, speech: false }))).toEqual({ asrModel: 'stt-rt-v5' });
  });
});
