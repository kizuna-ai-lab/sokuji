// src/lib/plan/compose.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CAPS, caps } from '../lineup/catalog';
import { oldRunOf } from '../lineup/oldRules.testing';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, RunStage } from '../lineup/types';
import { compose } from './compose';
import type { ComposeInput } from './compose';
import type { AnyProvider } from '../provider/types';
import { planOf, stubHosts, stubProvider } from './testing';
import { isRefusal } from './types';
import type { PlanRefusal, PlanRefusalCode, RunPlan } from './types';
import { wholeUnit } from './wholeUnit';

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
  // Providers of one unit each: Soniox has none here for transcription beside its voice alone.
  ['Soniox transcribes, Bing translates, on a provider whose one unit serves everything', { transcription: 'soniox', translation: 'bing', speech: 'soniox' }, 'lineup_no_unit', 'transcription'],
  ["Soniox's translation without its transcription", { transcription: 'local_inference', translation: 'soniox', speech: 'soniox' }, 'lineup_translation_bound', 'transcription'],
  ["Soniox's translation without its transcription, said before the other host's units are looked at", { transcription: 'local_inference', translation: 'soniox', speech: 'edge' }, 'lineup_translation_bound', 'transcription'],
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
    // A catalog in which Soniox holds transcription and translation jointly, as it did before they could be chosen apart.
    const jointSoniox = CAPS.map((c) => (c.id === 'soniox' ? { ...c, translatesOwn: false, joint: ['transcription', 'translation'] as RunStage[] } : c));
    const shape = (got: RunPlan | PlanRefusal) => (isRefusal(got) ? got : got.units.map((u) => [u.provider.id, u.unit.id, u.stages]));

    it.each([
      ['Soniox on all three: its text unit and its voice', all('soniox'), on('soniox', [text, voice]), [['soniox', 'stt', ['transcription', 'translation']], ['soniox', 'tts', ['speech']]]],
      ["Kizuna AI's Soniox on all three: the same two", all('kizunaai_soniox'), on('kizunaai_soniox', [voice, text]), [['kizunaai_soniox', 'stt', ['transcription', 'translation']], ['kizunaai_soniox', 'tts', ['speech']]]],
      ['a unit for all three is taken before any split', all('soniox'), on('soniox', [text, voice, whole]), [['soniox', 'whole', RUN_STAGES]]],
      ['no voice: no split serves, and the host has no unit', all('soniox'), on('soniox', [text]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['no text unit: the same', all('soniox'), on('soniox', [voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['units for single stages are not a split of the joint group', all('soniox'), on('soniox', [tr, tl, voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['an end-to-end provider is never split: its stages go together', all('openai'), on('openai', [text, voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['a host with no joint stages is covered by several of its units, each stage once', all('local_inference'), on('local_inference', [text, voice]), [['local_inference', 'stt', ['transcription', 'translation']], ['local_inference', 'tts', ['speech']]]],
      ['three units of one host, where no fewer serve', all('local_inference'), on('local_inference', [tr, tl, voice]), [['local_inference', 'tr', ['transcription']], ['local_inference', 'tl', ['translation']], ['local_inference', 'tts', ['speech']]]],
      ['fewest units first: two before three', all('local_inference'), on('local_inference', [tr, tl, voice, text]), [['local_inference', 'stt', ['transcription', 'translation']], ['local_inference', 'tts', ['speech']]]],
      ['a stage no unit covers: no cover, and the host has no unit', all('local_inference'), on('local_inference', [tr, voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ["Soniox's translation is bound to its transcription: units for the single stages are no cover of it", all('kizunaai_soniox'), on('kizunaai_soniox', [tr, tl, voice]), { refused: 'lineup_no_unit', stage: 'transcription' }],
      ['the joint group alone is asked of one unit, as before', { transcription: 'soniox', translation: 'soniox', speech: 'edge' }, on('soniox', [text, voice]), { refused: 'lineup_no_unit', stage: 'speech' }],
      ['part of a joint group is still a split stage, whatever units the host has', { transcription: 'soniox', translation: 'bing', speech: 'soniox' }, { ...on('soniox', [text, tr, voice]), catalog: jointSoniox }, { refused: 'lineup_stage_split', stage: 'translation' }],
      ['an end-to-end provider given two stages is asked for one unit, never a cut', { transcription: 'openai', translation: 'openai', speech: 'soniox' }, { ...on('openai', [tr, tl, voice]), providers: [stubProvider('openai', { units: [tr, tl, voice] }), stubProvider('soniox', { units: [text, tr, voice] })] }, { refused: 'lineup_stage_split', stage: 'speech' }],
    ] as Array<[string, Pick<LineUp, RunStage>, ComposeInput, unknown]>)('%s', (_name, lineUp, given, expected) => {
      expect(shape(compose(lineUp, given))).toEqual(expected);
    });

    describe('the local host, with a unit that is the whole of it, a translation unit and a voice; Soniox with its three units', () => {
      const speech = occupying('speech', 'speech');
      const translation = occupying('translation', 'translation');
      const local = stubProvider('local_inference');
      const localUnits = [wholeUnit(local), translation, speech];
      const given: ComposeInput = { providers: [stubProvider('soniox', { units: [text, tr, voice] }), { ...local, units: localUnits } as AnyProvider], settings: () => undefined };

      it.each([
        ['all on this device: the whole unit', all('local_inference'), [['local_inference', 'whole', RUN_STAGES]]],
        ['Bing and Edge are the local host: the whole unit', { transcription: 'local_inference', translation: 'bing', speech: 'edge' }, [['local_inference', 'whole', RUN_STAGES]]],
        ['a local translation model and Edge: the whole unit', { transcription: 'local_inference', translation: 'local_inference', speech: 'edge' }, [['local_inference', 'whole', RUN_STAGES]]],
        ['Bing and a local voice: the whole unit', { transcription: 'local_inference', translation: 'bing', speech: 'local_inference' }, [['local_inference', 'whole', RUN_STAGES]]],
        ["Edge reads Soniox's text: the voice alone", { transcription: 'soniox', translation: 'soniox', speech: 'edge' }, [['soniox', 'stt', ['transcription', 'translation']], ['local_inference', 'speech', ['speech']]]],
        ["a local voice reads Soniox's text: the voice alone", { transcription: 'soniox', translation: 'soniox', speech: 'local_inference' }, [['soniox', 'stt', ['transcription', 'translation']], ['local_inference', 'speech', ['speech']]]],
        ['Soniox transcribes, Bing translates, Edge speaks: three units, two of them this device\'s', { transcription: 'soniox', translation: 'bing', speech: 'edge' }, [['soniox', 'tr', ['transcription']], ['local_inference', 'translation', ['translation']], ['local_inference', 'speech', ['speech']]]],
        ['Soniox transcribes, a local model translates, a local voice speaks: the same three', { transcription: 'soniox', translation: 'local_inference', speech: 'local_inference' }, [['soniox', 'tr', ['transcription']], ['local_inference', 'translation', ['translation']], ['local_inference', 'speech', ['speech']]]],
        ["Soniox transcribes and speaks, Bing translates between: Soniox's two units around this device's, in stage order", { transcription: 'soniox', translation: 'bing', speech: 'soniox' }, [['soniox', 'tr', ['transcription']], ['local_inference', 'translation', ['translation']], ['soniox', 'tts', ['speech']]]],
        ['this device transcribes and translates: the whole unit, never its translation unit, whoever speaks', { transcription: 'local_inference', translation: 'bing', speech: 'soniox' }, [['local_inference', 'whole', ['transcription', 'translation']], ['soniox', 'tts', ['speech']]]],
        ["Soniox's translation needs Soniox's transcription", { transcription: 'local_inference', translation: 'soniox', speech: 'edge' }, { refused: 'lineup_translation_bound', stage: 'transcription', provider: 'soniox' }],
        ['this device has no unit that transcribes alone', { transcription: 'local_inference', translation: 'soniox', speech: 'soniox' }, { refused: 'lineup_translation_bound', stage: 'transcription', provider: 'soniox' }],
      ] as Array<[string, Pick<LineUp, RunStage>, unknown]>)('%s', (_name, lineUp, expected) => {
        expect(shape(compose(lineUp, given))).toEqual(expected);
      });

      it('an all-local line-up is the plan of the provider alone, on the very unit it declares', () => {
        const plan = compose(all('local_inference'), given) as RunPlan;
        expect(plan.units).toHaveLength(1);
        expect(plan.units[0].unit).toBe(localUnits[0]);
        expect(RUN_STAGES.map((stage) => plan.byStage[stage])).toEqual([plan.units[0], plan.units[0], plan.units[0]]);
      });
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
