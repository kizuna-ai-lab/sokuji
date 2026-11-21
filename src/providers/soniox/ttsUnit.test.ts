/**
 * Soniox's voice as a speech unit: what it declares, that its config is the
 * whole provider's, and its sessions over `LegSpeech`, driven on
 * `FakeSocket` and a virtual clock and held to the speech rules.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Ref } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import type { SpeechStartRequest } from '../../lib/contract/speech';
import { checkSpeech, recordSpeech, type SpeechLog } from '../../lib/contract/speechConformance';
import { flush } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import type { LegName } from '../../lib/conversation/types';
import { isSpeechUnit } from '../../lib/plan/types';
import type { SharedSettings } from '../../lib/provider/types';
import type { SonioxTtsConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxLeasePort, type SonioxSettings, type SonioxVoiceCredentials } from './settings';
import { AUTO_CTX, b64, KEY, SHARED, type Json } from './testing';
import { createSonioxTtsUnit, sonioxSpeaks, sonioxTtsUnit, sonioxTtsUnitFor, type SonioxTtsUnitConfig } from './ttsUnit';

const REVERSED: SharedSettings = { ...SHARED, reversed: () => true };
const BACK = { ...AUTO_CTX, direction: { source: 'ja', target: 'en' } };

/** A recorded session of the unit, its socket not opened yet: `opening` is its `open()`. */
function create(over: { leg?: LegName; credentials?: SonioxCredentials | SonioxVoiceCredentials; config?: SonioxTtsConfig; counts?: Map<Ref, number> } = {}) {
  const clock = createVirtualClock(0);
  const sockets = fakeSockets();
  const unit = createSonioxTtsUnit({ openSocket: sockets.create });
  const counts = over.counts ?? new Map<Ref, number>();
  const request: SpeechStartRequest<SonioxTtsConfig, SonioxVoiceCredentials> = {
    leg: over.leg ?? 'speaker',
    context: AUTO_CTX,
    config: over.config ?? { voice: 'Adrian', speed: 1 },
    credentials: over.credentials ?? KEY,
    clock,
    signal: new AbortController().signal,
    counts,
  };
  const { session, log } = recordSpeech(unit.startSpeech!, request);
  const opening = session.open();
  return { clock, sockets, session, log, opening, counts };
}

async function setup(over: Parameters<typeof create>[0] = {}) {
  const made = create(over);
  made.sockets.last().open();
  await made.opening;
  return { ...made, tts: () => made.sockets.last() };
}

const audioOf = (log: SpeechLog) => log.flatMap((e) => (e.kind === 'audio' ? [e.payload] : []));
const rangesOf = (log: SpeechLog) => log.flatMap((e) => (e.kind === 'speechRanges' ? [e.payload] : []));
const degradedOf = (log: SpeechLog) => log.flatMap((e) => (e.kind === 'degraded' ? [e.payload] : []));
const framesOf = (log: SpeechLog, type: string) => log.flatMap((e) => (e.kind === 'frame' && e.payload.type === type ? [e.payload] : []));
/** The text frames sent to synthesis, in order. */
const texts = (sent: Json[]) => sent.filter((m) => typeof m.text === 'string' && m.text !== '').map((m) => m.text);
const chunk = (streamId: string, samples: number) => JSON.stringify({ stream_id: streamId, audio: b64(samples) });
const terminated = (streamId: string) => JSON.stringify({ stream_id: streamId, terminated: true });

describe("Soniox's speech unit", () => {
  it('is a speech unit that occupies speech when asked for exactly that', () => {
    expect(sonioxTtsUnit.id).toBe('tts');
    expect(isSpeechUnit(sonioxTtsUnit)).toBe(true);
    expect(sonioxTtsUnit.start).toBeUndefined();
    expect(sonioxTtsUnit.occupies(SONIOX_DEFAULTS, new Set(['speech']))).toEqual(['speech']);
    expect(sonioxTtsUnit.occupies(SONIOX_DEFAULTS, new Set(['translation', 'speech']))).toBeNull();
    expect(sonioxTtsUnit.occupies(SONIOX_DEFAULTS, new Set(['transcription', 'translation', 'speech']))).toBeNull();
    expect(sonioxTtsUnit.occupies(SONIOX_DEFAULTS, new Set(['transcription', 'translation']))).toBeNull();
    expect(sonioxTtsUnit.occupies(SONIOX_DEFAULTS, new Set())).toBeNull();
  });

  it('says what the voice can do; whether the participant speaks is its definition\'s to say', () => {
    const can = { speech: 'optional', turns: ['auto', 'manual'], turnOwner: 'either', boundaries: 'provider', textInput: false, faceToFace: true, speaks: sonioxSpeaks };
    expect(sonioxTtsUnit.capabilities(SONIOX_DEFAULTS)).toEqual({ ...can, participantSpeech: true });
    expect(sonioxTtsUnitFor({ participantSpeech: true }).capabilities(SONIOX_DEFAULTS)).toEqual({ ...can, participantSpeech: true });
    expect(sonioxTtsUnitFor({ participantSpeech: false }).capabilities(SONIOX_DEFAULTS)).toEqual({ ...can, participantSpeech: false });
  });

  it("builds the leg's voice and speed, for the speaker's leg and the participant's", () => {
    const cases: Array<[SonioxSettings, speaker: SonioxTtsConfig, participant: SonioxTtsConfig]> = [
      [SONIOX_DEFAULTS, { voice: 'Adrian', speed: 1 }, { voice: 'Grace', speed: 1 }],
      [{ ...SONIOX_DEFAULTS, voice: 'Maya', participantVoice: 'Noah', ttsSpeed: 1.2 }, { voice: 'Maya', speed: 1.2 }, { voice: 'Noah', speed: 1.2 }],
      // The participant's choice is the speaker's own: the two never sound alike.
      [{ ...SONIOX_DEFAULTS, voice: 'Maya', participantVoice: 'Maya' }, { voice: 'Maya', speed: 1 }, { voice: 'Grace', speed: 1 }],
      [{ ...SONIOX_DEFAULTS, region: 'eu', voiceEu: 'Nina', ttsSpeed: 9 }, { voice: 'Nina', speed: 1.3 }, { voice: 'Grace', speed: 1.3 }],
      [{ ...SONIOX_DEFAULTS, ttsSpeed: 0.1 }, { voice: 'Adrian', speed: 0.7 }, { voice: 'Grace', speed: 0.7 }],
      [{ ...SONIOX_DEFAULTS, ttsSpeed: Number.NaN }, { voice: 'Adrian', speed: 1 }, { voice: 'Grace', speed: 1 }],
    ];
    for (const [s, speaker, participant] of cases) {
      expect(sonioxTtsUnit.build(AUTO_CTX, s, SHARED)).toEqual(speaker);
      expect(sonioxTtsUnit.build(BACK, s, REVERSED)).toEqual(participant);
      expect(sonioxTtsUnit.describe(speaker)).toEqual({ ttsModel: 'tts-rt-v2' });
    }
  });

  it('describes its model and nothing else', () => {
    expect(sonioxTtsUnit.describe({ voice: 'Adrian', speed: 1 })).toEqual({ ttsModel: 'tts-rt-v2' });
  });

  it('names no speech model for a leg that does not speak', () => {
    const silent = { ...AUTO_CTX, speech: false };
    const config = sonioxTtsUnit.build(silent, SONIOX_DEFAULTS, SHARED) as SonioxTtsUnitConfig;
    expect(config).toEqual({ ...sonioxTtsUnit.build(AUTO_CTX, SONIOX_DEFAULTS, SHARED), off: true });
    expect(sonioxTtsUnit.describe(config)).toEqual({});
  });
});

describe("a session of Soniox's speech unit", () => {
  it('reads a chunk as audio with provisional ranges, then fills the ranges in, within the rules', async () => {
    const { session, log, tts, counts } = await setup();
    session.speak(2, 'Hello, world.', [0, 13], 'en');
    expect(tts().sentJson<Json>()[0]).toMatchObject({ stream_id: 'utt-1-1', language: 'en', voice: 'Adrian' });
    tts().receive(chunk('utt-1-1', 2400));
    tts().receive(chunk('utt-1-1', 7200));
    expect(audioOf(log).map((a) => [a.ref, a.pcm.length, a.range])).toEqual([[2, 2400, [0, 2]], [2, 7200, [2, 7]]]);
    expect(audioOf(log).every((a) => !('home' in a) && !('voice' in a))).toBe(true);
    expect(rangesOf(log)).toEqual([]);
    session.endUtterance(2);
    tts().receive(terminated('utt-1-1'));
    expect(rangesOf(log)).toEqual([{ ref: 2, ranges: [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 13] }] }]);
    expect(counts.get(2)).toBe(2);
    // A second row, in a second segment.
    session.speak(4, 'Next one.', [0, 9], 'en');
    tts().receive(chunk('utt-2-1', 4800));
    session.endUtterance(4);
    tts().receive(terminated('utt-2-1'));
    expect(rangesOf(log)[1]).toEqual({ ref: 4, ranges: [{ index: 0, range: [0, 9] }] });
    session.close();
    expect(checkSpeech(log)).toEqual([]);
  });

  it("numbers its audio on the request's counter, going on from where another voice left a row", async () => {
    const counts = new Map<Ref, number>([[2, 3]]);
    const { session, log, tts } = await setup({ counts });
    session.speak(2, 'Hi.', [5, 8], 'en');
    tts().receive(chunk('utt-1-1', 2400));
    tts().receive(terminated('utt-1-1'));
    expect(counts.get(2)).toBe(4);
    expect(rangesOf(log)).toEqual([{ ref: 2, ranges: [{ index: 3, range: [5, 8] }] }]);
    expect(checkSpeech(log)).toEqual([]);
  });

  it("opens the region's socket with the key for speech, and sends the config's voice and speed and the client reference", async () => {
    const { session, tts } = await setup({ credentials: { region: 'eu', stt: 'stt-key', tts: 'tts-key', clientReferenceId: 'ref-1' }, config: { voice: 'Maya', speed: 1.2 } });
    expect(tts().url).toBe('wss://tts-rt.eu.soniox.com/tts-websocket');
    expect(tts().protocols).toEqual(['soniox-api-key', 'tts-key']);
    session.speak(2, 'Hi.', [0, 3], 'en');
    expect(tts().sentJson<Json>()[0]).toMatchObject({ voice: 'Maya', speed: 1.2, model: 'tts-rt-v2', client_reference_id: 'ref-1', sample_rate: 24000 });
  });

  it("a voice-only lease's voice: its speech key, that stream's client reference, and its start reported once when the socket first opens", async () => {
    const voiceLease = { streamAccepted: vi.fn() };
    const made = create({ credentials: { region: 'jp', tts: 'k-spk_tts', clientReferenceId: 'ref-spk_tts', voiceLease } });
    await flush();
    expect(voiceLease.streamAccepted).not.toHaveBeenCalled();
    made.sockets.last().open();
    await made.opening;
    expect(made.sockets.last().url).toBe('wss://tts-rt.jp.soniox.com/tts-websocket');
    expect(made.sockets.last().protocols).toEqual(['soniox-api-key', 'k-spk_tts']);
    expect(voiceLease.streamAccepted).toHaveBeenCalledTimes(1);
    made.session.speak(2, 'Hi.', [0, 3], 'en');
    expect(made.sockets.last().sentJson<Json>()[0]).toMatchObject({ client_reference_id: 'ref-spk_tts' });
    // A dropped socket reopened for the next text is the same voice: nothing more is reported.
    made.sockets.last().serverClose(1006);
    made.session.speak(3, 'Again.', [0, 6], 'en');
    await flush();
    made.sockets.last().open();
    await flush();
    expect(made.sockets.all).toHaveLength(2);
    expect(voiceLease.streamAccepted).toHaveBeenCalledTimes(1);
  });

  it("a session lease's voice reports nothing: its port is the transcription socket's, which says the start itself", async () => {
    const lease: SonioxLeasePort = {
      streamAccepted: vi.fn(), streamEnded: vi.fn(), atGrantEnd: vi.fn(() => false), cutoff: vi.fn(),
      reissue: vi.fn(async () => ({ ok: false as const, retry: true as const, message: 'unused' })),
    };
    const leased: SonioxCredentials = { region: 'us', stt: 'k-spk_stt', tts: 'k-spk_tts', clientReferenceId: 'ref-spk_stt', lease };
    const { session, tts } = await setup({ credentials: leased });
    session.speak(2, 'Hi.', [0, 3], 'en');
    tts().receive(chunk('utt-1-1', 2400));
    session.close();
    await flush();
    for (const called of Object.values(lease)) expect(called).not.toHaveBeenCalled();
  });

  it("a voice-only lease's leg that holds no key says nothing and reports nothing", async () => {
    const { sockets, opening, log } = create({ credentials: { region: 'us' } });
    await opening;
    expect(sockets.all).toEqual([]);
    expect(degradedOf(log)).toHaveLength(1);
  });

  it("asks in Soniox's own language code", async () => {
    const { session, tts } = await setup();
    session.speak(2, 'Kumusta.', [0, 8], 'fil');
    expect(tts().sentJson<Json>()[0]).toMatchObject({ stream_id: 'utt-1-1', language: 'tl' });
  });

  it('a language Soniox has no code for is left out, with a line in the Logs, and nothing throws', async () => {
    const { session, log, tts } = await setup();
    expect(() => session.speak(2, 'Hello.', [0, 6], 'xx')).not.toThrow();
    expect(tts().sentJson<Json>()).toEqual([]);
    expect(framesOf(log, 'tts.language_unsupported')).toEqual([{ direction: 'out', type: 'tts.language_unsupported', payload: { language: 'xx' } }]);
    session.close();
    session.speak(3, 'Hello.', [0, 6], 'xx');
    expect(framesOf(log, 'tts.language_unsupported')).toHaveLength(1);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('text that comes before the socket opens waits for it', async () => {
    const { session, sockets, opening, log } = create();
    session.speak(2, 'Hello.', [0, 6], 'en');
    expect(sockets.all).toHaveLength(1);
    sockets.last().open();
    await opening;
    expect(texts(sockets.last().sentJson<Json>())).toEqual(['Hello.']);
    sockets.last().receive(chunk('utt-1-1', 2400));
    expect(audioOf(log)).toHaveLength(1);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('switched off: the live segment is dropped and nothing more is heard; back on, it resumes at the next sentence', async () => {
    const { session, log, tts } = await setup();
    session.speak(1, 'I went ', [0, 7], 'en');
    tts().receive(chunk('utt-1-1', 2400));
    session.setOn(false);
    expect(tts().sentJson<Json>()).toContainEqual({ stream_id: 'utt-1-1', text: '', text_end: true });
    // What the dropped segment still says is not heard; it is closed out over the chunk that was.
    tts().receive(chunk('utt-1-1', 2400));
    tts().receive(terminated('utt-1-1'));
    expect(audioOf(log)).toHaveLength(1);
    expect(rangesOf(log)).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 7] }] }]);
    // The caller goes on handing text while speech is off: none of it is sent.
    session.speak(1, 'home ', [7, 12], 'en');
    session.setOn(true);
    // The rest of the sentence being said is skipped; the next one is read.
    session.speak(1, 'early. ', [12, 19], 'en');
    session.speak(1, 'Then I slept.', [19, 32], 'en');
    expect(texts(tts().sentJson<Json>())).toEqual(['I went ', 'Then I slept.']);
    tts().receive(chunk('utt-1-2', 2400));
    session.endUtterance(1);
    tts().receive(terminated('utt-1-2'));
    expect(audioOf(log)).toHaveLength(2);
    expect(framesOf(log, 'tts.speech').map((f) => f.payload)).toEqual([{ on: false }, { on: true }]);
    expect(checkSpeech(log)).toEqual([]);
  });

  it("a chunk read for another leg's row: its audio and its ranges name that leg as their home, and name no voice", async () => {
    const { session, log, tts } = await setup({ leg: 'participant' });
    session.speak(7, 'Hola.', [0, 5], 'es', 'speaker');
    tts().receive(chunk('utt-1-1', 2400));
    expect(audioOf(log)).toHaveLength(1);
    expect(audioOf(log)[0]).toMatchObject({ ref: 7, home: 'speaker', range: [0, 2] });
    expect(audioOf(log)[0]).not.toHaveProperty('voice');
    session.endUtterance(7);
    tts().receive(terminated('utt-1-1'));
    expect(rangesOf(log)).toEqual([{ ref: 7, ranges: [{ index: 0, range: [0, 5] }], home: 'speaker' }]);
    // The leg's own row afterwards carries no home.
    session.speak(8, 'Adiós.', [0, 6], 'es');
    tts().receive(chunk('utt-2-1', 2400));
    session.endUtterance(8);
    tts().receive(terminated('utt-2-1'));
    expect(audioOf(log)[1]).not.toHaveProperty('home');
    expect(rangesOf(log)[1]).toEqual({ ref: 8, ranges: [{ index: 0, range: [0, 6] }] });
    expect(checkSpeech(log)).toEqual([]);
  });

  it('recycle lets the socket go without a word; the next text opens a fresh one, and a row goes on counting', async () => {
    const { session, log, tts, sockets, counts } = await setup();
    const dead = tts();
    session.speak(1, 'Hello. ', [0, 7], 'en');
    dead.receive(chunk('utt-1-1', 2400));
    session.recycle!();
    expect(dead.closedByClient).not.toBeNull();
    expect(framesOf(log, 'tts.recycle')).toHaveLength(1);
    expect(sockets.all).toHaveLength(1);
    session.speak(1, 'Again.', [7, 13], 'en');
    expect(sockets.all).toHaveLength(2);
    sockets.last().open();
    await flush();
    expect(texts(sockets.last().sentJson<Json>())).toEqual(['Again.']);
    sockets.last().receive(chunk('utt-1-1', 2400));
    sockets.last().receive(terminated('utt-1-1'));
    expect(counts.get(1)).toBe(2);
    expect(rangesOf(log)).toEqual([{ ref: 1, ranges: [{ index: 1, range: [7, 13] }] }]);
    expect(degradedOf(log)).toEqual([]);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('a segment Soniox kills says tts_segment_lost, with its reason', async () => {
    const { session, log, tts } = await setup();
    session.speak(1, 'Hello.', [0, 6], 'en');
    tts().receive(chunk('utt-1-1', 2400));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' }));
    expect(degradedOf(log)).toEqual([{ code: 'tts_segment_lost', message: 'Soniox TTS 408: Request timeout', reason: 'tts_408' }]);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('close closes the socket, and nothing is said or asked after it', async () => {
    const { session, log, tts } = await setup();
    session.speak(1, 'Hello.', [0, 6], 'en');
    tts().receive(chunk('utt-1-1', 2400));
    session.close();
    expect(tts().closedByClient).not.toBeNull();
    const sent = tts().sent.length;
    const said = log.length;
    session.speak(2, 'More.', [0, 5], 'en');
    session.endUtterance(2);
    session.setOn(false);
    session.recycle!();
    expect(tts().sent).toHaveLength(sent);
    expect(log.filter((e, i) => i >= said && (e.kind === 'audio' || e.kind === 'speechRanges' || e.kind === 'degraded' || e.kind === 'frame'))).toEqual([]);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('close during the connect closes that socket, and says nothing', async () => {
    const { session, sockets, opening, log } = create();
    session.close();
    expect(sockets.last().closedByClient).not.toBeNull();
    await opening;
    await flush();
    expect(log.some((e) => e.kind === 'degraded' || e.kind === 'frame')).toBe(false);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('with no key for speech: opening says speech is degraded, once, and nothing else ever happens', async () => {
    const { session, sockets, opening, log } = create({ credentials: { region: 'us', stt: 'stt-key' } });
    await opening;
    expect(degradedOf(log)).toEqual([{ code: 'tts_degraded', message: 'No TTS key was issued for this leg: it runs text-only.' }]);
    await session.open();
    session.speak(2, 'Hello.', [0, 6], 'en');
    session.speak(3, 'Hola.', [0, 5], 'es', 'participant');
    session.endUtterance(2);
    session.setOn(false);
    session.setOn(true);
    session.recycle?.();
    session.close();
    await flush();
    expect(sockets.all).toEqual([]);
    expect(degradedOf(log)).toHaveLength(1);
    expect(log.some((e) => e.kind === 'audio' || e.kind === 'speechRanges' || e.kind === 'frame')).toBe(false);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('with no key for speech, a session closed before it opens says nothing', async () => {
    const clock = createVirtualClock(0);
    const { session, log } = recordSpeech(sonioxTtsUnit.startSpeech!, {
      leg: 'speaker', context: AUTO_CTX, config: { voice: 'Adrian', speed: 1 }, credentials: { region: 'us', stt: 'stt-key' } satisfies SonioxCredentials as SonioxVoiceCredentials, clock, signal: new AbortController().signal, counts: new Map(),
    });
    session.close();
    await session.open();
    expect(degradedOf(log)).toEqual([]);
  });
});

describe("the languages Soniox's voice speaks", () => {
  const speaks = sonioxTtsUnit.capabilities(SONIOX_DEFAULTS).speaks!;
  it('the languages its table has a code for, Tagalog under the code the app writes', () => {
    expect(['en', 'ja', 'zh', 'fil', 'cy'].map((language) => speaks(language))).toEqual([true, true, true, true, true]);
  });
  it('no other language, no regional form, and never the automatic source', () => {
    expect(['yue', 'jv', 'pt-BR', 'tl', 'auto', ''].map((language) => speaks(language))).toEqual([false, false, false, false, false, false]);
  });
  it('is the same on both definitions', () => {
    expect(sonioxTtsUnitFor({ participantSpeech: false }).capabilities(SONIOX_DEFAULTS).speaks!('eu')).toBe(true);
  });
});
