import { describe, expect, it } from 'vitest';
import { localStagesOf } from './localStages';

describe('the local stages of a line-up', () => {
  it('the line-up decides Bing and Edge', () => {
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null })).toEqual({ translation: 'bing', speech: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'edge', summarisation: null })).toEqual({ translation: 'local', speech: 'edge' });
  });
  it('is null when nothing is stored or the line-up does not run on the local provider', () => {
    expect(localStagesOf(null)).toBeNull();
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null })).toBeNull();
  });
});
