/** Local Native's voice as a session of its own: the sidecar's TTS socket behind the speech contract, held to its rules. */
import { describe, expect, it } from 'vitest';
import type { Ref, SessionContext, TextRange } from '../../lib/contract/adapter';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import { flush } from '../../lib/contract/testing/drive';
import { checkSpeech, recordSpeech, type SpeechLog } from '../../lib/contract/speechConformance';
import type { NativeHost } from '../../lib/local-inference/native/nativeModels';
import { createFakeNativeEngines, createFakeNativeHost } from './fakeEngines';
import { startNativeSpeech, type NativeSpeechConfig, type NativeVoiceConfig } from './speechSession';

const JA_EN: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const cloneOnly = { builtin: 'none' as const, custom: 'clip' as const, required: true };

function voice(over: Partial<NativeVoiceConfig> = {}): NativeVoiceConfig {
  return { modelId: 'tts-a', device: 'auto', speed: 1, voice: '', capability: { builtin: 'named', custom: 'none' }, host: createFakeNativeHost(), ...over };
}

function create(config: NativeSpeechConfig = voice(), initial: Array<[Ref, number]> = []) {
  const fakes = createFakeNativeEngines();
  const clock = createVirtualClock(0);
  // The row's shared count, as the run hands it: entries other voices said before this session began.
  const counts = new Map<Ref, number>(initial);
  let madeOn: Clock | null = null;
  const { session, log } = recordSpeech(
    (request, events) => startNativeSpeech((k) => { madeOn = k; return fakes.tts; }, request, events),
    { leg: 'speaker', context: JA_EN, config, credentials: {}, clock, signal: new AbortController().signal, counts },
  );
  const of = (kind: string) => (log as SpeechLog).filter((r) => r.kind === kind).map((r) => (r as { payload: unknown }).payload);
  const frames = () => (log as SpeechLog).filter((r) => r.kind === 'frame').map((r) => (r as { payload: { type: string } }).payload.type);
  return { session, log, tts: fakes.tts, clock, counts, of, frames, madeOn: () => madeOn };
}

async function opened(config: NativeSpeechConfig = voice(), streaming = false, initial: Array<[Ref, number]> = []) {
  const h = create(config, initial);
  const opening = h.session.open();
  h.tts.ready({ streaming });
  await opening;
  await flush();
  return h;
}

const audio = (log: SpeechLog) => (log.filter((r) => r.kind === 'audio') as Array<{ payload: { ref: Ref; range?: TextRange } }>)
  .map((r) => (r.payload.range ? { ref: r.payload.ref, range: r.payload.range } : { ref: r.payload.ref }));
const ranges = (log: SpeechLog) => (log.filter((r) => r.kind === 'speechRanges') as Array<{ payload: unknown }>).map((r) => r.payload);

describe("Local Native's speech session", () => {
  it("a one-shot sentence is one clip, ranged in the row's whole translation (#578 ruling 24)", async () => {
    const h = await opened();
    h.session.speak(7, 'Good night.', [12, 23], 'en');
    await flush();
    h.tts.say();
    await flush();
    expect(audio(h.log)).toEqual([{ ref: 7, range: [12, 23] }]);
    expect(h.counts.get(7)).toBe(1);
    h.session.close();
    expect(checkSpeech(h.log)).toEqual([]);
  });

  it("streaming chunks come unranged, then their ranges follow, indexed by the row's shared count (#578 ruling 24)", async () => {
    const h = await opened(voice(), true, [[7, 2]]); // another voice already said two entries of row 7
    h.session.speak(7, 'Good night.', [12, 23], 'en');
    await flush();
    h.tts.chunk();
    h.tts.chunk();
    h.tts.chunk();
    h.tts.finish();
    await flush();
    expect(audio(h.log)).toEqual([{ ref: 7 }, { ref: 7 }, { ref: 7 }]);
    expect(ranges(h.log)).toEqual([{ ref: 7, ranges: [{ index: 2, range: expect.any(Array) }, { index: 3, range: expect.any(Array) }, { index: 4, range: expect.any(Array) }] }]);
    expect(h.counts.get(7)).toBe(5);
    h.session.close();
    expect(checkSpeech(h.log)).toEqual([]);
  });

  it('a leg built silent with no voice for its target says so once when it opens', async () => {
    const h = create({ off: true, unavailable: 'speaker_tts_missing' });
    await h.session.open();
    await h.session.open();
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'speaker_tts_missing', params: { target: 'en' } })]);
    expect(h.madeOn()).toBeNull();
    const quiet = create({ off: true });
    await quiet.session.open();
    expect(quiet.of('degraded')).toEqual([]);
  });

  it('open never rejects: a load that fails says tts_degraded once', async () => {
    const h = create();
    const opening = h.session.open();
    h.tts.failInit('no such model');
    await expect(opening).resolves.toBeUndefined();
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
    h.session.speak(1, 'Hello.', [0, 6], 'en');
    await flush();
    expect(h.tts.spoken).toEqual([]);
    expect(checkSpeech(h.log)).toEqual([]);
  });

  it('a clone-only model with no clip is not loaded, and says so (#578 ruling 10)', async () => {
    const host = createFakeNativeHost({ voiceStore: () => ({ list: async () => [], resolveApply: async () => null }) });
    const h = create(voice({ capability: cloneOnly, host }));
    await h.session.open();
    expect(h.tts.inits).toEqual([]);
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded', message: expect.stringMatching(/needs a voice clip/) })]);
  });

  it('applies the stored built-in voice before the first sentence; a substituted clip says voice_fallback', async () => {
    const voices = [{ name: 'Bella', language: 'en', curated: true, unstable: false, default: false }];
    const named = await opened(voice({ voice: 'builtin:Bella', host: createFakeNativeHost({ listVoices: async () => voices as never }) }));
    expect(named.tts.voices).toEqual(['Bella']);
    expect(named.of('degraded')).toEqual([]);
    const clips: NativeHost['voiceStore'] = () => ({ list: async () => [{ id: 3, name: 'clip 3' }], resolveApply: async (id) => ({ kind: 'clip', audio: new Float32Array([id]), sampleRate: 24000 }) });
    const swapped = await opened(voice({ voice: 'custom:9', capability: cloneOnly, host: createFakeNativeHost({ voiceStore: clips }) }));
    expect(swapped.of('degraded')).toEqual([expect.objectContaining({ code: 'voice_fallback' })]);
  });

  it("inits the leg's target on the request's clock, and files the voice's plan where the library's badges read it", async () => {
    const host = createFakeNativeHost();
    const h = await opened(voice({ host }));
    expect(h.madeOn()).toBe(h.clock);
    expect(h.tts.inits).toEqual([{ modelId: 'tts-a', device: 'auto', language: 'en', variant: undefined }]);
    expect(host.plans).toEqual([{ stage: 'tts', plan: expect.objectContaining({ model: 'tts-a' }) }]);
  });

  it('switched off mid-stretch: nothing more of it is heard; switched on, the next stretch is read', async () => {
    const h = await opened(voice(), true);
    h.session.speak(1, 'One.', [0, 4], 'en');
    await flush();
    h.tts.chunk();
    h.session.setOn(false);
    h.tts.chunk();
    h.tts.finish();
    await flush();
    expect(audio(h.log)).toEqual([{ ref: 1 }]);
    h.session.setOn(true);
    h.session.speak(2, 'Two.', [0, 4], 'en');
    await flush();
    h.tts.chunk();
    h.tts.finish();
    await flush();
    expect(audio(h.log)).toEqual([{ ref: 1 }, { ref: 2 }]);
    h.session.close();
    expect(checkSpeech(h.log)).toEqual([]);
  });

  it("a stretch in another language than the leg's target is not read", async () => {
    const h = await opened();
    h.session.speak(1, 'こんばんは。', [0, 6], 'ja');
    await flush();
    expect(h.tts.spoken).toEqual([]);
    expect(h.frames()).toContain('local.native.tts.skipped');
    h.session.close();
  });

  it('a closed socket degrades speech once, and nothing more is read', async () => {
    const h = await opened();
    h.tts.onClosed?.('native host disconnected');
    h.tts.onClosed?.('native host disconnected');
    h.session.speak(1, 'Hello.', [0, 6], 'en');
    await flush();
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded', message: 'Speech synthesis stopped: native host disconnected' })]);
    expect(h.tts.spoken).toEqual([]);
    expect(checkSpeech(h.log)).toEqual([]);
  });

  it('close lets the socket go, and nothing follows', async () => {
    const h = await opened();
    h.session.speak(1, 'Hello.', [0, 6], 'en');
    await flush();
    h.tts.rejectsOnDispose = false;
    h.session.close();
    expect(h.tts.disposes).toBe(1);
    const said = h.log.length;
    h.tts.say();
    await flush();
    expect(h.log).toHaveLength(said);
    expect(checkSpeech(h.log)).toEqual([]);
  });

});
