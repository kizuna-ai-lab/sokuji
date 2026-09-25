// Binds applySetupDraft to the live stores. Mocked out in SetupWizard's render
// tests so the component can be exercised without the stores' import graph.
//
// applyProvider is bound to the OLD stores here — Task 5 of the switch rebinds
// it to providerStore (plan 1e-3b-2, "the dual-writer constraint"): this file
// mounts no new writer until then.
import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import useAudioStore from '../../stores/audioStore';   // default export only — there is no named useAudioStore
import { useSetupStore } from '../../stores/setupStore';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { useAuth } from '../../lib/auth/hooks';
import { reportWarning, describeCause } from '../../lib/diagnostics/report';
import { applySetupDraft } from './applySetup';
import type { SetupDraft } from './setupDraft';

export function useApplySetup(): (draft: SetupDraft) => Promise<void> {
  const { getToken, isSignedIn } = useAuth();
  return useCallback(async (draft: SetupDraft) => {
    const s = useSettingsStore.getState();
    await applySetupDraft(draft, {
      setMode: useAudioStore.getState().setMode,
      setTextOnly: s.setTextOnly,
      setSpeakerDisplayMode: s.setSpeakerDisplayMode,
      setParticipantDisplayMode: s.setParticipantDisplayMode,
      applyProvider: async (provider, pair, credentials) => {
        const s = useSettingsStore.getState();
        const unchanged = provider === s.provider;
        await s.updateProviderSlice(ProviderConfigFactory.getDescriptor(provider).settingsSliceKey, { sourceLanguage: pair.source, targetLanguage: pair.target, ...credentials });
        await s.setProvider(provider);
        // setProvider clears the validation cache even for the provider already
        // selected, and SettingsInitializer re-validates only on a change (moved
        // here from applySetup.ts). Fired, not awaited: today it ran after the
        // record was written; here it runs before, and awaiting it would hold the
        // record behind a check that scans IndexedDB first on the offline path —
        // and a failed check must never cost the record.
        if (unchanged) {
          void useSettingsStore.getState().validateApiKey(getToken, isSignedIn).catch((error: unknown) =>
            reportWarning('SetupWizard', `Checking the provider after setup failed: ${describeCause(error)}`, { cause: error }));
        }
      },
      completeSetup: useSetupStore.getState().completeSetup,
    });
  }, [getToken, isSignedIn]);
}
