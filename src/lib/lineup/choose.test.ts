import { describe, expect, it } from 'vitest';
import { RELEASED } from '../../providers/registry';
import { choiceInput } from '../plan/choice';
import { compose } from '../plan/compose';
import { isRefusal } from '../plan/types';
import { CAPS, caps, hostDefaults } from './catalog';
import { choose as chooseWith } from './choose';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage } from './types';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const kizuna = { transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox', summarisation: null };
const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
const gemini = { transcription: 'gemini', translation: 'gemini', speech: 'gemini', summarisation: null };

// The released providers under their default settings: what the line-up page and the store ask the composer with
// before an entry loads.
const input = choiceInput(RELEASED, {});
const choose = (lineUp: LineUp, stage: Parameters<typeof chooseWith>[1], id: string | null) => chooseWith(lineUp, stage, id, input);

/** Every triple of options in the catalog, without notes. */
function everyLineUp(): LineUp[] {
  const lineUps: LineUp[] = [];
  for (const t of CAPS) for (const tl of CAPS) for (const s of CAPS) lineUps.push({ transcription: t.id, translation: tl.id, speech: s.id, summarisation: null });
  return lineUps;
}

describe('choosing a provider for a stage', () => {
  it('a provider takes the stages it holds jointly, and leaves the others alone', () => {
    expect(choose(local, 'translation', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: ['transcription'] });
  });
  it('an end-to-end provider takes all three and leaves the notes alone', () => {
    expect(choose({ ...soniox, summarisation: 'x' }, 'speech', 'openai_live').lineUp).toEqual({ transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live', summarisation: 'x' });
  });
  it('on the local host a single stage changes alone', () => { expect(choose(local, 'translation', 'local_inference')).toEqual({ lineUp: { ...local, translation: 'local_inference' }, moved: [] }); });

  it('a voice chosen under another provider\'s text moves nothing', () => {
    expect(choose(soniox, 'speech', 'edge')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: [] });
    expect(choose(kizuna, 'speech', 'edge')).toEqual({ lineUp: { ...kizuna, speech: 'edge' }, moved: [] });
    expect(choose(kizuna, 'speech', 'local_inference')).toEqual({ lineUp: { ...kizuna, speech: 'local_inference' }, moved: [] });
    expect(choose(local, 'speech', 'soniox')).toEqual({ lineUp: { ...local, speech: 'soniox' }, moved: [] });
  });
  it('a text side chosen over another provider\'s voice keeps that voice', () => {
    expect(choose(local, 'transcription', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: ['translation'] });
    expect(choose(soniox, 'transcription', 'kizunaai_soniox').lineUp).toMatchObject({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'soniox' });
  });

  it('a provider that loses a stage of a joint group loses the whole group, to the chosen host\'s defaults', () => {
    // Soniox's transcription and translation go together: taking one away takes the other, and its voice stays.
    expect(choose(soniox, 'transcription', 'local_inference')).toEqual({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'soniox', summarisation: null }, moved: ['translation'] });
    // An end-to-end provider holds all three together: taking its voice away takes the rest.
    expect(choose(gemini, 'speech', 'edge')).toEqual({ lineUp: local, moved: ['transcription', 'translation'] });
    expect(choose(gemini, 'transcription', 'soniox')).toEqual({ lineUp: soniox, moved: ['translation', 'speech'] });
  });

  it('a voice that cannot stay beside the chosen text side follows it, and the result says so', () => {
    // Kizuna AI's voice only reads its own translation: with own-key Soniox for the text, speech goes to Soniox's voice.
    const toSoniox = choose(kizuna, 'transcription', 'soniox');
    expect(toSoniox).toEqual({ lineUp: soniox, moved: ['translation', 'speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'soniox' } });
    expect(isRefusal(compose(toSoniox.lineUp, input))).toBe(false);
    expect(choose(kizuna, 'translation', 'soniox')).toEqual({ lineUp: soniox, moved: ['transcription', 'speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'soniox' } });
    // With this device for the text, to this device's default voice.
    const toLocal = choose(kizuna, 'transcription', 'local_inference');
    expect(toLocal).toEqual({ lineUp: local, moved: ['translation', 'speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'edge' } });
    expect(isRefusal(compose(toLocal.lineUp, input))).toBe(false);
    expect(choose(kizuna, 'translation', 'bing')).toEqual({ lineUp: local, moved: ['transcription', 'speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'edge' } });
    // A stored line-up that was already refused for its voice is put right by the next choice of a text side.
    expect(choose({ ...soniox, speech: 'kizunaai_soniox' }, 'transcription', 'local_inference').followed).toEqual({ stage: 'speech', from: 'kizunaai_soniox', to: 'edge' });
  });

  it('a voice that can stay beside the chosen text side stays', () => {
    // Edge reads any text side that takes another voice.
    expect(choose({ ...kizuna, speech: 'edge' }, 'transcription', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: ['translation'] });
    // Soniox's own-key voice stands alone, and Kizuna AI's text takes another voice.
    expect(choose(soniox, 'transcription', 'kizunaai_soniox')).toEqual({ lineUp: { ...kizuna, speech: 'soniox' }, moved: ['translation'] });
    expect(isRefusal(compose({ ...kizuna, speech: 'soniox' }, input))).toBe(false);
  });

  it('a choice made on the speech stage makes nothing follow: a voice that cannot stand alone is kept as chosen, refused', () => {
    const chosen = choose(soniox, 'speech', 'kizunaai_soniox');
    expect(chosen).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: [] });
    expect(compose(chosen.lineUp, input)).toMatchObject({ refused: 'lineup_voice_not_alone' });
  });

  it('a refusal of another kind makes nothing follow, and neither does a default voice that would still be refused', () => {
    // No provider is offered: the composer says so before it looks at the voice.
    const none = choiceInput([], {});
    expect(chooseWith(kizuna, 'transcription', 'soniox', none)).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['translation'] });
    // Soniox is not offered, so its default voice would not run either: the choice is kept as made.
    const withoutSoniox = choiceInput(RELEASED.filter((p) => p.id !== 'soniox'), {});
    expect(chooseWith(kizuna, 'transcription', 'soniox', withoutSoniox)).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['translation'] });
  });

  it('the two hosted providers are separate choices', () => {
    expect(choose(soniox, 'transcription', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    expect(choose(kizuna, 'speech', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
  });
  it('only the notes can be switched off', () => { expect(() => choose(soniox, 'speech', null)).toThrow(); expect(choose(soniox, 'summarisation', null).lineUp.summarisation).toBeNull(); });
  it('refuses an option that does not serve the stage', () => { expect(() => choose(soniox, 'transcription', 'edge')).toThrow(); });

  it('for every line-up and every choice: the chosen stage and its joint partners are the choice, any other stage moves only when its provider lost a joint partner, and speech alone may follow', () => {
    const reasons = new Set<string>();
    for (const from of everyLineUp()) for (const stage of RUN_STAGES) for (const c of CAPS) {
      if (!c.stages.includes(stage)) continue;
      const label = JSON.stringify({ from, stage, id: c.id });
      const { lineUp, moved, followed } = choose(from, stage, c.id);
      const group: readonly RunStage[] = c.joint?.includes(stage) ? c.joint : [stage];
      // The line-up by the joint rule alone.
      const byJoint = { ...from };
      for (const s of RUN_STAGES) {
        if (group.includes(s)) { byJoint[s] = c.id; continue; }
        const joint = caps(from[s]!)?.joint;
        const lostPartner = !!joint && joint.includes(s) && joint.some((t) => group.includes(t) && from[t] === from[s]);
        if (lostPartner) byJoint[s] = hostDefaults(c.host)[s];
      }
      if (followed) {
        // Only for a choice of another stage, only away from a voice the composer refuses, only to one that runs.
        expect(stage, label).not.toBe('speech');
        const refused = compose(byJoint, input);
        expect(isRefusal(refused) && ['lineup_voice_not_alone', 'lineup_voice_not_taken'].includes(refused.refused), label).toBe(true);
        if (isRefusal(refused)) reasons.add(refused.refused);
        expect(followed, label).toEqual({ stage: 'speech', from: byJoint.speech, to: hostDefaults(c.host).speech });
        expect(lineUp, label).toEqual({ ...byJoint, speech: followed.to });
        expect(isRefusal(compose(lineUp, input)), label).toBe(false);
      } else {
        expect(lineUp, label).toEqual(byJoint);
      }
      expect(moved, label).toEqual(RUN_STAGES.filter((s) => s !== stage && lineUp[s] !== from[s]));
      expect(lineUp.summarisation, label).toBe(from.summarisation);
    }
    // A text side that takes no other voice holds all three stages jointly, so choosing it already moves speech:
    // the only voice that ever has to follow is one that is not offered alone.
    expect([...reasons]).toEqual(['lineup_voice_not_alone']);
  });
});
