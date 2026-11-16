import { useMemo } from 'react';
import { EngineSurface } from '../../components/Settings/engine/EngineSurface';
import { ModelManagementSection } from '../../components/Settings/sections/ModelManagementSection';
import { useWasmEngineAdapter } from '../../components/Settings/engine/useWasmEngineAdapter';
import type { EngineProps } from '../../lib/provider/types';
import { FALLBACK_PAIR, modeOfLegs } from './engineLegs';
import type { LocalInferenceSettings } from './settings';

/**
 * LocalInference's `Engine` (ruling 9): today's model management —
 * `EngineSurface` over a settings-driven engine adapter and
 * `ModelManagementSection`, fed from `settings`/`update` instead of the store.
 * Storage (usage, deleting, importing) lives on the Models and storage page.
 *
 * The legs are the audio mode's (`providerStore.legs`), so the page shows
 * the directions a start would run (roadmap 1e-2 → 1e-3).
 */
export function LocalInferenceEngine({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, initialSlot, onInitialSlotConsumed, participantSpeaks = false,
}: EngineProps<LocalInferenceSettings>) {
  // A fresh object literal every render would defeat useWasmEngineAdapter's
  // own useMemo (its deps array holds this `override` reference). Keyed on
  // the pair's languages: the store hands out a new pair object on every
  // settings write.
  const { source, target } = pair;
  const override = useMemo(
    () => ({ settings, update, pair: { source, target }, participantSpeaks }),
    [settings, update, source, target, participantSpeaks],
  );
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
    />
  );
}
