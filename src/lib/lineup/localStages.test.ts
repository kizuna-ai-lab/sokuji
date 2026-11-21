import { describe, expect, it } from 'vitest';
import { localSpeechStagesOf, localStagesOf } from './localStages';

describe('the local stages of a line-up', () => {
  it('the line-up decides Bing and Edge', () => {
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null })).toEqual({ translation: 'bing', speech: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'edge', summarisation: null })).toEqual({ translation: 'local', speech: 'edge' });
  });
  it('is null when nothing is stored or the local provider serves no stage of the line-up', () => {
    expect(localStagesOf(null)).toBeNull();
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null })).toBeNull();
  });
  it('answers for the stages the local provider serves when another provider serves the others', () => {
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null })).toEqual({ translation: 'local', speech: 'edge' });
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference', summarisation: null })).toEqual({ translation: 'local', speech: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'soniox', summarisation: null })).toEqual({ translation: 'bing', speech: 'local' });
  });
  it("the local voice's stages: the whole line-up's when it is all on this device, else Edge or a local model for speech alone", () => {
    expect(localSpeechStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'edge' })).toEqual({ translation: 'bing', speech: 'edge' });
    expect(localSpeechStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference' })).toEqual({ translation: 'bing', speech: 'local' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'edge' })).toEqual({ translation: 'local', speech: 'edge' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference' })).toEqual({ translation: 'local', speech: 'local' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' })).toEqual({ translation: 'local', speech: 'local' });
  });
});
