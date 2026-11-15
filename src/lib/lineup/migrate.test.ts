import { describe, expect, it } from 'vitest';
import { lineUpFromToday } from './migrate';

describe('the line-up from today\'s values', () => {
  it('a free user whose automatic choices resolve to Bing and Edge keeps them', () => {
    expect(lineUpFromToday({ selected: 'local_inference', local: { translation: 'bing-translator', tts: 'edge-tts' } })).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null });
  });
  it('a downloaded local model that wins today stays local', () => {
    expect(lineUpFromToday({ selected: 'local_inference', local: { translation: 'hy-mt15-1.8b-translation', tts: 'edge-tts' } })).toMatchObject({ translation: 'local_inference', speech: 'edge' });
  });
  it('direct speech translation by Granite Speech stays local on both stages', () => {
    expect(lineUpFromToday({ selected: 'local_inference', local: { translation: 'granite-speech', tts: 'edge-tts' } })).toEqual({ transcription: 'local_inference', translation: 'local_inference', speech: 'edge', summarisation: null });
  });
  it('nothing resolved for a local stage is local', () => {
    expect(lineUpFromToday({ selected: 'local_inference', local: { translation: null, tts: null } })).toMatchObject({ translation: 'local_inference', speech: 'local_inference' });
  });
  it('the hosted Soniox provider serves all three stages', () => { expect(lineUpFromToday({ selected: 'kizunaai_soniox', local: null })).toMatchObject({ transcription: 'kizunaai_soniox', speech: 'kizunaai_soniox' }); });
  it('each other provider serves all three stages', () => {
    for (const id of ['kizunaai_qwen', 'soniox', 'openai', 'openai_translate', 'openai_live', 'gemini', 'qwen_livetranslate', 'volcengine_ast2', 'palabraai']) {
      expect(lineUpFromToday({ selected: id, local: null })).toEqual({ transcription: id, translation: id, speech: id, summarisation: null });
    }
  });
});
