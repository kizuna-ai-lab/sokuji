import { describe, it, expect, vi } from 'vitest';
import {
  SonioxProviderConfig,
  defaultSonioxSettings,
  parseVocabularyTerms,
  parseVocabularyTranslations,
} from './SonioxProviderConfig';
import { SonioxSessionConfig } from '../interfaces/IClient';

describe('parseVocabularyTerms', () => {
  it('splits lines, trims, drops empties and dedupes', () => {
    expect(parseVocabularyTerms('  Kizuna AI \n\nSokuji\r\nSokuji\n   \nPipeWire'))
      .toEqual(['Kizuna AI', 'Sokuji', 'PipeWire']);
  });

  it('returns [] for empty input', () => {
    expect(parseVocabularyTerms('')).toEqual([]);
    expect(parseVocabularyTerms('  \n \n')).toEqual([]);
  });
});

describe('parseVocabularyTranslations', () => {
  it('splits each line on the FIRST = and trims both sides', () => {
    expect(parseVocabularyTranslations('Kizuna AI = 絆愛\na=b=c'))
      .toEqual([
        { source: 'Kizuna AI', target: '絆愛' },
        { source: 'a', target: 'b=c' },
      ]);
  });

  it('drops lines without = and lines with an empty side', () => {
    expect(parseVocabularyTranslations('no separator\n=target only\nsource only=\nok=fine'))
      .toEqual([{ source: 'ok', target: 'fine' }]);
  });

  it('returns [] for empty input', () => {
    expect(parseVocabularyTranslations('')).toEqual([]);
  });
});

describe('SonioxProviderConfig.buildSessionConfig', () => {
  const descriptor = new SonioxProviderConfig();
  const build = (patch: Partial<typeof defaultSonioxSettings>) =>
    descriptor.buildSessionConfig({ ...defaultSonioxSettings, ...patch }, '') as SonioxSessionConfig;

  it('emits no context and default numbers for default settings', () => {
    const cfg = build({});
    expect(cfg.context).toBeUndefined();
    expect(cfg.endpointSensitivity).toBe(0);
    expect(cfg.endpointLatencyAdjustmentLevel).toBe(0);
    expect(cfg.ttsSpeed).toBe(1.0);
  });

  it('parses vocabulary strings into a structured context', () => {
    const cfg = build({
      vocabularyTerms: 'Sokuji\nKizuna AI',
      vocabularyTranslations: 'Kizuna AI=絆愛',
    });
    expect(cfg.context).toEqual({
      terms: ['Sokuji', 'Kizuna AI'],
      translationTerms: [{ source: 'Kizuna AI', target: '絆愛' }],
    });
  });

  it('omits the empty half of the context', () => {
    expect(build({ vocabularyTerms: 'Sokuji' }).context).toEqual({ terms: ['Sokuji'] });
    expect(build({ vocabularyTranslations: 'a=b' }).context)
      .toEqual({ translationTerms: [{ source: 'a', target: 'b' }] });
  });

  it('clamps numbers to their documented ranges', () => {
    const cfg = build({ endpointSensitivity: 5, endpointLatencyAdjustmentLevel: 7, ttsSpeed: 2.0 });
    expect(cfg.endpointSensitivity).toBe(1);
    expect(cfg.endpointLatencyAdjustmentLevel).toBe(3);
    expect(cfg.ttsSpeed).toBe(1.3);
    const lo = build({ endpointSensitivity: -5, endpointLatencyAdjustmentLevel: -2, ttsSpeed: 0.1 });
    expect(lo.endpointSensitivity).toBe(-1);
    expect(lo.endpointLatencyAdjustmentLevel).toBe(0);
    expect(lo.ttsSpeed).toBe(0.7);
  });

  it('rounds fractional latency levels and falls back to defaults on non-finite input', () => {
    expect(build({ endpointLatencyAdjustmentLevel: 1.6 }).endpointLatencyAdjustmentLevel).toBe(2);
    for (const nonFinite of [NaN, Infinity, -Infinity]) {
      const bad = build({
        endpointSensitivity: nonFinite as unknown as number,
        endpointLatencyAdjustmentLevel: nonFinite as unknown as number,
        ttsSpeed: nonFinite as unknown as number,
      });
      expect(bad.endpointSensitivity).toBe(0);
      expect(bad.endpointLatencyAdjustmentLevel).toBe(0);
      expect(bad.ttsSpeed).toBe(1.0);
    }
  });

  it('trims the vocabulary to the serialized wire budget — translations first, earlier lines win', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 700 short unique "sNNN=tN" lines fit the 4000-char textarea but
    // serialize to ~22 KB of {source, target} objects — over the wire limit.
    const lines = Array.from({ length: 700 }, (_, i) => `s${String(i).padStart(3, '0')}=t${i}`);
    const cfg = build({ vocabularyTerms: 'KeepMe', vocabularyTranslations: lines.join('\n') });
    const kept = cfg.context!.translationTerms!;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(700);
    expect(kept[0]).toEqual({ source: 's000', target: 't0' }); // head retained, tail dropped
    expect(cfg.context!.terms).toEqual(['KeepMe']); // cheap terms survive untouched
    const serialized = JSON.stringify({
      terms: cfg.context!.terms,
      translation_terms: kept,
    }).length;
    expect(serialized).toBeLessThanOrEqual(9000);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('leaves an under-budget vocabulary untouched by the budget guard', () => {
    const cfg = build({ vocabularyTerms: 'Sokuji', vocabularyTranslations: 'a=b' });
    expect(cfg.context).toEqual({
      terms: ['Sokuji'],
      translationTerms: [{ source: 'a', target: 'b' }],
    });
  });

  it('tolerates a slice missing the new fields (pre-upgrade persisted state)', () => {
    const legacy = { ...defaultSonioxSettings } as Record<string, unknown>;
    delete legacy.vocabularyTerms;
    delete legacy.vocabularyTranslations;
    delete legacy.endpointSensitivity;
    delete legacy.endpointLatencyAdjustmentLevel;
    delete legacy.ttsSpeed;
    const cfg = descriptor.buildSessionConfig(legacy, '') as SonioxSessionConfig;
    expect(cfg.context).toBeUndefined();
    expect(cfg.endpointSensitivity).toBe(0);
    expect(cfg.endpointLatencyAdjustmentLevel).toBe(0);
    expect(cfg.ttsSpeed).toBe(1.0);
  });
});

describe('SonioxProviderConfig voices', () => {
  it('exposes the full 28-voice catalog, unique, including the original twelve', () => {
    const voices = new SonioxProviderConfig().getConfig().voices.map((v) => v.value);
    expect(voices).toHaveLength(28);
    expect(new Set(voices).size).toBe(28);
    for (const original of ['Adrian', 'Claire', 'Daniel', 'Emma', 'Grace', 'Jack', 'Kenji', 'Maya', 'Mina', 'Nina', 'Noah', 'Owen']) {
      expect(voices).toContain(original);
    }
  });
});
