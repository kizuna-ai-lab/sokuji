// Binds applySetupDraft to the live stores. Mocked out in SetupWizard's render
// tests so the component can be exercised without the stores' import graph.
//
// applyProvider writes through the provider store, the one writer of the
// session's provider settings, and resolves once those writes have landed;
// readiness re-checks on the store's own reset.
import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import useAudioStore from '../../stores/audioStore';   // default export only — there is no named useAudioStore
import { useSetupStore, SetupPersistError } from '../../stores/setupStore';
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
      applyProvider: async (provider, pair, credentials, settings) => {
        const id = providerIdFromStored(provider);
        const p = presentProviders().find((candidate) => candidate.id === id);
        if (!p) throw new Error(`This build does not offer "${provider}".`);
        const store = useProviderStore.getState();
        await store.load(p);
        // The credential choice first (F4): the credentials below are the
        // fields it shows. Only the provider's own choice is a setting the
        // wizard writes (Stage 2 Volcengine AST2, ruling 1).
        const choice = p.credentials.choice?.setting;
        if (choice !== undefined && settings[choice] !== undefined) store.updateSettings(p, { [choice]: settings[choice] });
        for (const [key, value] of Object.entries(credentials)) {
          if (p.credentials.keys.includes(key)) store.setCredential(p, key, value);
        }
        store.setPair(p, pair);
        // A wizard choice is a person's: it persists (1e-3b-1 ruling 8).
        store.select(p.id, 'pick');
        // The record comes last and says setup is done: never over a provider
        // whose settings are not on disk yet (the extension's storage is
        // asynchronous, and a closed side panel would keep the record alone).
        if (!await store.flush(p)) throw new SetupPersistError();
      },
      completeSetup: useSetupStore.getState().completeSetup,
    });
  }, []);
}
