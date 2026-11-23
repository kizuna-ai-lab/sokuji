// Transcription and translation chosen apart, with the released providers: Soniox (an own key, or Kizuna AI's)
// transcribing for Bing or a model of this device, read by any voice. What the stores make of such a line-up
// (the plan, the languages on offer, what the live gate refuses), what a start is refused for provider by
// provider (a key, a sign-in, a model), and the wallet's floor.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { bingProvider } from '../../providers/bing/provider';
import { edgeProvider } from '../../providers/edge/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { kizunaSonioxProvider } from '../../providers/soniox/kizuna';
import { kizunaSonioxMinimumBalance, sonioxRolesFloorMicroUsd } from '../../providers/soniox/kizunaBudget';
import { sonioxProvider } from '../../providers/soniox/provider';
import useAudioStore from '../../stores/audioStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useModelStore } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { compose } from '../plan/compose';
import { buildPlan, describePlan } from '../plan/composite';
import { planFromStores } from '../plan/fromStores';
import { checkStagesOf, transcriptionProvider } from '../plan/read';
import type { RunPlan } from '../plan/types';
import type { AnyProvider } from '../provider/types';
import type { SharedSettings } from '../run/types';
import { ensureReadyFromStores, faceToFaceFromStores, lineUpNoticeFromStores, liveGate, readShapeFromStores } from './appShape';
import { balanceRefusal, gate, planLanguages } from './shape';

const auth = { signedIn: false, getToken: async () => null };
const lineUp = (transcription: string, translation: string, speech: string) => ({ transcription, translation, speech, summarisation: null });
const values = (options: readonly { value: string }[]) => options.map((o) => o.value);

async function stored(of: ReturnType<typeof lineUp>, key: Record<string, string> = { apiKey: 'k' }) {
  useLineUpStore.setState({ lineUp: of, stored: true, unstoredProvider: null, locked: false });
  await useProviderStore.getState().load(sonioxProvider);
  await useProviderStore.getState().load(localInferenceProvider);
  await useProviderStore.getState().load(bingProvider);
  await useProviderStore.getState().load(edgeProvider);
  const entries = useProviderStore.getState().entries;
  useProviderStore.setState({ entries: { ...entries, soniox: { ...entries.soniox, credentials: key } } });
}

function ready() {
  const found = planFromStores();
  if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
  return found;
}

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, stages: {}, intent: undefined });
  useAudioStore.setState({ mode: 'speaker', otherSide: 'meeting' } as never);
  useSettingsStore.setState({ textOnly: false });
  useRoutingStore.setState({ participantSpeech: null });
  // No model of this device is downloaded.
  useModelStore.setState({ initialized: true, modelStatuses: {} } as never);
});

describe('Soniox with an own key transcribing, Bing translating, Edge speaking: through the stores', () => {
  it('composes to three units, and the run freezes the plan with both providers and the three ids', async () => {
    await stored(lineUp('soniox', 'bing', 'edge'));
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    const found = ready();
    expect(found.plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([
      ['soniox', 'transcription', ['transcription']],
      ['bing', 'translation', ['translation']],
      ['edge', 'speech', ['speech']],
    ]);
    const shape = readShapeFromStores(auth)!;
    expect(shape.plan).toBe(found.plan);
    expect(Object.keys(shape.accounts).sort()).toEqual(['bing', 'edge', 'soniox']);
    expect(shape.lineUp).toEqual({ transcription: 'soniox', translation: 'bing', speech: 'edge' });
    expect(shape.lineUpStored).toBe(true);
    // The pair is the transcription provider's.
    expect(shape.pair).toEqual({ source: 'en', target: 'ja' });
    expect(liveGate('electron')).toBeNull();
    expect(lineUpNoticeFromStores()).toBeNull();
  });

  it("the languages on offer: Soniox's sources that Bing translates, never an automatic one; the targets Bing translates the source into", async () => {
    await stored(lineUp('soniox', 'bing', 'edge'));
    const offer = planLanguages(ready()).languages;
    const sources = values(offer.sources(undefined));
    expect(sources).not.toContain('auto');
    expect(sources).toContain('en');
    expect(sources).toContain('zh');
    // Bing's list lacks Basque: neither a source nor a target.
    expect(sources).not.toContain('eu');
    const targets = values(offer.targets('en', undefined));
    expect(targets).toContain('ja');
    expect(targets).toContain('zh');
    expect(targets).not.toContain('en');
    expect(targets).not.toContain('eu');
    expect(offer.targets('auto', undefined)).toEqual([]);
    // Soniox translating itself offers the automatic source, and Basque.
    useLineUpStore.setState({ lineUp: lineUp('soniox', 'soniox', 'edge') });
    const own = planLanguages(ready()).languages;
    expect(values(own.sources(undefined))).toContain('auto');
    expect(values(own.targets('en', undefined))).toContain('eu');
  });

  it('a model of this device translating: every pair of two of Soniox\'s languages, and no automatic source', async () => {
    await stored(lineUp('soniox', 'local_inference', 'edge'));
    const offer = planLanguages(ready()).languages;
    const all = values(sonioxProvider.languages.targets('en', sonioxProvider.settings.defaults as never));
    expect(values(offer.sources(undefined))).toEqual(values(sonioxProvider.languages.sources(sonioxProvider.settings.defaults as never)).filter((code) => code !== 'auto'));
    expect(values(offer.targets('en', undefined))).toEqual(all.filter((code) => code !== 'en'));
  });

  it('an automatic source is refused in words of its own, naming Bing, on the translation stage; a fixed one runs', async () => {
    await stored(lineUp('soniox', 'bing', 'edge'));
    useProviderStore.getState().setPair(sonioxProvider, { source: 'auto', target: 'ja' });
    expect(useProviderStore.getState().entries.soniox.pair).toEqual({ source: 'auto', target: 'ja' });
    expect(liveGate('electron')).toMatchObject({ code: 'lineup_source_not_fixed', params: { stage: 'translation', provider: 'bing' } });
    expect(lineUpNoticeFromStores()).toMatchObject({ code: 'lineup_source_not_fixed', stage: 'translation' });
    // The run's own gate, over the shape a start freezes, says the same.
    expect(gate(readShapeFromStores(auth)!, 'electron')).toMatchObject({ code: 'lineup_source_not_fixed' });
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    expect(liveGate('electron')).toBeNull();
    // With a model of this device, the same refusal names this device.
    useLineUpStore.setState({ lineUp: lineUp('soniox', 'local_inference', 'edge') });
    useProviderStore.getState().setPair(sonioxProvider, { source: 'auto', target: 'ja' });
    expect(liveGate('electron')).toMatchObject({ code: 'lineup_source_not_fixed', params: { provider: 'local_inference' } });
  });

  it('a pair Bing does not translate is refused with its languages; in Both, the other direction is judged too', async () => {
    await stored(lineUp('soniox', 'bing', 'edge'));
    // Stored while Soniox translated: Basque is Soniox's, not Bing's.
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'eu' });
    expect(liveGate('electron')).toMatchObject({ code: 'lineup_pair_not_translated', params: { stage: 'translation', provider: 'bing', source: 'en', target: 'eu' } });
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    useAudioStore.setState({ mode: 'both' } as never);
    expect(liveGate('electron')).toBeNull();
    const shape = readShapeFromStores(auth)!;
    expect(shape.legs).toEqual(['speaker', 'participant']);
    // A model of this device takes Basque; what remains is Edge, which has no voice for it, until nothing is read aloud.
    useAudioStore.setState({ mode: 'speaker' } as never);
    useLineUpStore.setState({ lineUp: lineUp('soniox', 'local_inference', 'edge') });
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'eu' });
    expect(liveGate('electron')).toMatchObject({ code: 'lineup_language_not_spoken', params: { stage: 'speech', provider: 'edge', language: 'eu' } });
    useSettingsStore.setState({ textOnly: true });
    expect(liveGate('electron')).toBeNull();
  });

  it('face-to-face is not offered and is refused where "beside me" is chosen, naming Soniox; in a meeting, Both runs as two sessions', async () => {
    await stored(lineUp('soniox', 'bing', 'edge'));
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' } as never);
    expect(faceToFaceFromStores()).toBe(false);
    expect(liveGate('electron')).toMatchObject({ code: 'lineup_face_to_face_apart', params: { stage: 'translation', provider: 'soniox' } });
    const shape = readShapeFromStores(auth)!;
    expect(shape.faceToFace).toBe(false);
    expect(shape.faceToFaceAsked).toBe(true);
    expect(gate(shape, 'electron')).toMatchObject({ code: 'lineup_face_to_face_apart' });
    useAudioStore.setState({ otherSide: 'meeting' } as never);
    expect(liveGate('electron')).toBeNull();
    expect(readShapeFromStores(auth)!).not.toHaveProperty('faceToFaceAsked');
    // Soniox translating too: face-to-face is on, and nothing is refused.
    useLineUpStore.setState({ lineUp: lineUp('soniox', 'soniox', 'edge') });
    useAudioStore.setState({ otherSide: 'beside' } as never);
    expect(faceToFaceFromStores()).toBe(true);
    expect(liveGate('electron')).toBeNull();
  });
});

describe('what a record of such a session names', () => {
  it('each stage\'s model comes from the unit that serves it: Soniox\'s recognition, Bing, and Edge\'s voice', async () => {
    await stored(lineUp('soniox', 'bing', 'edge'));
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    const shape = readShapeFromStores(auth)!;
    const shared = { ...shape.shared, models: [], speaks: true, lineUp: shape.lineUp } as SharedSettings;
    const configs = buildPlan(shape.plan, { direction: shape.pair, speech: true, turns: 'auto' }, shape, shared);
    if (!(configs instanceof Map)) throw new Error(`refused: ${JSON.stringify(configs)}`);
    const models = describePlan(shape.plan, configs);
    expect(models.asrModel).toBe('stt-rt-v6');
    expect(models.translationModel).toBe('bing-translator');
    expect(typeof models.ttsModel).toBe('string');
    // Soniox is asked for no translation: its config says it transcribes alone.
    expect(configs.get(shape.plan.byStage.transcription)).toMatchObject({ transcribesAlone: true });
    // What the run hands the record beside them: the three ids, under the provider that transcribes.
    expect(shape.lineUp).toEqual({ transcription: 'soniox', translation: 'bing', speech: 'edge' });
    expect(transcriptionProvider(shape.plan).id).toBe('soniox');
  });
});

describe('what a start needs of each provider, each named in its own notice', () => {
  const check = (provider: AnyProvider) => ensureReadyFromStores(provider, readShapeFromStores(auth)!, new AbortController().signal);

  it("Soniox's key is asked of Soniox, though Bing and Edge need nothing", async () => {
    await stored(lineUp('soniox', 'bing', 'edge'), {});
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    expect(await check(sonioxProvider)).toMatchObject({ state: 'not-ready', code: 'credentials_missing', params: { provider: 'soniox' } });
    expect(await check(bingProvider)).toMatchObject({ state: 'ready' });
    expect(await check(edgeProvider)).toMatchObject({ state: 'ready' });
  });

  it('a model of this device translating: its translation model is asked of this device, and no recognition model', async () => {
    await stored(lineUp('soniox', 'local_inference', 'edge'), {});
    useProviderStore.getState().setPair(sonioxProvider, { source: 'en', target: 'ja' });
    const plan = ready().plan;
    // What its check is told: the stages it serves.
    const stages = checkStagesOf(plan, localInferenceProvider);
    expect(stages).toEqual(['translation']);
    expect(checkStagesOf(plan, edgeProvider)).toEqual(['speech']);
    expect(checkStagesOf(plan, sonioxProvider)).toEqual(['transcription']);
    expect(await check(localInferenceProvider)).toMatchObject({ state: 'not-ready', code: 'local_models_missing' });
    expect(await check(sonioxProvider)).toMatchObject({ state: 'not-ready', code: 'credentials_missing', params: { provider: 'soniox' } });
  });
});

describe("Kizuna AI's Soniox transcribing for another translator", () => {
  const providers = [kizunaSonioxProvider, sonioxProvider, localInferenceProvider, bingProvider, edgeProvider] as AnyProvider[];
  const settings = (id: string) => providers.find((p) => p.id === id)!.settings.defaults;
  const planOf = (of: ReturnType<typeof lineUp>) => compose(of, { providers, settings }) as RunPlan;
  const accounts = Object.fromEntries(providers.map((p) => [p.id, { settings: p.settings.defaults, credentials: {} }]));
  const known = (balanceMicroUsd: number) => ({ status: 'known' as const, balanceMicroUsd, frozen: false });
  const floorOf = (plan: RunPlan, textOnly = false) => kizunaSonioxMinimumBalance({ plan, legs: ['speaker'], textOnly, participantSpeech: false }, kizunaSonioxProvider.settings.defaults as never);

  it('composes with Bing or a model of this device, read by Edge, by this device, or by its own voice', () => {
    for (const translation of ['bing', 'local_inference']) {
      for (const speech of ['edge', 'local_inference', 'kizunaai_soniox', 'soniox']) {
        const plan = planOf(lineUp('kizunaai_soniox', translation, speech));
        expect('refused' in plan, `${translation}+${speech}`).toBe(false);
        expect(plan.byStage.transcription.unit.id).toBe('transcription');
        expect(plan.byStage.translation.unit.id).toBe('translation');
      }
    }
  });

  it('the floor is the text-only one with another voice, and the speaking one when its own voice reads', () => {
    const text = sonioxRolesFloorMicroUsd(['spk_stt']);
    expect(floorOf(planOf(lineUp('kizunaai_soniox', 'bing', 'edge')))).toBe(text);
    expect(floorOf(planOf(lineUp('kizunaai_soniox', 'local_inference', 'local_inference')))).toBe(text);
    // The same as its own translation read by another voice, and less than a session that speaks.
    expect(floorOf(planOf(lineUp('kizunaai_soniox', 'kizunaai_soniox', 'edge')))).toBe(text);
    const speaking = floorOf(planOf(lineUp('kizunaai_soniox', 'bing', 'kizunaai_soniox')));
    expect(speaking).toBe(sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts']));
    expect(speaking).toBeGreaterThan(text);
  });

  it('the gate holds the wallet to that floor, and refuses nothing above it', () => {
    const plan = planOf(lineUp('kizunaai_soniox', 'bing', 'edge'));
    const text = sonioxRolesFloorMicroUsd(['spk_stt']);
    const input = { plan, accounts, pair: { source: 'en', target: 'ja' }, legs: ['speaker'] as const, turnMode: 'auto' as const, textOnly: false, participantSpeech: false, lineUp: { transcription: 'kizunaai_soniox', translation: 'bing', speech: 'edge' } };
    expect(balanceRefusal({ ...input, account: known(text - 1) })).toMatchObject({ code: 'balance_below_floor' });
    expect(balanceRefusal({ ...input, account: known(text) })).toBeNull();
    expect(gate({ ...input, account: known(text) }, 'electron')).toBeNull();
    expect(gate({ ...input, account: known(text - 1) }, 'electron')).toMatchObject({ code: 'balance_below_floor' });
    // The pair is judged before the wallet.
    expect(gate({ ...input, pair: { source: 'auto', target: 'ja' }, account: known(text - 1) }, 'electron')).toMatchObject({ code: 'lineup_source_not_fixed', params: { provider: 'bing' } });
  });

  it('signed out, the start is refused for the sign-in, naming Kizuna AI\'s Soniox', async () => {
    useLineUpStore.setState({ lineUp: lineUp('kizunaai_soniox', 'bing', 'edge'), stored: true, unstoredProvider: null, locked: false });
    await useProviderStore.getState().load(kizunaSonioxProvider);
    await useProviderStore.getState().load(bingProvider);
    await useProviderStore.getState().load(edgeProvider);
    const plan = planOf(lineUp('kizunaai_soniox', 'bing', 'edge'));
    const entries = useProviderStore.getState().entries;
    const shape = {
      plan, accounts: { kizunaai_soniox: entries.kizunaai_soniox, bing: entries.bing, edge: entries.edge },
      lineUp: { transcription: 'kizunaai_soniox', translation: 'bing', speech: 'edge' }, lineUpStored: true,
      pair: { source: 'en', target: 'ja' }, legs: ['speaker'] as const, turnMode: 'auto' as const, textOnly: false, participantSpeech: false,
      keepReplayAudio: false, shared: {} as never, auth,
    };
    const signal = new AbortController().signal;
    expect(await ensureReadyFromStores(kizunaSonioxProvider as AnyProvider, shape as never, signal)).toMatchObject({ state: 'not-ready', code: 'sign_in_required', params: { provider: 'kizunaai_soniox' } });
    expect(await ensureReadyFromStores(edgeProvider as AnyProvider, shape as never, signal)).toMatchObject({ state: 'ready' });
  });
});
