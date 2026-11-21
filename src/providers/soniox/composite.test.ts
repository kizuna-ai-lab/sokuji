/**
 * Soniox for all three stages, as a session runs it: the composite over its
 * text unit and its voice (spec 2026-11-19 §7, §11.1), on fake sockets and a
 * virtual clock. Each case plays STT frames, TTS answers, clock advances and
 * calls, and states what each leg is then told, in order (`said`: one line an
 * event, see `testing.composite.ts`), and what went out to synthesis.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError, type SessionContext } from '../../lib/contract/adapter';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush, voicedPcm } from '../../lib/contract/testing/drive';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import type { LegName } from '../../lib/conversation/types';
import { startComposite, type PlanConfigs } from '../../lib/plan/composite';
import type { RunPlan } from '../../lib/plan/types';
import { RECONNECT_DELAYS_MS } from '../../lib/session/reconnect';
import { SONIOX_STALL_MS } from './adapter';
import { SONIOX_DEFAULTS, type SonioxCredentials } from './settings';
import { b64, END, ERROR_503, FIN, isStt, KEY, msg, orig, SHARED, tr, type Json } from './testing';
import {
  answer, audioByRow, framesOf, lastStream, live, logged, PAR, pictureOf, planConfigs, said, sentOn, sonioxOnSockets, SPK, spoken, starting,
  type CompositeOptions, type Mode, type Run,
} from './testing.composite';
import { FIN_TRANSLATION_GRACE_MS } from './utterances';

const kinds = (run: Run, leg: LegName) => run.log[leg].map((e) => e.kind);
const count = (run: Run, leg: LegName, kind: string) => kinds(run, leg).filter((k) => k === kind).length;
const ja = (text: string, is_final = true) => ({ ...orig(text, is_final), language: 'ja' });
/** A 100-ms frame's worth of one level: the shared socket's mixer sends one per tick. */
const level = (v: number) => new Int16Array(2400).fill(v);
/** `n` mixer frames of one leg speaking, the other quiet. */
function voiced(run: Run, leg: LegName, n: number): void {
  for (let i = 0; i < n; i++) {
    run.sessions[leg]!.appendAudio(level(4000));
    run.clock.advance(100);
  }
}
/** The server's 503 and the close after it on the STT socket, then the reconnect's first attempt, opened. */
async function reconnect(run: Run): Promise<void> {
  const dropped = run.stt();
  dropped.receive(ERROR_503);
  dropped.serverClose(1011);
  await flush();
  run.clock.advance(RECONNECT_DELAYS_MS[0]);
  await flush();
  run.openAll();
  await flush();
}
/** Every leg stopped, and what the stops left in flight settled. */
async function stopAll(run: Run): Promise<void> {
  await Promise.all(run.legs.map((leg) => run.sessions[leg]!.stop()));
  await flush();
}
/** What a leg was told after it failed or closed. */
const afterTheEnd = (run: Run, leg: LegName) => run.log[leg].slice(run.log[leg].findIndex((e) => e.kind === 'failed' || e.kind === 'closed') + 1);

describe('Soniox over its text unit and its voice: one leg', () => {
  async function oneLeg(leg: LegName): Promise<Run> {
    const run = await live({ mode: 'leg', leg });
    const [src, dst] = leg === 'speaker' ? ['en', 'ja'] : ['ja', 'en'];
    const o = (text: string, is_final = true) => ({ ...orig(text, is_final), language: src });
    const stt = run.stt();
    run.sessions[leg]!.appendAudio(level(3000));
    stt.receive(msg(o('How are', false), { ...tr('お元', dst, src), is_final: false }));
    stt.receive(msg(o('How are'), tr('お元気', dst, src), { ...tr('です', dst, src), is_final: false }));
    answer(run, leg, [2400], false);
    stt.receive(msg(o(' you?'), tr('ですか？', dst, src), END));
    answer(run, leg, [1200, 600]);
    stt.receive(msg(o('Fine.'), tr('元気です。', dst, src), END));
    answer(run, leg, [4800]);
    // Kept alive for a while, then stopped.
    run.clock.advance(25_000);
    await stopAll(run);
    run.clock.advance(60_000);
    await flush();
    return run;
  }

  it('the speaker: partials, finals over several messages, audio and its ranges, a second utterance, stop', async () => {
    const run = await oneLeg('speaker');
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <How are> en',
      'text 2 <お元> stable=0 ja',
      'text 1 <How are> en',
      'text 2 <お元気です> stable=3 ja',
      'audio 2 [0,1] 2400',
      'text 1 <How are you?> en',
      'text 2 <お元気ですか？> stable=7 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [1,1] 1200',
      'audio 2 [1,1] 600',
      'ranges 2 0:[0,4] 1:[4,6] 2:[6,7]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Fine.> en',
      'text 4 <元気です。> stable=5 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,2] 4800',
      'ranges 4 0:[0,5]',
    ]);
    expect(logged(run, 'speaker')).toEqual([
      'out session.opened',
      'in stt.delta',
      'in stt.delta',
      'in tts.audio',
      'in stt.transcript',
      'in stt.translation',
      'in stt.endpoint',
      'out tts.speak',
      'in tts.audio',
      'in tts.audio',
      'in stt.transcript',
      'in stt.translation',
      'in stt.endpoint',
      'out tts.speak',
      'in tts.audio',
      'out stt.end',
    ]);
    expect(spoken(run, 'speaker')).toEqual(['お元気', 'ですか？', '元気です。']);
    expect(count(run, 'speaker', 'audio')).toBe(4);
    expect(count(run, 'speaker', 'speechRanges')).toBe(2);
    expect(run.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(run.timers()).toBe(0);
  });

  it('the participant, run alone: the same in its own direction', async () => {
    const run = await oneLeg('participant');
    expect(said(run, 'participant')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <How are> ja',
      'text 2 <お元> stable=0 en',
      'text 1 <How are> ja',
      'text 2 <お元気です> stable=3 en',
      'audio 2 [0,1] 2400',
      'text 1 <How are you?> ja',
      'text 2 <お元気ですか？> stable=7 en',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [1,1] 1200',
      'audio 2 [1,1] 600',
      'ranges 2 0:[0,4] 1:[4,6] 2:[6,7]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Fine.> ja',
      'text 4 <元気です。> stable=5 en',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,2] 4800',
      'ranges 4 0:[0,5]',
    ]);
    expect(spoken(run, 'participant')).toEqual(['お元気', 'ですか？', '元気です。']);
    expect(said(run, 'speaker')).toEqual([]);
    expect(run.timers()).toBe(0);
  });

  it('speech switched off and on mid-sentence: nothing more is sent after off, and it resumes at the next sentence', async () => {
    const run = await live({ mode: 'leg' });
    const stt = run.stt();
    const session = run.sessions.speaker!;
    stt.receive(msg(orig('One, '), tr('一つ、')));
    answer(run, 'speaker', [1200], false);
    session.setSpeech!(false);
    // The dropped segment still ends at the server; what it sends for it is not speech.
    answer(run, 'speaker', [1200]);
    stt.receive(msg(orig('two.'), tr('二つ。'), END));
    stt.receive(msg(orig('Three'), tr('三つ')));
    session.setSpeech!(true);
    // The rest of the sentence that was open when speech came back is not read.
    stt.receive(msg(orig(' and four.'), tr('と四つ。')));
    stt.receive(msg(orig(' Five.'), tr('五つ。'), END));
    answer(run, 'speaker', [2400]);
    session.setSpeech!(false);
    session.setSpeech!(false);
    stt.receive(msg(orig('Six.'), tr('六つ。'), END));
    session.setSpeech!(true);
    stt.receive(msg(orig('Seven.'), tr('七つ。'), END));
    answer(run, 'speaker', [2400]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <One, > en',
      'text 2 <一つ、> stable=3 ja',
      'audio 2 [0,0] 1200',
      'ranges 2 0:[0,3]',
      'text 1 <One, two.> en',
      'text 2 <一つ、二つ。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Three> en',
      'text 4 <三つ> stable=2 ja',
      'text 3 <Three and four.> en',
      'text 4 <三つと四つ。> stable=6 ja',
      'text 3 <Three and four. Five.> en',
      'text 4 <三つと四つ。五つ。> stable=9 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [6,7] 2400',
      'ranges 4 0:[6,9]',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <Six.> en',
      'text 6 <六つ。> stable=3 ja',
      'close 5 u3',
      'close 6 u3',
      'open 7 source u4',
      'open 8 translation u4',
      'text 7 <Seven.> en',
      'text 8 <七つ。> stable=3 ja',
      'close 7 u4',
      'close 8 u4',
      'audio 8 [0,1] 2400',
      'ranges 8 0:[0,3]',
    ]);
    expect(spoken(run, 'speaker')).toEqual(['一つ、', '五つ。', '七つ。']);
    expect(count(run, 'speaker', 'audio')).toBe(3);
  });

  it('an STT reconnect during speech: the voice is let go once, what was open closes as it stands, and nothing is spoken twice', async () => {
    const run = await live({ mode: 'leg' });
    run.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
    answer(run, 'speaker', [2400], false);
    await reconnect(run);
    // The next translation opens a fresh TTS socket.
    run.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
    await flush();
    run.openAll();
    await flush();
    answer(run, 'speaker', [2400]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello, > en',
      'text 2 <こんにちは、> stable=6 ja',
      'audio 2 [0,1] 2400',
      'close 1 u1',
      'close 2 u1',
      'reconnecting 1',
      'reconnected',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Again.> en',
      'text 4 <もう一度。> stable=5 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,1] 2400',
      'ranges 4 0:[0,5]',
    ]);
    expect(run.sttSockets()).toHaveLength(2);
    expect(run.ttsSockets('speaker')).toHaveLength(2);
    expect(spoken(run, 'speaker')).toEqual(['こんにちは、', 'もう一度。']);
  });

  it("a stall's reconnect lets the leg's TTS socket go, half-open as it may be: the next translation goes on a new one, and nothing is degraded", async () => {
    const run = await live({ mode: 'leg' });
    const before = run.tts();
    run.stt().receive(msg(orig('Hi.'), tr('やあ。'), END));
    expect(spoken(run, 'speaker')).toEqual(['やあ。']);
    // The blip: the server says nothing more while the leg talks, and both sockets still read as open.
    for (let t = 0; t < SONIOX_STALL_MS; t += 100) {
      run.sessions.speaker!.appendAudio(voicedPcm(100));
      run.clock.advance(100);
    }
    expect(said(run, 'speaker').slice(-1)).toEqual(['reconnecting 1']);
    expect(before.readyState).toBe(FakeSocket.OPEN);
    expect(before.closedByClient).toBeNull();
    run.stt().open();
    await flush();
    expect(said(run, 'speaker').slice(-1)).toEqual(['reconnected']);
    expect(before.closedByClient).not.toBeNull();
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(run.ttsSockets('speaker')).toHaveLength(2);
    run.tts().open();
    await flush();
    expect(spoken(run, 'speaker')).toEqual(['やあ。', 'こんにちは。']);
    expect((sentOn(before) as Json[]).some((m) => m.text === 'こんにちは。')).toBe(false);
    expect(count(run, 'speaker', 'degraded')).toBe(0);
    await stopAll(run);
  });

  it('a reconnect with a partial translation showing: the row closes with the partial, and only its finals were read', async () => {
    const run = await live({ mode: 'leg' });
    run.stt().receive(msg(orig('Half of', false), tr('半'), { ...tr('分の'), is_final: false }));
    answer(run, 'speaker', [1200], false);
    await reconnect(run);
    run.stt().receive(msg(orig('Whole.'), tr('全部。'), END));
    await flush();
    run.openAll();
    await flush();
    answer(run, 'speaker', [1200]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Half of> en',
      'text 2 <半分の> stable=1 ja',
      'audio 2 [0,0] 1200',
      'close 1 u1',
      'close 2 u1',
      'reconnecting 1',
      'reconnected',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Whole.> en',
      'text 4 <全部。> stable=3 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,0] 1200',
      'ranges 4 0:[0,3]',
    ]);
    expect(spoken(run, 'speaker')).toEqual(['半', '全部。']);
  });

  it('a TTS segment lost, then the TTS socket lost: one notice each, and the next translation speaks again', async () => {
    const run = await live({ mode: 'leg' });
    const stt = run.stt();
    stt.receive(msg(orig('Hello, '), tr('こんにちは、')));
    answer(run, 'speaker', [1200], false);
    const first = run.tts();
    first.receive(JSON.stringify({ stream_id: lastStream(first), error_code: 408, error_message: 'Request timeout' }));
    first.receive(JSON.stringify({ stream_id: lastStream(first), terminated: true }));
    stt.receive(msg(orig('world.'), tr('世界。'), END));
    answer(run, 'speaker', [2400]);
    // The socket drops while a segment is speaking.
    stt.receive(msg(orig('More, '), tr('もっと、')));
    answer(run, 'speaker', [600], false);
    first.drop();
    await flush();
    stt.receive(msg(orig('and more.'), tr('さらに。'), END));
    await flush();
    run.openAll();
    await flush();
    answer(run, 'speaker', [1200]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello, > en',
      'text 2 <こんにちは、> stable=6 ja',
      'audio 2 [0,0] 1200',
      'degraded tts_segment_lost tts_408',
      'ranges 2 0:[0,6]',
      'text 1 <Hello, world.> en',
      'text 2 <こんにちは、世界。> stable=9 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [6,7] 2400',
      'ranges 2 1:[6,9]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <More, > en',
      'text 4 <もっと、> stable=4 ja',
      'audio 4 [0,0] 600',
      'degraded tts_stopped tts_socket_error',
      'ranges 4 0:[0,4]',
      'text 3 <More, and more.> en',
      'text 4 <もっと、さらに。> stable=8 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [4,4] 1200',
      'ranges 4 1:[4,8]',
    ]);
    expect(spoken(run, 'speaker')).toEqual([
      'こんにちは、',
      '世界。',
      'もっと、',
      'さらに。',
    ]);
    expect(run.ttsSockets('speaker')).toHaveLength(2);
  });

  it('<fin> with a late translation: read within the grace, ended when it runs out', async () => {
    const run = await live({ mode: 'leg', turns: 'manual' });
    const stt = run.stt();
    const session = run.sessions.speaker!;
    session.beginTurn();
    stt.receive(msg(orig('Hi there.'), tr('や')));
    session.endTurn();
    stt.receive(msg(FIN));
    run.clock.advance(1_000);
    stt.receive(msg(tr('あ。')));
    answer(run, 'speaker', [1200, 1200]);
    run.clock.advance(FIN_TRANSLATION_GRACE_MS);
    // A translation that only arrives after <fin>, and the next turn beginning while it is still open.
    stt.receive(msg(orig('Next.'), FIN));
    stt.receive(msg(tr('次。')));
    answer(run, 'speaker', [1200]);
    stt.receive(msg(orig('Last.'), tr('最後。'), FIN));
    answer(run, 'speaker', [1200]);
    run.clock.advance(FIN_TRANSLATION_GRACE_MS);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hi there.> en',
      'text 2 <や> stable=1 ja',
      'close 1 u1',
      'text 2 <やあ。> stable=3 ja',
      'audio 2 [0,0] 1200',
      'audio 2 [0,1] 1200',
      'ranges 2 0:[0,2] 1:[2,3]',
      'close 2 u1',
      'open 3 source u2',
      'text 3 <Next.> en',
      'close 3 u2',
      'open 4 translation u2',
      'text 4 <次。> stable=2 ja',
      'audio 4 [0,0] 1200',
      'ranges 4 0:[0,2]',
      'close 4 u2',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <Last.> en',
      'text 6 <最後。> stable=3 ja',
      'close 5 u3',
      'audio 6 [0,0] 1200',
      'ranges 6 0:[0,3]',
      'close 6 u3',
    ]);
    expect(spoken(run, 'speaker')).toEqual(['や', 'あ。', '次。', '最後。']);
    expect(count(run, 'speaker', 'segmentClosed')).toBe(6);
    expect((sentOn(run.stt()) as Json[]).filter((m) => m.type === 'finalize')).toHaveLength(1);
  });

  it('a translation chunk after <end> closed its segment: it is read, and its utterance ends again', async () => {
    const run = await live({ mode: 'leg' });
    const stt = run.stt();
    stt.receive(msg(orig('Hi.'), tr('やあ'), END));
    answer(run, 'speaker', [1200]);
    stt.receive(msg(tr('。')));
    answer(run, 'speaker', [600]);
    // The same with the next original in the same message.
    stt.receive(msg(orig('Well.'), tr('さて'), END));
    answer(run, 'speaker', [1200]);
    stt.receive(msg(tr('、ね。'), orig('Next.'), tr('次。'), END));
    answer(run, 'speaker', [600]);
    answer(run, 'speaker', [1200]);
    await stopAll(run);
    // The late chunk is read and is no text of its row: the row keeps the text it closed with.
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hi.> en',
      'text 2 <やあ> stable=2 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,0] 1200',
      'ranges 2 0:[0,2]',
      'text 2 <やあ。> stable=3 ja',
      'audio 2 [] 600',
      'ranges 2 1:[2,3]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Well.> en',
      'text 4 <さて> stable=2 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,0] 1200',
      'ranges 4 0:[0,2]',
      'text 4 <さて、ね。> stable=5 ja',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <Next.> en',
      'text 6 <次。> stable=2 ja',
      'close 5 u3',
      'close 6 u3',
      'audio 4 [2,3] 600',
      'ranges 4 1:[2,5]',
      'audio 6 [0,1] 1200',
      'ranges 6 0:[0,2]',
    ]);
    expect(spoken(run, 'speaker')).toEqual(['やあ', '。', 'さて', '、ね。', '次。']);
    // The late chunk's audio is the row's next entry, past the text it closed with.
    expect(audioByRow(run)['speaker:2'].audio).toMatchObject([{ index: 0, voice: 'speaker', samples: 1200 }, { index: 1, voice: 'speaker', samples: 600 }]);
    expect(audioByRow(run)['speaker:2'].ranges).toEqual([{ index: 0, range: [0, 2] }, { index: 1, range: [2, 3] }]);
  });

  it('a language switch inside one utterance: the run in the target is read, the other has nobody to read it', async () => {
    const run = await live({ mode: 'leg' });
    const stt = run.stt();
    stt.receive(msg(orig('Hi.'), END));
    stt.receive(msg(ja('こんにちは')));
    // The last utterance's late tail lands on the new one, then the new one's own translation, in the other language.
    stt.receive(msg(tr('やあ。'), tr('Hello', 'en', 'ja'), tr(' there', 'en', 'ja')));
    answer(run, 'speaker', [1200]);
    stt.receive(msg(END));
    // A switch between two messages, and finals in one language beside a partial in another.
    stt.receive(msg(orig('x'), tr('一。'), { ...tr(' two', 'en', 'ja'), is_final: false }));
    answer(run, 'speaker', [600]);
    stt.receive(msg(tr(' two.', 'en', 'ja'), tr('三。'), END));
    answer(run, 'speaker', [600]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'text 1 <Hi.> en',
      'close 1 u1',
      'open 2 source u2',
      'text 2 <こんにちは> ja',
      'open 3 translation u2',
      'text 3 <やあ。> stable=3 ja',
      'text 3 <やあ。Hello there> stable=14 en',
      'audio 3 [0,0] 1200',
      'ranges 3 0:[0,3]',
      'close 2 u2',
      'close 3 u2',
      'open 4 source u3',
      'open 5 translation u3',
      'text 5 <一。> stable=2 ja',
      'text 4 <x> en',
      'text 5 <一。 two> stable=2 en',
      'audio 5 [0,0] 600',
      'ranges 5 0:[0,2]',
      'text 5 <一。 two.> stable=7 en',
      'text 5 <一。 two.三。> stable=9 ja',
      'close 4 u3',
      'close 5 u3',
      'audio 5 [7,7] 600',
      'ranges 5 1:[7,9]',
    ]);
    expect(spoken(run, 'speaker')).toEqual(['やあ。', '一。', '三。']);
  });

  it('a same-language pair speaks its translations: a leg speaks into its target, whatever its source', async () => {
    const run = await live({ mode: 'leg', pair: { source: 'ja', target: 'ja' } });
    run.stt().receive(msg(ja('Ohayō.'), tr('おはよう。', 'ja', 'en'), END));
    expect(spoken(run, 'speaker')).toEqual(['おはよう。']);
    await stopAll(run);
  });

  it('a leg that does not speak: no voice, no TTS socket, no notice', async () => {
    const run = await live({ mode: 'leg', speaks: { speaker: false } });
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    run.stt().receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <はい。> ja',
      'text 4 <Yes.> stable=4 en',
      'close 3 u2',
      'close 4 u2',
    ]);
    expect(run.ttsSockets('speaker')).toEqual([]);
    expect(run.sockets.all).toHaveLength(1);
  });
});

describe('Soniox over its text unit and its voice: the start and the stop', () => {
  it('a start cancelled while it connects: it rejects, and every socket it asked for is closed', async () => {
    const run = starting({ mode: 'leg' });
    run.controller.abort(new Error('cancelled'));
    await run.started;
    run.clock.advance(60_000);
    await flush();
    const picture = pictureOf(run);
    expect(picture.start).toMatch(/cancelled/);
    expect(picture.stt.map((s) => s.closedByClient)).toEqual([true]);
    expect(picture.tts.speaker).toEqual([{ accepted: false, sent: [], closedByClient: true }]);
    expect(run.log.speaker).toEqual([]);
    expect(picture.timers).toBe(0);
  });

  async function cancelledBoth(mode: Mode): Promise<Run> {
    const run = starting({ mode });
    run.controller.abort(new Error('cancelled'));
    await run.started;
    run.clock.advance(60_000);
    await flush();
    return run;
  }

  // With both legs the voices are opened once the text sessions have started: a start cancelled before that has
  // asked for no TTS socket at all.
  it.each(['split', 'shared'] as const)('%s Both, a start cancelled while it connects: it rejects, nothing is said, and no voice was asked for', async (mode) => {
    const run = await cancelledBoth(mode);
    const picture = pictureOf(run);
    expect(picture.start).toMatch(/cancelled/);
    expect(picture.stt).toHaveLength(mode === 'split' ? 2 : 1);
    expect(picture.stt.every((s) => s.closedByClient && s.sent.length === 0)).toBe(true);
    expect([run.ttsSockets('speaker').length, run.ttsSockets('participant').length]).toEqual([0, 0]);
    expect(run.log).toEqual({ speaker: [], participant: [] });
    expect(picture.timers).toBe(0);
  });

  async function stoppedWhileTheVoiceConnects(mode: Mode): Promise<Run> {
    const run = starting({ mode });
    for (const stt of run.sttSockets()) stt.open();
    await run.started;
    await flush();
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    await stopAll(run);
    run.clock.advance(60_000);
    await flush();
    return run;
  }

  const TEXT_ONLY = ['open 1 source u1', 'open 2 translation u1', 'text 1 <Hello.> en', 'text 2 <こんにちは。> stable=6 ja', 'close 1 u1', 'close 2 u1'];

  it.each(['leg', 'split', 'shared'] as const)('%s, a stop while the TTS socket still connects: the socket is closed before it opens', async (mode) => {
    const run = await stoppedWhileTheVoiceConnects(mode);
    const picture = pictureOf(run);
    expect(picture.start).toBe('started');
    expect(picture.tts.speaker).toEqual([{ accepted: false, sent: [], closedByClient: true }]);
    if (mode !== 'leg') expect(picture.tts.participant).toEqual([{ accepted: false, sent: [], closedByClient: true }]);
    expect(run.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    // The text went on meanwhile, and nothing was heard of the voice.
    expect(said(run, mode === 'split' ? 'participant' : 'speaker')).toEqual(TEXT_ONLY);
    for (const leg of run.legs) expect(logged(run, leg).filter((f) => f.startsWith('in tts.')), leg).toEqual([]);
    expect(picture.timers).toBe(0);
  });

  it('a refused STT socket fails the start with network, closes the TTS socket, and says nothing', async () => {
    const run = starting({ mode: 'leg' });
    run.stt().drop();
    await run.started;
    expect(run.failure).toBeInstanceOf(AdapterStartError);
    expect((run.failure as AdapterStartError).code).toBe('network');
    expect(run.tts().closedByClient).not.toBeNull();
    await flush();
    expect(run.log.speaker).toEqual([]);
    expect(run.timers()).toBe(0);
  });

  it('text flows while the TTS socket still opens; its speech waits for the socket, then goes in order', async () => {
    const run = starting({ mode: 'leg' });
    run.stt().open();
    await run.started;
    await flush();
    expect(run.tts().readyState).toBe(FakeSocket.CONNECTING);
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
    ]);
    expect(run.tts().sent).toEqual([]);

    run.tts().open();
    await flush();
    const sent = run.tts().sentJson<Json>();
    expect(sent[0]).toMatchObject({ stream_id: 'utt-1-1', voice: 'Adrian', language: 'ja' });
    expect(sent.slice(1)).toEqual([
      { stream_id: 'utt-1-1', text: 'こんにちは。', text_end: false },
      { stream_id: 'utt-1-1', text: '', text_end: true },
    ]);
    answer(run, 'speaker', [2400, 1200]);
    expect(said(run, 'speaker').slice(-3)).toEqual(['audio 2 [0,1] 2400', 'audio 2 [1,1] 1200', 'ranges 2 0:[0,4] 1:[4,6]']);
    expect(framesOf(run, 'speaker', 'tts.connect_failed')).toEqual([]);
    await stopAll(run);
  });

  it("a bad key's error frame while the TTS socket still opens fails the leg after the start resolved, once, and closes that socket", async () => {
    const run = starting({ mode: 'leg' });
    run.stt().open();
    await run.started;
    await flush();
    expect(run.failure).toBeUndefined();
    expect(run.tts().readyState).toBe(FakeSocket.CONNECTING);
    run.stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    await flush();
    expect(said(run, 'speaker')).toEqual(['failed auth <[Soniox 401] Invalid API key>']);
    expect(afterTheEnd(run, 'speaker')).toEqual([]);
    expect(run.tts().closedByClient).not.toBeNull();
    expect(run.timers()).toBe(0);
  });

  it("a stop ends a TTS stream still speaking with text_end, framed after the STT stream's end", async () => {
    const run = await live({ mode: 'leg' });
    // A final translation with no sentence end and no <end> yet: its TTS stream is still open.
    run.stt().receive(msg(orig('Hello'), tr('こんにちは')));
    expect(run.tts().sentJson<Json>().filter((m) => m.text_end === true)).toEqual([]);
    const n = run.log.speaker.length;
    const stopping = run.sessions.speaker!.stop();
    // Both sockets are closed before the stop's first await.
    expect(run.stt().closedByClient).not.toBeNull();
    expect(run.tts().closedByClient).not.toBeNull();
    await stopping;
    expect(run.tts().sentJson<Json>().slice(-1)).toEqual([{ stream_id: 'utt-1-1', text: '', text_end: true }]);
    expect(run.log.speaker.slice(n)).toEqual([
      { kind: 'frame', payload: { direction: 'out', type: 'stt.end' } },
      { kind: 'frame', payload: { direction: 'out', type: 'tts.end', payload: { streamId: 'utt-1-1' } } },
    ]);
    run.clock.advance(60_000);
    await flush();
    expect(run.log.speaker).toHaveLength(n + 2);
    expect(run.timers()).toBe(0);
  });

  it("opens both sockets at the key's region, and a client reference rides in both config frames", async () => {
    const run = await live({ mode: 'leg', credentials: { speaker: { region: 'jp', stt: 'k', tts: 'k-tts', clientReferenceId: 'ref-1' } } });
    expect(run.stt().url).toBe('wss://stt-rt.jp.soniox.com/transcribe-websocket');
    expect(run.tts().url).toBe('wss://tts-rt.jp.soniox.com/tts-websocket');
    expect(run.sessions.speaker!.info.region).toBe('jp');
    expect(run.stt().sentJson<Json>()[0]).toMatchObject({ client_reference_id: 'ref-1' });
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(run.tts().sentJson<Json>()).toContainEqual(expect.objectContaining({ stream_id: 'utt-1-1', model: expect.any(String), client_reference_id: 'ref-1' }));
    await stopAll(run);
  });

  it('no frame for the Logs carries a key, of either socket', async () => {
    const run = await live({ mode: 'leg' });
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    answer(run, 'speaker', [2400, 1200]);
    await stopAll(run);
    const frames = JSON.stringify(run.log.speaker.filter((e) => e.kind === 'frame'));
    expect(frames).toContain('tts.');
    expect(frames).not.toContain(SPK.stt);
    expect(frames).not.toContain(SPK.tts);
  });

  it("the Logs' opening line says the region and the translation, and nothing of who speaks: the text unit holds no voice", async () => {
    const run = await live({ mode: 'shared' });
    expect(framesOf(run, 'speaker', 'session.opened')).toEqual([{ region: 'us', translation: { type: 'two_way', language_a: 'en', language_b: 'ja' } }]);
    expect(framesOf(run, 'participant', 'session.opened')).toEqual([]);
    await stopAll(run);
  });
});

describe('Soniox over its text unit and its voice: a missing speech key', () => {
  const NO_SPEECH_KEY: SonioxCredentials = { region: 'us', stt: 'k-spk' };

  it('no speech key: one notice once the leg is open, no TTS socket, and the subtitles go on', async () => {
    const run = await live({ mode: 'leg', credentials: { speaker: NO_SPEECH_KEY } });
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    run.sessions.speaker!.setSpeech!(false);
    run.sessions.speaker!.setSpeech!(true);
    await reconnect(run);
    run.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'degraded tts_degraded',
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
      'reconnecting 1',
      'reconnected',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Again.> en',
      'text 4 <もう一度。> stable=5 ja',
      'close 3 u2',
      'close 4 u2',
    ]);
    expect(run.log.speaker.find((e) => e.kind === 'degraded')).toEqual({ kind: 'degraded', payload: { code: 'tts_degraded', message: expect.stringContaining('No TTS key') } });
    expect(count(run, 'speaker', 'degraded')).toBe(1);
    // The two STT sockets, the reconnect's included, and none for speech.
    expect(run.sockets.all).toHaveLength(2);
    expect(run.sockets.all.every(isStt)).toBe(true);
  });

  it('no speech key, a start that fails: nothing is said of the key', async () => {
    const run = starting({ mode: 'leg', credentials: { speaker: NO_SPEECH_KEY } });
    run.controller.abort(new Error('cancelled'));
    await run.started;
    await flush();
    expect(String(run.failure)).toMatch(/cancelled/);
    expect(run.log.speaker).toEqual([]);
  });

  async function participantWithoutKey(mode: Mode): Promise<Run> {
    const run = await live({ mode, credentials: { participant: { region: 'us', stt: 'k-par' } } });
    const [speaker, participant = speaker] = run.sttSockets();
    speaker.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    answer(run, 'speaker', [1200]);
    participant.receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
    // Into the participant's target, on the speaker's row: there is no voice to read it.
    speaker.receive(msg(ja('大丈夫。'), tr('It is fine.', 'en', 'ja'), END));
    await stopAll(run);
    return run;
  }

  it("split Both, the participant holds no speech key: its leg says so, and the speaker's voice goes on", async () => {
    const run = await participantWithoutKey('split');
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,0] 1200',
      'ranges 2 0:[0,6]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <大丈夫。> ja',
      'text 4 <It is fine.> stable=11 en',
      'close 3 u2',
      'close 4 u2',
    ]);
    expect(said(run, 'participant')).toEqual([
      'degraded tts_degraded',
      'open 1 source u1 person=1.2',
      'open 2 translation u1 person=1.2',
      'text 1 <はい。> ja person=1.2',
      'text 2 <Yes.> stable=4 en person=1.2',
      'close 1 u1',
      'close 2 u1',
    ]);
    expect(run.ttsSockets('participant')).toEqual([]);
    expect(spoken(run, 'speaker')).toEqual(['こんにちは。']);
  });

  it("shared Both, the participant holds no speech key: its leg says so, and the speaker's voice goes on", async () => {
    const run = await participantWithoutKey('shared');
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,0] 1200',
      'ranges 2 0:[0,6]',
    ]);
    expect(said(run, 'participant')).toEqual([
      'degraded tts_degraded',
      'open 3 source u2 person=1.2',
      'open 4 translation u2 person=1.2',
      'text 3 <はい。> ja person=1.2',
      'text 4 <Yes.> stable=4 en person=1.2',
      'close 3 u2',
      'close 4 u2',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <大丈夫。> ja',
      'text 6 <It is fine.> stable=11 en',
      'close 5 u3',
      'close 6 u3',
    ]);
    expect(run.ttsSockets('participant')).toEqual([]);
    expect(spoken(run, 'speaker')).toEqual(['こんにちは。']);
  });
});

describe('Soniox over its text unit and its voice: both legs', () => {
  it('split Both: each leg on its own sockets, its own rows and its own numbering', async () => {
    const run = await live({ mode: 'split' });
    const [speaker, participant] = run.sttSockets();
    speaker.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    participant.receive(msg(ja('はい。'), tr('Yes.', 'en', 'ja'), END));
    answer(run, 'speaker', [2400, 2400]);
    answer(run, 'participant', [1200]);
    // A translation into the other leg's language has nobody to read it: the legs are apart.
    speaker.receive(msg(ja('大丈夫。'), tr('It is fine.', 'en', 'ja'), END));
    participant.receive(msg(ja('どうも。'), tr('Thanks.', 'en', 'ja'), END));
    answer(run, 'participant', [1200]);
    await run.sessions.speaker!.stop();
    participant.receive(msg(ja('また。'), tr('Again.', 'en', 'ja'), END));
    answer(run, 'participant', [600]);
    await run.sessions.participant!.stop();
    await flush();
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,1] 2400',
      'audio 2 [1,2] 2400',
      'ranges 2 0:[0,3] 1:[3,6]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <大丈夫。> ja',
      'text 4 <It is fine.> stable=11 en',
      'close 3 u2',
      'close 4 u2',
    ]);
    expect(said(run, 'participant')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <はい。> ja',
      'text 2 <Yes.> stable=4 en',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,1] 1200',
      'ranges 2 0:[0,4]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <どうも。> ja',
      'text 4 <Thanks.> stable=7 en',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,1] 1200',
      'ranges 4 0:[0,7]',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <また。> ja',
      'text 6 <Again.> stable=6 en',
      'close 5 u3',
      'close 6 u3',
      'audio 6 [0,1] 600',
      'ranges 6 0:[0,6]',
    ]);
    expect(run.sttSockets()).toHaveLength(2);
    expect(spoken(run, 'speaker')).toEqual(['こんにちは。']);
    expect(spoken(run, 'participant')).toEqual(['Yes.', 'Thanks.', 'Again.']);
    expect(count(run, 'participant', 'audio')).toBe(3);
  });

  it('shared Both: one socket for both legs, each leg read by its own voice on its own key and reference', async () => {
    const run = await live({
      mode: 'shared',
      // As a lease hands them out: the participant rides the speaker's socket and holds its own speech key and reference.
      credentials: { speaker: { ...SPK, clientReferenceId: 'ref-mix' }, participant: { region: 'us', stt: SPK.stt, tts: PAR.tts, clientReferenceId: 'ref-par-tts' } },
    });
    const stt = run.stt();
    voiced(run, 'speaker', 5);
    stt.receive(msg(orig('Hello', false), { ...tr('こん'), is_final: false }));
    stt.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    answer(run, 'speaker', [2400, 1200]);
    voiced(run, 'participant', 5);
    stt.receive(msg({ ...ja('はい。'), speaker: '2', start_ms: 500, end_ms: 1000 }, tr('Yes.', 'en', 'ja'), END));
    answer(run, 'participant', [1200]);
    // The speaker says a Japanese line: its translation is in the participant's target, read by that voice on the speaker's row.
    voiced(run, 'speaker', 5);
    stt.receive(msg({ ...ja('大丈夫。'), speaker: '1', start_ms: 1000, end_ms: 1500 }, tr('It is fine.', 'en', 'ja'), END));
    answer(run, 'participant', [2400]);
    run.sessions.participant!.setSpeech!(false);
    stt.receive(msg(orig('Good.'), tr('いいね。'), END));
    answer(run, 'speaker', [600]);
    await run.sessions.participant!.stop();
    run.clock.advance(30_000);
    await flush();
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello> en',
      'text 2 <こん> stable=0 ja',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,1] 2400',
      'audio 2 [1,1] 1200',
      'ranges 2 0:[0,4] 1:[4,6]',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <大丈夫。> ja',
      'text 6 <It is fine.> stable=11 en',
      'close 5 u3',
      'close 6 u3',
      'audio 6 [0,2] 2400 voice=participant',
      'ranges 6 0:[0,11]',
      'open 7 source u4',
      'open 8 translation u4',
      'text 7 <Good.> en',
      'text 8 <いいね。> stable=4 ja',
      'close 7 u4',
      'close 8 u4',
      'audio 8 [0,0] 600',
      'ranges 8 0:[0,4]',
    ]);
    expect(said(run, 'participant')).toEqual([
      'open 3 source u2 person=1.2',
      'open 4 translation u2 person=1.2',
      'text 3 <はい。> ja person=1.2',
      'text 4 <Yes.> stable=4 en person=1.2',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,1] 1200',
      'ranges 4 0:[0,4]',
    ]);
    expect(spoken(run, 'speaker')).toEqual([
      'こんにちは。',
      'いいね。',
    ]);
    expect(spoken(run, 'participant')).toEqual([
      'Yes.',
      'It is fine.',
    ]);
    const picture = pictureOf(run);
    expect(picture.stt).toHaveLength(1);
    expect(picture.tts.speaker).toHaveLength(1);
    expect(picture.tts.participant).toHaveLength(1);
    expect((picture.tts.participant[0].sent[0] as Json).client_reference_id).toBe('ref-par-tts');
    expect((picture.tts.speaker[0].sent[0] as Json).client_reference_id).toBe('ref-mix');
    expect(count(run, 'speaker', 'audio')).toBe(4);
    expect(count(run, 'participant', 'audio')).toBe(1);
    // The mixed audio went out on the one socket.
    expect(picture.stt[0].sent.filter((m) => typeof m === 'object' && m !== null && 'binary' in m)).toHaveLength(15);
    // Either leg's stop stopped the one connection and both voices.
    expect(run.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(picture.timers).toBe(0);
  });

  it("face-to-face: a translation into the other side's language is read by that side's voice, and a row both voices read is numbered once", async () => {
    const run = await live({ mode: 'faceToFace' });
    const stt = run.stt();
    // Label '2' speaks Japanese, the participant's source: two lines establish it as the participant.
    stt.receive(msg({ ...ja('こんにちは。'), speaker: '2' }, tr('Hello.', 'en', 'ja'), END));
    answer(run, 'participant', [1200]);
    stt.receive(msg({ ...ja('ありがとう。'), speaker: '2' }, tr('Thank you.', 'en', 'ja'), END));
    answer(run, 'participant', [1200]);
    // They say an English line: its translation is Japanese, the speaker leg's target, read by the speaker's voice on their row.
    stt.receive(msg({ ...orig('Thank you.'), speaker: '2' }, tr('どうもありがとう。'), END));
    answer(run, 'speaker', [2400, 2400]);
    // A row both voices read: a tail in Japanese, then the row's own English.
    stt.receive(msg({ ...ja('はい'), speaker: '2' }));
    stt.receive(msg(tr('やあ。'), tr('Yes', 'en', 'ja'), tr(' indeed.', 'en', 'ja'), END));
    answer(run, 'speaker', [1200]);
    answer(run, 'participant', [1200, 1200]);
    // The speaker, label '1', is still spoken to after it.
    stt.receive(msg({ ...orig('Fine.'), speaker: '1' }, tr('元気です。'), END));
    answer(run, 'speaker', [1200]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 9 source u5',
      'open 10 translation u5',
      'text 9 <Fine.> en',
      'text 10 <元気です。> stable=5 ja',
      'close 9 u5',
      'close 10 u5',
      'audio 10 [0,1] 1200',
      'ranges 10 0:[0,5]',
    ]);
    expect(said(run, 'participant')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <こんにちは。> ja',
      'text 2 <Hello.> stable=6 en',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,1] 1200',
      'ranges 2 0:[0,6]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <ありがとう。> ja',
      'text 4 <Thank you.> stable=10 en',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,1] 1200',
      'ranges 4 0:[0,10]',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <Thank you.> en',
      'text 6 <どうもありがとう。> stable=9 ja',
      'close 5 u3',
      'close 6 u3',
      'audio 6 [0,1] 2400 voice=speaker',
      'audio 6 [1,1] 2400 voice=speaker',
      'ranges 6 0:[0,5] 1:[5,9]',
      'open 7 source u4',
      'text 7 <はい> ja',
      'open 8 translation u4',
      'text 8 <やあ。> stable=3 ja',
      'text 8 <やあ。Yes indeed.> stable=14 en',
      'close 7 u4',
      'close 8 u4',
      'audio 8 [0,1] 1200 voice=speaker',
      'ranges 8 0:[0,3]',
      'audio 8 [3,5] 1200',
      'audio 8 [5,6] 1200',
      'ranges 8 1:[3,9] 2:[9,14]',
    ]);
    expect(spoken(run, 'speaker')).toEqual([
      'どうもありがとう。',
      'やあ。',
      '元気です。',
    ]);
    expect(spoken(run, 'participant')).toEqual([
      'Hello.',
      'Thank you.',
      'Yes indeed.',
    ]);
    // One row read by both voices: its entries are numbered together, 0 to 2.
    const both = Object.values(audioByRow(run)).find((row) => new Set(row.audio.map((a) => a.voice)).size === 2)!;
    expect(both.audio.map((a) => a.index)).toEqual([0, 1, 2]);
    expect(both.ranges.map((r) => r.index).sort()).toEqual([0, 1, 2]);
  });

  it('an STT reconnect in shared Both: both voices are let go, and both legs hear of the reconnect', async () => {
    const run = await live({ mode: 'shared' });
    run.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
    answer(run, 'speaker', [2400], false);
    await reconnect(run);
    run.stt().receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
    run.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
    await flush();
    run.openAll();
    await flush();
    answer(run, 'participant', [1200]);
    answer(run, 'speaker', [2400]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello, > en',
      'text 2 <こんにちは、> stable=6 ja',
      'audio 2 [0,1] 2400',
      'close 1 u1',
      'close 2 u1',
      'reconnecting 1',
      'reconnected',
      'open 5 source u3',
      'open 6 translation u3',
      'text 5 <Again.> en',
      'text 6 <もう一度。> stable=5 ja',
      'close 5 u3',
      'close 6 u3',
      'audio 6 [0,1] 2400',
      'ranges 6 0:[0,5]',
    ]);
    expect(said(run, 'participant')).toEqual([
      'reconnecting 1',
      'reconnected',
      'open 3 source u2 person=2.2',
      'open 4 translation u2 person=2.2',
      'text 3 <はい。> ja person=2.2',
      'text 4 <Yes.> stable=4 en person=2.2',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,1] 1200',
      'ranges 4 0:[0,4]',
    ]);
    expect(run.ttsSockets('speaker')).toHaveLength(2);
    expect(run.ttsSockets('participant')).toHaveLength(2);
    expect(spoken(run, 'speaker')).toEqual(['こんにちは、', 'もう一度。']);
    expect(spoken(run, 'participant')).toEqual(['Yes.']);
  });

  it("split Both: an STT reconnect on one leg lets only that leg's voice go", async () => {
    const run = await live({ mode: 'split' });
    const [speakerTts] = run.ttsSockets('speaker');
    const [participantTts] = run.ttsSockets('participant');
    run.sttSockets()[0].serverClose(1006);
    await flush();
    run.stt().open();
    await flush();
    expect(said(run, 'speaker')).toEqual(['reconnecting 1', 'reconnected']);
    expect(said(run, 'participant')).toEqual([]);
    expect(speakerTts.closedByClient).not.toBeNull();
    expect(participantTts.closedByClient).toBeNull();
    run.sttSockets()[1].receive(msg(ja('はい。'), tr('Yes.', 'en', 'ja'), END));
    expect(run.ttsSockets('participant')).toHaveLength(1);
    expect(spoken(run, 'participant')).toEqual(['Yes.']);
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(run.ttsSockets('speaker')).toHaveLength(2);
    for (const leg of run.legs) expect(count(run, leg, 'degraded'), leg).toBe(0);
    await stopAll(run);
  });

  it.each(['split', 'shared'] as const)("%s Both: each leg speaks in its own voice, and a leg's switch is its own voice's only", async (mode) => {
    const CLONE = '7c1d2e3f-0000-4000-8000-00000000c10e';
    const run = await live({ mode, settings: { voice: CLONE, participantVoice: 'Emma' } });
    const [speaker, participant = speaker] = run.sttSockets();
    speaker.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    participant.receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
    expect(run.tts('speaker').sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: CLONE, language: 'ja' }));
    expect(run.tts('participant').sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: 'Emma', language: 'en' }));
    expect(run.tts('participant').sentJson<Json>()).not.toContainEqual(expect.objectContaining({ voice: CLONE }));
    answer(run, 'speaker', [1200]);
    answer(run, 'participant', [1200]);
    // The participant's speech switched off: its translations are sent to synthesis no more, the speaker's still are.
    run.sessions.participant!.setSpeech!(false);
    participant.receive(msg({ ...ja('どうも。'), speaker: '2' }, tr('Thanks.', 'en', 'ja'), END));
    speaker.receive(msg(orig('Good.'), tr('いいね。'), END));
    expect(spoken(run, 'participant')).toEqual(['Yes.']);
    expect(spoken(run, 'speaker')).toEqual(['こんにちは。', 'いいね。']);
    await stopAll(run);
  });

  it("shared Both: a participant TTS socket that cannot open is no failed start, and is said in that leg's Logs only", async () => {
    const run = starting({ mode: 'shared' });
    run.openAll();
    await run.started;
    expect(run.failure).toBeUndefined();
    // The voices are opened once both legs have started: the speaker's opens, the participant's is refused.
    run.tts('speaker').open();
    run.tts('participant').drop();
    await flush();
    expect(Object.keys(run.sessions).sort()).toEqual(['participant', 'speaker']);
    expect(said(run, 'speaker')).toEqual([]);
    expect(said(run, 'participant')).toEqual([]);
    // Its first translation retries (a TTS socket that cannot open is retried on the first text).
    expect(logged(run, 'participant')).toContain('in tts.connect_failed');
    expect(logged(run, 'speaker')).not.toContain('in tts.connect_failed');
    await stopAll(run);
  });

  it("shared Both: a stop's end of the STT stream is on the speaker's log, and a speaking leg's TTS stream end on its own", async () => {
    const run = await live({ mode: 'shared' });
    const stt = run.stt();
    // The speaker's utterance, spoken and ended; then the participant's, its translation still speaking (no sentence end, no <end>).
    stt.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    stt.receive(msg({ ...ja('おはよう'), speaker: '2' }, tr('Good morning', 'en', 'ja')));
    const n = { speaker: run.log.speaker.length, participant: run.log.participant.length };
    await run.sessions.participant!.stop();
    const since = (leg: LegName) => run.log[leg].slice(n[leg]).map((e) => (e.kind === 'frame' ? [e.payload.type, e.payload.payload] : [e.kind]));
    expect(since('speaker')).toEqual([['stt.end', undefined]]);
    expect(since('participant')).toEqual([['tts.end', { streamId: 'utt-1-1' }]]);
  });

  it("shared Both: a chunk after <end> in the other leg's language is read by that leg's voice, and both end the utterance", async () => {
    const run = await live({ mode: 'shared' });
    const stt = run.stt();
    /** The streams a voice ended itself, with `text_end`, in order. */
    const ended = (leg: LegName) => run.tts(leg).sentJson<Json>().filter((m) => m.text_end === true).map((m) => m.stream_id);
    stt.receive(msg(orig('Hi.'), tr('やあ。'), END));
    // Each voice ends the utterance it read: its own stream's `text_end` is out before the server's answer to it.
    const hi = lastStream(run.tts('speaker'));
    expect(hi).toBeDefined();
    expect(ended('speaker')).toEqual([hi]);
    answer(run, 'speaker', [1200]);
    stt.receive(msg(tr(' Bye.', 'en', 'ja')));
    const bye = lastStream(run.tts('participant'));
    expect(bye).toBeDefined();
    expect(ended('participant')).toEqual([bye]);
    answer(run, 'participant', [600]);
    stt.receive(msg(orig('Next.'), tr('次。'), END));
    const next = lastStream(run.tts('speaker'));
    expect(next).not.toBe(hi);
    expect(ended('speaker')).toEqual([hi, next]);
    answer(run, 'speaker', [1200]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hi.> en',
      'text 2 <やあ。> stable=3 ja',
      'close 1 u1',
      'close 2 u1',
      'audio 2 [0,0] 1200',
      'ranges 2 0:[0,3]',
      'text 2 <やあ。 Bye.> stable=8 en',
      'audio 2 [3,4] 600 voice=participant',
      'ranges 2 1:[3,8]',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Next.> en',
      'text 4 <次。> stable=2 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,0] 1200',
      'ranges 4 0:[0,2]',
    ]);
    expect(said(run, 'participant')).toEqual([]);
    expect(spoken(run, 'speaker')).toEqual(['やあ。', '次。']);
    expect(spoken(run, 'participant')).toEqual([' Bye.']);
    expect(audioByRow(run)['speaker:2'].audio.map((a) => a.voice)).toEqual(['speaker', 'participant']);
    // The stop ended no stream again: each was ended once, by the voice that read it.
    expect(ended('speaker')).toEqual([hi, next]);
    expect(ended('participant')).toEqual([bye]);
  });

  it('shared Both, a leg that does not speak: no voice, no TTS socket, no notice for it', async () => {
    const run = await live({ mode: 'shared', speaks: { speaker: false, participant: true } });
    run.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    run.stt().receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
    answer(run, 'participant', [1200]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello.> en',
      'text 2 <こんにちは。> stable=6 ja',
      'close 1 u1',
      'close 2 u1',
    ]);
    expect(said(run, 'participant')).toEqual([
      'open 3 source u2 person=1.2',
      'open 4 translation u2 person=1.2',
      'text 3 <はい。> ja person=1.2',
      'text 4 <Yes.> stable=4 en person=1.2',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,1] 1200',
      'ranges 4 0:[0,4]',
    ]);
    expect(run.ttsSockets('speaker')).toEqual([]);
    expect(run.ttsSockets('participant')).toHaveLength(1);
  });

  it.each(['split', 'shared'] as const)('%s Both on one key for both legs, one leg silent: the silent leg has no TTS socket, the speaking leg has one', async (mode) => {
    const run = await live({ mode, speaks: { speaker: true, participant: false }, credentials: { participant: SPK } });
    const [speaker, participant = speaker] = run.sttSockets();
    speaker.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    participant.receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
    answer(run, 'speaker', [1200]);
    expect(run.ttsSockets('participant')).toEqual([]);
    expect(run.ttsSockets('speaker')).toHaveLength(1);
    expect(run.tts('speaker').protocols).toEqual(['soniox-api-key', SPK.tts]);
    expect(spoken(run, 'speaker')).toEqual(['こんにちは。']);
    expect(spoken(run, 'participant')).toEqual([]);
    expect(pictureOf(run).tts.participant).toEqual([]);
    await stopAll(run);
  });

  it('a language switch inside one utterance, shared Both: each run is read by the voice of its language, on one row', async () => {
    const run = await live({ mode: 'shared' });
    const stt = run.stt();
    stt.receive(msg(orig('Hi.'), END));
    stt.receive(msg({ ...ja('こんにちは'), speaker: '2' }));
    stt.receive(msg(tr('やあ。'), tr('Hello', 'en', 'ja'), tr(' there', 'en', 'ja')));
    answer(run, 'speaker', [1200]);
    answer(run, 'participant', [1200], false);
    stt.receive(msg(tr('. Bye.', 'en', 'ja'), tr('じゃあ。'), END));
    answer(run, 'participant', [1200]);
    answer(run, 'speaker', [600]);
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'text 1 <Hi.> en',
      'close 1 u1',
    ]);
    expect(said(run, 'participant')).toEqual([
      'open 2 source u2 person=1.2',
      'text 2 <こんにちは> ja person=1.2',
      'open 3 translation u2 person=1.2',
      'text 3 <やあ。> stable=3 ja person=1.2',
      'text 3 <やあ。Hello there> stable=14 en person=1.2',
      'audio 3 [0,0] 1200 voice=speaker',
      'ranges 3 0:[0,3]',
      'audio 3 [3,4] 1200',
      'text 3 <やあ。Hello there. Bye.> stable=20 en person=1.2',
      'text 3 <やあ。Hello there. Bye.じゃあ。> stable=24 ja person=1.2',
      'close 2 u2',
      'close 3 u2',
      'audio 3 [4,5] 1200',
      'ranges 3 1:[3,12] 2:[12,20]',
      'audio 3 [20,20] 600 voice=speaker',
      'ranges 3 3:[20,24]',
    ]);
    expect(spoken(run, 'speaker')).toEqual(['やあ。', 'じゃあ。']);
    expect(spoken(run, 'participant')).toEqual(['Hello there', '. Bye.']);
  });

  it('the STT connection fails for good: both legs fail the same way, their voices closed, and nothing follows the failure', async () => {
    const run = await live({ mode: 'shared' });
    run.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
    answer(run, 'speaker', [1200], false);
    run.stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    await flush();
    for (const leg of run.legs) expect(run.tts(leg).closedByClient, leg).not.toBeNull();
    await stopAll(run);
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello, > en',
      'text 2 <こんにちは、> stable=6 ja',
      'audio 2 [0,0] 1200',
      'failed auth <[Soniox 401] Invalid API key>',
    ]);
    expect(said(run, 'participant')).toEqual(['failed auth <[Soniox 401] Invalid API key>']);
    // A voice is closed before its leg says `failed`, and nothing of it is passed on: not its last line for the
    // Logs either (`tts.end`, for the stream it was speaking). The stream's end still went out on its socket.
    expect(afterTheEnd(run, 'speaker')).toEqual([]);
    expect(afterTheEnd(run, 'participant')).toEqual([]);
    expect(logged(run, 'speaker')).not.toContain('out tts.end');
    expect(run.tts('speaker').sentJson<Json>().slice(-1)).toEqual([{ stream_id: 'utt-1-1', text: '', text_end: true }]);
    expect(run.timers()).toBe(0);
  });
});

describe('Soniox over its text unit and its voice: keys from a lease', () => {
  async function leased(mode: Mode): Promise<Run> {
    const run = await live({ mode, leaseEndsAt: 8_000 });
    run.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
    answer(run, 'speaker', [1200], false);
    await reconnect(run);
    run.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
    await flush();
    run.openAll();
    await flush();
    answer(run, 'speaker', [1200], false);
    // The server goes on answering while the time runs.
    for (let i = 0; i < 4; i++) {
      run.clock.advance(2_000);
      run.stt().receive(msg());
    }
    // A 403 at the grant's end is the granted time running out: the close after it ends the legs.
    run.stt().receive(JSON.stringify({ error_code: 403, error_message: 'Forbidden' }));
    run.stt().serverClose(1000);
    await flush();
    await stopAll(run);
    return run;
  }

  function leaseExpectations(run: Run): void {
    const picture = pictureOf(run);
    for (const leg of run.legs) expect(afterTheEnd(run, leg), leg).toEqual([]);
    expect(picture.lease).toEqual(['streamAccepted', 'streamEnded', 'reissue', 'streamAccepted', 'cutoff', 'streamEnded']);
    // The speaker's voice keeps the reference its keys came with; the reissued STT key carries its own.
    expect(picture.stt.map((s) => [s.key, (s.sent[0] as Json).client_reference_id])).toEqual([['k-spk', 'ref-0'], ['k-spk-1', 'ref-1']]);
    expect(picture.tts.speaker.map((s) => (s.sent[0] as Json).client_reference_id)).toEqual(['ref-0', 'ref-0']);
    // The voices were closed with their legs.
    for (const leg of run.legs) expect(picture.tts[leg].every((s) => s.closedByClient), leg).toBe(true);
    expect(picture.timers).toBe(0);
  }

  it("one leg: a reconnect on a reissued key, then the grant's end closes the leg without an error", async () => {
    const run = await leased('leg');
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello, > en',
      'text 2 <こんにちは、> stable=6 ja',
      'audio 2 [0,0] 1200',
      'close 1 u1',
      'close 2 u1',
      'reconnecting 1',
      'reconnected',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Again.> en',
      'text 4 <もう一度。> stable=5 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,0] 1200',
      'ended <The granted session time ended.>',
    ]);
    leaseExpectations(run);
  });

  it("shared Both: a reconnect on a reissued key, then the grant's end closes both legs without an error", async () => {
    const run = await leased('shared');
    expect(said(run, 'speaker')).toEqual([
      'open 1 source u1',
      'open 2 translation u1',
      'text 1 <Hello, > en',
      'text 2 <こんにちは、> stable=6 ja',
      'audio 2 [0,0] 1200',
      'close 1 u1',
      'close 2 u1',
      'reconnecting 1',
      'reconnected',
      'open 3 source u2',
      'open 4 translation u2',
      'text 3 <Again.> en',
      'text 4 <もう一度。> stable=5 ja',
      'close 3 u2',
      'close 4 u2',
      'audio 4 [0,0] 1200',
      'ended <The granted session time ended.>',
    ]);
    expect(said(run, 'participant')).toEqual([
      'reconnecting 1',
      'reconnected',
      'ended <The granted session time ended.>',
    ]);
    leaseExpectations(run);
  });
});

describe('Soniox over its text unit and its voice: agent text', () => {
  async function fed(mode: Mode): Promise<Run> {
    const run = await live({ mode, agentText: true, settings: { agentText: true } });
    const stt = run.stt();
    stt.receive(msg(orig('Hello, '), tr('こんにちは、')));
    answer(run, 'speaker', [2400], false);
    stt.receive(msg(orig('world.'), tr('世界。'), END));
    answer(run, 'speaker', [1200], true);
    answer(run, 'speaker', [2400, 1200]);
    if (mode !== 'leg') {
      stt.receive(msg({ ...ja('大丈夫。'), speaker: '2' }, tr('It is fine.', 'en', 'ja'), END));
      answer(run, 'participant', [2400]);
    }
    // The microphone gated: text is placed and not sent.
    run.mic.open = false;
    stt.receive(msg(orig('Quiet.'), tr('静かに。'), END));
    answer(run, 'speaker', [1200]);
    run.mic.open = true;
    await reconnect(run);
    run.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
    await flush();
    run.openAll();
    await flush();
    answer(run, 'speaker', [1200]);
    await stopAll(run);
    return run;
  }
  /** The agent text frames that went out on each STT socket, in order. */
  const agentTextSent = (run: Run) => run.sttSockets().map((s) => (sentOn(s) as Json[]).filter((m) => m.type === 'agent_text').map((m) => [m.text, m.end_of_segment]));

  it('one leg: a feed over the events reads each row by its audio, and sends its text to the STT socket', async () => {
    const run = await fed('leg');
    expect(run.agentCalls).toEqual([
      ['speaker', 'こ', false, true],
      ['speaker', 'んにちは、', false, true],
      ['speaker', '世界。', false, true],
      ['speaker', 'も', false, true],
      ['speaker', 'う一度。', false, true],
    ]);
    expect(audioByRow(run)).toEqual({
      'speaker:2': {
        audio: [{ index: 0, range: [0, 1], samples: 2400, voice: 'speaker' }, { index: 1, range: [1, 1], samples: 1200, voice: 'speaker' }],
        ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 9] }],
      },
      'speaker:4': { audio: [{ index: 0, range: [0, 1], samples: 1200, voice: 'speaker' }], ranges: [{ index: 0, range: [0, 4] }] },
      'speaker:6': { audio: [{ index: 0, range: [0, 1], samples: 1200, voice: 'speaker' }], ranges: [{ index: 0, range: [0, 5] }] },
    });
    expect(agentTextSent(run)).toEqual([
      [['こ', false], ['んにちは、', false], ['世界。', false]],
      [['も', false], ['う一度。', false]],
    ]);
    // Each STT socket was opened for agent text, the reconnect's too.
    expect(run.sttSockets().map((s) => (sentOn(s)[0] as Json).enable_agent_text_input)).toEqual([true, true]);
  });

  it('shared Both: the same over the one socket, a row read by the other voice included', async () => {
    const run = await fed('shared');
    expect(run.agentCalls).toEqual([
      ['speaker', 'こ', false, true],
      ['speaker', 'んにちは、', false, true],
      ['speaker', '世界。', false, true],
      ['speaker', 'It', false, true],
      ['speaker', ' is fine.', false, true],
      ['speaker', 'も', false, true],
      ['speaker', 'う一度。', false, true],
    ]);
    expect(audioByRow(run)).toEqual({
      'participant:4': { audio: [{ index: 0, range: [0, 2], samples: 2400, voice: 'participant' }], ranges: [{ index: 0, range: [0, 11] }] },
      'speaker:2': {
        audio: [{ index: 0, range: [0, 1], samples: 2400, voice: 'speaker' }, { index: 1, range: [1, 1], samples: 1200, voice: 'speaker' }],
        ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 9] }],
      },
      'speaker:6': { audio: [{ index: 0, range: [0, 1], samples: 1200, voice: 'speaker' }], ranges: [{ index: 0, range: [0, 4] }] },
      'speaker:8': { audio: [{ index: 0, range: [0, 1], samples: 1200, voice: 'speaker' }], ranges: [{ index: 0, range: [0, 5] }] },
    });
    expect(agentTextSent(run)).toEqual([
      [['こ', false], ['んにちは、', false], ['世界。', false], ['It', false], [' is fine.', false]],
      [['も', false], ['う一度。', false]],
    ]);
    expect(run.sttSockets().map((s) => (sentOn(s)[0] as Json).enable_agent_text_input)).toEqual([true, true]);
  });

  it('face-to-face: the same over the one socket', async () => {
    const run = await fed('faceToFace');
    expect(run.agentCalls).toEqual([
      ['speaker', 'こ', false, true],
      ['speaker', 'んにちは、', false, true],
      ['speaker', '世界。', false, true],
      ['speaker', 'It', false, true],
      ['speaker', ' is fine.', false, true],
      ['speaker', 'も', false, true],
      ['speaker', 'う一度。', false, true],
    ]);
    expect(audioByRow(run)).toEqual({
      'participant:4': { audio: [{ index: 0, range: [0, 2], samples: 2400, voice: 'participant' }], ranges: [{ index: 0, range: [0, 11] }] },
      'speaker:2': {
        audio: [{ index: 0, range: [0, 1], samples: 2400, voice: 'speaker' }, { index: 1, range: [1, 1], samples: 1200, voice: 'speaker' }],
        ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 9] }],
      },
      'speaker:6': { audio: [{ index: 0, range: [0, 1], samples: 1200, voice: 'speaker' }], ranges: [{ index: 0, range: [0, 4] }] },
      'speaker:8': { audio: [{ index: 0, range: [0, 1], samples: 1200, voice: 'speaker' }], ranges: [{ index: 0, range: [0, 5] }] },
    });
    expect(agentTextSent(run)).toEqual([
      [['こ', false], ['んにちは、', false], ['世界。', false], ['It', false], [' is fine.', false]],
      [['も', false], ['う一度。', false]],
    ]);
    expect(run.sttSockets().map((s) => (sentOn(s)[0] as Json).enable_agent_text_input)).toEqual([true, true]);
  });

  async function refused(o: CompositeOptions): Promise<Run> {
    const run = await live({ ...o, agentText: true });
    run.sttSockets()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    answer(run, 'speaker', [2400]);
    await stopAll(run);
    return run;
  }

  it.each([
    ['split Both', { mode: 'split', settings: { agentText: true } }],
    ['the setting off', { mode: 'leg', settings: { agentText: false } }],
  ] as Array<[string, CompositeOptions]>)('agent text is refused where the socket was not opened for it: %s', async (_name, o) => {
    const run = await refused(o);
    expect(run.agentCalls.length).toBeGreaterThan(0);
    expect(run.agentCalls.every((call) => call[3] === false)).toBe(true);
    expect(run.sttSockets().every((s) => (sentOn(s)[0] as Json).enable_agent_text_input === undefined)).toBe(true);
    expect(agentTextSent(run).flat()).toEqual([]);
    expect(logged(run, 'speaker')).not.toContain('out stt.agent_text');
  });
});

describe('Soniox over its text unit and its voice: conformance', () => {
  let sockets = fakeSockets();
  let plan: RunPlan;
  /** The audio of the scenario running, by its row and its length. */
  let heard: Array<[number | undefined, number]> = [];
  const stt = () => sockets.all.filter(isStt).slice(-1)[0];
  const tts = () => sockets.all.filter((s) => !isStt(s)).slice(-1)[0] as FakeSocket | undefined;
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  const harness: AdapterHarness<PlanConfigs, SonioxCredentials> = {
    adapter: {
      start: (request, events) => startComposite(plan, { ...request, credentials: () => request.credentials }, {
        ...events,
        audio: (e) => { heard.push([e.ref, e.pcm.length]); events.audio(e); },
      }),
    },
    config: (context: SessionContext) => {
      sockets = fakeSockets();
      heard = [];
      plan = sonioxOnSockets(sockets).plan;
      return planConfigs(plan, context, SONIOX_DEFAULTS, SHARED);
    },
    credentials: KEY,
    opening: () => [{ run: openAll }, { flush: true }],
    exchange: [
      { run: () => stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END)) },
      // Its speech, when the leg speaks: two chunks, then the segment's clean end.
      { run: () => {
        const t = tts();
        const id = t && lastStream(t);
        if (!t || !id) return;
        t.receive(JSON.stringify({ stream_id: id, audio: b64(2400) }));
        t.receive(JSON.stringify({ stream_id: id, audio: b64(1200) }));
        t.receive(JSON.stringify({ stream_id: id, terminated: true }));
      } },
    ],
    // A close the table ends (spec 2026-11-05 reconnect §4.1): a 1011 would reconnect.
    serverClose: [{ run: () => stt().serverClose(1008, 'policy violation') }, { flush: true }],
    refuse: [{ run: () => stt().drop() }],
    // The 503 drops the socket at once; the attempt's socket is the newest. The voice's socket was let go at the
    // reconnect: the next translation opens a fresh one.
    reconnect: [
      { run: () => stt().receive(ERROR_503) },
      { flush: true },
      { run: openAll },
      { flush: true },
    ],
  };

  it('runs every scenario but typed text', () => {
    expect(scenarioNames(harness)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close', 'reconnect']);
  });

  it.each(scenarioNames(harness))('%s', async (name) => {
    const report = await runScenario(harness, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('the exchange is spoken: the scenario that speaks emits audio for the translation, the one that does not opens no TTS socket', async () => {
    await runScenario(harness, 'open-stop');
    expect(heard).toEqual([[2, 2400], [2, 1200]]);
    expect(sockets.all.some((s) => !isStt(s))).toBe(true);
    await runScenario(harness, 'speech-off');
    expect(heard).toEqual([]);
    expect(sockets.all.every(isStt)).toBe(true);
  });
});
