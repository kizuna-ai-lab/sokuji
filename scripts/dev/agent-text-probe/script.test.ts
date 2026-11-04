import { describe, expect, it } from 'vitest';
import { activeDbfs } from './audio';
import { buildScript, CLIPS, LEAD_MS, PAIRS } from './script';
import { coverage, editCounts, units } from './text';

const RATE = 24000;
/** Every file a steady tone 10 s long, so cuts are easy to find. */
const load = () => Int16Array.from({ length: RATE * 10 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / RATE)));

describe('buildScript', () => {
  it('lays the turns out in order, A then B, each after its gap, the speech windows in microphone ms', () => {
    const s = buildScript('zh-ja', { rate: RATE, voiceDbfs: -20, turns: 3 }, load);
    expect(s.turns.map((t) => [t.k, t.side, t.lang, t.clip, t.fromMs, t.toMs, t.intent])).toEqual([
      [1, 'A', 'zh', 'zh', 1000, 5380, 'clean'],
      [2, 'B', 'ja', 'umbrella', 14380, 17800, 'clean'],
      [3, 'A', 'zh', 'zh1', 19300, 20540, 'talk-over'],
    ]);
    expect(s.turns[0].text).toBe(CLIPS.zh.text);
    // The pcm: silence until the first clip's cut (its speech less the lead), then the clip, at the asked level.
    const at = ((1000 - LEAD_MS) * RATE) / 1000;
    expect(s.pcm.subarray(0, at).every((v) => v === 0)).toBe(true);
    expect(activeDbfs(s.pcm.subarray(at, at + RATE), RATE)).toBeCloseTo(-20, 0);
    expect(s.durationMs).toBeGreaterThan(20540);
  });

  it('is the same samples every time', () => {
    const a = buildScript('zh-en', { rate: RATE, voiceDbfs: -20 }, load);
    const b = buildScript('zh-en', { rate: RATE, voiceDbfs: -20 }, load);
    expect(a.pcm.length).toBe(b.pcm.length);
    expect(Buffer.from(a.pcm.buffer, a.pcm.byteOffset, a.pcm.byteLength).equals(Buffer.from(b.pcm.buffer, b.pcm.byteOffset, b.pcm.byteLength))).toBe(true);
    expect(a.turns).toHaveLength(PAIRS['zh-en'].turns.length);
  });

  it('alternates the two languages in both pairs, and mixes talk-over and clean turns for each language', () => {
    for (const name of Object.keys(PAIRS)) {
      const s = buildScript(name, { rate: RATE, voiceDbfs: -20 }, load);
      for (const lang of [PAIRS[name].a, PAIRS[name].b]) {
        const intents = new Set(s.turns.filter((t) => t.lang === lang).map((t) => t.intent));
        expect([...intents].sort(), `${name} ${lang}`).toEqual(['clean', 'talk-over']);
      }
    }
  });

  it('refuses an unknown pair', () => {
    expect(() => buildScript('xx', { rate: RATE, voiceDbfs: -20 }, load)).toThrow(/pair one of/);
  });
});

describe('text measures', () => {
  it('counts characters for zh/ja and words for en, punctuation and case aside', () => {
    expect(units('欢迎，使用 实时。', 'zh')).toEqual(['欢', '迎', '使', '用', '实', '时']);
    expect(units('Ask not, what YOUR country…', 'en')).toEqual(['ask', 'not', 'what', 'your', 'country']);
  });

  it('counts substitutions, deletions and insertions', () => {
    expect(editCounts([...'abcd'], [...'abxd'])).toEqual({ n: 4, s: 1, d: 0, i: 0 });
    expect(editCounts([...'abcd'], [...'abd'])).toEqual({ n: 4, s: 0, d: 1, i: 0 });
    expect(editCounts([...'ab'], [...'xxab'])).toEqual({ n: 2, s: 0, d: 0, i: 2 });
    expect(editCounts([...'ab'], [])).toEqual({ n: 2, s: 0, d: 2, i: 0 });
  });

  it('measures how much of one text appears, in order, in another', () => {
    expect(coverage('实时翻译', '欢迎使用实时翻译', 'zh')).toBe(1);
    expect(coverage('欢迎使用实时翻译', '实时翻译', 'zh')).toBe(0.5);
    expect(coverage('', 'x', 'zh')).toBe(0);
  });
});
