import type { AnyProvider, EngineSlot } from '../../lib/provider/types';
import { useProviderStore } from '../../stores/providerStore';
import { useSelectedProvider } from './useSelectedProvider';

interface ProviderOwnSettingsProps {
  providers: readonly AnyProvider[];
  /** A run is not idle: the provider's own settings are locked. */
  disabled?: boolean;
}

/** The selected provider's own `Settings` (D18), over its loaded entry. Nothing before the entry loads. */
export function ProviderOwnSettings({ providers, disabled }: ProviderOwnSettingsProps) {
  const selection = useSelectedProvider(providers);
  if (!selection?.entry) return null;
  const { provider, entry, update } = selection;
  const Settings = provider.Settings;
  return <Settings settings={entry.settings} update={update} disabled={disabled} pair={entry.pair} />;
}

interface ProviderEngineProps {
  providers: readonly AnyProvider[];
  /** A run is not idle: the engine's settings are locked. */
  disabled?: boolean;
  /** Open this slot on mount — a chip's deep link. */
  initialSlot?: EngineSlot | null;
  onInitialSlotConsumed?(): void;
}

/**
 * The selected provider's `Engine` (ruling 3): model management, the local
 * engines only, with the legs a start would open and the deep-link slot.
 * Nothing when the provider offers none, or before its entry loads.
 */
export function ProviderEngine({ providers, disabled, initialSlot, onInitialSlotConsumed }: ProviderEngineProps) {
  const legs = useProviderStore((s) => s.legs);
  const selection = useSelectedProvider(providers);
  if (!selection?.entry) return null;
  const { provider, entry, update } = selection;
  const Engine = provider.Engine;
  if (!Engine) return null;
  return (
    <Engine
      settings={entry.settings}
      update={update}
      disabled={disabled}
      pair={entry.pair}
      legs={legs}
      initialSlot={initialSlot}
      onInitialSlotConsumed={onInitialSlotConsumed}
    />
  );
}
