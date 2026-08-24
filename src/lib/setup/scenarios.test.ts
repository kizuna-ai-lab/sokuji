import { describe, it, expect } from 'vitest';
import { SCENARIOS, getScenario, providerFitForScenario } from './scenarios';

describe('scenario presets', () => {
  it('enumerates every meaningful mode × textOnly combination exactly once', () => {
    const combos = SCENARIOS.map((s) => `${s.mode}:${s.textOnly}`);
    // participant is text-only by construction (the leg never speaks), so it
    // appears once; speaker and both appear with both toggle values.
    expect(combos.sort()).toEqual([
      'both:false', 'both:true', 'participant:true', 'speaker:false', 'speaker:true',
    ]);
  });

  it('pins the presets the spec table lists', () => {
    expect(getScenario('understand-others')).toMatchObject({ mode: 'participant', textOnly: true, participantDisplayMode: 'translation' });
    expect(getScenario('be-heard')).toMatchObject({ mode: 'speaker', textOnly: false, speakerDisplayMode: 'both' });
    expect(getScenario('subtitle-myself')).toMatchObject({ mode: 'speaker', textOnly: true, speakerDisplayMode: 'translation' });
    expect(getScenario('two-way-voice')).toMatchObject({ mode: 'both', textOnly: false, speakerDisplayMode: 'both', participantDisplayMode: 'both' });
    expect(getScenario('two-way-text')).toMatchObject({ mode: 'both', textOnly: true, speakerDisplayMode: 'both', participantDisplayMode: 'both' });
  });

  it('leaves the display mode of a leg the scenario does not run untouched', () => {
    expect(getScenario('understand-others').speakerDisplayMode).toBeUndefined();
    expect(getScenario('be-heard').participantDisplayMode).toBeUndefined();
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

  it('accepts an optional provider everywhere', () => {
    for (const s of SCENARIOS) expect(providerFitForScenario('optional', s)).toEqual({ ok: true });
  });
});
