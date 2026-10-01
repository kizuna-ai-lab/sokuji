// Builds a TourCtx from the live stores and starts chapter 1. Help's
// "Restart Setup Guide" uses it; the wizard seeds its own ctx instead
// (it knows the credential outcome the store does not yet).
import { useCallback } from 'react';
import { useAuth } from '../../lib/auth/hooks';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProviderStore } from '../../stores/providerStore';
import { storedProviderValue } from '../../lib/session/storedSettings';
import { useLayoutStore } from '../../stores/layoutStore';
import useAudioStore from '../../stores/audioStore';   // default export only
import { isElectron, isExtension, isLinux, isMacOS, isWindows } from '../../utils/environment';
import type { ProviderType } from '../../types/Provider';
import { buildTourCtx } from './tourContext';
import { useTour } from './TourProvider';

export function useStartBasicsTour(): () => void {
  const { isSignedIn } = useAuth();
  const { start } = useTour();
  return useCallback(() => {
    // Every caller, not just the one that happens to hold a toggle: Help lives
    // in the settings panel, and SimpleSettings renders HelpSection without a
    // `toggleSettings` prop, so the panel would sit open under the tour it just
    // restarted. Steps that need the panel reopen it in their own `prepare`.
    useLayoutStore.getState().setShowSettings(false);
    const s = useSettingsStore.getState();
    start(buildTourCtx({
      record: useSetupStore.getState().setup,
      // The selected provider, in the old enum's spelling — never the record's,
      // which is wizard-time history (tourContext.ts).
      provider: storedProviderValue(useProviderStore.getState().selected ?? '') as ProviderType,
      mode: useAudioStore.getState().mode,
      textOnly: s.textOnly,
      isSignedIn,
      apiKeyValid: s.isApiKeyValid,
      env: { isElectron: isElectron(), isExtension: isExtension(), isLinux: isLinux(), isMacOS: isMacOS(), isWindows: isWindows() },
    }));
  }, [isSignedIn, start]);
}
