import { describe, expect, it } from 'vitest';
import { localSpeechStagesOf, localStagesOf, localTranscriptionStagesOf, localTranslationStagesOf, unservedStages } from './localStages';

describe('the local stages of a line-up', () => {
  it('Bing and Edge are providers of their own: this device serves only its models, and an all-local line-up reads as before', () => {
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null })).toEqual({ translation: null, speech: null, transcription: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null })).toEqual({ translation: null, speech: 'local', transcription: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'edge', summarisation: null })).toEqual({ translation: 'local', speech: null });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference', summarisation: null })).toEqual({ translation: 'local', speech: 'local' });
  });
  it('with no line-up, the translation unit reads this machine\'s models alone, and never null', () => {
    expect(localTranslationStagesOf(null)).toEqual({ translation: 'local', speech: null, transcription: null });
    expect(localSpeechStagesOf(null)).toEqual({ translation: null, speech: 'local' });
  });
  it('is null when nothing is stored or the local provider serves no stage of the line-up', () => {
    expect(localStagesOf(null)).toBeNull();
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null })).toBeNull();
  });
  it('says null for a stage another provider serves', () => {
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null })).toBeNull();
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference', summarisation: null })).toEqual({ translation: null, speech: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'soniox', summarisation: null })).toEqual({ translation: null, speech: null, transcription: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'soniox', summarisation: null })).toEqual({ translation: 'local', speech: null });
  });
  it("the local voice's stages: the whole line-up's when it is all on this device, else a local model for speech alone (Edge is another provider's)", () => {
    expect(localSpeechStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'edge' })).toEqual({ translation: null, speech: null, transcription: 'local' });
    expect(localSpeechStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference' })).toEqual({ translation: null, speech: 'local', transcription: 'local' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'edge' })).toEqual({ translation: null, speech: 'local' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference' })).toEqual({ translation: null, speech: 'local' });
    expect(localSpeechStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' })).toEqual({ translation: null, speech: 'local' });
  });
  it("the engine's stages another provider serves: recognition goes with translation", () => {
    expect(unservedStages(null)).toEqual([]);
    expect(unservedStages({ translation: 'local', speech: 'local' })).toEqual([]);
    expect(unservedStages({ translation: null, speech: 'local' })).toEqual(['asr', 'translation']);
    expect(unservedStages({ translation: 'local', speech: null })).toEqual(['tts']);
  });
  it('says so when it translates what another provider transcribes: then, and only then, transcription is stated', () => {
    expect(localStagesOf({ transcription: 'soniox', translation: 'local_inference', speech: 'edge', summarisation: null })).toEqual({ translation: 'local', speech: null, transcription: null });
    expect(localStagesOf({ transcription: 'soniox', translation: 'local_inference', speech: 'soniox', summarisation: null })).toEqual({ translation: 'local', speech: null, transcription: null });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'edge', summarisation: null })).not.toHaveProperty('transcription');
    expect(localStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'local_inference', summarisation: null })).not.toHaveProperty('transcription');
  });
  it("the local translation's stages as a unit of its own: a local model, and never a recognition model", () => {
    expect(localTranslationStagesOf({ transcription: 'soniox', translation: 'bing', speech: 'edge' })).toEqual({ translation: 'local', speech: null, transcription: null });
    expect(localTranslationStagesOf({ transcription: 'soniox', translation: 'local_inference', speech: 'soniox' })).toEqual({ translation: 'local', speech: null, transcription: null });
    // Built for a plan the line-up does not describe: a model of this machine, and still no recognition.
    expect(localTranslationStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference' })).toEqual({ translation: 'local', speech: 'local', transcription: null });
    expect(localTranslationStagesOf({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' })).toEqual({ translation: 'local', speech: null, transcription: null });
  });
  it("the engine's stages another provider serves: recognition alone, where this device translates what another transcribes", () => {
    expect(unservedStages({ translation: 'local', speech: 'local', transcription: null })).toEqual(['asr']);
    expect(unservedStages({ translation: 'local', speech: null, transcription: null })).toEqual(['asr', 'tts']);
    expect(unservedStages({ translation: null, speech: null, transcription: null })).toEqual(['asr', 'translation', 'tts']);
  });
  it('says so when it transcribes what another provider translates: then, and only then, transcription is stated as served here', () => {
    expect(localStagesOf({ transcription: 'local_inference', translation: 'soniox', speech: 'edge', summarisation: null })).toEqual({ translation: null, speech: null, transcription: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'openai', speech: 'local_inference', summarisation: null })).toEqual({ translation: null, speech: 'local', transcription: 'local' });
    expect(localStagesOf({ transcription: 'local_inference', translation: 'soniox', speech: 'soniox', summarisation: null })).toEqual({ translation: null, speech: null, transcription: 'local' });
    // Recognition with translation on this device is the whole session, as before: nothing more is stated.
    expect(localStagesOf({ transcription: 'local_inference', translation: 'local_inference', speech: 'soniox', summarisation: null })).not.toHaveProperty('transcription');
  });
  it("the engine's stages another provider serves: translation alone, where this device transcribes what another translates", () => {
    expect(unservedStages({ translation: null, speech: 'local', transcription: 'local' })).toEqual(['translation']);
    expect(unservedStages({ translation: null, speech: null, transcription: 'local' })).toEqual(['translation', 'tts']);
    // Without the member, recognition still goes with translation, as every value written before reads.
    expect(unservedStages({ translation: null, speech: 'local' })).toEqual(['asr', 'translation']);
  });
  it("the local recognition's stages as a unit of its own: a recognition model of this machine, and never a translation model", () => {
    expect(localTranscriptionStagesOf({ transcription: 'local_inference', translation: 'soniox', speech: 'edge' })).toEqual({ translation: null, speech: null, transcription: 'local' });
    expect(localTranscriptionStagesOf({ transcription: 'local_inference', translation: 'soniox', speech: 'soniox' })).toEqual({ translation: null, speech: null, transcription: 'local' });
    // Built for a plan the line-up does not describe, or with no line-up: still no translation model.
    expect(localTranscriptionStagesOf({ transcription: 'local_inference', translation: 'bing', speech: 'edge' })).toEqual({ translation: null, speech: null, transcription: 'local' });
    expect(localTranscriptionStagesOf(null)).toEqual({ translation: null, speech: null, transcription: 'local' });
    expect(unservedStages(localTranscriptionStagesOf(null))).toEqual(['translation', 'tts']);
  });
});
