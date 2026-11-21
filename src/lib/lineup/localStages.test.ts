import { describe, expect, it } from 'vitest';
import { localSpeechStagesOf, localStagesOf, unservedStages } from './localStages';

describe('the local stages of a line-up', () => {
  it('the line-up decides Bing and Edge: an all-local line-up reads as before', () => {
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null })).toEqual({ translation: 'bing', speech: 'edge' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null })).toEqual({ translation: 'bing', speech: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'edge', summarisation: null })).toEqual({ translation: 'local', speech: 'edge' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference', summarisation: null })).toEqual({ translation: 'local', speech: 'local' });
  });
  it('is null when nothing is stored or the local provider serves no stage of the line-up', () => {
    expect(localStagesOf(null)).toBeNull();
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null })).toBeNull();
  });
  it('says null for a stage another provider serves', () => {
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null })).toEqual({ translation: null, speech: 'edge' });
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference', summarisation: null })).toEqual({ translation: null, speech: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'soniox', summarisation: null })).toEqual({ translation: 'bing', speech: null });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'soniox', summarisation: null })).toEqual({ translation: 'local', speech: null });
  });
  it("the local voice's stages: the whole line-up's when it is all on this device, else Edge or a local model for speech alone", () => {
    expect(localSpeechStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'edge' })).toEqual({ translation: 'bing', speech: 'edge' });
    expect(localSpeechStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference' })).toEqual({ translation: 'bing', speech: 'local' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'edge' })).toEqual({ translation: null, speech: 'edge' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference' })).toEqual({ translation: null, speech: 'local' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' })).toEqual({ translation: null, speech: 'local' });
  });
  it("the engine's stages another provider serves: recognition goes with translation", () => {
    expect(unservedStages(null)).toEqual([]);
    expect(unservedStages({ translation: 'bing', speech: 'edge' })).toEqual([]);
    expect(unservedStages({ translation: null, speech: 'local' })).toEqual(['asr', 'translation']);
    expect(unservedStages({ translation: 'local', speech: null })).toEqual(['tts']);
  });
});
