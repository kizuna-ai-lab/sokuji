import { useMemo } from 'react';
import { EngineSurface } from '../../components/Settings/engine/EngineSurface';
import { useWasmEngineAdapter } from '../../components/Settings/engine/useWasmEngineAdapter';
import type { EngineProps } from '../../lib/provider/types';
import { FALLBACK_PAIR, modeOfLegs } from './engineLegs';
import type { LocalInferenceSettings } from './settings';

/**
 * LocalInference's `Engine` (ruling 9): `EngineSurface` over a settings-driven
 * engine adapter, fed from `settings`/`update` instead of the store. The model
 * library (downloading, importing, deleting) is the Models and storage page,
 * where a slot's "Browse library…" goes; the voices are in the speech card
 * (B-20).
 *
 * The legs are the audio mode's (`providerStore.legs`), so the page shows
 * the directions a start would run (roadmap 1e-2 → 1e-3).
 */
export function LocalInferenceEngine({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, initialSlot, onInitialSlotConsumed, participantSpeaks = false, speakerSpeaks = true,
}: EngineProps<LocalInferenceSettings>) {
  // A fresh object literal every render would defeat useWasmEngineAdapter's
  // own useMemo (its deps array holds this `override` reference). Keyed on
  // the pair's languages: the store hands out a new pair object on every
  // settings write.
  const { source, target } = pair;
  const override = useMemo(
    () => ({ settings, update, pair: { source, target }, participantSpeaks, speakerSpeaks }),
    [settings, update, source, target, participantSpeaks, speakerSpeaks],
  );
  const adapter = useWasmEngineAdapter(disabled, override);
  return (
    <EngineSurface
      adapter={adapter}
      effectiveMode={modeOfLegs(legs)}
      initialSlot={initialSlot ?? null}
      onInitialSlotConsumed={onInitialSlotConsumed}
    />
  );
}
