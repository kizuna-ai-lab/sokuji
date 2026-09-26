/**
 * Soniox's `startBoth` (D23; ruling 4): split Both — two ordinary sessions,
 * a failing leg named (`LegStartError`) — and shared Both — one mixed
 * two_way socket on the speaker's key, each utterance given to the leg the
 * side tracker names (label, energy, then language), each speaking leg on
 * its own TTS socket and key, two facades that stop one core. Driven on
 * `FakeSocket` and a virtual clock from the first run — no network.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError, LegStartError, type SessionContext, type StartRequest } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { b64, END, ERROR_503, isStt, msg, orig, SHARED, tr, trackedClock, type Json } from './testing';

const SPK: SonioxCredentials = { region: 'us', stt: 'k-spk', tts: 'k-spk' };
const PAR: SonioxCredentials = { region: 'us', stt: 'k-par', tts: 'k-par-tts' };

function both(o: { sharedBoth?: boolean; participantSpeaks?: boolean; abortFirst?: boolean } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const controller = new AbortController();
  if (o.abortFirst) controller.abort(new Error('cancelled'));
  const s: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: o.sharedBoth ?? true };
  const contexts: Record<LegName, SessionContext> = {
    speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
    participant: { direction: { source: 'ja', target: 'en' }, speech: o.participantSpeaks ?? false, turns: 'auto' },
  };
  const rec = { speaker: recordEvents(), participant: recordEvents() };
  const request = (leg: LegName, credentials: SonioxCredentials): StartRequest<SonioxConfig, SonioxCredentials> =>
    ({ context: contexts[leg], config: buildSoniox(contexts[leg], s, SHARED), credentials, clock, signal: controller.signal });
  const starting = createSonioxAdapter({ openSocket: sockets.create }).startBoth(
    { speaker: request('speaker', SPK), participant: request('participant', PAR) },
    { speaker: rec.speaker.events, participant: rec.participant.events },
  );
  const sttSockets = () => sockets.all.filter(isStt);
  const ttsSockets = () => sockets.all.filter((x) => !isStt(x));
  const openAll = () => { for (const x of sockets.all) if (x.readyState === FakeSocket.CONNECTING) x.open(); };
  const kinds = (leg: LegName) => rec[leg].log.map((e) => e.kind);
  const of = <K extends AdapterEvent['kind']>(leg: LegName, kind: K) => rec[leg].log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  return { sockets, clock, timers, controller, rec, starting, sttSockets, ttsSockets, openAll, kinds, of };
}

/** A 100-ms frame's worth of one level (the mixer's frame). */
const level = (v: number) => new Int16Array(2400).fill(v);

async function live(o?: Parameters<typeof both>[0]) {
  const h = both(o);
  h.openAll();
  const sessions = await h.starting;
  return { ...h, sessions };
}

type Live = Awaited<ReturnType<typeof live>>;

/** `n` mixer frames of one leg speaking at `v`, the other quiet. */
function speak(h: Live, leg: LegName, n: number, v = 4000): void {
  for (let i = 0; i < n; i++) {
    h.sessions[leg].appendAudio(level(v));
    h.clock.advance(100);
  }
}

/** The refs that opened in a leg's log. */
const opened = (h: Live, leg: LegName) => h.of(leg, 'segmentOpened').map((e) => e.payload.ref);

/** Two utterances labelled '2', each backed by the participant's energy: the label is then the participant's (case 7). */
function establishTwoAsParticipant(h: Live): void {
  speak(h, 'participant', 10);
  h.sttSockets()[0].receive(msg({ ...orig('Un.'), language: 'ja', speaker: '2', start_ms: 0, end_ms: 900 }, END));
  speak(h, 'participant', 10);
  h.sttSockets()[0].receive(msg({ ...orig('Deux.'), language: 'ja', speaker: '2', start_ms: 1000, end_ms: 1900 }, END));
  expect(opened(h, 'participant')).toEqual([1, 2]);
  expect(opened(h, 'speaker')).toEqual([]);
}

describe('Soniox startBoth: split', () => {
  it('split: two sessions on two STT sockets, each on its own direction and key', async () => {
    const h = await live({ sharedBoth: false });
    expect(h.sttSockets()).toHaveLength(2);
    const [spk, par] = h.sttSockets().map((x) => x.sentJson<Json>()[0]);
    expect(spk).toMatchObject({ api_key: 'k-spk', translation: { type: 'one_way', target_language: 'ja' }, language_hints: ['en'] });
    expect(par).toMatchObject({ api_key: 'k-par', translation: { type: 'one_way', target_language: 'en' }, language_hints: ['ja'] });
    expect(spk).not.toHaveProperty('enable_speaker_diarization');
    expect(par).not.toHaveProperty('enable_speaker_diarization');
  });

  it('split: the legs stop apart', async () => {
    const h = await live({ sharedBoth: false });
    await h.sessions.speaker.stop();
    expect(h.sttSockets()[0].closedByClient).not.toBeNull();
    expect(h.sttSockets()[1].closedByClient).toBeNull();
  });

  it('split: a participant that cannot open stops the speaker and is named', async () => {
    const h = both({ sharedBoth: false });
    const participantStt = h.sttSockets()[1];
    for (const x of h.sockets.all) if (x !== participantStt) x.open();
    participantStt.drop();
    const error = await h.starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LegStartError);
    expect((error as LegStartError).leg).toBe('participant');
    expect((error as LegStartError).cause).toBeInstanceOf(AdapterStartError);
    expect(((error as LegStartError).cause as AdapterStartError).code).toBe('network');
    // The speaker's STT and TTS sockets.
    const speakerSockets = h.sockets.all.filter((x) => x !== participantStt);
    expect(speakerSockets).toHaveLength(2);
    for (const x of speakerSockets) expect(x.closedByClient).not.toBeNull();
  });
});

describe('Soniox startBoth: shared', () => {
  it("shared: one STT socket, two_way on the speaker's pair, both hints, diarization, the speaker's key", async () => {
    const h = await live();
    expect(h.sttSockets()).toHaveLength(1);
    expect(h.sttSockets()[0].sentJson<Json>()[0]).toMatchObject({
      api_key: 'k-spk',
      translation: { type: 'two_way', language_a: 'en', language_b: 'ja' },
      language_hints: ['en', 'ja'],
      enable_speaker_diarization: true,
    });
    // The speaker speaks, the participant does not.
    expect(h.ttsSockets()).toHaveLength(1);
  });

  it('shared: mixes both legs onto the socket every 100 ms, and keeps sending when both are quiet', async () => {
    const h = await live();
    const frames = () => h.sttSockets()[0].sent.filter((d): d is Int16Array => d instanceof Int16Array);
    h.sessions.speaker.appendAudio(level(1000));
    h.sessions.participant.appendAudio(level(3000));
    expect(frames()).toEqual([]);
    h.clock.advance(100);
    expect(frames()).toHaveLength(1);
    expect(frames()[0]).toHaveLength(2400);
    expect(frames()[0].every((v) => v === 2000)).toBe(true);
    h.clock.advance(100);
    expect(frames()).toHaveLength(2);
    expect(frames()[1]).toHaveLength(2400);
    expect(frames()[1].every((v) => v === 0)).toBe(true);
  });

  it('shared: an utterance goes to the leg the energy names — over the language', async () => {
    const h = await live();
    speak(h, 'speaker', 10);
    // Its language alone would say participant: the speaker's source is 'en'.
    h.sttSockets()[0].receive(msg({ ...orig('Hello'), language: 'ja', start_ms: 0, end_ms: 900 }));
    expect(opened(h, 'speaker')).toEqual([1]);
    expect(opened(h, 'participant')).toEqual([]);

    h.sttSockets()[0].receive(msg(END));
    speak(h, 'participant', 10);
    h.sttSockets()[0].receive(msg({ ...orig('Bonjour'), start_ms: 1000, end_ms: 1900 }));
    expect(opened(h, 'participant')).toEqual([2]);
    expect(opened(h, 'speaker')).toEqual([1]);
  });

  it('shared: a speaker label established by energy answers on its own', async () => {
    const h = await live();
    establishTwoAsParticipant(h);
    // No frame was recorded at 60 s, and its language would say speaker.
    h.sttSockets()[0].receive(msg({ ...orig('Trois.'), language: 'en', speaker: '2', start_ms: 60_000, end_ms: 60_500 }));
    expect(opened(h, 'participant')).toEqual([1, 2, 3]);
    expect(opened(h, 'speaker')).toEqual([]);
  });

  it("shared: the language decides when neither label nor energy can, and the speaker's leg when nothing can", async () => {
    const h = await live();
    const stt = h.sttSockets()[0];
    stt.receive(msg({ ...orig('Hello.'), language: 'en' }));
    expect(opened(h, 'speaker')).toEqual([1]);
    stt.receive(msg(END));
    stt.receive(msg({ ...orig('Konnichiwa.'), language: 'ja' }));
    expect(opened(h, 'participant')).toEqual([2]);
    stt.receive(msg(END));
    const { language: _language, ...unknownLanguage } = orig('Hm.');
    stt.receive(msg(unknownLanguage));
    expect(opened(h, 'speaker')).toEqual([1, 3]);
    expect(opened(h, 'participant')).toEqual([2]);
  });

  it('shared: each speaking leg has its own TTS socket and key; the participant speaks only when its switch is on (ruling 4)', async () => {
    const h = await live({ participantSpeaks: true });
    expect(h.ttsSockets()).toHaveLength(2);
    h.sttSockets()[0].receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    expect(opened(h, 'participant')).toEqual([1, 2]);
    const [speakerTts, participantTts] = h.ttsSockets();
    const sent = participantTts.sentJson<Json>();
    expect(sent).toContainEqual(expect.objectContaining({ api_key: 'k-par-tts', language: 'en', model: expect.any(String) }));
    expect(sent).toContainEqual(expect.objectContaining({ text: 'Good morning.', text_end: false }));
    expect(speakerTts.sentJson()).toEqual([]);
    // Its audio is the participant's.
    const id = sent.find((m) => m.model !== undefined)!.stream_id as string;
    participantTts.receive(JSON.stringify({ stream_id: id, audio: b64(2400) }));
    expect(h.of('participant', 'audio').map((e) => e.payload.ref)).toEqual([2]);
    expect(h.of('speaker', 'audio')).toEqual([]);

    const quiet = await live();
    expect(quiet.ttsSockets()).toHaveLength(1);
  });

  it('shared: a participant TTS socket that cannot open is no failed start', async () => {
    const h = both({ participantSpeaks: true });
    const [, participantTts] = h.ttsSockets();
    for (const x of h.sockets.all) if (x !== participantTts) x.open();
    participantTts.drop();
    const sessions = await h.starting;
    expect(Object.keys(sessions).sort()).toEqual(['participant', 'speaker']);
    await flush();
    expect(h.of('speaker', 'failed')).toEqual([]);
    expect(h.of('participant', 'failed')).toEqual([]);
    // The Logs only, on the participant's own leg (choice 6): its first translation retries.
    expect(h.of('participant', 'frame').map((e) => e.payload.type)).toContain('tts.connect_failed');
  });

  it('shared: stopping either leg stops the core, once', async () => {
    const h = await live();
    const [stt] = h.sttSockets();
    const [tts] = h.ttsSockets();
    await h.sessions.participant.stop();
    expect(stt.closedByClient).not.toBeNull();
    expect(tts.closedByClient).not.toBeNull();
    // The mixer's interval stopped with the sockets' timers.
    expect(h.timers()).toBe(0);
    const n = { speaker: h.rec.speaker.log.length, participant: h.rec.participant.log.length };
    await h.sessions.speaker.stop();
    // The stream's end went out once.
    expect(stt.sent.filter((d) => d === '')).toHaveLength(1);
    h.clock.advance(60_000);
    await flush();
    expect(h.rec.speaker.log.length).toBe(n.speaker);
    expect(h.rec.participant.log.length).toBe(n.participant);
  });

  it('shared: a socket failure fails both legs', async () => {
    const h = await live();
    h.sttSockets()[0].serverClose(1011);
    await flush();
    for (const leg of ['speaker', 'participant'] as const) {
      expect(h.of(leg, 'failed')).toHaveLength(1);
      expect(h.of(leg, 'failed')[0].payload.code).toBe('connection_lost');
    }
  });

  it('shared: a resume shows both legs reconnecting, then reconnected, and forgets the speaker labels', async () => {
    const h = await live();
    establishTwoAsParticipant(h);
    h.sttSockets()[0].receive(ERROR_503);
    h.sttSockets()[0].serverClose(1011);
    await flush();
    expect(h.kinds('speaker')).toContain('reconnecting');
    expect(h.kinds('participant')).toContain('reconnecting');
    h.openAll();
    await flush();
    expect(h.kinds('speaker')).toContain('reconnected');
    expect(h.kinds('participant')).toContain('reconnected');
    // The new socket restarts the server's clock and its labels (`SonioxClient.ts:646-647`).
    h.sttSockets()[1].receive(msg({ ...orig('Again.'), language: 'en', speaker: '2', start_ms: 0, end_ms: 500 }));
    expect(opened(h, 'speaker')).toEqual([3]);
    expect(opened(h, 'participant')).toEqual([1, 2]);
  });

  it("shared: only the speaker's endTurn finalizes, on the shared socket", async () => {
    const h = await live();
    const finalizes = () => h.sttSockets()[0].sentJson<Json>().filter((m) => m.type === 'finalize');
    h.sessions.participant.endTurn();
    expect(finalizes()).toEqual([]);
    h.sessions.speaker.endTurn();
    expect(finalizes()).toHaveLength(1);
  });

  it('shared: a socket that cannot open names the speaker', async () => {
    const h = both();
    h.sttSockets()[0].drop();
    const error = await h.starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LegStartError);
    expect((error as LegStartError).leg).toBe('speaker');
    expect(((error as LegStartError).cause as AdapterStartError).code).toBe('network');
    expect(h.ttsSockets()[0].closedByClient).not.toBeNull();
    await flush();
    expect(h.rec.speaker.log).toEqual([]);
    expect(h.rec.participant.log).toEqual([]);
  });
});

describe('Soniox startBoth: cancelled', () => {
  it.each([true, false])('a start already cancelled opens nothing (shared: %s)', async (sharedBoth) => {
    const h = both({ sharedBoth, abortFirst: true });
    await expect(h.starting).rejects.toThrow(/cancelled/);
    expect(h.sockets.all).toEqual([]);
  });

  it.each([true, false])('a start cancelled while it opens rejects with the abort, blaming no leg (shared: %s)', async (sharedBoth) => {
    const h = both({ sharedBoth });
    h.controller.abort(new Error('cancelled'));
    const error = await h.starting.then(() => null, (e: unknown) => e);
    expect(error).not.toBeInstanceOf(LegStartError);
    expect(String(error)).toMatch(/cancelled/);
    for (const x of h.sockets.all) expect(x.closedByClient).not.toBeNull();
  });
});
