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

/** Every triple of options in the catalog, without notes. */
function everyLineUp(): LineUp[] {
  const lineUps: LineUp[] = [];
  for (const t of CAPS) for (const tl of CAPS) for (const s of CAPS) lineUps.push({ transcription: t.id, translation: tl.id, speech: s.id, summarisation: null });
  return lineUps;
}

/** Every line-up the old rule ran: each triple of options in the catalog that one provider ran, without notes. */
function everyRunnableLineUp(): LineUp[] {
  return everyLineUp().filter((lineUp) => oldRunOf(lineUp).ok);
}

describe('choosing a provider for a stage', () => {
  it('a provider takes the stages it holds jointly', () => { expect(choose(local, 'translation', 'soniox', allPresent)).toEqual({ lineUp: soniox, moved: ['transcription', 'speech'] }); });
  it('an end-to-end provider takes all three and leaves the notes alone', () => {
    expect(choose({ ...soniox, summarisation: 'x' }, 'speech', 'openai_live', allPresent).lineUp).toEqual({ transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live', summarisation: 'x' });
  });
  it('on the local host a single stage changes alone', () => { expect(choose(local, 'translation', 'local_inference', allPresent)).toEqual({ lineUp: { ...local, translation: 'local_inference' }, moved: [] }); });
  it('a choice today\'s code cannot combine moves the others and says so', () => { expect(choose(soniox, 'speech', 'edge', allPresent)).toEqual({ lineUp: local, moved: ['transcription', 'translation'] }); });
  it('the two hosted providers are separate choices', () => {
    expect(choose(soniox, 'transcription', 'kizunaai_qwen', allPresent).lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    expect(choose(soniox, 'transcription', 'kizunaai_soniox', allPresent).lineUp).toMatchObject({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox' });
  });
  it('only the notes can be switched off', () => { expect(() => choose(soniox, 'speech', null, allPresent)).toThrow(); expect(choose(soniox, 'summarisation', null, allPresent).lineUp.summarisation).toBeNull(); });

  it('moves nothing else when the line-up is refused only because its host is not offered here', () => {
    const allLocal = { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference', summarisation: null };
    const noLocal = { ...allPresent, providers: allPresent.providers.filter((p) => p.id !== 'local_inference') };
    const choice = choose(allLocal, 'translation', 'bing', noLocal);
    expect(choice.moved).toEqual([]);
    expect(choice.lineUp.speech).toBe('local_inference');
  });

  it('moves exactly the stages the old rule moved, for every line-up and every choice', () => {
    expect(everyRunnableLineUp().length).toBeGreaterThan(10);
    for (const from of everyLineUp()) for (const stage of RUN_STAGES) for (const c of CAPS) {
      if (!c.stages.includes(stage)) continue;
      expect(choose(from, stage, c.id, allPresent), JSON.stringify({ from, stage, id: c.id })).toEqual(oldChoose(from, stage, c.id));
    }
  });
});
