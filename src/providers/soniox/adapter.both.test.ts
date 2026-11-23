/**
 * Soniox's `startBoth` (D23; ruling 4): split Both — two ordinary sessions,
 * a failing leg named (`LegStartError`) — and shared Both — one mixed
 * two_way socket on the speaker's key, each utterance given to the leg the
 * side tracker names (label, energy, then language), two facades that stop
 * one core. The legs' voices are not the adapter's: both legs with their
 * speech are in `composite.test.ts`. Driven on
 * `FakeSocket` and a virtual clock from the first run — no network.
 */
import { describe, it, expect } from 'vitest';
import type { SharedSettings } from '../../lib/run/types';
import { AdapterStartError, LegStartError, type SessionContext, type StartRequest } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { END, ERROR_503, isStt, msg, orig, SHARED, tr, trackedClock, type Json } from './testing';

const SPK: SonioxCredentials = { region: 'us', stt: 'k-spk', tts: 'k-spk' };
const PAR: SonioxCredentials = { region: 'us', stt: 'k-par', tts: 'k-par-tts' };

/** The app's rule (`shared.ts`): the participant's direction is the pair's reverse. */
const BOTH_SHARED: SharedSettings = { ...SHARED, reversed: (direction) => direction.source === 'ja' };

function both(o: { sharedBoth?: boolean; participantSpeaks?: boolean; abortFirst?: boolean; faceToFace?: boolean; speaks?: boolean; speakerSource?: string; settings?: Partial<SonioxSettings> } = {}) {
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
  const shared = { ...BOTH_SHARED, ...(o.faceToFace ? { faceToFace: true } : {}), ...(o.speaks ? { speaks: true } : {}) };
  const request = (leg: LegName, credentials: SonioxCredentials): StartRequest<SonioxConfig, SonioxCredentials> =>
    ({ context: contexts[leg], config: buildSoniox(contexts[leg], s, shared), credentials, clock, signal: controller.signal });
  const starting = createSonioxAdapter({ openSocket: sockets.create }).startBoth(
    { speaker: request('speaker', SPK), participant: request('participant', PAR) },
    { speaker: rec.speaker.events, participant: rec.participant.events },
  );
  const sttSockets = () => sockets.all.filter(isStt);
  const openAll = () => { for (const x of sockets.all) if (x.readyState === FakeSocket.CONNECTING) x.open(); };
  const kinds = (leg: LegName) => rec[leg].log.map((e) => e.kind);
  const of = <K extends AdapterEvent['kind']>(leg: LegName, kind: K) => rec[leg].log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  return { sockets, clock, timers, controller, rec, starting, sttSockets, openAll, kinds, of };
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
    // The speaker's socket.
    const speakerSockets = h.sockets.all.filter((x) => x !== participantStt);
    expect(speakerSockets).toHaveLength(1);
    for (const x of speakerSockets) expect(x.closedByClient).not.toBeNull();
  });
});

describe('Soniox startBoth: agent text (spec 2026-11-05 §4.3)', () => {
  it('split: no socket asks for agent text even when the run speaks, the participant speaking alone included (measured 2026-11-05)', async () => {
    const h = both({ sharedBoth: false, participantSpeaks: true, speaks: true });
    h.openAll(); await h.starting;
    expect(h.sttSockets()).toHaveLength(2);
    for (const s of h.sttSockets()) expect(s.sentJson<Json>()[0]).not.toHaveProperty('enable_agent_text_input');
  });
  it('shared and face-to-face: the one socket asks', async () => {
    for (const o of [{ speaks: true }, { faceToFace: true, speaks: true }]) {
      const h = both(o);
      h.openAll(); await h.starting;
      expect(h.sttSockets()).toHaveLength(1);
      expect(h.sttSockets()[0].sentJson<Json>()[0]).toMatchObject({ enable_agent_text_input: true });
    }
  });
  it('without shared.speaks no socket asks', async () => {
    const h = both({ sharedBoth: false });
    h.openAll(); await h.starting;
    for (const s of h.sttSockets()) expect(s.sentJson<Json>()[0]).not.toHaveProperty('enable_agent_text_input');
  });
  it('shared, with the setting off: the one socket does not ask, though the run speaks', async () => {
    const h = both({ speaks: true, settings: { agentText: false } });
    h.openAll(); await h.starting;
    expect(h.sttSockets()).toHaveLength(1);
    expect(h.sttSockets()[0].sentJson<Json>()[0]).not.toHaveProperty('enable_agent_text_input');
  });
});

describe('Soniox startBoth: shared', () => {
  it("shared: one STT socket, two_way on the speaker's pair, both hints, diarization, the speaker's key", async () => {
    const h = await live();
    expect(h.sttSockets()).toHaveLength(1);
    expect(h.sttSockets()[0].protocols).toEqual(['soniox-api-key', 'k-spk']);
    expect(h.sttSockets()[0].sentJson<Json>()[0]).toMatchObject({
      translation: { type: 'two_way', language_a: 'en', language_b: 'ja' },
      language_hints: ['en', 'ja'],
      enable_speaker_diarization: true,
    });
    // And no other socket: neither leg's voice is the adapter's.
    expect(h.sockets.all).toHaveLength(1);
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
    // Two labels on my leg (a misattribution, or a reconnect's new epoch) would number me as two people.
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

  it('shared: stopping either leg stops the core, once', async () => {
    const h = await live();
    const [stt] = h.sttSockets();
    await h.sessions.participant.stop();
    expect(stt.closedByClient).not.toBeNull();
    // The mixer's interval stopped with the socket's timers.
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
    // A close the table ends (spec 2026-11-05 reconnect §4.1): a 1011 would reconnect.
    h.sttSockets()[0].serverClose(1008);
    await flush();
    for (const leg of ['speaker', 'participant'] as const) {
      expect(h.of(leg, 'failed')).toHaveLength(1);
      expect(h.of(leg, 'failed')[0].payload.code).toBe('connection_lost');
    }
  });

  it('shared: a reconnect shows both legs reconnecting, then reconnected, and forgets the speaker labels', async () => {
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
    // Down: the reconnect's first attempt is still connecting. A second of the
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

  it("shared: audio that comes during the gap is dropped, not queued for the new socket, even before the mixer's next tick (§4.3)", async () => {
    const h = await live();
    const [first] = h.sttSockets();
    first.serverClose(1011);
    await flush();
    const resumed = h.sttSockets()[1];
    expect(resumed.readyState).toBe(FakeSocket.CONNECTING);
    // No tick passes: a mixer that queued this would send it on the next socket.
    h.sessions.speaker.appendAudio(level(4000));
    h.sessions.participant.appendAudio(level(4000));
    h.openAll();
    await flush();
    expect(h.kinds('speaker')).toContain('reconnected');
    h.clock.advance(100);
    const frames = resumed.sent.filter((d): d is Int16Array => d instanceof Int16Array);
    expect(frames).toHaveLength(1);
    expect(frames[0].every((v) => v === 0)).toBe(true);
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
    await flush();
    expect(h.rec.speaker.log).toEqual([]);
    expect(h.rec.participant.log).toEqual([]);
  });
});

describe('Soniox startBoth: shared, languages', () => {
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
