// src/stores/localModels.ts
//
// This device's local models behind the `LocalModels` port: the model store, read through whatever the local provider
// is handed. The run, the provider store and the readiness driver hand it on; the provider imports no store. A module
// of its own, so a test that mocks `modelStore` with only `useModelStore` still serves it.
import type { LocalModels } from '../lib/local-inference/selection/types';
import { useModelStore } from './modelStore';

export const localModels: LocalModels = {
  scanned: (signal) => (useModelStore.getState().initialized ? Promise.resolve() : raceInitialize(signal)),
  resolve: (source, target, selections, stages) => useModelStore.getState().resolve(source, target, selections, stages),
  deviceFeatures: () => useModelStore.getState().deviceFeatures,
  watch: (onChange) => useModelStore.subscribe((s) => s.modelStatuses, () => onChange()),
};

/**
 * Resolves once the model store finishes initializing, or rejects with the
 * abort reason if `signal` fires first (mirrors `fake/adapter.ts`'s own
 * signal race — `Adapter.start`'s `request.signal` follows the same rule,
 * and `CheckContext.signal` is documented the same way: "Aborted when the
 * start that asked is cancelled").
 */
function raceInitialize(signal?: AbortSignal): Promise<void> {
  const init = useModelStore.getState().initialize();
  if (!signal) return init;
  if (signal.aborted) {
    init.catch(() => {}); // already answered by the abort below — never surfaced
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<void>((resolveInit, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    init.then(
      () => { signal.removeEventListener('abort', onAbort); resolveInit(); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}
