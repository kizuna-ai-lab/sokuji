import { describe, it, expect } from 'vitest';
import { useNativeModelStore } from './nativeModelStore';
import { requiredNativeModels } from '../lib/local-inference/native/nativeCatalog';

describe('nativeModelStore.isReady', () => {
  it('is true only when all listed models are ready', () => {
    useNativeModelStore.setState({ statuses: { a: 'ready', b: 'ready', c: 'absent' } });
    const { isReady } = useNativeModelStore.getState();
    expect(isReady(['a', 'b'])).toBe(true);
    expect(isReady(['a', 'c'])).toBe(false);
    expect(isReady([])).toBe(false);
  });
});

describe('requiredNativeModels', () => {
  it('lists asr + translation(+qwen default) + tts when speech on', () => {
    // en target -> piper TTS; '' translation -> qwen
    expect(requiredNativeModels('sense-voice', '', '', 'es', 'en')).toEqual([
      'sense-voice', 'qwen', 'csukuangfj/vits-piper-en_US-amy-low',
    ]);
    // opus-mt translation, ja target -> no TTS
    expect(requiredNativeModels('whisper-tiny', 'opus-mt', '', 'zh', 'ja')).toEqual([
      'whisper-tiny', 'Xenova/opus-mt-zh-ja',
    ]);
  });
});
