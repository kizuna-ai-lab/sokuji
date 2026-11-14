/**
 * Looks up what the account (managed) or the region's key (own key) really owns and rewrites a stale
 * custom-voice field of one region. Every write is compare-before-write; a lookup that failed, or being
 * offline, changes nothing. Never rejects.
 */
import { reportWarning } from '../../lib/diagnostics/report';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import type { SonioxRegion } from '../../lib/soniox/regions';
import { isSonioxBuiltInVoice } from '../../lib/soniox/ttsCatalog';
import { hasVoiceClip } from '../../lib/soniox/voiceClipStorage';
import { reconcileManagedSonioxVoice, reconcileSonioxVoice } from '../../lib/soniox/voiceReconcile';
import { useProviderStore } from '../../stores/providerStore';
import { ManagedVoicesClient } from './managedVoicesClient';
import { sonioxKeyField, sonioxVoiceField } from './settings';
import { SonioxVoicesClient } from './voicesClient';

export interface VoiceFieldReconcileDeps {
  managedClient?(getToken: () => Promise<string | null>, region: SonioxRegion): Pick<ManagedVoicesClient, 'mine'>;
  ownKeyClient?(key: string, region: SonioxRegion): Pick<SonioxVoicesClient, 'list'>;
  hasDeviceClip?(userId: string | null | undefined): Promise<boolean>;
  online?(): boolean;
}

const defaultOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const defaultHasDeviceClip = (userId: string | null | undefined) => hasVoiceClip(userId);

export async function reconcileSonioxVoiceField(
  p: AnyProvider,
  region: SonioxRegion,
  auth: () => AuthContext | undefined,
  deps: VoiceFieldReconcileDeps = {},
): Promise<void> {
  try {
    const entryOf = () => useProviderStore.getState().entries[p.id];
    const field = sonioxVoiceField(region);
    const snapshot = entryOf();
    if (!snapshot) return;
    const stored = (snapshot.settings as Record<string, unknown>)[field];
    if (typeof stored !== 'string' || !stored || isSonioxBuiltInVoice(stored)) return;
    if (!(deps.online ?? defaultOnline)()) return;

    const startUser = auth()?.userId ?? null;
    let next: string;
    if (p.kind === 'managed') {
      const a = auth();
      if (!a || !a.signedIn || a.loaded === false) return;
      // Only a managed start can rebuild a voice from this account's clip.
      const hasClip = await (deps.hasDeviceClip ?? defaultHasDeviceClip)(startUser);
      // Bound to the account this started for: another account's token must never answer for it, even if
      // the account switches back before the answer lands. No token, no lookup, nothing written.
      const getToken = async () => {
        const now = auth();
        return (now?.userId ?? null) === startUser ? (now ?? a).getToken() : null;
      };
      const client = (deps.managedClient ?? ((t, r) => new ManagedVoicesClient(t, r)))(getToken, region);
      next = reconcileManagedSonioxVoice(stored, await client.mine(), hasClip);
    } else {
      const key = (snapshot.credentials as Record<string, string | undefined>)[sonioxKeyField(region)];
      if (!key) return;
      const client = (deps.ownKeyClient ?? ((k, r) => new SonioxVoicesClient(k, r)))(key, region);
      next = reconcileSonioxVoice(stored, (await client.list()).map((v) => v.id), false);
    }
    if (next === stored) return;
    const now = entryOf();
    if (!now || (now.settings as Record<string, unknown>)[field] !== stored) return;
    if ((auth()?.userId ?? null) !== startUser) return;
    if (p.kind !== 'managed' && (now.credentials as Record<string, string | undefined>)[sonioxKeyField(region)] !== (snapshot.credentials as Record<string, string | undefined>)[sonioxKeyField(region)]) return;
    await useProviderStore.getState().updateSettings(p, { [field]: next });
  } catch (cause) {
    reportWarning('SonioxVoice', 'Could not check the custom voice against the account; it was left unchanged.', { dedupeKey: 'voice:reconcile', cause });
  }
}
