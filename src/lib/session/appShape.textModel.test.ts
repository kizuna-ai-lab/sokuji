// A text model translating what Soniox or this device heard (text models, part B), with the released providers in
// the desktop app: the plan the stores make of the line-up, the languages on offer (a translator that takes any two
// languages leaves the transcriber's own lists, and no automatic source), what the live gate refuses, and that each
// provider is checked for its own stage and named in its own notice.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  getEnvironment: () => 'electron', isElectron: () => true, isExtension: () => false,
}));

import { geminiTextProvider } from '../../providers/gemini_text/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { openaiTextProvider } from '../../providers/openai_text/provider';
import { sonioxProvider } from '../../providers/soniox/provider';
import useAudioStore from '../../stores/audioStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useModelStore } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { checkStagesOf } from '../plan/read';
import { planFromStores } from '../plan/fromStores';
import { lineUpNoticeFromStores, liveGate, readShapeFromStores } from './appShape';
import { planLanguages } from './shape';

const auth = { signedIn: false, getToken: async () => null };
const lineUp = (transcription: string, translation: string, speech: string) => ({ transcription, translation, speech, summarisation: null });
const values = (options: readonly { value: string }[]) => options.map((o) => o.value);

async function stored(of: ReturnType<typeof lineUp>) {
  useLineUpStore.setState({ lineUp: of, stored: true, unstoredProvider: null, locked: false });
  for (const p of [sonioxProvider, localInferenceProvider, openaiTextProvider, geminiTextProvider]) await useProviderStore.getState().load(p);
  const entries = useProviderStore.getState().entries;
  useProviderStore.setState({ entries: { ...entries, soniox: { ...entries.soniox, credentials: { apiKey: 'k' } }, openai_text: { ...entries.openai_text, credentials: { apiKey: 'test-key-0000' } } } });
}

function ready() {
  const found = planFromStores();
  if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
  return found;
}

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, stages: {}, stageIds: {}, intent: undefined });
  useAudioStore.setState({ mode: 'speaker', otherSide: 'meeting' } as never);
  useSettingsStore.setState({ textOnly: false });
  useRoutingStore.setState({ participantSpeech: null });
  useModelStore.setState({ initialized: true, modelStatuses: {} } as never);
});

describe("Soniox transcribing, OpenAI's text model translating, Soniox's voice reading", () => {
  it('composes to three units; the text model is checked for the translation alone', async () => {
    await stored(lineUp('soniox', 'openai_text', 'soniox'));
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    const found = ready();
    expect(found.plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([
      ['soniox', 'transcription', ['transcription']],
      ['openai_text', 'translation', ['translation']],
      ['soniox', 'tts', ['speech']],
    ]);
    expect(checkStagesOf(found.plan, openaiTextProvider)).toEqual(['translation']);
    const shape = readShapeFromStores(auth)!;
    expect(Object.keys(shape.accounts).sort()).toEqual(['openai_text', 'soniox']);
    expect(shape.lineUp).toEqual({ transcription: 'soniox', translation: 'openai_text', speech: 'soniox' });
    expect(liveGate('electron')).toBeNull();
    expect(lineUpNoticeFromStores()).toBeNull();
  });

  it("the languages on offer: every one of Soniox's as a source but the automatic one, and its every other language as a target", async () => {
    await stored(lineUp('soniox', 'openai_text', 'soniox'));
    const offer = planLanguages(ready()).languages;
    const soniox = sonioxProvider.settings.defaults as never;
    expect(values(offer.sources(undefined))).toEqual(values(sonioxProvider.languages.sources(soniox)).filter((code) => code !== 'auto'));
    expect(values(offer.targets('en', undefined))).toEqual(values(sonioxProvider.languages.targets('en', soniox)).filter((code) => code !== 'en'));
    // Basque, which Bing does not take, is a target a text model translates into.
    expect(values(offer.targets('ja', undefined))).toContain('eu');
    expect(offer.targets('auto', undefined)).toEqual([]);
  });

  it('an automatic source is refused in words of its own, naming the text model, on the translation stage', async () => {
    await stored(lineUp('soniox', 'openai_text', 'soniox'));
    useProviderStore.getState().setPair(sonioxProvider, { source: 'auto', target: 'ja' });
    expect(liveGate('electron')).toMatchObject({ code: 'lineup_source_not_fixed', params: { stage: 'translation', provider: 'openai_text' } });
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    expect(liveGate('electron')).toBeNull();
  });

  it("a key missing for the text model refuses Start, naming the text model, whose row it opens", async () => {
    await stored(lineUp('soniox', 'gemini_text', 'soniox'));
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    const answer = await useProviderStore.getState().refreshReadiness(geminiTextProvider, auth);
    expect(answer).toMatchObject({ state: 'not-ready', code: 'credentials_missing', params: { provider: 'gemini_text' } });
  });
});

describe("this device transcribing, Gemini's text model translating, Edge reading", () => {
  it("composes to this device's recognition alone, the text model and this device's speech", async () => {
    await stored(lineUp('local_inference', 'gemini_text', 'edge'));
    const found = ready();
    expect(found.plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([
      ['local_inference', 'transcription', ['transcription']],
      ['gemini_text', 'translation', ['translation']],
      ['local_inference', 'speech', ['speech']],
    ]);
    const offer = planLanguages(found).languages;
    const local = localInferenceProvider.settings.defaults as never;
    expect(values(offer.sources(undefined))).toEqual(values(localInferenceProvider.languages.sources(local)));
    expect(values(offer.targets('en', undefined))).toEqual(values(localInferenceProvider.languages.targets('en', local)));
  });
});
