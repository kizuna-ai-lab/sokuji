import { describe, it, expect } from 'vitest';
import { SCENARIOS, getScenario, providerFitForScenario } from './scenarios';

describe('scenario presets', () => {
  it('enumerates every meaningful mode × textOnly × other side combination exactly once', () => {
    const combos = SCENARIOS.map((s) => `${s.mode}:${s.textOnly}:${s.otherSide ?? 'meeting'}`);
    // participant is text-only by construction (the leg never speaks), so it
    // appears once; speaker and both appear with both toggle values, and both
    // again with the other side beside me.
    expect(combos.sort()).toEqual([
      'both:false:beside', 'both:false:meeting', 'both:true:beside', 'both:true:meeting',
      'participant:true:meeting', 'speaker:false:meeting', 'speaker:true:meeting',
    ]);
  });

  it('pins the presets the spec table lists: a mode and whether the speaker leg speaks, and nothing else — no display mode (Stage 2 session end, ruling 1)', () => {
    expect(getScenario('understand-others')).toEqual({ id: 'understand-others', mode: 'participant', textOnly: true });
    expect(getScenario('be-heard')).toEqual({ id: 'be-heard', mode: 'speaker', textOnly: false });
    expect(getScenario('subtitle-myself')).toEqual({ id: 'subtitle-myself', mode: 'speaker', textOnly: true });
    expect(getScenario('two-way-voice')).toEqual({ id: 'two-way-voice', mode: 'both', textOnly: false, participantSpeech: true });
    expect(getScenario('two-way-text')).toEqual({ id: 'two-way-text', mode: 'both', textOnly: true, participantSpeech: false });
  });
});

describe('providerFitForScenario', () => {
  const speaks = getScenario('be-heard');
  const wantsText = getScenario('subtitle-myself');
  const listens = getScenario('understand-others');

  it('rejects a text-only provider for a scenario that speaks', () => {
    expect(providerFitForScenario('always', speaks)).toEqual({ ok: false, reason: 'cannot-speak' });
    expect(providerFitForScenario('always', getScenario('two-way-voice'))).toEqual({ ok: false, reason: 'cannot-speak' });
  });

  it('rejects an always-speaking provider for a subtitles-only scenario', () => {
    expect(providerFitForScenario('never', wantsText)).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(providerFitForScenario('never', getScenario('two-way-text'))).toEqual({ ok: false, reason: 'cannot-be-text-only' });
  });

  it('accepts any provider for the listening scenario — the participant leg never speaks', () => {
    expect(providerFitForScenario('always', listens)).toEqual({ ok: true });
    expect(providerFitForScenario('never', listens)).toEqual({ ok: true });
    expect(providerFitForScenario('optional', listens)).toEqual({ ok: true });
  });

  it('accepts an optional provider in every meeting scenario, and in every scenario when it offers face-to-face', () => {
    for (const s of SCENARIOS.filter((x) => !x.otherSide)) expect(providerFitForScenario('optional', s)).toEqual({ ok: true });
    for (const s of SCENARIOS) expect(providerFitForScenario('optional', s, true)).toEqual({ ok: true });
  });
});

describe('face-to-face scenarios', () => {
  it('are Both beside me, with and without voice', () => {
    expect(getScenario('face-to-face-voice')).toEqual({ id: 'face-to-face-voice', mode: 'both', textOnly: false, otherSide: 'beside', participantSpeech: true });
    expect(getScenario('face-to-face-text')).toEqual({ id: 'face-to-face-text', mode: 'both', textOnly: true, otherSide: 'beside', participantSpeech: false });
    expect(getScenario('face-to-face-voice')).toMatchObject({ participantSpeech: true });
    expect(getScenario('face-to-face-text')).toMatchObject({ participantSpeech: false });
  });

  it('fit only a provider that offers face-to-face', () => {
    expect(providerFitForScenario('optional', getScenario('face-to-face-voice'), false)).toEqual({ ok: false, reason: 'cannot-face-to-face' });
    expect(providerFitForScenario('optional', getScenario('face-to-face-voice'), true)).toEqual({ ok: true });
    expect(providerFitForScenario('optional', getScenario('two-way-voice'), false)).toEqual({ ok: true });
  });
});
