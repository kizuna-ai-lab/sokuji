// src/lib/plan/read.test.ts
import { describe, expect, it } from 'vitest';
import { RUN_STAGES } from '../lineup/types';
import { accountOf, capabilitiesOf, providersIn, transcriptionAccount, transcriptionProvider, unitFor } from './read';
import { planOf, stubProvider } from './testing';
import type { PlannedUnit, RunPlan } from './types';

describe('reading a plan', () => {
  it('names each provider once, in unit order, the unit of each stage, and the transcribing provider', () => {
    const local = stubProvider('local_inference');
    const soniox = stubProvider('soniox');
    const text: PlannedUnit = { ...planOf(soniox).units[0], stages: ['transcription', 'translation'] };
    const voice: PlannedUnit = { ...planOf(local).units[0], stages: ['speech'] };
    const plan: RunPlan = { units: [text, voice], byStage: { transcription: text, translation: text, speech: voice } };
    expect(providersIn(plan)).toEqual([soniox, local]);
    expect(providersIn(planOf(soniox))).toEqual([soniox]);
    expect(RUN_STAGES.map((stage) => unitFor(plan, stage))).toEqual([text, text, voice]);
    expect(transcriptionProvider(plan)).toBe(soniox);
  });

  it("answers a provider's account as the run froze it, and throws for a provider not in the plan", () => {
    const account = { settings: { region: 'eu' }, credentials: { apiKey: 'k' } };
    const shape = { accounts: { soniox: account } };
    expect(accountOf(shape, stubProvider('soniox'))).toBe(account);
    expect(() => accountOf(shape, stubProvider('openai'))).toThrow(/openai/);
  });

  it("answers the transcribing provider's account, whatever else the accounts hold", () => {
    const local = stubProvider('local_inference');
    const soniox = stubProvider('soniox');
    const text: PlannedUnit = { ...planOf(soniox).units[0], stages: ['transcription', 'translation'] };
    const voice: PlannedUnit = { ...planOf(local).units[0], stages: ['speech'] };
    const plan: RunPlan = { units: [voice, text], byStage: { transcription: text, translation: text, speech: voice } };
    const heard = { pair: { source: 'ja', target: 'en' } };
    const spoken = { pair: { source: 'en', target: 'ja' } };
    expect(transcriptionAccount({ plan, accounts: { local_inference: spoken, soniox: heard } })).toBe(heard);
    expect(transcriptionAccount({ plan: planOf(local), accounts: { local_inference: spoken, soniox: heard } })).toBe(spoken);
  });

  it('throws when the transcribing provider has no account', () => {
    const accounts = { openai: { pair: { source: 'ja', target: 'en' } } };
    expect(() => transcriptionAccount({ plan: planOf(stubProvider('soniox')), accounts })).toThrow(/soniox/);
  });

  it("asks a stage's unit for its capabilities under its own provider's settings", () => {
    const local = stubProvider('local_inference', { speech: 'always', turns: (s: { manual: boolean }) => (s.manual ? ['manual'] : ['auto']) });
    const soniox = stubProvider('soniox', { turns: (s: { manual: boolean }) => (s.manual ? ['auto', 'manual'] : ['auto']) });
    const text: PlannedUnit = { ...planOf(soniox).units[0], stages: ['transcription', 'translation'] };
    const voice: PlannedUnit = { ...planOf(local).units[0], stages: ['speech'] };
    const shape = {
      plan: { units: [text, voice], byStage: { transcription: text, translation: text, speech: voice } },
      accounts: { soniox: { settings: { manual: true }, credentials: {} }, local_inference: { settings: { manual: false }, credentials: {} } },
    };
    expect(capabilitiesOf(shape, 'transcription').turns).toEqual(['auto', 'manual']);
    expect(capabilitiesOf(shape, 'speech').speech).toBe('always');
    expect(capabilitiesOf(shape, 'speech').turns).toEqual(['auto']);
  });
});

describe('whether a plan asks a provider for speech', () => {
  it('is true of the provider whose unit serves the speech stage, and of no other', async () => {
    const { servesSpeech } = await import('./read');
    const { stubProvider, stubTextUnit, stubSpeechUnit, textAndSpeechPlan } = await import('./testing');
    const { wholePlan } = await import('./wholeUnit');
    const plan = textAndSpeechPlan(stubTextUnit().planned, stubSpeechUnit().planned);
    expect(servesSpeech(plan, { id: 'stub_voice' })).toBe(true);
    expect(servesSpeech(plan, { id: 'stub_text' })).toBe(false);
    const alone = stubProvider('alone');
    expect(servesSpeech(wholePlan(alone), alone)).toBe(true);
    expect(servesSpeech(wholePlan(alone), { id: 'elsewhere' })).toBe(false);
  });
});

describe('whether a plan asks a provider to transcribe', () => {
  it('is true of the provider whose unit serves the transcription stage, and of no other', async () => {
    const { servesTranscription } = await import('./read');
    const { stubProvider, stubTextUnit, stubSpeechUnit, textAndSpeechPlan } = await import('./testing');
    const { wholePlan } = await import('./wholeUnit');
    const plan = textAndSpeechPlan(stubTextUnit().planned, stubSpeechUnit().planned);
    expect(servesTranscription(plan, { id: 'stub_text' })).toBe(true);
    expect(servesTranscription(plan, { id: 'stub_voice' })).toBe(false);
    const alone = stubProvider('alone');
    expect(servesTranscription(wholePlan(alone), alone)).toBe(true);
    expect(servesTranscription(wholePlan(alone), { id: 'elsewhere' })).toBe(false);
  });
});
