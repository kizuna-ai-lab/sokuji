import { useLayoutEffect, useMemo, useRef } from 'react';
import type { AnyProvider, AuthContext, EngineSlot } from '../../lib/provider/types';
import { useProviderStore } from '../../stores/providerStore';
import { ownProps, useSelectedProvider } from './useSelectedProvider';

interface ProviderOwnSettingsProps {
  providers: readonly AnyProvider[];
  /** A run is not idle: the provider's own settings are locked. */
  disabled?: boolean;
}

/** The selected provider's own `Settings` (D18), over its loaded entry, with its account (F3): the saved credentials and `auth`, the sign-in. Nothing before the entry loads. */
export function ProviderOwnSettings({ providers, auth, disabled }: ProviderOwnSettingsProps & { auth: AuthContext }) {
  const selection = useSelectedProvider(providers);
  const credentials = selection?.entry?.credentials;
  // The hosts' `auth` is a new object on every render (`useAuth` makes
  // `getToken` inline), so the account never keys on it. Its `getToken`
  // calls the latest host's through this ref, current from the commit on;
  // a layout effect, not a render-phase write, so an abandoned render's
  // `auth` never reaches it (as `ColorPicker`'s `onChangeRef`).
  const latestAuth = useRef(auth);
  useLayoutEffect(() => {
    latestAuth.current = auth;
  });
  const { signedIn, userId } = auth;
  // One identity while the saved credentials (the entry's object, replaced
  // only by an edit), the signed-in state and the user stay the same: a
  // Settings that keys an effect on its account (a voice library) re-runs
  // only then.
  const account = useMemo(
    () => (credentials ? { credentials, auth: { signedIn, userId, getToken: () => latestAuth.current.getToken() } } : undefined),
    [credentials, signedIn, userId],
  );
  if (!selection?.entry) return null;
  const Settings = selection.provider.Settings;
  return <Settings {...ownProps(selection, selection.entry, disabled)} account={account} />;
}

/**
 * The selected provider's `TurnDetection` Controls, as their own block on
 * Advanced's Provider tab in every turn mode. The Speech section's summary
 * links here: `#turn-detection-tuning-section` is what Settings.tsx scrolls
 * to and highlights for the `'turn-detection-tuning'` target. Nothing when
 * the provider has no `TurnDetection`, or before its entry loads.
 */
export function ProviderTurnDetectionControls({ providers, disabled }: ProviderOwnSettingsProps) {
  const selection = useSelectedProvider(providers);
  if (!selection?.entry) return null;
  const Controls = selection.provider.TurnDetection?.Controls;
  if (!Controls) return null;
  return (
    <div className="turn-detection-tuning-block" id="turn-detection-tuning-section">
      <Controls {...ownProps(selection, selection.entry, disabled)} />
    </div>
  );
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
  const Engine = selection.provider.Engine;
  if (!Engine) return null;
  return (
    <Engine
      {...ownProps(selection, selection.entry, disabled)}
      legs={legs}
      initialSlot={initialSlot}
      onInitialSlotConsumed={onInitialSlotConsumed}
    />
  );
}
