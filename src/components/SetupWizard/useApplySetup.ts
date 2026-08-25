// Binds applySetupDraft to the live stores. Mocked out in SetupWizard's render
// tests so the component can be exercised without the stores' import graph.
import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import useAudioStore from '../../stores/audioStore';   // default export only — there is no named useAudioStore
import { useSetupStore } from '../../stores/setupStore';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { useAuth } from '../../lib/auth/hooks';
import { applySetupDraft } from './applySetup';
import type { SetupDraft } from './setupDraft';

export function useApplySetup(): (draft: SetupDraft) => Promise<void> {
  const { getToken, isSignedIn } = useAuth();
  return useCallback(async (draft: SetupDraft) => {
    const s = useSettingsStore.getState();
    await applySetupDraft(draft, {
      currentProvider: s.provider,
      sliceKeyFor: (p) => ProviderConfigFactory.getDescriptor(p).settingsSliceKey,
      setMode: useAudioStore.getState().setMode,
      setTextOnly: s.setTextOnly,
      setSpeakerDisplayMode: s.setSpeakerDisplayMode,
      setParticipantDisplayMode: s.setParticipantDisplayMode,
      updateProviderSlice: s.updateProviderSlice,
      setProvider: s.setProvider,
      completeSetup: useSetupStore.getState().completeSetup,
      validateApiKey: () => useSettingsStore.getState().validateApiKey(getToken, isSignedIn),
    });
  }, [getToken, isSignedIn]);
}
