import { useMemo } from 'react';
import { EngineSurface } from '../../components/Settings/engine/EngineSurface';
import { useNativeEngineAdapter, type NativeEngineSettings } from '../../components/Settings/engine/useNativeEngineAdapter';
import { useSettingsStore } from '../../stores/settingsStore';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import type { EngineProps } from '../../lib/provider/types';
import { FALLBACK_PAIR, modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

// The native model UI edits a slice of Local Native's settings: the type checker holds the fit here, where it is handed over.
const fitsTheModelUi = (s: LocalNativeSettings): NativeEngineSettings => s;

/**
 * Local Native's `Engine`, in the manner of LocalInference's: `EngineSurface` over `useNativeEngineAdapter` fed from
 * `settings` / `update` / the pair — the engine page draws the engine card at its top through the adapter's gate (it
 * draws only the states a person can act on) — and, while a slot's
 * "Browse library…" goes to that stage of the native library in Models and storage (#578 ruling 27). Voice previews
 * take the app's route through the preview port its host hands it (#578 ruling 13).
 */
export function LocalNativeEngine({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, initialSlot, onInitialSlotConsumed, preview,
}: EngineProps<LocalNativeSettings>) {
  // Keyed on the pair's languages: the store hands out a new pair object on every settings write.
  const { source, target } = pair;
  const hostPair = useMemo(() => ({ source, target }), [source, target]);
  const override = useMemo(() => ({ settings: fitsTheModelUi(settings), update, pair: hostPair }), [settings, update, hostPair]);
  const adapter = useNativeEngineAdapter(disabled, override);
  return (
    <VoicePreviewContext.Provider value={preview ?? null}>
      <EngineSurface
        adapter={adapter}
        effectiveMode={modeOfLegs(legs)}
        initialSlot={initialSlot ?? null}
        onInitialSlotConsumed={onInitialSlotConsumed}
        onBrowse={(slot) => useSettingsStore.getState().navigateToSettings(`native-models-${slot.stage}`)}
      />
    </VoicePreviewContext.Provider>
  );
}
