// src/lib/plan/compose.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CAPS, caps } from '../lineup/catalog';
import { oldRunOf } from '../lineup/oldRules.testing';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, RunStage } from '../lineup/types';
import { compose } from './compose';
import type { ComposeInput } from './compose';
import { planOf, stubHosts, stubProvider } from './testing';
import { isRefusal } from './types';
import type { PlanRefusal, PlanRefusalCode, RunPlan } from './types';

const all = (id: string): Pick<LineUp, RunStage> => ({ transcription: id, translation: id, speech: id });

// palabraai is left out: the build does not offer it.
const offered = ['openai', 'soniox', 'local_inference', 'gemini'].map((id) => stubProvider(id));
const input: ComposeInput = { providers: offered, settings: () => undefined };

const cases: Array<[string, Pick<LineUp, RunStage>, 'ok' | PlanRefusalCode, RunStage?]> = [
  ['one end-to-end provider', all('openai'), 'ok'],
  ['Soniox on all three', all('soniox'), 'ok'],
  ['local with Bing and Edge', { transcription: 'local_inference', translation: 'bing', speech: 'edge' }, 'ok'],
  ['local with its own models', all('local_inference'), 'ok'],
  ['a stage unset', { ...all('soniox'), speech: null }, 'lineup_incomplete', 'speech'],
  ['an unknown id', { ...all('soniox'), speech: 'nope' }, 'lineup_incomplete', 'speech'],
  ['Bing asked to transcribe', { ...all('local_inference'), transcription: 'bing' }, 'lineup_incomplete', 'transcription'],
  ['a provider this build does not offer', all('palabraai'), 'lineup_not_offered', 'transcription'],
  ['a stage unset beside one not offered: the unset stage first', { ...all('palabraai'), speech: null }, 'lineup_incomplete', 'speech'],
  ['Soniox text with Edge speech', { transcription: 'soniox', translation: 'soniox', speech: 'edge' }, 'lineup_no_unit', 'speech'],
  ['Soniox transcribes, Bing translates', { transcription: 'soniox', translation: 'bing', speech: 'soniox' }, 'lineup_stage_split', 'translation'],
  ['two end-to-end providers', { transcription: 'openai', translation: 'openai', speech: 'gemini' }, 'lineup_stage_split', 'transcription'],
];

describe('compose', () => {
  it.each(cases)('%s', (_name, lineUp, expected, stage) => {
    const got = compose(lineUp, input);
    if (expected !== 'ok') {
      expect(got).toMatchObject({ refused: expected, stage });
      return;
    }
    expect(isRefusal(got)).toBe(false);
    const plan = got as RunPlan;
    const host = caps(lineUp.transcription!)!.host;
    expect(plan.units).toHaveLength(1);
    expect(plan.byStage.transcription).toBe(plan.byStage.speech);
    expect(plan.units[0].provider.id).toBe(host);
    expect(plan).toEqual(planOf(offered.find((p) => p.id === host)!));
  });

  it('names the first stage of the host that could not serve its stages, not of another host', () => {
    // A local provider that always speaks has no unit for recognition and translation alone; Soniox can speak alone.
    const speaking: ComposeInput = { providers: offered.map((p) => (p.id === 'local_inference' ? stubProvider('local_inference', { speech: 'always' }) : p)), settings: () => undefined };
    expect(compose({ transcription: 'local_inference', translation: 'local_inference', speech: 'soniox' }, speaking)).toEqual({ refused: 'lineup_no_unit', stage: 'transcription' });
  });

  it('names the option whose provider this build does not offer', () =>
    expect(compose(all('palabraai'), input)).toEqual({ refused: 'lineup_not_offered', stage: 'transcription', provider: 'palabraai' }));

  it("takes the first of the host's units that occupies exactly the stages asked, asking with the host's settings", () => {
    const part = { id: 'part', occupies: vi.fn(() => ['transcription']) };
    const whole = { id: 'whole', occupies: vi.fn(() => RUN_STAGES) };
    const soniox = stubProvider('soniox', { units: [part, whole] });
    const settings = { of: 'soniox' };
    const plan = compose(all('soniox'), { providers: [soniox], settings: (id) => (id === 'soniox' ? settings : undefined) }) as RunPlan;
    expect(part.occupies).toHaveBeenCalledWith(settings, new Set(RUN_STAGES));
    expect(plan.byStage.speech.unit).toBe(whole);
  });

  describe('a host whose stages no single unit serves', () => {
    const occupying = (id: string, ...stages: RunStage[]) => ({ id, occupies: (_s: unknown, want: ReadonlySet<RunStage>) => (want.size === stages.length && stages.every((st) => want.has(st)) ? stages : null) });
    const text = occupying('stt', 'transcription', 'translation');
    const voice = occupying('tts', 'speech');
    const tr = occupying('tr', 'transcription');
    const tl = occupying('tl', 'translation');
    const whole = occupying('whole', ...RUN_STAGES);
    const on = (id: string, units: unknown[]): ComposeInput => ({ providers: [stubProvider(id, { units }), ...offered.filter((p) => p.id !== id)], settings: () => undefined });
    const shape = (got: RunPlan | PlanRefusal) => (isRefusal(got) ? got : got.units.map((u) => [u.provider.id, u.unit.id, u.stages]));

    it.each([
      ['Soniox on all three: its text unit and its voice', all('soniox'), on('soniox', [text, voice]), [['soniox', 'stt', ['transcription', 'translation']], ['soniox', 'tts', ['speech']]]],
      ["Kizuna AI's Soniox on all three: the same two", all('kizunaai_soniox'), on('kizunaai_soniox', [voice, text]), [['kizunaai_soniox', 'stt', ['transcription', 'translation']], ['kizunaai_soniox', 'tts', ['speech']]]],
      ['a unit for all three is taken before any split', all('soniox'), on('soniox', [text, voice, whole]), [['soniox', 'whole', RUN_STAGES]]],
      ['no voice: no split serves, and the host has no unit', all('soniox'), on('soniox', [text]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['no text unit: the same', all('soniox'), on('soniox', [voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['units for single stages are not a split of the joint group', all('soniox'), on('soniox', [tr, tl, voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['an end-to-end provider is never split: its stages go together', all('openai'), on('openai', [text, voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['a host with no joint stages is not split', all('local_inference'), on('local_inference', [text, voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['the joint group alone is asked of one unit, as before', { transcription: 'soniox', translation: 'soniox', speech: 'edge' }, on('soniox', [text, voice]), { refused: 'lineup_no_unit', stage: 'speech' }],
      ['part of the joint group is still a split stage', { transcription: 'soniox', translation: 'bing', speech: 'soniox' }, on('soniox', [text, voice]), { refused: 'lineup_stage_split', stage: 'translation' }],
    ] as Array<[string, Pick<LineUp, RunStage>, ComposeInput, unknown]>)('%s', (_name, lineUp, given, expected) => {
      expect(shape(compose(lineUp, given))).toEqual(expected);
    });

    it('is the plan of the provider alone, each stage on its unit', () => {
      const soniox = stubProvider('soniox', { units: [text, voice] });
      const plan = compose(all('soniox'), { providers: [soniox], settings: () => undefined }) as RunPlan;
      expect(plan).toEqual(planOf(soniox));
      expect(RUN_STAGES.map((stage) => plan.byStage[stage].unit.id)).toEqual(['stt', 'stt', 'tts']);
      expect(plan.byStage.transcription).toBe(plan.byStage.translation);
      expect(plan.units).toEqual([plan.byStage.transcription, plan.byStage.speech]);
    });
  });

  it('does not take a unit whose answer repeats a stage: it holds fewer stages than were asked', () => {
    const repeats = { id: 'repeats', occupies: () => ['transcription', 'transcription', 'speech'] };
    expect(compose(all('soniox'), { providers: [stubProvider('soniox', { units: [repeats] })], settings: () => undefined }))
      .toEqual({ refused: 'lineup_no_unit', stage: 'transcription' });
  });

  it.each(['optional', 'always'] as const)('runs exactly the line-ups the old rule ran, on the same provider, with every provider\'s speech %s', (speech) => {
    const allPresent = stubHosts({ speech });
    for (const t of CAPS) for (const tl of CAPS) for (const s of CAPS) {
      const l = { transcription: t.id, translation: tl.id, speech: s.id };
      const got = compose(l, allPresent);
      const old = oldRunOf({ ...l, summarisation: null });
      expect(!isRefusal(got), JSON.stringify(l)).toBe(old.ok);
      if (old.ok && !isRefusal(got)) expect(got.units.map((u) => u.provider.id), JSON.stringify(l)).toEqual([old.provider]);
    }
  });
});
