import { describe, expect, it } from 'vitest';
import { score, type LogLine } from './score';

/**
 * A canned run. Person A (zh, speaker leg) and B (ja, participant leg).
 * - Turn 1, A, clean: recognised right.
 * - A's translation (ref 2, ja) plays; its echo becomes a ja line between the turns (ref 3): an echo line,
 *   translated (ref 4, zh) and spoken back.
 * - Turn 2, B, over that zh playback: recognised with one substitution and one deletion.
 * - Turn 3, A, over more zh playback (ref 6): its line holds the echo's text too — the person's, merged.
 */
const L = (t: number, kind: string, d?: unknown): LogLine => ({ t, kind, ...(d === undefined ? {} : { d }) });
const seg = (t: number, leg: string, ref: number, side: string, origin: string, text: string, language: string, timing?: [number, number]): LogLine[] => [
  L(t, 'seg', { leg, event: 'opened', ref, side, origin }),
  L(t, 'seg', { leg, event: 'text', ref, text, language, ...(timing ? { timing: { startMs: timing[0], endMs: timing[1] } } : {}) }),
  L(t, 'seg', { leg, event: 'closed', ref, origin }),
];

const LOG: LogLine[] = [
  L(0, 'run', { condition: 'enqueue', echo: { on: true, delayMs: 120 } }),
  L(0, 'script', {
    turns: [
      { k: 1, side: 'A', lang: 'zh', clip: 'zh1', text: '欢迎使用实时翻译，', fromMs: 1000, toMs: 2240, intent: 'clean' },
      { k: 2, side: 'B', lang: 'ja', clip: 'door', text: 'ドアを閉めてください。', fromMs: 5000, toMs: 7260, intent: 'talk-over' },
      { k: 3, side: 'A', lang: 'zh', clip: 'zh2', text: '希望这个声音能让交流变得轻松自然。', fromMs: 9000, toMs: 11550, intent: 'talk-over' },
    ],
  }),
  L(130, 'tau0', { tau0: -70 }),
  ...seg(2500, 'speaker', 1, 'source', 'u1', '欢迎使用实时翻译', 'zh', [1000, 2200]),
  ...seg(2500, 'speaker', 2, 'translation', 'u1', 'リアルタイム翻訳へようこそ。', 'ja'),
  L(2900, 'agent', { voice: 'speaker', ref: 2, span: [0, 6], text: 'リアルタイム', end: false, sent: true, pos: 2700 }),
  L(2900, 'audio', { leg: 'speaker', voice: 'speaker', ref: 2, index: 0, range: [0, 6], samples: 14400, at: 2810, micFrom: 3000, micTo: 3600 }),
  L(3300, 'audio', { leg: 'speaker', voice: 'speaker', ref: 2, index: 1, range: [6, 10], samples: 14400, at: 3410, micFrom: 3600, micTo: 4200 }),
  L(3900, 'agent', { voice: 'speaker', ref: 2, span: [6, 14], text: '翻訳へようこそ。', end: false, sent: true, pos: 3700 }),
  L(3900, 'ranges', { leg: 'speaker', ref: 2, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 14] }] }),
  L(4300, 'agent', { voice: 'speaker', text: '', end: true, sent: true, pos: 4100 }),
  L(4300, 'agent', { voice: 'speaker', ref: 2, span: [14, 14], text: 'x', end: false, sent: false, pos: 4100 }),
  ...seg(4400, 'participant', 3, 'source', 'u2', 'リアルタイム翻訳', 'ja', [3100, 4100]),
  ...seg(4400, 'participant', 4, 'translation', 'u2', '实时翻译', 'zh'),
  L(4500, 'audio', { leg: 'participant', voice: 'participant', ref: 4, index: 0, range: [0, 4], samples: 26400, at: 4310, micFrom: 4500, micTo: 5600 }),
  ...seg(7800, 'participant', 5, 'source', 'u3', 'ドアを閉めて下さい', 'ja', [5000, 7200]),
  ...seg(7800, 'participant', 6, 'translation', 'u3', '关上门', 'zh'),
  L(8400, 'audio', { leg: 'participant', voice: 'participant', ref: 6, index: 0, range: [0, 3], samples: 19200, at: 8310, micFrom: 8500, micTo: 9300 }),
  ...seg(12000, 'speaker', 7, 'source', 'u4', '关上门希望这个声音能让交流变得轻松自然', 'zh', [8600, 11500]),
  // Never finalized: not counted.
  L(12500, 'seg', { leg: 'speaker', event: 'opened', ref: 9, side: 'source', origin: 'u5' }),
  L(12500, 'seg', { leg: 'speaker', event: 'text', ref: 9, text: '还没', language: 'zh', timing: { startMs: 12000, endMs: 12300 } }),
  L(12600, 'stt.error', { code: 400, message: 'example', pos: 12500 }),
  L(13000, 'stt.final', { finished: true, usage: { input_text_tokens: 12, output_text_tokens: 40 } }),
  L(13100, 'event', { leg: 'speaker', kind: 'failed', payload: { message: 'closed' }, afterEnd: true }),
  L(13200, 'levels', { humanActiveDbfs: -20, ttsActiveDbfs: -18, echoActiveDbfs: -24, echoToVoiceDb: -4, clippedSamples: 0 }),
  L(13300, 'end', { framesPushed: 131, framesSent: 130, sttSockets: 1, finalMessage: true, broken: false }),
];

describe('score', () => {
  const s = score(LOG);

  it('counts the finalized source lines, not the unfinished one', () => {
    expect(s.sourceUtterances).toBe(4);
    expect(s.unfinishedSourceUtterances).toBe(1);
  });

  it('finds the echo line outside every turn, what it overlapped, and that it was spoken back', () => {
    expect(s.echoLineCount).toBe(1);
    expect(s.echoLines[0]).toMatchObject({
      leg: 'participant', ref: 3, language: 'ja', text: 'リアルタイム翻訳', fromMs: 3100, toMs: 4100,
      reason: 'outside-human-turn', overlapsTts: 'リアルタイム翻訳へようこそ。', translated: '实时翻译', spokenBack: true,
    });
    expect(s.echoTranslatedBack).toBe(1);
  });

  it("scores each turn against its reference: clean or talk-over by the echo's overlap", () => {
    const [t1, t2, t3] = s.humanWer.turns;
    expect(t1).toMatchObject({ k: 1, kind: 'clean', echoOverlapMs: 0, metric: 'cer', counts: { n: 8, s: 0, d: 0, i: 0 }, rate: 0 });
    expect(t2).toMatchObject({ k: 2, kind: 'talk-over', echoOverlapMs: 600, recognized: 'ドアを閉めて下さい', counts: { n: 10, s: 1, d: 1, i: 0 }, rate: 0.2 });
    expect(t3).toMatchObject({ k: 3, kind: 'talk-over', counts: { n: 16, s: 0, d: 0, i: 3 } });
    expect(s.humanWer.byLanguage.zh.clean).toMatchObject({ turns: 1, rate: 0 });
    expect(s.humanWer.byLanguage.zh.talkOver).toMatchObject({ turns: 1, n: 16, i: 3, rate: 0.188 });
    expect(s.humanWer.byLanguage.ja.talkOver).toMatchObject({ turns: 1, n: 10, s: 1, d: 1, rate: 0.2 });
  });

  it("keeps a person's line that holds echo as theirs, and lists it as merged", () => {
    expect(s.mergedLineCount).toBe(1);
    expect(s.mergedLines[0]).toMatchObject({ ref: 7, turn: 3, extraUnits: 3, overlapsTts: '关上门', spokenBack: false });
  });

  it("counts agent text, and each text's lead over its echo on the STT clock and over playback", () => {
    expect(s.agentText).toMatchObject({ framesSent: 3, framesDropped: 1, textFrames: 2, endFrames: 1, chars: 14, lateTexts: 1, unplayedTexts: 0 });
    // 'リアルタイム' (echo at 3000, server at 2700); '翻訳へようこそ。' (its chunk's echo at 3600, server at 3700).
    expect(s.agentText.serverLeadMs).toMatchObject({ n: 2, min: -100, max: 300 });
    expect(s.agentText.playLeadMs).toMatchObject({ n: 2, min: -490, max: -90 });
  });

  it("reads the input text tokens from the final message when it names them, and passes errors, events and levels through", () => {
    expect(s.inputTextTokens).toBe(12);
    expect(s.tokenFields).toEqual({ 'usage.input_text_tokens': 12, 'usage.output_text_tokens': 40 });
    expect(s.sonioxErrors).toEqual([{ t: 12600, kind: 'stt.error', code: 400, message: 'example', pos: 12500 }]);
    expect(s.sessionEvents).toEqual([{ t: 13100, leg: 'speaker', kind: 'failed', payload: { message: 'closed' }, afterEnd: true }]);
    expect(s.levels).toMatchObject({ echoToVoiceDb: -4 });
    expect(s.playback.clips).toBe(4);
  });

  it('warns of what makes the timing untrustworthy, and of nothing in a clean run', () => {
    expect(s.warnings).toEqual([]);
    const resumed = score(LOG.map((l) => (l.kind === 'end' ? L(l.t, 'end', { framesPushed: 131, framesSent: 128, sttSockets: 2, broken: true }) : l)));
    expect(resumed.warnings).toHaveLength(3);
    expect(resumed.warnings.join(' ')).toMatch(/opened 2 times.*frames were lost.*failed or closed/);
  });

  it('says when the final message has no token counts, or never came', () => {
    const without = score(LOG.filter((l) => l.kind !== 'stt.final').concat(L(13000, 'stt.final', { finished: true })));
    expect(without.inputTextTokens).toBeNull();
    expect(without.inputTextTokensNote).toMatch(/reports no token counts/);
    expect(score(LOG.filter((l) => l.kind !== 'stt.final')).inputTextTokensNote).toMatch(/no final message/);
  });
});
