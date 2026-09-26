// Binds applySetupDraft to the live stores. Mocked out in SetupWizard's render
// tests so the component can be exercised without the stores' import graph.
//
// applyProvider writes through the provider store (plan 1e-3b-2's switch), the
// one writer of the session's provider settings; readiness re-checks on the
// store's own reset.
import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import useAudioStore from '../../stores/audioStore';   // default export only — there is no named useAudioStore
import { useSetupStore } from '../../stores/setupStore';
import { useProviderStore } from '../../stores/providerStore';
import { presentProviders } from '../../providers/registry';
import { providerIdFromStored } from '../../lib/session/storedSettings';
import { applySetupDraft } from './applySetup';
import type { SetupDraft } from './setupDraft';

export function useApplySetup(): (draft: SetupDraft) => Promise<void> {
  return useCallback(async (draft: SetupDraft) => {
    const s = useSettingsStore.getState();
    await applySetupDraft(draft, {
      setMode: useAudioStore.getState().setMode,
      setTextOnly: s.setTextOnly,
      setSpeakerDisplayMode: s.setSpeakerDisplayMode,
      setParticipantDisplayMode: s.setParticipantDisplayMode,
      applyProvider: async (provider, pair, credentials) => {
        const id = providerIdFromStored(provider);
        const p = presentProviders().find((candidate) => candidate.id === id);
        if (!p) throw new Error(`This build does not offer "${provider}".`);
        const store = useProviderStore.getState();
        await store.load(p);
        for (const [key, value] of Object.entries(credentials)) {
          if (p.credentials.keys.includes(key)) store.setCredential(p, key, value);
        }
        store.setPair(p, pair);
        // A wizard choice is a person's: it persists (1e-3b-1 ruling 8).
        store.select(p.id, 'pick');
      },
      completeSetup: useSetupStore.getState().completeSetup,
    });
  }, []);
}
