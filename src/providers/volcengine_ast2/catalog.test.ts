import { describe, it, expect } from 'vitest';
import raw from './voices.json';
import { pairCode } from '../../lib/language/code';
import { FIXED_LANGUAGES, type Catalog } from './catalogShape';
import { defaultVoice, isFixedTarget, resourceOf, speaks, voicesFor } from './catalog';
import { ONE_WAY_ONLY } from '../../../scripts/doubao-voices/build';

const catalog = raw as Catalog;
const VIVI = 'zh_female_vv_uranus_bigtts';

describe("the snapshot's invariants (#577 catalog spec §1.3)", () => {
  it('holds unique voices, each with a resource, a gender and at least one of the nine languages', () => {
    const ids = catalog.voices.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of catalog.voices) {
      expect([1, 2], v.id).toContain(v.r);
      expect(['male', 'female'], v.id).toContain(v.g);
      expect(Object.keys(v.l).length, v.id).toBeGreaterThan(0);
      for (const code of Object.keys(v.l)) expect(FIXED_LANGUAGES, `${v.id} ${code}`).toContain(code);
      const first = Object.values(v.l)[0];
      expect(first.n && first.a && first.p, v.id).toBeTruthy();
    }
  });

  it('holds no one-way-only voice', () => {
    for (const v of catalog.voices) expect(ONE_WAY_ONLY.has(v.id), v.id).toBe(false);
  });

  it('counts the 2026-10-02 pull (a refresh updates these numbers in its own diff)', () => {
    expect(catalog.voices).toHaveLength(506);
    expect(Object.fromEntries(FIXED_LANGUAGES.map((c) => [c, voicesFor(c).length]))).toEqual({ zh: 362, en: 95, ja: 16, id: 14, es: 21, pt: 12, de: 1, fr: 3, ko: 3 });
    expect(voicesFor('zh+en')).toHaveLength(12);
  });
});

describe("the catalog's lookups", () => {
  it("names zh+en as the app's bidirectional code", () => {
    expect(pairCode('zh', 'en')).toBe('zh+en');
    expect(isFixedTarget('zh+en')).toBe(true);
    expect(isFixedTarget('ko')).toBe(true);
    expect(isFixedTarget('th')).toBe(false);
  });

  it('lists the voices of a target in ListSpeakers order, each named and sampled in that language', () => {
    const en = voicesFor('en');
    const harmony = en.find((v) => v.id === 'zh_male_jingqiangkanye_moon_bigtts')!;
    expect(harmony).toEqual({
      id: 'zh_male_jingqiangkanye_moon_bigtts', resource: 'seed-tts-1.0', gender: 'male', age: 'young', name: 'Harmony',
      previewUrl: `${catalog.prefix}portal/bigtts/short_trial_url/Harmony.mp3`,
    });
    expect(voicesFor('zh').find((v) => v.id === harmony.id)!.name).toBe('京腔侃爷');
    expect(en.map((v) => v.id)).toEqual(catalog.voices.filter((v) => 'en' in v.l).map((v) => v.id));
  });

  it("reads a {} language as the voice's first", () => {
    const ja = voicesFor('ja').find((v) => v.id === VIVI)!;
    const zh = voicesFor('zh').find((v) => v.id === VIVI)!;
    expect(ja).toEqual(zh);
  });

  it('lists for zh+en the voices that speak both, named in Chinese', () => {
    for (const v of voicesFor('zh+en')) expect(speaks(v.id, 'zh') && speaks(v.id, 'en'), v.id).toBe(true);
    expect(voicesFor('zh+en').find((v) => v.id === 'zh_male_jingqiangkanye_moon_bigtts')!.name).toBe('京腔侃爷');
  });

  it('answers whether a voice speaks a target, and its resource', () => {
    expect(speaks(VIVI, 'ja')).toBe(true);
    expect(speaks(VIVI, 'ko')).toBe(false);
    expect(speaks('en_male_alex_uranus_bigtts', 'zh')).toBe(false);
    expect(speaks('nope_bigtts', 'zh')).toBe(false);
    expect(resourceOf(VIVI)).toBe('seed-tts-2.0');
    expect(resourceOf('zh_male_jingqiangkanye_emo_mars_bigtts')).toBe('seed-tts-1.0');
    expect(resourceOf('nope_bigtts')).toBeUndefined();
  });

  it("takes a target's first voice as its default", () => {
    for (const code of ['zh', 'en', 'ja', 'es', 'id', 'zh+en']) expect(defaultVoice(code)!.id, code).toBe(VIVI);
    expect(defaultVoice('ko')!.id).toBe('ko_male_m03_uranus_bigtts');
    expect(defaultVoice('th')).toBeUndefined();
  });
});
