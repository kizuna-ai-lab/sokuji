import { useMemo } from 'react';
import { EngineSurface } from '../../components/Settings/engine/EngineSurface';
import { ModelManagementSection } from '../../components/Settings/sections/ModelManagementSection';
import { StoragePage } from '../../components/Settings/engine/StoragePage';
import { useWasmEngineAdapter } from '../../components/Settings/engine/useWasmEngineAdapter';
import type { EngineProps } from '../../lib/provider/types';
import type { LegName } from '../../lib/conversation/types';
import type { LocalInferenceSettings } from './settings';

/** `ProviderPanel` always supplies `pair`; this only matters standalone. */
const FALLBACK_PAIR = { source: 'ja', target: 'en' };

/**
 * `legs` → the audio mode a start would actually run: more than one leg is
 * `'both'`, one leg is itself, and no legs at all (standalone, never true
 * once mounted under `ProviderEngine`) falls back to `'speaker'`. Spelled
 * out as the literal union rather than importing `AudioMode` — `src/providers/**`
 * imports no store but `modelStore` and `turnModeStore`, and `audioStore` is
 * one more than that.
 */
export function modeOfLegs(legs: readonly LegName[]): 'speaker' | 'participant' | 'both' {
  return legs.length > 1 ? 'both' : legs[0] ?? 'speaker';
}

/**
 * LocalInference's `Engine` (ruling 9): today's model management —
 * `EngineSurface` over a settings-driven engine adapter, `ModelManagementSection`
 * and `StoragePage` — the same trio Simple mode already opens from the
 * provider row (`SimpleSettings.tsx`), now fed from `settings`/`update`
 * instead of the store.
 *
 * The legs are the audio mode's (`providerStore.legs`), so the page shows
 * the directions a start would run (roadmap 1e-2 → 1e-3).
 */
export function LocalInferenceEngine({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, initialSlot, onInitialSlotConsumed,
}: EngineProps<LocalInferenceSettings>) {
  // A fresh object literal every render would defeat useWasmEngineAdapter's
  // own useMemo (its deps array holds this `override` reference). Keyed on
  // the pair's languages: the store hands out a new pair object on every
  // settings write.
  const { source, target } = pair;
  const override = useMemo(() => ({ settings, update, pair: { source, target } }), [settings, update, source, target]);
  const adapter = useWasmEngineAdapter(disabled, override);
  return (
    <EngineSurface
      adapter={adapter}
      effectiveMode={modeOfLegs(legs)}
      initialSlot={initialSlot ?? null}
      onInitialSlotConsumed={onInitialSlotConsumed}
      renderLibrary={(slot) => (
        <ModelManagementSection
          isSessionActive={disabled}
          stageFilter={slot.stage}
          direction={slot.dir}
          settings={settings}
          update={update}
          pair={pair}
        />
      )}
      renderStorage={() => (
        <StoragePage provider="wasm" isSessionActive={disabled} settings={settings} pair={pair} />
      )}
    />
  );
}
