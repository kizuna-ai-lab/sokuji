import { useMemo } from 'react';
import { EngineSurface } from '../../components/Settings/engine/EngineSurface';
import { StoragePage } from '../../components/Settings/engine/StoragePage';
import { useNativeEngineAdapter } from '../../components/Settings/engine/useNativeEngineAdapter';
import { NativeModelManagementSection } from '../../components/Settings/sections/NativeModelManagementSection';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import type { EngineProps } from '../../lib/provider/types';
import { FALLBACK_PAIR, modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

/**
 * Local Native's `Engine`: the native model management — `EngineSurface` over
 * `useNativeEngineAdapter`, `NativeModelManagementSection` and `StoragePage`'s
 * native half — fed from `settings` / `update` / the pair (spec: Migration
 * item 10). Voice previews take the app's route through the preview port its
 * host hands it (#578 ruling 13).
 */
export function LocalNativeEngine({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, initialSlot, onInitialSlotConsumed, preview,
}: EngineProps<LocalNativeSettings>) {
  // Keyed on the pair's languages: the store hands out a new pair object on every settings write.
  const { source, target } = pair;
  const hostPair = useMemo(() => ({ source, target }), [source, target]);
  const override = useMemo(() => ({ settings, update, pair: hostPair }), [settings, update, hostPair]);
  const adapter = useNativeEngineAdapter(disabled, override);
  return (
    <VoicePreviewContext.Provider value={preview ?? null}>
      <EngineSurface
        adapter={adapter}
        effectiveMode={modeOfLegs(legs)}
        initialSlot={initialSlot ?? null}
        onInitialSlotConsumed={onInitialSlotConsumed}
        renderLibrary={(slot) => (
          <NativeModelManagementSection
            isSessionActive={disabled}
            stageFilter={slot.stage}
            direction={slot.dir}
            settings={settings}
            update={update}
            pair={hostPair}
          />
        )}
        renderStorage={() => <StoragePage provider="native" isSessionActive={disabled} settings={settings} pair={hostPair} />}
      />
    </VoicePreviewContext.Provider>
  );
}
