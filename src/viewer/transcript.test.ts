// src/viewer/transcript.test.ts
import { describe, it, expect } from 'vitest';
import type { ViewerEntry } from '../lib/share/types';
import { makeT } from './strings';
import { transcriptText } from './transcript';

const t = makeT({ transcript: { header: 'Saved {{time}}' } }, undefined);
const at = new Date(2026, 9, 4, 19, 12, 5).getTime();
const e = (id: string, src: string, tr: string): ViewerEntry => ({
  id, leg: 'speaker', t: at, languages: { source: 'ja', target: 'zh-CN' },
  source: [{ key: `${id}:1:0`, text: src, final: true }], translation: [{ key: `${id}:2:0`, text: tr, final: true }],
});

describe('transcriptText', () => {
  it('writes a header, then a time and the chosen language per entry, the other line when both', () => {
    const text = transcriptText([e('a', '今日は', '今天'), e('b', '', '')], { code: 'zh-CN', both: true }, t, at);
    expect(text).toBe('Saved 2026-10-04 19:12:05\n\n[19:12:05]\n今天\n今日は\n');
  });

  it('one language only', () => {
    expect(transcriptText([e('a', '今日は', '今天')], { code: 'ja', both: false }, t, at)).toBe('Saved 2026-10-04 19:12:05\n\n[19:12:05]\n今日は\n');
  });
});
