/**
 * When the signed-in account changes, the managed Soniox provider's custom voice (in its current region) may
 * belong to the previous account: reconcile it once per new user.
 */
import { reportWarning } from '../lib/diagnostics/report';
import type { AnyProvider, AuthContext } from '../lib/provider/types';
import { asSonioxRegion } from '../lib/soniox/regions';
import { reconcileSonioxVoiceField } from '../providers/soniox/voiceFieldReconcile';
import { useProviderStore } from '../stores/providerStore';

const MANAGED_ID = 'kizunaai_soniox';

export function watchSonioxVoiceAccount(o: {
  auth(): AuthContext;
  watchSignIn(fn: () => void): () => void;
  providers(): readonly AnyProvider[];
  reconcile?: typeof reconcileSonioxVoiceField;
}): () => void {
  const reconcile = o.reconcile ?? reconcileSonioxVoiceField;
  let lastUser: string | null = null;
  const check = () => {
    const a = o.auth();
    if (!a.signedIn) { lastUser = null; return; }
    if (a.loaded === false) return;
    const user = a.userId ?? null;
    if (user === null || user === lastUser) return;
    lastUser = user;
    const p = o.providers().find((x) => x.id === MANAGED_ID);
    if (!p) return;
    void (async () => {
      try {
        if (!useProviderStore.getState().entries[p.id]) await useProviderStore.getState().load(p);
        const entry = useProviderStore.getState().entries[p.id];
        if (!entry) return;
        await reconcile(p, asSonioxRegion((entry.settings as { region?: unknown }).region), o.auth);
      } catch (cause) {
        reportWarning('SonioxVoice', 'Could not check the custom voice after an account change.', { dedupeKey: 'voice:account', cause });
      }
    })();
  };
  const off = o.watchSignIn(check);
  check();
  return off;
}
