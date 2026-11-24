// src/stores/nativeModels.ts
//
// This device's native facts behind the `NativeModels` port: the native model store and the clip stores, read
// through whatever Local Native is handed. The provider imports no store.
import type { NativeModels } from '../lib/local-inference/native/nativeModels';
import { voiceStoreFor } from '../lib/local-inference/native/nativeVoiceStores';
import { nativeHardwareInfo, nativeListTtsVoices, useNativeModelStore } from './nativeModelStore';

type NativeModelStoreState = ReturnType<typeof useNativeModelStore.getState>;

export const nativeModels: NativeModels = {
  resolve: (source, target, selections) => useNativeModelStore.getState().resolve(source, target, selections),
  catalog: () => useNativeModelStore.getState().catalog,
  sizes: () => useNativeModelStore.getState().sizes,
  ensureSelectionReady: (read, signal) => raceSignal(useNativeModelStore.getState().ensureSelectionReady(read), signal),
  watch: (onChange) => {
    // A download, a delete, the bundle or the sidecar's lifecycle moving: the store's own events, once each.
    // `starting` neither calls back nor is remembered: every check starts an engine that is not ready, so a start
    // that fails must end where it began (`unavailable → starting → unavailable`), or each check would schedule the
    // next (#578).
    let key = nativeReadinessKey(useNativeModelStore.getState());
    return useNativeModelStore.subscribe((state) => {
      if (state.sidecarStatus === 'starting') return;
      const next = nativeReadinessKey(state);
      if (next === key) return;
      key = next;
      onChange();
    });
  },
  listVoices: (modelId) => nativeListTtsVoices(modelId),
  voiceStore: (custom, modelId) => voiceStoreFor(custom, modelId),
  hardware: () => nativeHardwareInfo(),
  plan: (stage, plan) => {
    // Each stage's resolved plan, where the library's device badges read it (#578 ruling 14).
    const store = useNativeModelStore.getState();
    const { model, device, backend, computeType, rtf, tokensPerSec, memoryBytes, fallbackReason } = plan;
    if (stage === 'asr') store.setAsrResolved({ model, device, backend, computeType, rtf, memoryBytes, fallbackReason });
    else if (stage === 'translation') store.setTranslationResolved({ model, device, backend, computeType, tokensPerSec, memoryBytes, fallbackReason });
    else store.setTtsResolved({ model, device, backend, computeType, rtf, memoryBytes, fallbackReason });
  },
};

/**
 * What readiness's answer depends on, as content. `refresh` writes a new statuses object even when nothing changed,
 * and a check itself refreshes: keyed by reference, every check would schedule the next. A running download reads as
 * `absent`, as it does to the gate: its start schedules no check, its completion does (#578).
 */
export function nativeReadinessKey(state: Pick<NativeModelStoreState, 'sidecarStatus' | 'bundleStatus' | 'catalog' | 'statuses'>): string {
  const statuses = Object.keys(state.statuses).sort()
    .map((id) => `${id}=${state.statuses[id] === 'downloading' ? 'absent' : state.statuses[id]}`).join(',');
  return `${state.sidecarStatus}|${state.bundleStatus}|${Object.keys(state.catalog).sort().join(',')}|${statuses}`;
}

/** `work`'s answer, or the abort reason if the start that asked is cancelled first (`localModels`' `raceInitialize`, for any promise). */
function raceSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => {}); // already answered by the abort below — never surfaced
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}
