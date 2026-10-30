/**
 * Soniox's `startBoth` (D23; ruling 4): split Both — two ordinary sessions,
 * a failing leg named (`LegStartError`) — and shared Both — one mixed
 * two_way socket on the speaker's key, each utterance given to the leg the
 * side tracker names (label, energy, then language), each speaking leg on
 * its own TTS socket and key, two facades that stop one core. Driven on
 * `FakeSocket` and a virtual clock from the first run — no network.
 */
import { describe, it, expect } from 'vitest';
import type { SharedSettings } from '../../lib/provider/types';
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
const CLONE = '7c1d2e3f-0000-4000-8000-00000000c10e';

/** The app's rule (`shared.ts`): the participant's direction is the pair's reverse. */
const BOTH_SHARED: SharedSettings = { ...SHARED, reversed: (direction) => direction.source === 'ja' };

function both(o: { sharedBoth?: boolean; participantSpeaks?: boolean; abortFirst?: boolean; faceToFace?: boolean; speakerSource?: string; settings?: Partial<SonioxSettings> } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const controller = new AbortController();
  if (o.abortFirst) controller.abort(new Error('cancelled'));
  const s: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: o.sharedBoth ?? true, ...o.settings };
  const contexts: Record<LegName, SessionContext> = {
    speaker: { direction: { source: o.speakerSource ?? 'en', target: 'ja' }, speech: true, turns: 'auto' },
    participant: { direction: { source: 'ja', target: o.speakerSource ?? 'en' }, speech: o.participantSpeaks ?? false, turns: 'auto' },
  };
  const rec = { speaker: recordEvents(), participant: recordEvents() };
  const shared = o.faceToFace ? { ...BOTH_SHARED, faceToFace: true } : BOTH_SHARED;
  const request = (leg: LegName, credentials: SonioxCredentials): StartRequest<SonioxConfig, SonioxCredentials> =>
    ({ context: contexts[leg], config: buildSoniox(contexts[leg], s, shared), credentials, clock, signal: controller.signal });
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

/** The TTS stream the adapter opened last on this socket. */
const lastStream = (x: FakeSocket) => x.sentJson<{ stream_id?: string; model?: string }>().filter((m) => m.model !== undefined).map((m) => m.stream_id!).pop();

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
  it("split: two sessions on two STT sockets, each on its own direction and key; the participant's labels its people", async () => {
    const h = await live({ sharedBoth: false });
    expect(h.sttSockets()).toHaveLength(2);
    expect(h.sttSockets().map((x) => x.protocols)).toEqual([['soniox-api-key', 'k-spk'], ['soniox-api-key', 'k-par']]);
    const [spk, par] = h.sttSockets().map((x) => x.sentJson<Json>()[0]);
    expect(spk).toMatchObject({ translation: { type: 'one_way', target_language: 'ja' }, language_hints: ['en', 'ja'] });
    expect(par).toMatchObject({ translation: { type: 'one_way', target_language: 'en' }, language_hints: ['ja', 'en'] });
    expect(spk).not.toHaveProperty('enable_speaker_diarization');
    expect(par).toMatchObject({ enable_speaker_diarization: true });
  });

  it('split: with speaker labels off, neither socket asks for diarization', async () => {
    const h = await live({ sharedBoth: false, settings: { speakerLabels: false } });
    for (const x of h.sttSockets()) expect(x.sentJson<Json>()[0]).not.toHaveProperty('enable_speaker_diarization');
  });

  it('split: the legs stop apart', async () => {
    const h = await live({ sharedBoth: false });
    await h.sessions.speaker.stop();
    expect(h.sttSockets()[0].closedByClient).not.toBeNull();
    expect(h.sttSockets()[1].closedByClient).toBeNull();
  });

  it("split: each leg's session.opened names its own speaking leg, on its own log", async () => {
    const h = await live({ sharedBoth: false, participantSpeaks: true });
    const speaking = (leg: LegName) => h.of(leg, 'frame').filter((e) => e.payload.type === 'session.opened').map((e) => (e.payload.payload as Json).speaking);
    expect(speaking('speaker')).toEqual([['speaker']]);
    expect(speaking('participant')).toEqual([['participant']]);
  });

  it('split: a speaking participant has its own TTS socket on its own key (ruling 4)', async () => {
    const h = await live({ sharedBoth: false, participantSpeaks: true });
    // The speaker's STT and TTS, then the participant's.
    expect(h.ttsSockets()).toHaveLength(2);
    const [, participantStt] = h.sttSockets();
    participantStt.receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    const [speakerTts, participantTts] = h.ttsSockets();
    expect([speakerTts.protocols, participantTts.protocols]).toEqual([['soniox-api-key', 'k-spk'], ['soniox-api-key', 'k-par-tts']]);
    const sent = participantTts.sentJson<Json>();
    expect(sent).toContainEqual(expect.objectContaining({ language: 'en', model: expect.any(String) }));
    expect(sent).toContainEqual(expect.objectContaining({ text: 'Good morning.', text_end: false }));
    expect(speakerTts.sentJson()).toEqual([]);
    const id = sent.find((m) => m.model !== undefined)!.stream_id as string;
    participantTts.receive(JSON.stringify({ stream_id: id, audio: b64(2400) }));
    expect(h.of('participant', 'audio')).toHaveLength(1);
    expect(h.of('speaker', 'audio')).toEqual([]);

    const quiet = await live({ sharedBoth: false });
    expect(quiet.ttsSockets()).toHaveLength(1);
  });

  it('split: each leg speaks in its own voice', async () => {
    const h = await live({ sharedBoth: false, participantSpeaks: true, settings: { voice: CLONE, participantVoice: 'Emma' } });
    const [speakerStt, participantStt] = h.sttSockets();
    speakerStt.receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    participantStt.receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    const [speakerTts, participantTts] = h.ttsSockets();
    expect(speakerTts.sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: CLONE, language: 'ja' }));
    expect(participantTts.sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: 'Emma', language: 'en' }));
    expect(participantTts.sentJson<Json>()).not.toContainEqual(expect.objectContaining({ voice: CLONE }));
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
  it("shared: the participant speaks in its own voice, never the speaker's", async () => {
    const h = await live({ participantSpeaks: true });
    h.sttSockets()[0].receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    const [, participantTts] = h.ttsSockets();
    expect(participantTts.sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: 'Grace', language: 'en' }));
  });

  it('shared: each leg speaks in its own voice', async () => {
    const h = await live({ participantSpeaks: true, settings: { voice: CLONE, participantVoice: 'Emma' } });
    // The speaker's utterance, backed by the speaker's energy; then the participant's, by theirs.
    speak(h, 'speaker', 10);
    h.sttSockets()[0].receive(msg({ ...orig('Hello.'), start_ms: 0, end_ms: 900 }, tr('こんにちは。'), END));
    speak(h, 'participant', 10);
    h.sttSockets()[0].receive(msg({ ...orig('Ohayō.'), language: 'ja', start_ms: 1000, end_ms: 1900 }, tr('Good morning.', 'en', 'ja'), END));
    const [speakerTts, participantTts] = h.ttsSockets();
    expect(speakerTts.sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: CLONE, language: 'ja' }));
    expect(participantTts.sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: 'Emma', language: 'en' }));
    expect(participantTts.sentJson<Json>()).not.toContainEqual(expect.objectContaining({ voice: CLONE }));
  });

  it("shared: one STT socket, two_way on the speaker's pair, both hints, diarization, the speaker's key", async () => {
    const h = await live();
    expect(h.sttSockets()).toHaveLength(1);
    expect(h.sttSockets()[0].protocols).toEqual(['soniox-api-key', 'k-spk']);
    expect(h.sttSockets()[0].sentJson<Json>()[0]).toMatchObject({
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

  it("shared: the speaker's leg carries no person label, the participant's keeps its people", async () => {
    const h = await live();
    const stt = h.sttSockets()[0];
    // Two labels on my leg (a misattribution, or a resume's new epoch) would number me as two people.
    stt.receive(msg({ ...orig('Hello.'), language: 'en', speaker: '1' }, tr('こんにちは。'), END));
    stt.receive(msg({ ...orig('Konnichiwa.'), language: 'ja', speaker: '2' }, tr('Hello.', 'en'), END));
    stt.receive(msg({ ...orig('Again.'), language: 'en', speaker: '3' }, tr('また。'), END));
    expect(opened(h, 'speaker').length).toBeGreaterThan(0);
    for (const e of [...h.of('speaker', 'segmentOpened'), ...h.of('speaker', 'segmentText')]) {
      expect(e.payload).not.toHaveProperty('person');
    }
    expect(h.of('participant', 'segmentOpened').map((e) => e.payload.person)).toEqual(['1.2', '1.2']);
  });

  it('shared: with speaker labels off, the socket still diarizes to tell the sides apart, and no leg carries a person label', async () => {
    const h = await live({ settings: { speakerLabels: false } });
    const stt = h.sttSockets()[0];
    expect(stt.sentJson<Json>()[0]).toMatchObject({ enable_speaker_diarization: true });
    establishTwoAsParticipant(h);
    // The label still answers on its own: no frame at 60 s, and its language would say speaker.
    stt.receive(msg({ ...orig('Trois.'), language: 'en', speaker: '2', start_ms: 60_000, end_ms: 60_500 }, END));
    expect(opened(h, 'participant')).toEqual([1, 2, 3]);
    stt.receive(msg({ ...orig('Hello.'), language: 'en', speaker: '1' }, tr('こんにちは。'), END));
    for (const leg of ['speaker', 'participant'] as const) {
      for (const e of [...h.of(leg, 'segmentOpened'), ...h.of(leg, 'segmentText')]) expect(e.payload).not.toHaveProperty('person');
    }
  });

  it('shared: each speaking leg has its own TTS socket and key; the participant speaks only when its switch is on (ruling 4)', async () => {
    const h = await live({ participantSpeaks: true });
    expect(h.ttsSockets()).toHaveLength(2);
    h.sttSockets()[0].receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    expect(opened(h, 'participant')).toEqual([1, 2]);
    const [speakerTts, participantTts] = h.ttsSockets();
    expect([speakerTts.protocols, participantTts.protocols]).toEqual([['soniox-api-key', 'k-spk'], ['soniox-api-key', 'k-par-tts']]);
    const sent = participantTts.sentJson<Json>();
    expect(sent).toContainEqual(expect.objectContaining({ language: 'en', model: expect.any(String) }));
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

  it("shared: the participant's setSpeech switches its own speech only, never the speaker's (#595)", async () => {
    const h = await live({ participantSpeaks: true });
    h.sessions.participant.setSpeech!(false);
    h.sttSockets()[0].receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    h.sttSockets()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    const [speakerTts, participantTts] = h.ttsSockets();
    expect(participantTts.sentJson<Json>().some((m) => m.text === 'Good morning.')).toBe(false);
    expect(speakerTts.sentJson<Json>().some((m) => m.text === 'こんにちは。')).toBe(true);
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

  it("shared: a stop's end of the stream is on the speaker's log, and a speaking leg's TTS stream end on its own (Stage 2 session end, ruling 2 (ii); choice 8)", async () => {
    const h = await live({ participantSpeaks: true });
    const stt = h.sttSockets()[0];
    // The speaker's utterance, spoken and ended; then the participant's, its translation still speaking (no sentence end, no <end>).
    stt.receive(msg({ ...orig('Hello.'), language: 'en' }, tr('こんにちは。'), END));
    stt.receive(msg({ ...orig('Ohayō'), language: 'ja' }, tr('Good morning', 'en', 'ja')));
    expect(opened(h, 'speaker')).toEqual([1, 2]);
    expect(opened(h, 'participant')).toEqual([3, 4]);
    const n = { speaker: h.rec.speaker.log.length, participant: h.rec.participant.log.length };
    await h.sessions.participant.stop();
    const said = (leg: LegName) => h.rec[leg].log.slice(n[leg]).map((e) => (e.kind === 'frame' ? [e.payload.type, e.payload.payload] : [e.kind]));
    expect(said('speaker')).toEqual([['stt.end', undefined]]);
    expect(said('participant')).toEqual([['tts.end', { streamId: 'utt-1-1' }]]);
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

  it("shared: the mixer sends and records nothing while the socket is down; the new socket's first frame is the side tracker's frame 0", async () => {
    const h = await live();
    const [first] = h.sttSockets();
    first.receive(ERROR_503);
    first.serverClose(1011);
    await flush();
    // Down: the resume's first attempt is still connecting. A second of the
    // speaker's voice mixes into frames that nothing sends or records.
    const resumed = h.sttSockets()[1];
    expect(resumed.readyState).toBe(FakeSocket.CONNECTING);
    speak(h, 'speaker', 10);
    h.openAll();
    await flush();
    expect(h.kinds('speaker')).toContain('reconnected');
    const frames = () => resumed.sent.filter((d): d is Int16Array => d instanceof Int16Array);
    expect(frames()).toEqual([]);
    speak(h, 'participant', 10);
    expect(frames()).toHaveLength(10);
    // No label, no language: only the energy of the new socket's frames 0–8 can tell, and it says participant.
    const { language: _language, ...bare } = orig('Bonjour.');
    resumed.receive(msg({ ...bare, start_ms: 0, end_ms: 900 }));
    expect(opened(h, 'participant')).toEqual([1]);
    expect(opened(h, 'speaker')).toEqual([]);
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

describe('Soniox startBoth: shared, languages', () => {
  it("shared: a translation into the speaker's own language is read by the participant's voice, on the speaker's row, naming that voice; the speaker's leg speaks on after it", async () => {
    const h = await live({ participantSpeaks: true });
    speak(h, 'speaker', 10);
    // The speaker's source is 'en'; they said a Japanese line, so Soniox translated it into English — the participant leg's target.
    h.sttSockets()[0].receive(msg({ ...orig('Daijōbu.'), language: 'ja' }, tr('It is fine.', 'en', 'ja'), END));
    expect(opened(h, 'speaker')).toEqual([1, 2]);
    expect(opened(h, 'participant')).toEqual([]);
    const [speakerTts, participantTts] = h.ttsSockets();
    expect(speakerTts.sentJson<Json>().some((m) => m.text === 'It is fine.')).toBe(false);
    const sent = participantTts.sentJson<Json>();
    expect(sent.find((m) => m.model !== undefined)).toMatchObject({ language: 'en' });
    expect(sent.some((m) => m.text === 'It is fine.')).toBe(true);
    // The utterance's end reaches the participant's voice too: its segment is closed with text_end.
    expect(sent.some((m) => m.text === '' && m.text_end === true)).toBe(true);
    // Its audio comes back on the speaker's row (ref 2), named with the participant's voice: karaoke and replay stay on the row,
    // and playback sends it to the participant's ear.
    participantTts.receive(JSON.stringify({ stream_id: lastStream(participantTts), audio: b64(2400) }));
    const audio = h.of('speaker', 'audio');
    expect(audio).toHaveLength(1);
    expect(audio[0].payload).toMatchObject({ ref: 2, voice: 'participant' });
    expect(h.of('participant', 'audio')).toHaveLength(0);
    participantTts.receive(JSON.stringify({ stream_id: lastStream(participantTts), terminated: true }));
    expect(h.of('speaker', 'speechRanges').map((e) => e.payload.ref)).toEqual([2]);
    expect(h.of('participant', 'speechRanges')).toHaveLength(0);
    // A normal line afterwards is spoken by the speaker's own voice.
    h.sttSockets()[0].receive(msg(orig('Good morning.'), tr('おはよう。'), END));
    expect(speakerTts.sentJson<Json>().some((m) => m.text === 'おはよう。')).toBe(true);
  });

  it("shared: a translation into the speaker's own language is not spoken when the participant's leg has no voice", async () => {
    const h = await live();
    speak(h, 'speaker', 10);
    h.sttSockets()[0].receive(msg({ ...orig('Daijōbu.'), language: 'ja' }, tr('It is fine.', 'en', 'ja'), END));
    for (const tts of h.ttsSockets()) expect(tts.sentJson<Json>().some((m) => m.text === 'It is fine.')).toBe(false);
  });

  it("shared: the token and the pair are both in app codes, so Soniox's 'tl' meets the source 'fil'", async () => {
    const h = await live({ speakerSource: 'fil' });
    h.sttSockets()[0].receive(msg({ ...orig('Kumusta.'), language: 'tl' }, END));
    expect(opened(h, 'speaker')).toEqual([1]);
    expect(opened(h, 'participant')).toEqual([]);
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

describe('Soniox startBoth: face-to-face', () => {
  it("face-to-face: the other person's code-switched line is read by the voice of its language — the speaker's — and they are still spoken to after it", async () => {
    const h = await live({ faceToFace: true, participantSpeaks: true });
    const stt = h.sttSockets()[0];
    // Label '2' speaks Japanese (the participant's source): two lines establish it as the participant.
    stt.receive(msg({ ...orig('Konnichiwa.'), language: 'ja', speaker: '2' }, END));
    stt.receive(msg({ ...orig('Arigatō.'), language: 'ja', speaker: '2' }, END));
    // They now say an English line; Soniox translates it into Japanese — their own language, and the speaker leg's target.
    stt.receive(msg({ ...orig('Thank you.'), language: 'en', speaker: '2' }, tr('Dōmo arigatō.', 'ja', 'en'), END));
    expect(opened(h, 'participant')).toEqual([1, 2, 3, 4]);
    expect(opened(h, 'speaker')).toEqual([]);
    const [speakerTts, participantTts] = h.ttsSockets();
    expect(participantTts.sentJson<Json>().some((m) => m.text === 'Dōmo arigatō.')).toBe(false);
    expect(speakerTts.sentJson<Json>().some((m) => m.text === 'Dōmo arigatō.')).toBe(true);
    expect(speakerTts.sentJson<Json>().find((m) => m.model !== undefined)).toMatchObject({ language: 'ja' });
    // Its audio comes back on the participant's row (ref 4), named with the speaker's voice.
    speakerTts.receive(JSON.stringify({ stream_id: lastStream(speakerTts), audio: b64(2400) }));
    expect(h.of('participant', 'audio').map((e) => e.payload)).toEqual([expect.objectContaining({ ref: 4, voice: 'speaker' })]);
    expect(h.of('speaker', 'audio')).toHaveLength(0);
    // A normal line afterwards is spoken to the speaker by the participant's own voice.
    stt.receive(msg({ ...orig('Mata ne.'), language: 'ja', speaker: '2' }, tr('See you.', 'en', 'ja'), END));
    expect(participantTts.sentJson<Json>().some((m) => m.text === 'See you.')).toBe(true);
  });

  it('attributes by label and language, not energy: a code-switched line stays with its speaker', async () => {
    const h = await live({ faceToFace: true });
    const stt = h.sttSockets()[0];
    // The participant's channel is silent in face-to-face; the speaker's carries both people.
    speak(h, 'speaker', 10);
    stt.receive(msg({ ...orig('Hello.'), language: 'en', speaker: '1' }, END));
    stt.receive(msg({ ...orig('Thanks.'), language: 'en', speaker: '1' }, END));
    stt.receive(msg({ ...orig('Konnichiwa.'), language: 'ja', speaker: '2' }, END));
    stt.receive(msg({ ...orig('Arigatō.'), language: 'ja', speaker: '2' }, END));
    // Speaker 1 now says a Japanese line: the label, established, keeps it on the speaker's leg.
    stt.receive(msg({ ...orig('Daijōbu.'), language: 'ja', speaker: '1' }, END));
    // One ref per utterance (no translation tokens here), numbered across the shared core.
    expect(opened(h, 'speaker')).toEqual([1, 2, 5]);
    expect(opened(h, 'participant')).toEqual([3, 4]);
  });

  it('emits no person label in face-to-face', async () => {
    const h = await live({ faceToFace: true });
    h.sttSockets()[0].receive(msg({ ...orig('Hello.'), language: 'en', speaker: '1' }, END));
    for (const e of [...h.of('speaker', 'segmentOpened'), ...h.of('speaker', 'segmentText')]) {
      expect(e.payload).not.toHaveProperty('person');
    }
  });

  it('a third language casts no vote: it follows the established label, and answers the speaker with none', async () => {
    const h = await live({ faceToFace: true });
    const stt = h.sttSockets()[0];
    const say = (text: string, language: string) => stt.receive(msg({ ...orig(text), language, speaker: '2' }, END));
    // Two German lines: with no label and no witness each lands on the speaker.
    say('Guten Tag.', 'de');
    say('Wie geht es?', 'de');
    expect(opened(h, 'speaker')).toEqual([1, 2]);
    // Two Japanese lines establish the label as the participant. Were German a speaker vote, this would tie 2-2 and not establish.
    say('Konnichiwa.', 'ja');
    say('Arigatō.', 'ja');
    expect(opened(h, 'participant')).toEqual([3, 4]);
    // A third language now follows the established label.
    say('Danke.', 'de');
    expect(opened(h, 'participant')).toEqual([3, 4, 5]);
  });
});
