import { describe, expect, it } from 'vitest';
import { stubHosts } from '../plan/testing';
import { CAPS } from './catalog';
import { choose } from './choose';
import { oldChoose, oldRunOf } from './oldRules.testing';
import { RUN_STAGES } from './types';
import type { LineUp } from './types';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
/** Every host offered: the choices below are made where every option can run. */
const allPresent = stubHosts();

/** Every line-up the old rule ran: each triple of options in the catalog that one provider ran, without notes. */
function everyRunnableLineUp(): LineUp[] {
  const lineUps: LineUp[] = [];
  for (const t of CAPS) for (const tl of CAPS) for (const s of CAPS) {
    const lineUp: LineUp = { transcription: t.id, translation: tl.id, speech: s.id, summarisation: null };
    if (oldRunOf(lineUp).ok) lineUps.push(lineUp);
  }
  return lineUps;
}

describe('choosing a provider for a stage', () => {
  it('a provider takes the stages it binds', () => { expect(choose(local, 'translation', 'soniox', allPresent)).toEqual({ lineUp: soniox, moved: ['transcription', 'speech'] }); });
  it('an end-to-end provider takes all three and leaves the notes alone', () => {
    expect(choose({ ...soniox, summarisation: 'x' }, 'speech', 'openai_live', allPresent).lineUp).toEqual({ transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live', summarisation: 'x' });
  });
  it('within the local family a single stage changes alone', () => { expect(choose(local, 'translation', 'local_inference', allPresent)).toEqual({ lineUp: { ...local, translation: 'local_inference' }, moved: [] }); });
  it('a choice today\'s code cannot combine moves the others and says so', () => { expect(choose(soniox, 'speech', 'edge', allPresent)).toEqual({ lineUp: local, moved: ['transcription', 'translation'] }); });
  it('the two hosted providers are separate choices', () => {
    expect(choose(soniox, 'transcription', 'kizunaai_qwen', allPresent).lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    expect(choose(soniox, 'transcription', 'kizunaai_soniox', allPresent).lineUp).toMatchObject({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox' });
  });
  it('only the notes can be switched off', () => { expect(() => choose(soniox, 'speech', null, allPresent)).toThrow(); expect(choose(soniox, 'summarisation', null, allPresent).lineUp.summarisation).toBeNull(); });

  it('moves exactly the stages the old rule moved, for every line-up and every choice', () => {
    for (const from of everyRunnableLineUp()) for (const stage of RUN_STAGES) for (const c of CAPS) {
      if (!c.stages.includes(stage)) continue;
      expect(choose(from, stage, c.id, allPresent)).toEqual(oldChoose(from, stage, c.id));
    }
  });
});
