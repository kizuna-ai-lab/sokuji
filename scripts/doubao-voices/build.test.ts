import { describe, it, expect } from 'vitest';
import { buildCatalog, formatCatalog, PREFIX, type RawSpeaker } from './build';

const raw = (o: Partial<RawSpeaker> & Pick<RawSpeaker, 'voice_type'>): RawSpeaker => ({
  resource_id: 'seed-tts-2.0',
  name: o.voice_type,
  gender: '女',
  age: '青年',
  languages: [{ language: 'zh-cn' }],
  short_trial_url: `${PREFIX}portal/bigtts/short_trial_url/${o.voice_type}.mp3`,
  trial_url: `${PREFIX}portal/bigtts/${o.voice_type}.wav`,
  ...o,
});

describe('buildCatalog (#577 catalog spec §1.1)', () => {
  it("drops the voice list's one-way-only voices, which fail in a bidirectional stream", () => {
    const c = buildCatalog([raw({ voice_type: 'ja_female_minimi_uranus_bigtts', languages: [{ language: 'ja' }] }), raw({ voice_type: 'a' })], '2026-10-02');
    expect(c.voices.map((v) => v.id)).toEqual(['a']);
  });

  it('maps ListSpeakers languages to app codes and keeps only the nine a fixed voice speaks', () => {
    const c = buildCatalog([
      raw({ voice_type: 'es', languages: [{ language: 'es-mx' }] }),
      raw({ voice_type: 'mx', languages: [{ language: 'mx' }] }),
      raw({ voice_type: 'pt', languages: [{ language: 'pt-br' }] }),
      raw({ voice_type: 'ko', languages: [{ language: 'ko' }] }),
      raw({ voice_type: 'th', languages: [{ language: 'th' }] }),
      raw({ voice_type: 'fil', languages: [{ language: 'fil' }] }),
    ], '2026-10-02');
    expect(c.voices.map((v) => [v.id, Object.keys(v.l)])).toEqual([['es', ['es']], ['mx', ['es']], ['pt', ['pt']], ['ko', ['ko']]]);
  });

  it('merges one id split over several entries, each language keeping its own persona, age and clip', () => {
    const c = buildCatalog([
      raw({ voice_type: 'zh_male_jingqiangkanye_moon_bigtts', resource_id: 'seed-tts-1.0', gender: '男', name: 'Harmony', age: '青年', languages: [{ language: 'en' }], short_trial_url: `${PREFIX}portal/bigtts/short_trial_url/Harmony.mp3` }),
      raw({ voice_type: 'zh_male_jingqiangkanye_moon_bigtts', resource_id: 'seed-tts-1.0', gender: '男', name: '京腔侃爷', age: '中年', languages: [{ language: 'zh-cn' }], short_trial_url: `${PREFIX}portal/bigtts/short_trial_url/京腔侃爷.mp3` }),
    ], '2026-10-02');
    expect(c.voices).toEqual([{
      id: 'zh_male_jingqiangkanye_moon_bigtts', r: 1, g: 'male',
      l: {
        en: { n: 'Harmony', a: 'young', p: 'portal/bigtts/short_trial_url/Harmony.mp3' },
        zh: { n: '京腔侃爷', a: 'middle_aged', p: 'portal/bigtts/short_trial_url/京腔侃爷.mp3' },
      },
    }]);
  });

  it('stores a language equal to the first as {}, and adds zh and en to the two voices the AST document names', () => {
    const c = buildCatalog([
      raw({ voice_type: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0', languages: [{ language: 'zh-cn' }, { language: 'ja' }, { language: 'id' }, { language: 'es-mx' }], short_trial_url: null }),
      raw({ voice_type: 'zh_male_jingqiangkanye_emo_mars_bigtts', resource_id: 'seed-tts-1.0', gender: '男', name: '京腔侃爷', age: '中年' }),
    ], '2026-10-02');
    expect(c.voices[0]).toEqual({
      id: 'zh_female_vv_uranus_bigtts', r: 2, g: 'female',
      // No short trial: the long one.
      l: { zh: { n: 'Vivi 2.0', a: 'young', p: 'portal/bigtts/zh_female_vv_uranus_bigtts.wav' }, ja: {}, id: {}, es: {}, en: {} },
    });
    expect(Object.keys(c.voices[1].l)).toEqual(['zh', 'en']);
    expect(c.voices[1].l.en).toEqual({});
  });

  it('keeps ListSpeakers order', () => {
    const c = buildCatalog(['c', 'a', 'b'].map((id) => raw({ voice_type: id })), '2026-10-02');
    expect(c.voices.map((v) => v.id)).toEqual(['c', 'a', 'b']);
  });

  it('fails loudly on a value its tables do not know, so a refresh cannot ship a guess', () => {
    expect(() => buildCatalog([raw({ voice_type: 'x', age: '婴儿' })], 'd')).toThrow(/x: unknown age "婴儿"/);
    expect(() => buildCatalog([raw({ voice_type: 'x', gender: '?' })], 'd')).toThrow(/x: unknown gender/);
    expect(() => buildCatalog([raw({ voice_type: 'x', resource_id: 'seed-icl-2.0' })], 'd')).toThrow(/x: unknown resource/);
    expect(() => buildCatalog([raw({ voice_type: 'x', short_trial_url: 'https://elsewhere/x.mp3' })], 'd')).toThrow(/x: sample clip outside/);
    expect(() => buildCatalog([raw({ voice_type: 'x' }), raw({ voice_type: 'x', resource_id: 'seed-tts-1.0', languages: [{ language: 'en' }] })], 'd')).toThrow(/x: its entries disagree/);
  });
});

describe('formatCatalog', () => {
  it('writes valid JSON with one voice per line, so a refresh diffs voice by voice', () => {
    const c = buildCatalog([raw({ voice_type: 'a' }), raw({ voice_type: 'b' })], '2026-10-02');
    const text = formatCatalog(c);
    expect(JSON.parse(text)).toEqual(c);
    expect(text.split('\n')).toHaveLength(5);
    expect(text.endsWith('\n')).toBe(true);
  });
});
