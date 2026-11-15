import { describe, expect, it } from 'vitest';
import { choose } from './choose';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };

describe('choosing a provider for a stage', () => {
  it('a provider takes the stages it binds', () => { expect(choose(local, 'translation', 'soniox')).toEqual({ lineUp: soniox, moved: ['transcription', 'speech'] }); });
  it('an end-to-end provider takes all three and leaves the notes alone', () => {
    expect(choose({ ...soniox, summarisation: 'x' }, 'speech', 'openai_live').lineUp).toEqual({ transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live', summarisation: 'x' });
  });
  it('within the local family a single stage changes alone', () => { expect(choose(local, 'translation', 'local_inference')).toEqual({ lineUp: { ...local, translation: 'local_inference' }, moved: [] }); });
  it('a choice today\'s code cannot combine moves the others and says so', () => { expect(choose(soniox, 'speech', 'edge')).toEqual({ lineUp: local, moved: ['transcription', 'translation'] }); });
  it('the two hosted providers are separate choices', () => {
    expect(choose(soniox, 'transcription', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    expect(choose(soniox, 'transcription', 'kizunaai_soniox').lineUp).toMatchObject({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox' });
  });
  it('only the notes can be switched off', () => { expect(() => choose(soniox, 'speech', null)).toThrow(); expect(choose(soniox, 'summarisation', null).lineUp.summarisation).toBeNull(); });
});
