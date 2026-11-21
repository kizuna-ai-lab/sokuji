// src/lib/plan/checks.test.ts
import { describe, expect, it } from 'vitest';
import { CAPS, caps } from '../lineup/catalog';
import type { LineUp, RunStage } from '../lineup/types';
import { checkPlan, refusalNotice, twoManaged, voiceRefusal } from './checks';
import { compose } from './compose';
import type { ComposeInput } from './compose';
import { stubProvider, textAndSpeechPlan } from './testing';
import { isRefusal, PLAN_REFUSAL_CODES } from './types';
import type { PlannedUnit, RunPlan, UnitCapabilities } from './types';
import { wholePlan } from './wholeUnit';

const options = (transcription: string, speech: string) => ({ transcription: caps(transcription)!, translation: caps(transcription)!, speech: caps(speech)! });

describe('the catalog says which voices stand alone and which text sides take another voice', () => {
  it("a voice alone: Kizuna AI's Soniox, Soniox with an own key, Edge and this device", () => {
    expect(CAPS.filter((c) => c.voiceAlone).map((c) => c.id).sort()).toEqual(['edge', 'kizunaai_soniox', 'local_inference', 'soniox']);
  });
  it("another voice is taken by Kizuna AI's Soniox, Soniox and this device (Bing runs on this device)", () => {
    expect(CAPS.filter((c) => c.takesVoice && c.stages.includes('transcription')).map((c) => c.id).sort()).toEqual(['kizunaai_soniox', 'local_inference', 'soniox']);
  });
});

describe('a voice beside another host\'s text', () => {
  it.each([
    ['all on one provider', 'soniox', 'soniox', null],
    ['an end-to-end provider alone', 'gemini', 'gemini', null],
    ['this device with Edge: one host', 'local_inference', 'edge', null],
    ["Edge reads Kizuna AI's Soniox", 'kizunaai_soniox', 'edge', null],
    ['a local voice reads Soniox', 'soniox', 'local_inference', null],
    ["Soniox's voice reads this device's text", 'local_inference', 'soniox', null],
    ["Soniox's voice (own key) reads Kizuna AI's Soniox", 'kizunaai_soniox', 'soniox', null],
    ["Kizuna AI's Soniox voice reads Soniox with an own key", 'soniox', 'kizunaai_soniox', null],
    ["Kizuna AI's Soniox voice reads this device's text", 'local_inference', 'kizunaai_soniox', null],
    ["an end-to-end provider's voice is not offered alone", 'soniox', 'gemini', { refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'gemini' }],
    ["Kizuna AI's Qwen voice is not offered alone", 'local_inference', 'kizunaai_qwen', { refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_qwen' }],
    ['an end-to-end provider takes no other voice', 'gemini', 'edge', { refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'gemini' }],
    ["Kizuna AI's Qwen takes no other voice", 'kizunaai_qwen', 'soniox', { refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'kizunaai_qwen' }],
    ["Kizuna AI's Qwen takes no other voice, Kizuna AI's Soniox voice included: the two hosted services never run together", 'kizunaai_qwen', 'kizunaai_soniox', { refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'kizunaai_qwen' }],
    ["an end-to-end provider takes no other voice, Kizuna AI's Soniox voice included", 'openai', 'kizunaai_soniox', { refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'openai' }],
    ['the voice is judged first', 'openai', 'gemini', { refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'gemini' }],
  ] as const)('%s', (_name, transcription, speech, expected) => {
    expect(voiceRefusal(options(transcription, speech))).toEqual(expected);
  });
});

const planned = (id: string, kind: string, stages: RunStage[]): PlannedUnit => ({ ...wholePlan(stubProvider(id, { kind })).units[0], stages });

describe('two managed providers', () => {
  it.each([
    ['one managed provider on every stage', [planned('a', 'managed', ['transcription', 'translation', 'speech'])], null],
    ["one managed provider's two units", (() => { const text = planned('a', 'managed', ['transcription', 'translation']); return [text, { ...text, stages: ['speech'] as RunStage[] }]; })(), null],
    ['a managed text side with an own-key voice', [planned('a', 'managed', ['transcription', 'translation']), planned('b', 'own-key', ['speech'])], null],
    ['two own-key providers', [planned('a', 'own-key', ['transcription', 'translation']), planned('b', 'local', ['speech'])], null],
    ['two managed providers: the stage of the second', [planned('a', 'managed', ['transcription', 'translation']), planned('b', 'managed', ['speech'])], { refused: 'lineup_two_managed', stage: 'speech' }],
  ] as Array<[string, PlannedUnit[], unknown]>)('%s', (_name, units, expected) => {
    expect(twoManaged(units)).toEqual(expected);
  });
});

describe('compose runs these checks after its own, the voice first', () => {
  const occupying = (id: string, ...stages: RunStage[]) => ({ id, occupies: (_s: unknown, want: ReadonlySet<RunStage>) => (want.size === stages.length && stages.every((st) => want.has(st)) ? stages : null) });
  const text = occupying('stt', 'transcription', 'translation');
  const voice = occupying('tts', 'speech');
  const twoUnits = (id: string, kind = 'own-key') => stubProvider(id, { kind, units: [text, voice] });
  const given = (...providers: ReturnType<typeof stubProvider>[]): ComposeInput => ({ providers, settings: () => undefined });
  const mix = (transcription: string, speech: string): Pick<LineUp, RunStage> => ({ transcription, translation: transcription, speech });

  it("Soniox's text with a voice on this device composes", () => {
    const plan = compose(mix('soniox', 'edge'), given(twoUnits('soniox'), twoUnits('local_inference', 'local'))) as RunPlan;
    expect(isRefusal(plan)).toBe(false);
    expect(plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['soniox', 'stt'], ['local_inference', 'tts']]);
  });
  it("Kizuna AI's Soniox voice under own-key Soniox text composes: the text unit of one, the voice of the other", () => {
    const plan = compose(mix('soniox', 'kizunaai_soniox'), given(twoUnits('soniox'), twoUnits('kizunaai_soniox', 'managed'))) as RunPlan;
    expect(isRefusal(plan)).toBe(false);
    expect(plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([['soniox', 'stt', ['transcription', 'translation']], ['kizunaai_soniox', 'tts', ['speech']]]);
  });
  it("the same line-up is refused under a catalog whose option does not offer that voice alone, though its units would serve: the composer reads the option, nothing else", () => {
    const catalog = CAPS.map((c) => (c.id === 'kizunaai_soniox' ? { ...c, voiceAlone: false } : c));
    expect(compose(mix('soniox', 'kizunaai_soniox'), { ...given(twoUnits('soniox'), twoUnits('kizunaai_soniox', 'managed')), catalog }))
      .toEqual({ refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_soniox' });
    // An id the given catalog does not hold is a stage left unset, as with the app's own.
    expect(compose(mix('soniox', 'kizunaai_soniox'), { ...given(twoUnits('soniox')), catalog: catalog.filter((c) => c.id !== 'kizunaai_soniox') }))
      .toEqual({ refused: 'lineup_incomplete', stage: 'speech' });
  });
  it("Kizuna AI's Qwen text with Kizuna AI's Soniox voice is refused before the two managed providers are counted: Qwen takes no other voice", () => {
    expect(compose(mix('kizunaai_qwen', 'kizunaai_soniox'), given(stubProvider('kizunaai_qwen', { kind: 'managed' }), twoUnits('kizunaai_soniox', 'managed'))))
      .toEqual({ refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'kizunaai_qwen' });
  });
  it('an end-to-end text side with Edge is refused: it takes no other voice', () => {
    expect(compose(mix('gemini', 'edge'), given(stubProvider('gemini'), twoUnits('local_inference', 'local'))))
      .toEqual({ refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'gemini' });
  });
  it('a stage with no unit is said before the voice', () => {
    // Gemini has no unit for speech alone: that is the first reason.
    expect(compose(mix('soniox', 'gemini'), given(twoUnits('soniox'), stubProvider('gemini')))).toMatchObject({ refused: 'lineup_stage_split' });
  });
  it('two managed providers are refused at the stage of the second', () => {
    expect(compose(mix('soniox', 'local_inference'), given(twoUnits('soniox', 'managed'), twoUnits('local_inference', 'managed'))))
      .toEqual({ refused: 'lineup_two_managed', stage: 'speech' });
  });
  it('a line-up all on one managed host is never refused by these', () => {
    expect(isRefusal(compose(mix('kizunaai_soniox', 'kizunaai_soniox'), given(twoUnits('kizunaai_soniox', 'managed'))))).toBe(false);
    expect(isRefusal(compose(mix('kizunaai_qwen', 'kizunaai_qwen'), given(stubProvider('kizunaai_qwen', { kind: 'managed' }))))).toBe(false);
  });
});

describe('the checks that need the run', () => {
  const speaking = (speaks?: UnitCapabilities['speaks']) => {
    const textUnit = { ...wholePlan(stubProvider('soniox')).units[0], stages: ['transcription', 'translation'] as RunStage[] };
    const [whole] = wholePlan(stubProvider('local_inference')).units;
    const speech: PlannedUnit = { ...whole, unit: { ...whole.unit, capabilities: (s) => ({ ...whole.unit.capabilities(s), ...(speaks ? { speaks } : {}) }) }, stages: ['speech'] };
    return textAndSpeechPlan(textUnit, speech);
  };
  const accounts = { soniox: { settings: undefined }, local_inference: { settings: undefined } };
  const onlyEnglish = (language: string) => language === 'en';
  const leg = (source: string, target: string, speech = true) => ({ direction: { source, target }, speech });

  it.each([
    ['the speaker leg is read in a language the voice has', { speaker: leg('ja', 'en') }, null],
    ['the speaker leg is read in a language the voice lacks', { speaker: leg('en', 'ja') }, { refused: 'lineup_language_not_spoken', stage: 'speech', provider: 'local_inference', language: 'ja' }],
    ['a leg that is not read aloud is not judged', { speaker: leg('en', 'ja', false) }, null],
    ['the participant leg is judged by its own target', { speaker: leg('ja', 'en'), participant: leg('en', 'ja') }, { refused: 'lineup_language_not_spoken', stage: 'speech', provider: 'local_inference', language: 'ja' }],
    ['the participant leg not read aloud', { speaker: leg('ja', 'en'), participant: leg('en', 'ja', false) }, null],
    ['no leg', {}, null],
  ] as Array<[string, Parameters<typeof checkPlan>[1]['contexts'], unknown]>)('%s', (_name, contexts, expected) => {
    expect(checkPlan(speaking(onlyEnglish), { accounts, contexts })).toEqual(expected);
  });

  it('a unit that does not say what it speaks is never refused: it speaks what its provider translates into', () => {
    expect(checkPlan(speaking(), { accounts, contexts: { speaker: leg('en', 'xx') } })).toBeNull();
    expect(checkPlan(wholePlan(stubProvider('openai')), { accounts: { openai: { settings: undefined } }, contexts: { speaker: leg('en', 'xx') } })).toBeNull();
  });

  it("names the line-up's option for speech, and asks the unit under its provider's settings", () => {
    const asked: unknown[][] = [];
    const settings = { of: 'local' };
    const [whole] = speaking().units.slice(1);
    const speech: PlannedUnit = { ...whole, unit: { ...whole.unit, capabilities: (s) => ({ ...whole.unit.capabilities(s), speaks: (language) => { asked.push([s, language]); return false; } }) } };
    const plan = textAndSpeechPlan(speaking().units[0], speech);
    expect(checkPlan(plan, { accounts: { ...accounts, local_inference: { settings } }, contexts: { speaker: leg('en', 'ja') }, lineUp: { speech: 'edge' } }))
      .toEqual({ refused: 'lineup_language_not_spoken', stage: 'speech', provider: 'edge', language: 'ja' });
    expect(asked).toEqual([[settings, 'ja']]);
  });

  it('asks the unit on its own capabilities, so a unit may read them through `this`', () => {
    const [whole] = speaking().units.slice(1);
    const own = { ...whole.unit.capabilities(undefined), voices: ['en'], speaks(this: { voices: string[] }, language: string) { return this.voices.includes(language); } };
    const speech: PlannedUnit = { ...whole, unit: { ...whole.unit, capabilities: () => own as UnitCapabilities } };
    const plan = textAndSpeechPlan(speaking().units[0], speech);
    expect(checkPlan(plan, { accounts, contexts: { speaker: leg('ja', 'en') } })).toBeNull();
    expect(checkPlan(plan, { accounts, contexts: { speaker: leg('en', 'ja') } })).toMatchObject({ refused: 'lineup_language_not_spoken', language: 'ja' });
  });

  it("judges nothing while the speech provider's account has not loaded: the unit is not asked without its settings", () => {
    let asked = 0;
    const [whole] = speaking().units.slice(1);
    const speech: PlannedUnit = { ...whole, unit: { ...whole.unit, capabilities: (s) => { asked += 1; return { ...whole.unit.capabilities(s), speaks: () => false }; } } };
    const plan = textAndSpeechPlan(speaking().units[0], speech);
    expect(checkPlan(plan, { accounts: { soniox: { settings: undefined } }, contexts: { speaker: leg('en', 'ja') } })).toBeNull();
    expect(asked).toBe(0);
  });
});

describe('a refusal as a notice', () => {
  const kizuna = stubProvider('kizunaai_soniox', { kind: 'managed', vendor: 'Soniox' });
  const soniox = stubProvider('soniox', { kind: 'own-key', vendor: 'Soniox' });

  it('has a sentence for every code', () => {
    for (const refused of PLAN_REFUSAL_CODES) {
      const notice = refusalNotice({ refused, stage: 'speech', provider: 'soniox', language: 'ja' });
      expect(notice.code).toBe(refused);
      expect(notice.message.length).toBeGreaterThan(10);
    }
  });
  it('carries the stage, the option, a managed option\'s engine, and the language', () => {
    expect(refusalNotice({ refused: 'lineup_incomplete', stage: 'speech' })).toEqual({ code: 'lineup_incomplete', message: 'The line-up names no provider for speech.', params: { stage: 'speech' } });
    expect(refusalNotice({ refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_soniox' }, null, [kizuna, soniox]).params)
      .toEqual({ stage: 'speech', provider: 'kizunaai_soniox', vendor: 'Soniox' });
    expect(refusalNotice({ refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'soniox' }, null, [kizuna, soniox]).params).toEqual({ stage: 'speech', provider: 'soniox' });
    expect(refusalNotice({ refused: 'lineup_language_not_spoken', stage: 'speech', provider: 'edge', language: 'eu' }).params).toEqual({ stage: 'speech', provider: 'edge', language: 'eu' });
  });
  it('names the option a stage with no unit was given to, and the option whose joint stages were split', () => {
    expect(refusalNotice({ refused: 'lineup_no_unit', stage: 'speech' }, { transcription: 'soniox', translation: 'soniox', speech: 'gemini' }).params).toEqual({ stage: 'speech', provider: 'gemini' });
    expect(refusalNotice({ refused: 'lineup_stage_split', stage: 'translation' }, { transcription: 'soniox', translation: 'bing', speech: 'soniox' }).params).toEqual({ stage: 'translation', provider: 'soniox' });
    expect(refusalNotice({ refused: 'lineup_stage_split', stage: 'transcription' }, { transcription: 'openai', translation: 'openai', speech: 'gemini' }).params).toEqual({ stage: 'transcription', provider: 'gemini' });
    expect(refusalNotice({ refused: 'lineup_stage_split', stage: 'transcription' }).params).toEqual({ stage: 'transcription' });
  });
});
