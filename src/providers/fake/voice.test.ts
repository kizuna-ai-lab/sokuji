import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import type { SpeechStartRequest } from '../../lib/contract/speech';
import { checkSpeech, recordSpeech, type SpeechLog } from '../../lib/contract/speechConformance';
import { isSpeechUnit } from '../../lib/plan/types';
import { unitsOf } from '../../lib/plan/wholeUnit';
import { readCredentials } from '../../lib/provider/credentials';
import { fakeProvider } from './provider';
import { FAKE_DEFAULTS } from './settings';
import { fakeVoiceProvider, type FakeVoiceConfig, type FakeVoiceCredentials } from './voice';

const noAuth = { signedIn: false, getToken: async () => null };
const [unit] = unitsOf(fakeVoiceProvider);

/** A recorded session of the fake voice on a virtual clock. */
function voice(counts = new Map<Ref, number>()) {
  const clock = createVirtualClock(0);
  const request: SpeechStartRequest<FakeVoiceConfig, FakeVoiceCredentials> = {
    leg: 'speaker',
    context: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
    config: { voice: 'fake' },
    credentials: {},
    clock,
    signal: new AbortController().signal,
    counts,
  };
  const { session, log } = recordSpeech(unit.startSpeech!, request);
  /** Every clip said so far: its ref, its range, its length, and the home leg when one is named. */
  const clips = () => log.flatMap((e) => (e.kind === 'audio' ? [[e.payload.ref, e.payload.range, e.payload.pcm.length, ...(e.payload.home ? [e.payload.home] : [])]] : []));
  return { clock, session, log, clips, counts };
}

const kinds = (log: SpeechLog) => log.map((e) => e.kind);

describe('the fake voice provider', () => {
  it('needs no key: it shows no credential field and reads an empty answer', () => {
    expect(fakeVoiceProvider.id).toBe('fake_voice');
    expect(fakeVoiceProvider.kind).toBe('own-key');
    expect(fakeVoiceProvider.credentials.keys).toEqual([]);
    expect(fakeVoiceProvider.credentials.fields(fakeVoiceProvider.settings.defaults)).toEqual([]);
    expect(readCredentials(fakeVoiceProvider, fakeVoiceProvider.settings.defaults, {}, noAuth)).toEqual({});
  });

  it('is always ready, and offers the languages the fake offers', async () => {
    await expect(fakeVoiceProvider.check({}, fakeVoiceProvider.settings.defaults, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] })).resolves.toEqual({ ok: true });
    expect(fakeVoiceProvider.languages).toBe(fakeProvider.languages);
  });

  it('has one unit, a speech unit that occupies speech when asked for exactly that', () => {
    expect(unitsOf(fakeVoiceProvider)).toHaveLength(1);
    expect(unit.id).toBe('voice');
    expect(isSpeechUnit(unit)).toBe(true);
    expect(unit.start).toBeUndefined();
    expect(unit.occupies({}, new Set(['speech']))).toEqual(['speech']);
    expect(unit.occupies({}, new Set(['translation', 'speech']))).toBeNull();
    expect(unit.occupies({}, new Set(['transcription', 'translation', 'speech']))).toBeNull();
    expect(unit.occupies({}, new Set(['transcription']))).toBeNull();
  });

  it('says what a voice can do', () => {
    const can = unit.capabilities({});
    expect({ ...can }).toEqual({ speech: 'optional', turns: ['auto', 'manual'], turnOwner: 'either', boundaries: 'silence', textInput: false, faceToFace: true, participantSpeech: true, speaks: expect.any(Function) });
  });

  it('builds and describes its one voice', () => {
    const shared = { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off' as const, sentencesPerRow: 0 }, models: [] };
    const config = unit.build({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' }, {}, shared);
    expect(config).toEqual({ voice: 'fake' });
    expect(unit.describe(config)).toEqual({ ttsModel: 'fake-voice' });
  });

  it('is never a text provider: it has no start of its own', () => {
    expect(fakeVoiceProvider).not.toHaveProperty('start');
  });
});

describe('the fake voice', () => {
  it('answers a speak on the next tick of the clock, never inside the call', async () => {
    const h = voice();
    await h.session.open();
    h.session.speak(1, 'Hello.', [0, 6], 'en');
    expect(h.clips()).toEqual([]);
    h.clock.advance(0);
    expect(h.clips()).toEqual([[1, [0, 6], 2400]]);
  });

  it('says one clip of silence per sentence, each with its range in the whole translation', () => {
    const h = voice();
    h.session.speak(1, 'One. Two!  Three? 四。五！六？', [10, 34], 'en');
    h.clock.advance(0);
    expect(h.clips()).toEqual([
      [1, [10, 14], 2400],
      [1, [15, 19], 2400],
      [1, [21, 27], 2400],
      [1, [28, 30], 2400],
      [1, [30, 32], 2400],
      [1, [32, 34], 2400],
    ]);
    const said = h.log.find((e) => e.kind === 'audio')!;
    expect(said.kind === 'audio' && said.payload.pcm.every((sample) => sample === 0)).toBe(true);
  });

  it('reads a text with no sentence end as one sentence, and says nothing for a blank one', () => {
    const h = voice();
    h.session.speak(1, 'no end here', [4, 15], 'en');
    h.session.speak(2, '  ', [0, 2], 'en');
    h.session.speak(3, '', [0, 0], 'en');
    h.clock.advance(0);
    expect(h.clips()).toEqual([[1, [4, 15], 2400]]);
  });

  it('counts each clip on the shared counter before it says it', () => {
    const h = voice(new Map([[1, 3]]));
    h.session.speak(1, 'One. Two.', [0, 9], 'en');
    h.clock.advance(0);
    expect(h.counts.get(1)).toBe(5);
    expect(h.log.filter((e) => e.kind === 'audio').map((e) => e.counts.get(1))).toEqual([4, 5]);
  });

  it('passes the home leg of a row through', () => {
    const h = voice();
    h.session.speak(1, 'Hello.', [0, 6], 'en', 'participant');
    h.clock.advance(0);
    expect(h.clips()).toEqual([[1, [0, 6], 2400, 'participant']]);
  });

  it('drops what is pending when speech is switched off, says nothing while off, and speaks again once on', () => {
    const h = voice();
    h.session.speak(1, 'Dropped.', [0, 8], 'en');
    h.session.setOn(false);
    h.session.speak(1, ' Unheard.', [8, 17], 'en');
    h.clock.advance(0);
    expect(h.clips()).toEqual([]);
    h.session.setOn(true);
    h.clock.advance(0);
    expect(h.clips()).toEqual([]);
    h.session.speak(1, ' Heard.', [17, 24], 'en');
    h.clock.advance(0);
    expect(h.clips()).toEqual([[1, [18, 24], 2400]]);
  });

  it('says nothing after close', () => {
    const h = voice();
    h.session.speak(1, 'Dropped.', [0, 8], 'en');
    h.session.close();
    h.session.speak(2, 'Late.', [0, 5], 'en');
    h.clock.advance(10);
    expect(h.clips()).toEqual([]);
    expect(kinds(h.log).slice(-3)).toEqual(['close', 'closed', 'speak']);
  });

  it('honours every rule of the speech contract, speech switched off and on included', async () => {
    const h = voice(new Map([[7, 2]]));
    await h.session.open();
    h.session.speak(1, 'First. Second', [0, 13], 'ja');
    h.clock.advance(0);
    h.session.speak(1, ' part. Third.', [13, 26], 'ja');
    h.session.speak(2, 'Abroad.', [0, 7], 'en', 'participant');
    h.clock.advance(5);
    h.session.endUtterance(1);
    h.session.speak(3, 'Cut off.', [0, 8], 'ja');
    h.session.setOn(false);
    h.session.speak(3, ' Unheard.', [8, 17], 'ja');
    h.clock.advance(5);
    h.session.setOn(true);
    h.session.speak(3, ' Heard again.', [17, 30], 'ja');
    h.session.speak(7, 'Counted on.', [0, 11], 'ja');
    h.clock.advance(5);
    h.session.endUtterance(3);
    h.session.speak(4, 'Never said.', [0, 11], 'ja');
    h.session.close();
    h.clock.advance(5);

    expect(checkSpeech(h.log)).toEqual([]);
    expect(h.clips().map(([ref]) => ref)).toEqual([1, 1, 1, 1, 2, 3, 7]);
    expect(h.counts).toEqual(new Map([[7, 3], [1, 4], [2, 1], [3, 1]]));
  });
});

describe('the fake voice in the catalog', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** The catalog and the composer as a build of this mode has them, with the registry that registers the catalog. */
  async function build(mode: string, dev: boolean) {
    vi.stubEnv('MODE', mode);
    vi.stubEnv('DEV', dev);
    vi.resetModules();
    const [catalog, composer] = await Promise.all([import('../../lib/lineup/catalog'), import('../../lib/plan/compose'), import('../registry')]);
    return { catalog, composer };
  }

  it('serves speech alone and hosts itself, in the build whose line-up may name the fake', async () => {
    const { catalog } = await build('e2e', false);
    expect(catalog.caps('fake')).toBeDefined();
    expect(catalog.caps('fake_voice')).toEqual({ id: 'fake_voice', stages: ['speech'], host: 'fake_voice', account: 'key', voiceAlone: true, takesVoice: false });
    // The fake's text may be read by it: transcription and translation go together, speech apart.
    expect(catalog.caps('fake')).toMatchObject({ joint: ['transcription', 'translation'], voiceAlone: false, takesVoice: true });
  });

  it('is in no other catalog', async () => {
    for (const [mode, dev] of [['production', false], ['development', true], ['test', true]] as const) {
      const { catalog } = await build(mode, dev);
      expect(catalog.caps('fake')).toBeUndefined();
      expect(catalog.caps('fake_voice')).toBeUndefined();
    }
  });

  it('the fake for transcription and translation with the fake voice for speech composes to a plan of two units', async () => {
    const { composer } = await build('e2e', false);
    const plan = composer.compose(
      { transcription: 'fake', translation: 'fake', speech: 'fake_voice' },
      { providers: [fakeProvider, fakeVoiceProvider], settings: (id) => (id === 'fake' ? FAKE_DEFAULTS : {}) },
    );
    if ('refused' in plan) throw new Error(`refused: ${plan.refused}`);
    expect(plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([
      ['fake', 'whole', ['transcription', 'translation']],
      ['fake_voice', 'voice', ['speech']],
    ]);
    expect(plan.byStage.transcription).toBe(plan.units[0]);
    expect(plan.byStage.translation).toBe(plan.units[0]);
    expect(plan.byStage.speech).toBe(plan.units[1]);
    expect(plan.units[0].unit.start).toBeDefined();
    expect(plan.units[1].unit.startSpeech).toBeDefined();
  });
});

describe('the languages the fake voice speaks', () => {
  it('every language: it reads silence', () => {
    const speaks = unit.capabilities({}).speaks!;
    expect(['en', 'ja', 'eu', 'xx'].map((language) => speaks(language))).toEqual([true, true, true, true]);
  });
});
