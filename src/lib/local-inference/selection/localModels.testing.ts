// src/lib/local-inference/selection/localModels.testing.ts
//
// Fixtures for tests: this device's local models (`LocalModels`) without the model store, scanned at once, with no
// model on the device unless a test says otherwise. Imported by tests only.
import type { LocalModels } from './types';

/** A `LocalModels` whose members are `over`'s where given: else scanned, every stage resolving to none, no GPU feature, nothing watched. */
export function fakeLocalModels(over: Partial<LocalModels> = {}): LocalModels {
  return {
    scanned: async () => {},
    resolve: () => ({ asr: null, translation: null, tts: null, notes: [], prunes: [] }),
    deviceFeatures: () => [],
    watch: () => () => {},
    ...over,
  };
}
