import { useMemo } from 'react';
import { EngineSurface } from '../../components/Settings/engine/EngineSurface';
import { ModelManagementSection } from '../../components/Settings/sections/ModelManagementSection';
import { StoragePage } from '../../components/Settings/engine/StoragePage';
import { useWasmEngineAdapter } from '../../components/Settings/engine/useWasmEngineAdapter';
import type { SettingsProps } from '../../lib/provider/types';
import type { LocalInferenceSettings } from './settings';

/** `ProviderPanel` always supplies `pair`; this only matters standalone. */
const FALLBACK_PAIR = { source: 'ja', target: 'en' };

/**
 * LocalInference's `Engine` (ruling 9): today's model management —
 * `EngineSurface` over a settings-driven engine adapter, `ModelManagementSection`
 * and `StoragePage` — the same trio Simple mode already opens from the
 * provider row (`SimpleSettings.tsx`), now fed from `settings`/`update`
 * instead of the store.
 *
 * `effectiveMode` is fixed at `'both'`: which legs a run will actually open
 * (`ctx.legs`) is not part of `SettingsProps`, so this Engine cannot yet
 * tell — showing both directions unconditionally is the safe default until
 * legs are threaded through (a later plan's gap, not this task's to close).
 */
export function LocalInferenceEngine({ settings, update, disabled = false, pair = FALLBACK_PAIR }: SettingsProps<LocalInferenceSettings>) {
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
      effectiveMode="both"
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
