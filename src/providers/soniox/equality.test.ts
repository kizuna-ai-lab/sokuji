/**
 * Soniox for all three stages, run two ways from one script: the adapter with
 * its voice inside, and the composite over Soniox's text unit and its voice
 * (spec 2026-11-19 §11.1). What each side says to its legs and sends on each
 * socket is the same; `testing.equality.ts` says what is compared. A place
 * where the two differ is pinned with a comment that starts `DIFFERENCE:`.
 */
import { describe, it, expect } from 'vitest';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { RECONNECT_DELAYS_MS } from '../../lib/session/reconnect';
import { END, ERROR_503, FIN, msg, orig, tr, type Json } from './testing';
import { answer, audioByRow, framesOf, lastStream, live, PAR, pictureOf, SPK, starting, type Pair, type Picture, type Side } from './testing.equality';
import { FIN_TRANSLATION_GRACE_MS } from './utterances';

/** The two sides said and sent the same; answers the adapter's side, for a test to check the script did what it means to. */
function same(h: Pair, o?: Parameters<typeof pictureOf>[1]): Picture {
  const old = pictureOf(h.old, o);
  expect(pictureOf(h.new, o)).toEqual(old);
  // What an agent text feed reads: each row's audio by its index, range and voice, and its filled-in ranges.
  expect(audioByRow(h.new)).toEqual(audioByRow(h.old));
  return old;
}

const kinds = (picture: Picture, leg: LegName) => picture.events[leg].map((e) => (e as { kind: string }).kind);
const count = (picture: Picture, leg: LegName, kind: string) => kinds(picture, leg).filter((k) => k === kind).length;
/** The text frames sent to synthesis on a leg's TTS sockets, in order. */
const spoken = (picture: Picture, leg: LegName) => picture.tts[leg].flatMap((s) => s.sent as Json[]).filter((m) => typeof m.text === 'string' && m.text !== '').map((m) => m.text);
const ja = (text: string, is_final = true) => ({ ...orig(text, is_final), language: 'ja' });
/** A 100-ms frame's worth of one level: the shared socket's mixer sends one per tick. */
const level = (v: number) => new Int16Array(2400).fill(v);
/** `n` mixer frames of one leg speaking, the other quiet. */
function voiced(side: Side, leg: LegName, n: number): void {
  for (let i = 0; i < n; i++) {
    side.sessions[leg]!.appendAudio(level(4000));
    side.clock.advance(100);
  }
}
/** The server's 503 and the close after it on the STT socket, then the reconnect's first attempt, opened. */
async function reconnect(side: Side): Promise<void> {
  const dropped = side.stt();
  dropped.receive(ERROR_503);
  dropped.serverClose(1011);
  await flush();
  side.clock.advance(RECONNECT_DELAYS_MS[0]);
  await flush();
  side.openAll();
  await flush();
}
const stopAll = (side: Side) => Promise.all(side.legs.map((leg) => side.sessions[leg]!.stop()));

describe('Soniox on the composite path equals the adapter with its voice inside', () => {
  it.each(['speaker', 'participant'] as const)('one leg (%s): partials, finals over several messages, audio and its ranges, a second utterance, stop', async (leg) => {
    const h = await live({ mode: 'leg', leg });
    const [src, dst] = leg === 'speaker' ? ['en', 'ja'] : ['ja', 'en'];
    const o = (text: string, is_final = true) => ({ ...orig(text, is_final), language: src });
    await h.each(async (side) => {
      const stt = side.stt();
      side.sessions[leg]!.appendAudio(level(3000));
      stt.receive(msg(o('How are', false), { ...tr('お元', dst, src), is_final: false }));
      stt.receive(msg(o('How are'), tr('お元気', dst, src), { ...tr('です', dst, src), is_final: false }));
      answer(side, leg, [2400], false);
      stt.receive(msg(o(' you?'), tr('ですか？', dst, src), END));
      answer(side, leg, [1200, 600]);
      stt.receive(msg(o('Fine.'), tr('元気です。', dst, src), END));
      answer(side, leg, [4800]);
      // Kept alive for a while, then stopped.
      side.clock.advance(25_000);
      await stopAll(side);
      side.clock.advance(60_000);
    });
    const old = same(h);
    expect(count(old, leg, 'audio')).toBe(4);
    expect(count(old, leg, 'speechRanges')).toBe(2);
    expect(spoken(old, leg)).toEqual(['お元気', 'ですか？', '元気です。']);
    expect(old.timers).toBe(0);
  });

  it('split Both: each leg on its own sockets, its own rows and its own numbering', async () => {
    const h = await live({ mode: 'split' });
    await h.each(async (side) => {
      const [speaker, participant] = side.sttSockets();
      speaker.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
      participant.receive(msg(ja('はい。'), tr('Yes.', 'en', 'ja'), END));
      answer(side, 'speaker', [2400, 2400]);
      answer(side, 'participant', [1200]);
      // A translation into the other leg's language has nobody to read it: the legs are apart.
      speaker.receive(msg(ja('大丈夫。'), tr('It is fine.', 'en', 'ja'), END));
      participant.receive(msg(ja('どうも。'), tr('Thanks.', 'en', 'ja'), END));
      answer(side, 'participant', [1200]);
      await side.sessions.speaker!.stop();
      participant.receive(msg(ja('また。'), tr('Again.', 'en', 'ja'), END));
      answer(side, 'participant', [600]);
      await side.sessions.participant!.stop();
    });
    const old = same(h);
    expect(old.stt).toHaveLength(2);
    expect(spoken(old, 'speaker')).toEqual(['こんにちは。']);
    expect(spoken(old, 'participant')).toEqual(['Yes.', 'Thanks.', 'Again.']);
    expect(count(old, 'participant', 'audio')).toBe(3);
  });

  it('shared Both: one socket for both legs, each leg read by its own voice on its own key and reference', async () => {
    const h = await live({
      mode: 'shared',
      // As a lease hands them out: the participant rides the speaker's socket and holds its own speech key and reference.
      credentials: { speaker: { ...SPK, clientReferenceId: 'ref-mix' }, participant: { region: 'us', stt: SPK.stt, tts: PAR.tts, clientReferenceId: 'ref-par-tts' } },
    });
    await h.each(async (side) => {
      const stt = side.stt();
      voiced(side, 'speaker', 5);
      stt.receive(msg(orig('Hello', false), { ...tr('こん'), is_final: false }));
      stt.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
      answer(side, 'speaker', [2400, 1200]);
      voiced(side, 'participant', 5);
      stt.receive(msg({ ...ja('はい。'), speaker: '2', start_ms: 500, end_ms: 1000 }, tr('Yes.', 'en', 'ja'), END));
      answer(side, 'participant', [1200]);
      // The speaker says a Japanese line: its translation is in the participant's target, read by that voice on the speaker's row.
      voiced(side, 'speaker', 5);
      stt.receive(msg({ ...ja('大丈夫。'), speaker: '1', start_ms: 1000, end_ms: 1500 }, tr('It is fine.', 'en', 'ja'), END));
      answer(side, 'participant', [2400]);
      side.sessions.participant!.setSpeech!(false);
      stt.receive(msg(orig('Good.'), tr('いいね。'), END));
      answer(side, 'speaker', [600]);
      await side.sessions.participant!.stop();
      side.clock.advance(30_000);
    });
    const old = same(h);
    expect(old.stt).toHaveLength(1);
    expect(old.tts.speaker).toHaveLength(1);
    expect(old.tts.participant).toHaveLength(1);
    expect((old.tts.participant[0].sent[0] as Json).client_reference_id).toBe('ref-par-tts');
    expect((old.tts.speaker[0].sent[0] as Json).client_reference_id).toBe('ref-mix');
    expect(count(old, 'speaker', 'audio')).toBe(4);
    expect(count(old, 'participant', 'audio')).toBe(1);
    expect(old.events.speaker).toContainEqual({ kind: 'audio', payload: expect.objectContaining({ voice: 'participant' }) });
    // The mixed audio went out on the one socket.
    expect(old.stt[0].sent.filter((m) => typeof m === 'object' && m !== null && 'binary' in m)).toHaveLength(15);
    expect(old.timers).toBe(0);
  });

  it("face-to-face: a translation into the other side's language is read by that side's voice, and a row both voices read is numbered once", async () => {
    const h = await live({ mode: 'faceToFace' });
    await h.each(async (side) => {
      const stt = side.stt();
      // Label '2' speaks Japanese, the participant's source: two lines establish it as the participant.
      stt.receive(msg({ ...ja('こんにちは。'), speaker: '2' }, tr('Hello.', 'en', 'ja'), END));
      answer(side, 'participant', [1200]);
      stt.receive(msg({ ...ja('ありがとう。'), speaker: '2' }, tr('Thank you.', 'en', 'ja'), END));
      answer(side, 'participant', [1200]);
      // They say an English line: its translation is Japanese, the speaker leg's target, read by the speaker's voice on their row.
      stt.receive(msg({ ...orig('Thank you.'), speaker: '2' }, tr('どうもありがとう。'), END));
      answer(side, 'speaker', [2400, 2400]);
      // A row both voices read: a tail in Japanese, then the row's own English.
      stt.receive(msg({ ...ja('はい'), speaker: '2' }));
      stt.receive(msg(tr('やあ。'), tr('Yes', 'en', 'ja'), tr(' indeed.', 'en', 'ja'), END));
      answer(side, 'speaker', [1200]);
      answer(side, 'participant', [1200, 1200]);
      // The speaker, label '1', is still spoken to after it.
      stt.receive(msg({ ...orig('Fine.'), speaker: '1' }, tr('元気です。'), END));
      answer(side, 'speaker', [1200]);
      await stopAll(side);
    });
    const old = same(h);
    const abroad = old.events.participant.filter((e) => (e as { kind: string; payload: { voice?: string } }).kind === 'audio' && (e as { payload: { voice?: string } }).payload.voice === 'speaker');
    expect(abroad.length).toBeGreaterThanOrEqual(3);
    // One row read by both voices: its entries are numbered together, 0 to 2.
    const both = Object.values(audioByRow(h.old)).find((row) => new Set(row.audio.map((a) => (a as { voice: string }).voice)).size === 2)!;
    expect(both.audio.map((a) => (a as { index: number }).index)).toEqual([0, 1, 2]);
    expect(both.ranges.map((r) => (r as { index: number }).index).sort()).toEqual([0, 1, 2]);
  });

  it('speech switched off and on mid-sentence: nothing more is sent after off, and it resumes at the next sentence', async () => {
    const h = await live({ mode: 'leg' });
    await h.each(async (side) => {
      const stt = side.stt();
      const session = side.sessions.speaker!;
      stt.receive(msg(orig('One, '), tr('一つ、')));
      answer(side, 'speaker', [1200], false);
      session.setSpeech!(false);
      // The dropped segment still ends at the server; what it sends for it is not speech.
      answer(side, 'speaker', [1200]);
      stt.receive(msg(orig('two.'), tr('二つ。'), END));
      stt.receive(msg(orig('Three'), tr('三つ')));
      session.setSpeech!(true);
      // The rest of the sentence that was open when speech came back is not read.
      stt.receive(msg(orig(' and four.'), tr('と四つ。')));
      stt.receive(msg(orig(' Five.'), tr('五つ。'), END));
      answer(side, 'speaker', [2400]);
      session.setSpeech!(false);
      session.setSpeech!(false);
      stt.receive(msg(orig('Six.'), tr('六つ。'), END));
      session.setSpeech!(true);
      stt.receive(msg(orig('Seven.'), tr('七つ。'), END));
      answer(side, 'speaker', [2400]);
      await stopAll(side);
    });
    const old = same(h);
    expect(spoken(old, 'speaker')).toEqual(['一つ、', '五つ。', '七つ。']);
    expect(count(old, 'speaker', 'audio')).toBe(3);
  });

  it('an STT reconnect during speech: the voice is let go once, what was open closes as it stands, and nothing is spoken twice', async () => {
    const h = await live({ mode: 'leg' });
    await h.each(async (side) => {
      side.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
      answer(side, 'speaker', [2400], false);
      await reconnect(side);
      // The next translation opens a fresh TTS socket.
      side.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
      await flush();
      side.openAll();
      await flush();
      answer(side, 'speaker', [2400]);
      await stopAll(side);
    });
    const old = same(h);
    expect(kinds(old, 'speaker')).toContain('reconnecting');
    expect(kinds(old, 'speaker')).toContain('reconnected');
    expect(old.stt).toHaveLength(2);
    expect(old.tts.speaker).toHaveLength(2);
    expect(spoken(old, 'speaker')).toEqual(['こんにちは、', 'もう一度。']);
  });

  it('an STT reconnect in shared Both: both voices are let go, and both legs hear of the reconnect', async () => {
    const h = await live({ mode: 'shared' });
    await h.each(async (side) => {
      side.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
      answer(side, 'speaker', [2400], false);
      await reconnect(side);
      side.stt().receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
      side.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
      await flush();
      side.openAll();
      await flush();
      answer(side, 'participant', [1200]);
      answer(side, 'speaker', [2400]);
      await stopAll(side);
    });
    const old = same(h);
    expect(kinds(old, 'participant')).toContain('reconnected');
    expect(old.tts.speaker).toHaveLength(2);
    expect(old.tts.participant).toHaveLength(2);
  });

  it('a reconnect with a partial translation showing: the row closes with the partial, and only its finals were read', async () => {
    const h = await live({ mode: 'leg' });
    await h.each(async (side) => {
      side.stt().receive(msg(orig('Half of', false), tr('半'), { ...tr('分の'), is_final: false }));
      answer(side, 'speaker', [1200], false);
      await reconnect(side);
      side.stt().receive(msg(orig('Whole.'), tr('全部。'), END));
      await flush();
      side.openAll();
      await flush();
      answer(side, 'speaker', [1200]);
      await stopAll(side);
    });
    const old = same(h);
    expect(old.events.speaker).toContainEqual({ kind: 'segmentText', payload: expect.objectContaining({ text: '半分の', stableLen: 1 }) });
    expect(spoken(old, 'speaker')).toEqual(['半', '全部。']);
  });

  it('a TTS segment lost, then the TTS socket lost: one notice each, and the next translation speaks again', async () => {
    const h = await live({ mode: 'leg' });
    await h.each(async (side) => {
      const stt = side.stt();
      stt.receive(msg(orig('Hello, '), tr('こんにちは、')));
      answer(side, 'speaker', [1200], false);
      const first = side.tts();
      first.receive(JSON.stringify({ stream_id: lastStream(first), error_code: 408, error_message: 'Request timeout' }));
      first.receive(JSON.stringify({ stream_id: lastStream(first), terminated: true }));
      stt.receive(msg(orig('world.'), tr('世界。'), END));
      answer(side, 'speaker', [2400]);
      // The socket drops while a segment is speaking.
      stt.receive(msg(orig('More, '), tr('もっと、')));
      answer(side, 'speaker', [600], false);
      first.drop();
      await flush();
      stt.receive(msg(orig('and more.'), tr('さらに。'), END));
      await flush();
      side.openAll();
      await flush();
      answer(side, 'speaker', [1200]);
      await stopAll(side);
    });
    const old = same(h);
    const degraded = old.events.speaker.filter((e) => (e as { kind: string }).kind === 'degraded').map((e) => (e as { payload: { code: string } }).payload.code);
    expect(degraded).toEqual(['tts_segment_lost', 'tts_stopped']);
    expect(old.tts.speaker).toHaveLength(2);
  });

  it('<fin> with a late translation: read within the grace, ended when it runs out', async () => {
    const h = await live({ mode: 'leg', turns: 'manual' });
    await h.each(async (side) => {
      const stt = side.stt();
      const session = side.sessions.speaker!;
      session.beginTurn();
      stt.receive(msg(orig('Hi there.'), tr('や')));
      session.endTurn();
      stt.receive(msg(FIN));
      side.clock.advance(1_000);
      stt.receive(msg(tr('あ。')));
      answer(side, 'speaker', [1200, 1200]);
      side.clock.advance(FIN_TRANSLATION_GRACE_MS);
      // A translation that only arrives after <fin>, and the next turn beginning while it is still open.
      stt.receive(msg(orig('Next.'), FIN));
      stt.receive(msg(tr('次。')));
      answer(side, 'speaker', [1200]);
      stt.receive(msg(orig('Last.'), tr('最後。'), FIN));
      answer(side, 'speaker', [1200]);
      side.clock.advance(FIN_TRANSLATION_GRACE_MS);
      await stopAll(side);
    });
    const old = same(h);
    expect(spoken(old, 'speaker')).toEqual(['や', 'あ。', '次。', '最後。']);
    expect(count(old, 'speaker', 'segmentClosed')).toBe(6);
  });

  it('a translation chunk after <end> closed its segment: it is read, and its utterance ends again', async () => {
    const h = await live({ mode: 'leg' });
    await h.each(async (side) => {
      const stt = side.stt();
      stt.receive(msg(orig('Hi.'), tr('やあ'), END));
      answer(side, 'speaker', [1200]);
      stt.receive(msg(tr('。')));
      answer(side, 'speaker', [600]);
      // The same with the next original in the same message.
      stt.receive(msg(orig('Well.'), tr('さて'), END));
      answer(side, 'speaker', [1200]);
      stt.receive(msg(tr('、ね。'), orig('Next.'), tr('次。'), END));
      answer(side, 'speaker', [600]);
      answer(side, 'speaker', [1200]);
      await stopAll(side);
    });
    const old = same(h);
    expect(spoken(old, 'speaker')).toEqual(['やあ', '。', 'さて', '、ね。', '次。']);
    // The late chunk's audio is the row's next entry, past the text it closed with.
    expect(audioByRow(h.old)['speaker:2'].audio).toMatchObject([{ index: 0, voice: 'speaker', samples: 1200 }, { index: 1, voice: 'speaker', samples: 600 }]);
    expect(audioByRow(h.old)['speaker:2'].ranges).toEqual([{ index: 0, range: [0, 2] }, { index: 1, range: [2, 3] }]);
  });

  it("shared Both: a chunk after <end> in the other leg's language is read by that leg's voice, and both end the utterance", async () => {
    const h = await live({ mode: 'shared' });
    await h.each(async (side) => {
      const stt = side.stt();
      stt.receive(msg(orig('Hi.'), tr('やあ。'), END));
      answer(side, 'speaker', [1200]);
      stt.receive(msg(tr(' Bye.', 'en', 'ja')));
      answer(side, 'participant', [600]);
      stt.receive(msg(orig('Next.'), tr('次。'), END));
      answer(side, 'speaker', [1200]);
      await stopAll(side);
    });
    const old = same(h);
    expect(spoken(old, 'participant')).toEqual([' Bye.']);
    expect(audioByRow(h.old)['speaker:2'].audio.map((a) => (a as { voice: string }).voice)).toEqual(['speaker', 'participant']);
  });

  it('a start cancelled while it connects: it rejects, and every socket it asked for is closed', async () => {
    const h = starting({ mode: 'leg' });
    await h.each(async (side) => {
      side.controller.abort(new Error('cancelled'));
      await side.started;
      side.clock.advance(60_000);
    });
    const old = same(h);
    expect(old.start).toMatch(/cancelled/);
    expect(old.stt.map((s) => s.closedByClient)).toEqual([true]);
    expect(old.tts.speaker).toEqual([{ accepted: false, sent: [], closedByClient: true }]);
    expect(old.events.speaker).toEqual([]);
    expect(old.timers).toBe(0);
  });

  it('a stop while the TTS socket still connects, one leg and both: the socket is closed before it opens', async () => {
    for (const mode of ['leg', 'split', 'shared'] as const) {
      const h = starting({ mode });
      await h.each(async (side) => {
        for (const stt of side.sttSockets()) stt.open();
        await side.started;
        await flush();
        side.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
        await stopAll(side);
        side.clock.advance(60_000);
      });
      const old = same(h);
      expect(old.start).toBe('started');
      expect(old.tts.speaker).toEqual([{ accepted: false, sent: [], closedByClient: true }]);
      expect(old.timers).toBe(0);
    }
  });

  it.each(['split', 'shared'] as const)('%s Both, a start cancelled while it connects: the same rejection and nothing said', async (mode) => {
    const h = starting({ mode });
    await h.each(async (side) => {
      side.controller.abort(new Error('cancelled'));
      await side.started;
      side.clock.advance(60_000);
    });
    // DIFFERENCE: with both legs the composite opens the voices once the text sessions have started, so a start
    // cancelled before that has asked for no TTS socket; the adapter had asked for one per speaking leg, and closed
    // each before it opened. Nothing was sent on any of them. Compared without those sockets.
    const old = same(h, { unopenedVoices: false });
    expect(old.start).toMatch(/cancelled/);
    expect(old.stt.every((s) => s.closedByClient && s.sent.length === 0)).toBe(true);
    expect([h.old.ttsSockets('speaker').length, h.old.ttsSockets('participant').length]).toEqual([1, 1]);
    expect(h.old.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect([h.new.ttsSockets('speaker').length, h.new.ttsSockets('participant').length]).toEqual([0, 0]);
    expect(old.timers).toBe(0);
  });

  it('no speech key: one notice once the leg is open, no TTS socket, and the subtitles go on', async () => {
    const h = await live({ mode: 'leg', credentials: { speaker: { region: 'us', stt: 'k-spk' } } });
    await h.each(async (side) => {
      side.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
      side.sessions.speaker!.setSpeech!(false);
      side.sessions.speaker!.setSpeech!(true);
      await reconnect(side);
      side.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
      await stopAll(side);
    });
    const old = same(h);
    expect(old.events.speaker[0]).toEqual({ kind: 'degraded', payload: { code: 'tts_degraded', reason: undefined, message: expect.stringContaining('No TTS key') } });
    expect(count(old, 'speaker', 'degraded')).toBe(1);
    expect(h.old.sockets.all).toHaveLength(2);
    expect(count(old, 'speaker', 'segmentClosed')).toBe(4);
  });

  it('no speech key, a start that fails: nothing is said of the key', async () => {
    const h = starting({ mode: 'leg', credentials: { speaker: { region: 'us', stt: 'k-spk' } } });
    await h.each(async (side) => {
      side.controller.abort(new Error('cancelled'));
      await side.started;
    });
    const old = same(h);
    expect(old.events.speaker).toEqual([]);
  });

  it.each(['split', 'shared'] as const)("%s Both, the participant holds no speech key: its leg says so, and the speaker's voice goes on", async (mode) => {
    const h = await live({ mode, credentials: { participant: { region: 'us', stt: 'k-par' } } });
    await h.each(async (side) => {
      const [speaker, participant = speaker] = side.sttSockets();
      speaker.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
      answer(side, 'speaker', [1200]);
      participant.receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
      // Into the participant's target, on the speaker's row: there is no voice to read it.
      speaker.receive(msg(ja('大丈夫。'), tr('It is fine.', 'en', 'ja'), END));
      await stopAll(side);
    });
    const old = same(h);
    expect(old.events.participant[0]).toEqual({ kind: 'degraded', payload: expect.objectContaining({ code: 'tts_degraded' }) });
    expect(count(old, 'speaker', 'degraded')).toBe(0);
    expect(old.tts.participant).toEqual([]);
    expect(count(old, 'speaker', 'audio')).toBe(1);
  });

  it('a leg that does not speak: no voice, no TTS socket, no notice', async () => {
    for (const mode of ['leg', 'shared'] as const) {
      const h = await live({ mode, speaks: { speaker: false, participant: mode === 'shared' } });
      await h.each(async (side) => {
        side.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
        side.stt().receive(msg({ ...ja('はい。'), speaker: '2' }, tr('Yes.', 'en', 'ja'), END));
        if (mode === 'shared') answer(side, 'participant', [1200]);
        await stopAll(side);
      });
      const old = same(h);
      expect(old.tts.speaker).toEqual([]);
      expect(count(old, 'speaker', 'degraded')).toBe(0);
    }
  });

  it('a language switch inside one utterance, one leg: the run in the target is read, the other has nobody to read it', async () => {
    const h = await live({ mode: 'leg' });
    await h.each(async (side) => {
      const stt = side.stt();
      stt.receive(msg(orig('Hi.'), END));
      stt.receive(msg(ja('こんにちは')));
      // The last utterance's late tail lands on the new one, then the new one's own translation, in the other language.
      stt.receive(msg(tr('やあ。'), tr('Hello', 'en', 'ja'), tr(' there', 'en', 'ja')));
      answer(side, 'speaker', [1200]);
      stt.receive(msg(END));
      // A switch between two messages, and finals in one language beside a partial in another.
      stt.receive(msg(orig('x'), tr('一。'), { ...tr(' two', 'en', 'ja'), is_final: false }));
      answer(side, 'speaker', [600]);
      stt.receive(msg(tr(' two.', 'en', 'ja'), tr('三。'), END));
      answer(side, 'speaker', [600]);
      await stopAll(side);
    });
    const old = same(h);
    expect(spoken(old, 'speaker')).toEqual(['やあ。', '一。', '三。']);
  });

  it('a language switch inside one utterance, shared Both: each run is read by the voice of its language, on one row', async () => {
    const h = await live({ mode: 'shared' });
    await h.each(async (side) => {
      const stt = side.stt();
      stt.receive(msg(orig('Hi.'), END));
      stt.receive(msg({ ...ja('こんにちは'), speaker: '2' }));
      stt.receive(msg(tr('やあ。'), tr('Hello', 'en', 'ja'), tr(' there', 'en', 'ja')));
      answer(side, 'speaker', [1200]);
      answer(side, 'participant', [1200], false);
      stt.receive(msg(tr('. Bye.', 'en', 'ja'), tr('じゃあ。'), END));
      answer(side, 'participant', [1200]);
      answer(side, 'speaker', [600]);
      await stopAll(side);
    });
    const old = same(h);
    expect(spoken(old, 'speaker')).toEqual(['やあ。', 'じゃあ。']);
    expect(spoken(old, 'participant')).toEqual(['Hello there', '. Bye.']);
  });

  it('the STT connection fails for good: both legs fail the same way, their voices closed', async () => {
    const h = await live({ mode: 'shared' });
    await h.each(async (side) => {
      side.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
      answer(side, 'speaker', [1200], false);
      side.stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
      await flush();
      // Nothing more reaches a leg that failed.
      const tts = side.tts('speaker');
      expect(tts.closedByClient).not.toBeNull();
      await stopAll(side);
    });
    const old = same(h);
    expect(kinds(old, 'speaker').slice(-1)).toEqual(['failed']);
    expect(kinds(old, 'participant').slice(-1)).toEqual(['failed']);
    // DIFFERENCE: the adapter closes a leg's voice after it has said `failed`, and the voice's last line for the
    // Logs (`tts.end`, for the stream it was speaking) follows the failure. The composite closes the voice first
    // and passes nothing of it on, so nothing follows `failed`. The same text frames go out on the TTS socket.
    const after = (side: Side) => side.log.speaker.slice(side.log.speaker.findIndex((e) => e.kind === 'failed') + 1);
    expect(after(h.old)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'tts.end', payload: { streamId: 'utt-1-1' } } }]);
    expect(after(h.new)).toEqual([]);
  });

  it.each(['leg', 'shared'] as const)("%s, keys from a lease: a reconnect on a reissued key, then the grant's end closes the legs without an error", async (mode) => {
    const h = await live({ mode, leaseEndsAt: 8_000 });
    await h.each(async (side) => {
      side.stt().receive(msg(orig('Hello, '), tr('こんにちは、')));
      answer(side, 'speaker', [1200], false);
      await reconnect(side);
      side.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
      await flush();
      side.openAll();
      await flush();
      answer(side, 'speaker', [1200], false);
      // The server goes on answering while the time runs.
      for (let i = 0; i < 4; i++) {
        side.clock.advance(2_000);
        side.stt().receive(msg());
      }
      // A 403 at the grant's end is the granted time running out: the close after it ends the legs.
      side.stt().receive(JSON.stringify({ error_code: 403, error_message: 'Forbidden' }));
      side.stt().serverClose(1000);
      await flush();
      await stopAll(side);
    });
    const old = same(h);
    for (const leg of h.old.legs) expect(kinds(old, leg).slice(-1), leg).toEqual(['closed']);
    expect(old.lease).toEqual(['streamAccepted', 'streamEnded', 'reissue', 'streamAccepted', 'cutoff', 'streamEnded']);
    // The speaker's voice keeps the reference its keys came with; the reissued STT key carries its own.
    expect(old.stt.map((s) => [s.key, (s.sent[0] as Json).client_reference_id])).toEqual([['k-spk', 'ref-0'], ['k-spk-1', 'ref-1']]);
    expect(old.tts.speaker.map((s) => (s.sent[0] as Json).client_reference_id)).toEqual(['ref-0', 'ref-0']);
    expect(old.timers).toBe(0);
  });

  it('agent text: a feed over each path reads the same rows and sends the same text to the STT socket', async () => {
    for (const mode of ['leg', 'shared', 'faceToFace'] as const) {
      const h = await live({ mode, agentText: true, settings: { agentText: true } });
      await h.each(async (side) => {
        const stt = side.stt();
        stt.receive(msg(orig('Hello, '), tr('こんにちは、')));
        answer(side, 'speaker', [2400], false);
        stt.receive(msg(orig('world.'), tr('世界。'), END));
        answer(side, 'speaker', [1200], true);
        answer(side, 'speaker', [2400, 1200]);
        if (mode !== 'leg') {
          stt.receive(msg({ ...ja('大丈夫。'), speaker: '2' }, tr('It is fine.', 'en', 'ja'), END));
          answer(side, 'participant', [2400]);
        }
        // The microphone gated: text is placed and not sent.
        side.mic.open = false;
        stt.receive(msg(orig('Quiet.'), tr('静かに。'), END));
        answer(side, 'speaker', [1200]);
        side.mic.open = true;
        await reconnect(side);
        side.stt().receive(msg(orig('Again.'), tr('もう一度。'), END));
        await flush();
        side.openAll();
        await flush();
        answer(side, 'speaker', [1200]);
        await stopAll(side);
      });
      const old = same(h);
      expect(old.agentText.filter((call) => call[3]).length, mode).toBeGreaterThanOrEqual(3);
      // Each STT socket was opened for agent text, and took it.
      expect(old.stt.map((s) => (s.sent[0] as Json).enable_agent_text_input), mode).toEqual([true, true]);
      expect(old.stt[0].sent.filter((m) => (m as Json).type === 'agent_text').length, mode).toBeGreaterThanOrEqual(3);
    }
  });

  it('agent text is refused the same way where the socket was not opened for it: split Both, and the setting off', async () => {
    for (const o of [{ mode: 'split' as const, settings: { agentText: true } }, { mode: 'leg' as const, settings: { agentText: false } }]) {
      const h = await live({ ...o, agentText: true });
      await h.each(async (side) => {
        side.sttSockets()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
        answer(side, 'speaker', [2400]);
        await stopAll(side);
      });
      const old = same(h);
      expect(old.agentText.length).toBeGreaterThan(0);
      expect(old.agentText.every((call) => call[3] === false)).toBe(true);
    }
  });

  it("the Logs say who speaks on the adapter's path only", async () => {
    const h = await live({ mode: 'shared' });
    // DIFFERENCE: `session.opened`, a line for the Logs, lists the legs whose voice the adapter holds. The text unit
    // holds none: on the composite path the list is empty, whoever speaks. Nothing above the contract reads it.
    expect(framesOf(h.old, 'speaker', 'session.opened')).toEqual([expect.objectContaining({ speaking: ['speaker', 'participant'] })]);
    expect(framesOf(h.new, 'speaker', 'session.opened')).toEqual([expect.objectContaining({ speaking: [] })]);
    await h.each((side) => { void stopAll(side); });
  });
});
