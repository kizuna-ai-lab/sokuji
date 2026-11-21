import { describe, expect, it } from 'vitest';
import { compose } from '../plan/compose';
import { stubHosts, stubProvider } from '../plan/testing';
import { isRefusal } from '../plan/types';
import { CAPS, caps, hostDefaults } from './catalog';
import { choose } from './choose';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage } from './types';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const kizuna = { transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox', summarisation: null };
const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
const gemini = { transcription: 'gemini', translation: 'gemini', speech: 'gemini', summarisation: null };

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

  it('a choice the composer refuses is kept as chosen: no stage is moved to make it run', () => {
    const text = { id: 'stt', occupies: (_s: unknown, want: ReadonlySet<string>) => (want.size === 2 && want.has('transcription') && want.has('translation') ? ['transcription', 'translation'] : null), start: () => undefined };
    const voice = { id: 'tts', occupies: (_s: unknown, want: ReadonlySet<string>) => (want.size === 1 && want.has('speech') ? ['speech'] : null), startSpeech: () => undefined };
    const hosts = stubHosts();
    const inUnits = { ...hosts, providers: hosts.providers.map((p) => (p.id === 'soniox' || p.id === 'kizunaai_soniox' ? stubProvider(p.id, { units: [text, voice] }) : p)) };
    // Kizuna AI's voice under own-key Soniox text: its voice is not offered alone.
    const chosen = choose(kizuna, 'transcription', 'soniox');
    expect(chosen).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['translation'] });
    expect(compose(chosen.lineUp, inUnits)).toMatchObject({ refused: 'lineup_voice_not_alone' });
    // A line-up the composer runs is chosen the same way.
    const runs = choose(kizuna, 'speech', 'soniox');
    expect(runs).toEqual({ lineUp: { ...kizuna, speech: 'soniox' }, moved: [] });
    expect(isRefusal(compose(runs.lineUp, inUnits))).toBe(false);
  });

  it('the two hosted providers are separate choices', () => {
    expect(choose(soniox, 'transcription', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    expect(choose(kizuna, 'speech', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
  });
  it('only the notes can be switched off', () => { expect(() => choose(soniox, 'speech', null)).toThrow(); expect(choose(soniox, 'summarisation', null).lineUp.summarisation).toBeNull(); });
  it('refuses an option that does not serve the stage', () => { expect(() => choose(soniox, 'transcription', 'edge')).toThrow(); });

  it('for every line-up and every choice: the chosen stage and its joint partners are the choice, and any other stage moves only when its provider lost a joint partner', () => {
    for (const from of everyLineUp()) for (const stage of RUN_STAGES) for (const c of CAPS) {
      if (!c.stages.includes(stage)) continue;
      const label = JSON.stringify({ from, stage, id: c.id });
      const { lineUp, moved } = choose(from, stage, c.id);
      const group: readonly RunStage[] = c.joint?.includes(stage) ? c.joint : [stage];
      for (const s of RUN_STAGES) {
        if (group.includes(s)) { expect(lineUp[s], label).toBe(c.id); continue; }
        const joint = caps(from[s]!)?.joint;
        const lostPartner = !!joint && joint.includes(s) && joint.some((t) => group.includes(t) && from[t] === from[s]);
        expect(lineUp[s], label).toBe(lostPartner ? hostDefaults(c.host)[s] : from[s]);
      }
      expect(moved, label).toEqual(RUN_STAGES.filter((s) => s !== stage && lineUp[s] !== from[s]));
      expect(lineUp.summarisation, label).toBe(from.summarisation);
    }
  });
});
