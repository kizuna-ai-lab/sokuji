import type { LegName } from '../../lib/conversation/types';

/**
 * `ProviderPicker`/`ProviderEngine` always supply `pair`; this only matters
 * standalone (e.g. the dev preview, or a test that renders one of these
 * components on its own).
 */
export const FALLBACK_PAIR = { source: 'ja', target: 'en' };

/**
 * `legs` → the audio mode a start would actually run: more than one leg is
 * `'both'`, one leg is itself, and no legs at all (standalone, never true
 * once mounted under `ProviderEngine`) falls back to `'speaker'`. Spelled
 * out as the literal union rather than importing `AudioMode` — `src/providers/**`
 * imports no store but `modelStore` and `turnModeStore`, and `audioStore` is
 * one more than that.
 *
 * Lives in its own module rather than `LocalInferenceEngine.tsx`: that file
 * also pulls in `EngineSurface`/`ModelManagementSection`/`StoragePage`/
 * `useWasmEngineAdapter` — a heavy chain reaching the legacy `settingsStore`,
 * `nativeModelStore` and `segmentationStore` — while `LocalInferenceEngineSummary`
 * is meant to stay the cheap, always-shown piece next to the picker (ruling
 * 3), with `Engine` opened on demand. Sharing this module keeps both callers
 * from having to import one another's dependencies.
 */
export function modeOfLegs(legs: readonly LegName[]): 'speaker' | 'participant' | 'both' {
  return legs.length > 1 ? 'both' : legs[0] ?? 'speaker';
}
