import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { ProviderEngine, ProviderOwnSettings } from './ProviderOwnSettings';
import { ProviderLanguages } from './ProviderLanguages';
import { ProviderPicker } from './ProviderPicker';

interface ProviderPanelProps {
  providers: readonly AnyProvider[];
  auth: AuthContext;
  /** A run is not idle: provider, languages, mode and the provider's own settings are locked. */
  disabled?: boolean;
}

/**
 * The provider area in pieces (ruling 2): the picker, its language pair, its
 * own settings, then its `Engine` — the pieces composed for the development
 * preview; the app's Settings compose them per layout instead
 * (`ProviderArea.tsx`).
 */
export function ProviderPanel({ providers, auth, disabled }: ProviderPanelProps) {
  return (
    <>
      <ProviderPicker providers={providers} auth={auth} disabled={disabled} />
      <ProviderLanguages providers={providers} disabled={disabled} />
      <ProviderOwnSettings providers={providers} auth={auth} disabled={disabled} />
      <ProviderEngine providers={providers} disabled={disabled} />
    </>
  );
}
