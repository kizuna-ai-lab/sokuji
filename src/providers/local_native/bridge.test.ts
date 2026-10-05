import { describe, expect, it } from 'vitest';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { nativeStoreHost } from './bridge';

describe('nativeStoreHost', () => {
  it("files each stage's plan where the library's badges read it (#578 ruling 14)", () => {
    nativeStoreHost.plan('asr', { model: 'asr-a', device: 'vulkan', backend: 'ggml', rtf: 0.2 });
    nativeStoreHost.plan('translation', { model: 'mt-a', device: 'cpu', tokensPerSec: 30, fallbackReason: 'vram' });
    nativeStoreHost.plan('tts', { model: 'tts-a', device: 'cpu' });
    const s = useNativeModelStore.getState();
    expect(s.asrResolved).toMatchObject({ model: 'asr-a', device: 'vulkan', backend: 'ggml', rtf: 0.2 });
    expect(s.translationResolved).toMatchObject({ model: 'mt-a', device: 'cpu', tokensPerSec: 30, fallbackReason: 'vram' });
    expect(s.ttsResolved).toMatchObject({ model: 'tts-a', device: 'cpu' });
  });
});
