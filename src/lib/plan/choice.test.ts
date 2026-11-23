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
const END_TO_END = ['kizunaai_qwen', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'openai_live', 'qwen_livetranslate', 'palabraai'];

describe('a choice the composer would refuse', () => {
  it("under Kizuna AI's Soniox on every stage, no voice is refused: an end-to-end service takes all three stages with it", () => {
    const from = all('kizunaai_soniox');
    for (const id of optionsFor('speech')) expect([id, refusedChoice(from, 'speech', id, input)]).toEqual([id, null]);
    // The voices that read Kizuna AI's text leave it where it is; an end-to-end service moves every stage to itself.
    for (const id of ['soniox', 'edge', 'local_inference']) expect(choose(from, 'speech', id).lineUp).toEqual(lineUp('kizunaai_soniox', 'kizunaai_soniox', id));
    for (const id of END_TO_END) expect(choose(from, 'speech', id).lineUp).toEqual(all(id));
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
    it('under Soniox with an own key, it is refused for speech alone: its voice only reads its own translation', () => {
      const from = all('soniox');
      expect(refusedChoice(from, 'speech', 'kizunaai_soniox', notAlone)).toEqual({
        refusal: { refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_soniox' },
        lineUp: lineUp('soniox', 'soniox', 'kizunaai_soniox'),
      });
      for (const id of optionsFor('speech').filter((o) => o !== 'kizunaai_soniox')) expect([id, refusedChoice(from, 'speech', id, notAlone)]).toEqual([id, null]);
    });

    it('a stored line-up that is refused: the voices that fix it are not refused, nor is its own text side, nor another: the voice follows it', () => {
      const from = lineUp('soniox', 'soniox', 'kizunaai_soniox');
      expect(compose(from, notAlone)).toMatchObject({ refused: 'lineup_voice_not_alone', stage: 'speech' });
      for (const id of ['edge', 'soniox', 'local_inference']) expect([id, refusedChoice(from, 'speech', id, notAlone)]).toEqual([id, null]);
      expect(refusedChoice(from, 'transcription', 'kizunaai_soniox', notAlone)).toBeNull();
      expect(refusedChoice(from, 'transcription', 'local_inference', notAlone)).toBeNull();
      expect(chooseWith(from, 'transcription', 'local_inference', notAlone).lineUp).toEqual(lineUp('local_inference', 'bing', 'edge'));
    });

    it('from any line-up that runs on one provider, only a refusal for a lone voice ever keeps an option out', () => {
      const seen = new Set<string>();
      for (const host of ['kizunaai_soniox', 'kizunaai_qwen', 'soniox', 'gemini', 'local_inference']) {
        for (const stage of RUN_STAGES) for (const id of optionsFor(stage)) {
          const refused = refusedChoice(all(host), stage, id, notAlone);
          if (refused) seen.add(refused.refusal.refused);
        }
      }
      expect([...seen]).toEqual(['lineup_voice_not_alone']);
    });
  });

  it('a refusal of another kind keeps no option out', () => {
    // No provider is offered: the composer says so, and that is not about how the line-up is put together.
    const none: ComposeInput = { providers: [], settings: () => undefined };
    expect(compose(chooseWith(all('soniox'), 'speech', 'edge', none).lineUp, none)).toMatchObject({ refused: 'lineup_not_offered' });
    expect(refusedChoice(all('soniox'), 'speech', 'edge', none)).toBeNull();
  });
});
