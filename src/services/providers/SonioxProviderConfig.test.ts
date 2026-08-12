import { describe, it, expect, vi } from 'vitest';
import {
  SonioxProviderConfig,
  defaultSonioxSettings,
  parseVocabularyTerms,
  parseVocabularyTranslations,
} from './SonioxProviderConfig';
import { SonioxSessionConfig } from '../interfaces/IClient';
import { SONIOX_DEFAULT_VOICE, resolveVoice } from '../../lib/soniox/ttsCatalog';

/** Built-ins tts-rt-v1 served that tts-rt-v2 rejects with HTTP 400. */
const RETIRED_BY_V2 = ['Claire', 'Elise', 'Jack', 'Maya', 'Meera', 'Noah', 'Sofia'];

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
    delete legacy.contextText;
    const cfg = descriptor.buildSessionConfig(legacy, '') as SonioxSessionConfig;
    expect(cfg.context).toBeUndefined();
    expect(cfg.endpointSensitivity).toBe(0);
    expect(cfg.endpointLatencyAdjustmentLevel).toBe(0);
    expect(cfg.ttsSpeed).toBe(1.0);
  });

  it('passes trimmed background text through as context.text', () => {
    const cfg = build({ contextText: '  Quarterly review of the Sokuji roadmap. ' });
    expect(cfg.context).toEqual({ text: 'Quarterly review of the Sokuji roadmap.' });
  });

  it('omits context entirely for whitespace-only background text', () => {
    const cfg = build({ contextText: '   \n\t ' });
    expect(cfg.context).toBeUndefined();
  });

  it('truncates the background text first when the serialized context overflows, keeping vocabulary intact', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // ~200 translation pairs (~6.4 KB serialized) + 4000-char text → overflow
    // where text absorbs the whole cut and translations survive untouched.
    const lines = Array.from({ length: 200 }, (_, i) => `src${String(i).padStart(3, '0')}=tgt${i}`);
    const cfg = build({ vocabularyTranslations: lines.join('\n'), contextText: 'x'.repeat(4000) });
    expect(cfg.context!.translationTerms).toHaveLength(200);
    const text = cfg.context!.text!;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(4000);
    const serialized = JSON.stringify({
      translation_terms: cfg.context!.translationTerms,
      text,
    }).length;
    expect(serialized).toBeLessThanOrEqual(9000);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('sacrifices the text entirely before touching vocabulary on extreme overflow', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 700 pairs (~22 KB serialized) — text goes to zero, then translations trim.
    const lines = Array.from({ length: 700 }, (_, i) => `s${String(i).padStart(3, '0')}=t${i}`);
    const cfg = build({ vocabularyTranslations: lines.join('\n'), contextText: 'y'.repeat(4000) });
    expect(cfg.context!.text).toBeUndefined();          // fully truncated → omitted
    expect(cfg.context!.translationTerms!.length).toBeGreaterThan(0);
    expect(cfg.context!.translationTerms!.length).toBeLessThan(700);
    warn.mockRestore();
  });

  it('strips a trailing lone surrogate when the truncation cut lands mid-emoji', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 100 CJK chars + 1950 emoji (each a surrogate pair) = 4000 UTF-16 code
    // units of background text, plus 200 translation pairs to force overflow
    // (same generator as the test above). With these exact counts the
    // computed cut (keep=1477) lands 1,377 code units into the emoji run —
    // an odd offset into 2-unit pairs, i.e. mid-pair — which exercises the
    // lone-surrogate strip. (Verified numerically; adjust the pair count if
    // this ever stops landing mid-pair.)
    const lines = Array.from({ length: 200 }, (_, i) => `src${String(i).padStart(3, '0')}=tgt${i}`);
    const cfg = build({
      vocabularyTranslations: lines.join('\n'),
      contextText: '好'.repeat(100) + '😀'.repeat(1950),
    });
    expect(cfg.context!.translationTerms).toHaveLength(200);
    const text = cfg.context!.text!;
    expect(text.length).toBeGreaterThan(0);
    expect(/[\uD800-\uDBFF]$/.test(text)).toBe(false);
    const serialized = JSON.stringify({
      translation_terms: cfg.context!.translationTerms,
      text,
    }).length;
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
    const cfg = build({ vocabularyTranslations: lines.join('\n'), contextText: 'a\n'.repeat(2000) });
    expect(cfg.context!.translationTerms).toHaveLength(200);
    const text = cfg.context!.text!;
    expect(text.length).toBeGreaterThan(0); // the naive over-cut would have emptied it
    const serialized = JSON.stringify({
      translation_terms: cfg.context!.translationTerms,
      text,
    }).length;
    expect(serialized).toBeLessThanOrEqual(9000);
    expect(serialized).toBeGreaterThan(8990); // maximal: the cut wastes no meaningful capacity
    warn.mockRestore();
  });
});

describe('SonioxProviderConfig voices', () => {
  const descriptor = new SonioxProviderConfig();
  const voiceOf = (voice: string) =>
    (descriptor.buildSessionConfig({ ...defaultSonioxSettings, voice }, '') as SonioxSessionConfig).voice;

  it('offers the tts-rt-v2 roster and none of the seven voices v2 retired', () => {
    const voices = new SonioxProviderConfig().getConfig().voices.map((v) => v.value);
    // Pinning all 70 names would make this fail on Soniox's release schedule
    // rather than on ours — the roster is a snapshot of GET /v1/tts-models and
    // already moved once (71 → 70) on GA day. What must hold is the property
    // the v1 → v2 migration is about: nothing offered is something v2 rejects.
    expect(voices.length).toBeGreaterThan(0);
    expect(new Set(voices).size).toBe(voices.length);
    for (const retired of RETIRED_BY_V2) expect(voices).not.toContain(retired);
    // Survivors: still offered, so a user who picked one under v1 keeps it.
    expect(voices).toEqual(expect.arrayContaining(['Adrian', 'Daniel', 'Kenji', 'Mina', 'Nina']));
  });

  it('never offers a voice that resolveVoice would rewrite', () => {
    // The dropdown and the wire have to agree. An option the user can pick
    // that resolveVoice then swaps out would speak in a voice they did not
    // choose, with nothing in the UI admitting it.
    for (const { value } of new SonioxProviderConfig().getConfig().voices) {
      expect(resolveVoice(value)).toBe(value);
    }
  });

  it('rewrites a retired v1 voice from saved settings instead of sending it', () => {
    // The upgrade path that actually exists: settings written under tts-rt-v1,
    // read back by a build that talks to v2. 'Maya' was the shipped default,
    // so this is the common case, not an edge one.
    for (const retired of RETIRED_BY_V2) expect(voiceOf(retired)).toBe(SONIOX_DEFAULT_VOICE);
  });

  it('passes a cloned-voice id through untouched', () => {
    // Cloned voices are Soniox-issued UUIDs and are absent from the built-in
    // roster by design — the fallback must not mistake that for a stale name.
    const uuid = 'bf8c1ec8-548f-4d2c-8706-72e3b840f349';
    expect(voiceOf(uuid)).toBe(uuid);
  });
});
