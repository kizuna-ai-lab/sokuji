import { describe, it, expect } from 'vitest';
import { AST2_DEFAULTS } from './settings';
import { CLONE, clonable, effectiveVoice } from './voice';

const VIVI = 'zh_female_vv_uranus_bigtts';
const ALEX = 'en_male_alex_uranus_bigtts';
const pair = (source: string, target: string) => ({ source, target });
const withVoices = (voices: Record<string, string>) => ({ ...AST2_DEFAULTS, voices });

describe('clonable (#577 catalog §2.2)', () => {
  it('is the cloning model: lang_8 both sides with Chinese or English on one, or zh+en with itself', () => {
    for (const [s, t] of [['zh', 'en'], ['en', 'zh'], ['ja', 'zh'], ['en', 'fr'], ['zh', 'pt'], ['zh+en', 'zh+en']]) expect(clonable(pair(s, t)), `${s} → ${t}`).toBe(true);
  });

  it('is false where the server answers "group model … not found" (#576), and for nonsense pairs', () => {
    for (const [s, t] of [['ko', 'en'], ['zh', 'ko'], ['yue', 'zh'], ['ru', 'en'], ['ja', 'de'], ['zh', 'zh'], ['zh+en', 'en'], ['en', 'zh+en']]) expect(clonable(pair(s, t)), `${s} → ${t}`).toBe(false);
  });
});

describe('effectiveVoice (#577 catalog §2.4)', () => {
  it('clones a pair cloning runs when nothing is chosen, as every profile before the catalog did', () => {
    expect(effectiveVoice(pair('zh', 'en'), AST2_DEFAULTS)).toBe(CLONE);
    expect(effectiveVoice(pair('zh+en', 'zh+en'), AST2_DEFAULTS)).toBe(CLONE);
  });

  it("speaks the target's first voice on a pair cloning does not run", () => {
    expect(effectiveVoice(pair('ko', 'en'), AST2_DEFAULTS)).toBe(VIVI);
    expect(effectiveVoice(pair('zh', 'ko'), AST2_DEFAULTS)).toBe('ko_male_m03_uranus_bigtts');
  });

  it('speaks the voice chosen for the target', () => {
    expect(effectiveVoice(pair('zh', 'en'), withVoices({ en: ALEX }))).toBe(ALEX);
    expect(effectiveVoice(pair('ko', 'en'), withVoices({ en: ALEX }))).toBe(ALEX);
    expect(effectiveVoice(pair('zh+en', 'zh+en'), withVoices({ 'zh+en': 'zh_female_shuangkuaisisi_moon_bigtts' }))).toBe('zh_female_shuangkuaisisi_moon_bigtts');
  });

  it('keeps a stored clone for a pair it cannot run, without overwriting it, and applies it again where it can', () => {
    const s = withVoices({ en: CLONE });
    expect(effectiveVoice(pair('ko', 'en'), s)).toBe(VIVI);
    expect(effectiveVoice(pair('zh', 'en'), s)).toBe(CLONE);
    expect(s.voices).toEqual({ en: CLONE });
  });

  it('falls back when the chosen voice cannot speak the target or is gone (Review Focus)', () => {
    expect(effectiveVoice(pair('zh', 'en'), withVoices({ en: 'ja_female_bv024_uranus_bigtts' }))).toBe(CLONE);
    expect(effectiveVoice(pair('ko', 'en'), withVoices({ en: 'nope_bigtts' }))).toBe(VIVI);
  });

  it('reads only the slot of the target', () => {
    expect(effectiveVoice(pair('zh', 'ja'), withVoices({ en: ALEX }))).toBe(CLONE);
  });
});
