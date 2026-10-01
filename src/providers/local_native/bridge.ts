import { voiceStoreFor } from '../../lib/local-inference/native/nativeVoiceStores';
import { nativeHardwareInfo, nativeListTtsVoices, useNativeModelStore } from '../../stores/nativeModelStore';
import type { NativeHost } from './host';

/**
 * The adapter's host over the native model store (#578 ruling 14): the
 * built-in voices and the hardware probe through the store's management
 * socket, the clip stores, and each stage's resolved plan where the
 * library's badges read it. The definition hands it in, so the session side
 * imports no store.
 */
export const nativeStoreHost: NativeHost = {
  listVoices: (modelId) => nativeListTtsVoices(modelId),
  voiceStore: (custom, modelId) => voiceStoreFor(custom, modelId),
  hardware: () => nativeHardwareInfo(),
  plan: (stage, plan) => {
    const store = useNativeModelStore.getState();
    const { model, device, backend, computeType, rtf, tokensPerSec, memoryBytes, fallbackReason } = plan;
    if (stage === 'asr') store.setAsrResolved({ model, device, backend, computeType, rtf, memoryBytes, fallbackReason });
    else if (stage === 'translation') store.setTranslationResolved({ model, device, backend, computeType, tokensPerSec, memoryBytes, fallbackReason });
    else store.setTtsResolved({ model, device, backend, computeType, rtf, memoryBytes, fallbackReason });
  },
};
