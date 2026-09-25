import { useMemo } from 'react';
import { OutputToggles, SpeechSection } from './sections/SpeechSection';
import SentenceSegmentationSection from './sections/SentenceSegmentationSection';
import { ProviderEngine, ProviderOwnSettings } from '../providers/ProviderOwnSettings';
import { ProviderLanguages } from '../providers/ProviderLanguages';
import { ProviderPicker } from '../providers/ProviderPicker';
import { useAuthContext } from '../providers/useAuthContext';
import type { EngineSlot } from '../../lib/provider/types';
import { presentProviders } from '../../providers/registry';
import { useMode } from '../../stores/audioStore';
import { useEngineSlotTarget, useSetEngineSlotTarget, useTextOnly } from '../../stores/settingsStore';

/**
 * The provider-related blocks the two Settings layouts show (plan 1e-3b-2):
 * the General tab and Simple mode's list share `SessionSettingsGeneral`;
 * Advanced's Provider tab is `SessionSettingsProvider`; Simple mode pushes
 * `SessionEnginePage` in place of its list when a chip is clicked (1e-3
 * ruling 10). Every block reads `providerStore` and the run's lock.
 */
export function SessionSettingsGeneral({ locked, onOpenSlot }: { locked: boolean; onOpenSlot(slot: EngineSlot): void }) {
  const providers = useMemo(() => presentProviders(), []);
  const auth = useAuthContext();
  const mode = useMode();
  const textOnly = useTextOnly();
  return (
    <>
      <ProviderLanguages providers={providers} disabled={locked} sentence={{ mode, textOnly }} />
      <SpeechSection locked={locked} />
      <OutputToggles locked={locked} />
      <SentenceSegmentationSection isSessionActive={locked} />
      <ProviderPicker providers={providers} auth={auth} disabled={locked} openSlot={onOpenSlot} />
    </>
  );
}

export function SessionSettingsProvider({ locked }: { locked: boolean }) {
  const providers = useMemo(() => presentProviders(), []);
  const auth = useAuthContext();
  const engineSlotTarget = useEngineSlotTarget();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  return (
    <>
      <ProviderPicker providers={providers} auth={auth} disabled={locked} openSlot={setEngineSlotTarget} />
      <ProviderEngine providers={providers} disabled={locked} initialSlot={engineSlotTarget} onInitialSlotConsumed={() => setEngineSlotTarget(null)} />
      <ProviderOwnSettings providers={providers} disabled={locked} />
    </>
  );
}

export function SessionEnginePage({ locked, slot }: { locked: boolean; slot: EngineSlot }) {
  const providers = useMemo(() => presentProviders(), []);
  return <ProviderEngine providers={providers} disabled={locked} initialSlot={slot} />;
}
