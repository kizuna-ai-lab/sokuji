// src/lib/plan/choice.test.ts
import { describe, expect, it } from 'vitest';
import { allCaps } from '../lineup/catalog';
import { choose as chooseWith } from './choose';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, RunStage } from '../lineup/types';
import { RELEASED } from '../../providers/registry';
import { refusedChoice } from './choice';
import { compose, type ComposeInput } from './compose';
import { isRefusal } from './types';

// The released providers under their default settings: what the line-up page composes with before an entry loads.
const input: ComposeInput = { providers: RELEASED, settings: (id) => RELEASED.find((p) => p.id === id)?.settings.defaults };
const choose = (from: LineUp, stage: RunStage, id: string) => chooseWith(from, stage, id, input);
const lineUp = (transcription: string, translation: string, speech: string): LineUp => ({ transcription, translation, speech, summarisation: null });
const all = (id: string) => lineUp(id, id, id);
/** Every option the catalog lists for a stage. */
const optionsFor = (stage: RunStage) => allCaps().filter((c) => c.stages.includes(stage)).map((c) => c.id);
// The same, under a catalog in which Kizuna AI's Soniox voice is not offered alone: what an option whose voice
// reads only its own translation is shown as. No released option is one any more.
const notAlone: ComposeInput = { ...input, catalog: allCaps().map((c) => (c.id === 'kizunaai_soniox' ? { ...c, voiceAlone: false } : c)) };
const END_TO_END = ['gemini', 'openai_translate', 'openai_live', 'palabraai'];
// Whole-unit services whose voice reads only their own translation, while their text takes another voice (owner, 2026-11-23).
const TEXT_OPEN = ['volcengine_ast2', 'openai', 'qwen_livetranslate'];

describe("a whole-unit service whose text takes another voice (owner, 2026-11-23)", () => {
  it('runs its whole unit for the text alone beside any voice offered alone, on two units, and the voice is not its own', () => {
    const alone = allCaps().filter((c) => c.voiceAlone).map((c) => c.id);
    expect(alone.sort()).toEqual(['edge', 'kizunaai_soniox', 'local_inference', 'local_native', 'soniox']);
    for (const id of [...TEXT_OPEN, 'kizunaai_qwen']) for (const voice of alone) {
      const plan = compose(lineUp(id, id, voice), input);
      // Kizuna AI's two services never run together.
      if (id === 'kizunaai_qwen' && voice === 'kizunaai_soniox') { expect(plan, voice).toMatchObject({ refused: 'lineup_two_managed' }); continue; }
      expect(isRefusal(plan), `${id}/${voice}`).toBe(false);
      if (isRefusal(plan)) continue;
      expect(plan.units.map((u) => [u.provider.id, u.unit.id, u.stages]), `${id}/${voice}`).toEqual([[id, 'whole', ['transcription', 'translation']], [voice, plan.byStage.speech.unit.id, ['speech']]]);
    }
  });
  it('an end-to-end service still takes no other voice', () => {
    for (const id of END_TO_END) expect(compose(lineUp(id, id, 'edge'), input), id).toMatchObject({ refused: 'lineup_voice_not_taken', provider: id });
  });
});

describe('a choice the composer would refuse', () => {
  it("under Kizuna AI's Soniox on every stage, no voice is refused: an end-to-end service takes all three stages with it", () => {
    const from = all('kizunaai_soniox');
    for (const id of optionsFor('speech')) expect([id, refusedChoice(from, 'speech', id, input)]).toEqual([id, null]);
    // The voices that read Kizuna AI's text leave it where it is; a voice that reads only its own text moves every stage to itself.
    for (const id of ['soniox', 'edge', 'local_inference']) expect(choose(from, 'speech', id).lineUp).toEqual(lineUp('kizunaai_soniox', 'kizunaai_soniox', id));
    for (const id of [...END_TO_END, ...TEXT_OPEN, 'kizunaai_qwen']) expect(choose(from, 'speech', id).lineUp).toEqual(all(id));
  });

  it('under an end-to-end service, Edge for speech takes the other stages to this device, and that runs', () => {
    const from = all('gemini');
    const candidate = choose(from, 'speech', 'edge').lineUp;
    expect(candidate).toEqual(lineUp('local_inference', 'bing', 'edge'));
    expect(isRefusal(compose(candidate, input))).toBe(false);
    expect(refusedChoice(from, 'speech', 'edge', input)).toBeNull();
    // And every other voice: the stages it does not take go to its own provider.
    for (const id of optionsFor('speech')) expect([id, refusedChoice(from, 'speech', id, input)]).toEqual([id, null]);
  });

  it("under Soniox with an own key or this device, no voice is refused: Kizuna AI's Soniox for speech alone leaves the text where it is", () => {
    for (const from of [all('soniox'), lineUp('local_inference', 'bing', 'edge'), all('local_inference')]) {
      for (const id of optionsFor('speech')) expect([id, refusedChoice(from, 'speech', id, input)]).toEqual([id, null]);
      const chosen = choose(from, 'speech', 'kizunaai_soniox').lineUp;
      expect(chosen).toEqual({ ...from, speech: 'kizunaai_soniox' });
      expect(isRefusal(compose(chosen, input))).toBe(false);
    }
  });

  it("own-key Soniox read by Kizuna AI's Soniox voice: every other voice and every text side can be chosen from it", () => {
    const from = lineUp('soniox', 'soniox', 'kizunaai_soniox');
    expect(isRefusal(compose(from, input))).toBe(false);
    for (const stage of RUN_STAGES) for (const id of optionsFor(stage)) expect([stage, id, refusedChoice(from, stage, id, input)]).toEqual([stage, id, null]);
    // The hosted voice stays beside a text side that takes another voice, and goes with one that does not.
    expect(choose(from, 'transcription', 'local_inference').lineUp).toEqual(lineUp('local_inference', 'bing', 'kizunaai_soniox'));
    expect(choose(from, 'transcription', 'kizunaai_soniox').lineUp).toEqual(all('kizunaai_soniox'));
    expect(choose(from, 'transcription', 'kizunaai_qwen').lineUp).toEqual(all('kizunaai_qwen'));
  });

  it("under Kizuna AI's Soniox on every stage, no other text side is refused, and Kizuna AI's voice stays beside the ones that take it", () => {
    const from = all('kizunaai_soniox');
    for (const stage of ['transcription', 'translation'] as const) for (const id of optionsFor(stage)) expect([stage, id, refusedChoice(from, stage, id, input)]).toEqual([stage, id, null]);
    expect(choose(from, 'transcription', 'soniox').lineUp).toEqual(lineUp('soniox', 'soniox', 'kizunaai_soniox'));
    expect(choose(from, 'transcription', 'local_inference').lineUp).toEqual(lineUp('local_inference', 'bing', 'kizunaai_soniox'));
    for (const id of END_TO_END) expect(choose(from, 'transcription', id).lineUp).toEqual(all(id));
    // The text sides that take another voice keep Kizuna AI's; Kizuna AI's Qwen never runs beside it, and takes the voice.
    for (const id of TEXT_OPEN) expect(choose(from, 'transcription', id).lineUp).toEqual(lineUp(id, id, 'kizunaai_soniox'));
    expect(choose(from, 'transcription', 'kizunaai_qwen').lineUp).toEqual(all('kizunaai_qwen'));
  });

  it('from any line-up that runs on one provider, no option is kept out', () => {
    const seen = new Set<string>();
    for (const host of ['kizunaai_soniox', 'kizunaai_qwen', 'soniox', 'gemini', 'local_inference']) {
      for (const stage of RUN_STAGES) for (const id of optionsFor(stage)) {
        const refused = refusedChoice(all(host), stage, id, input);
        if (refused) seen.add(refused.refusal.refused);
      }
    }
    expect([...seen]).toEqual([]);
  });

  describe('a voice that is not offered alone (none is released so; the page still words it)', () => {
    it('under Soniox with an own key, it is not kept out for speech: it brings its own text side, the only one it reads', () => {
      const from = all('soniox');
      expect(refusedChoice(from, 'speech', 'kizunaai_soniox', notAlone)).toBeNull();
      expect(chooseWith(from, 'speech', 'kizunaai_soniox', notAlone).lineUp).toEqual(all('kizunaai_soniox'));
      for (const id of optionsFor('speech')) expect([id, refusedChoice(from, 'speech', id, notAlone)]).toEqual([id, null]);
    });

    it('a stored line-up that is refused: the voices that fix it are not refused, nor is its own text side, nor another: the voice follows it', () => {
      const from = lineUp('soniox', 'soniox', 'kizunaai_soniox');
      expect(compose(from, notAlone)).toMatchObject({ refused: 'lineup_voice_not_alone', stage: 'speech' });
      for (const id of ['edge', 'soniox', 'local_inference']) expect([id, refusedChoice(from, 'speech', id, notAlone)]).toEqual([id, null]);
      expect(refusedChoice(from, 'transcription', 'kizunaai_soniox', notAlone)).toBeNull();
      expect(refusedChoice(from, 'transcription', 'local_inference', notAlone)).toBeNull();
      expect(chooseWith(from, 'transcription', 'local_inference', notAlone).lineUp).toEqual(lineUp('local_inference', 'bing', 'edge'));
    });

    it('from any line-up that runs on one provider, no option is kept out', () => {
      const seen = new Set<string>();
      for (const host of ['kizunaai_soniox', 'kizunaai_qwen', 'soniox', 'gemini', 'local_inference']) {
        for (const stage of RUN_STAGES) for (const id of optionsFor(stage)) {
          const refused = refusedChoice(all(host), stage, id, notAlone);
          if (refused) seen.add(refused.refusal.refused);
        }
      }
      expect([...seen]).toEqual([]);
    });
  });

  it('a refusal of another kind keeps no option out', () => {
    // No provider is offered: the composer says so, and that is not about how the line-up is put together.
    const none: ComposeInput = { providers: [], settings: () => undefined };
    expect(compose(chooseWith(all('soniox'), 'speech', 'edge', none).lineUp, none)).toMatchObject({ refused: 'lineup_not_offered' });
    expect(refusedChoice(all('soniox'), 'speech', 'edge', none)).toBeNull();
  });
});
