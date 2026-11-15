/**
 * A stored custom voice id can go stale: after a region or account change it may name a voice this
 * account/project does not own. These are the pure rules; the service that looks things up and writes is
 * `providers/soniox/voiceFieldReconcile.ts`. A built-in name and an empty field are never touched.
 */
import { SONIOX_DEFAULT_VOICE, isSonioxBuiltInVoice } from './ttsCatalog';

/**
 * Own key: `ownedVoices` is what `list()` returned (`null` when the lookup failed). An owned id stays, any status;
 * an unknown one stays only when this device holds the account's clip (Start rebuilds it), else the default.
 */
export function reconcileSonioxVoice(stored: string, ownedVoices: readonly string[] | null, hasDeviceClip: boolean): string {
  if (!stored || isSonioxBuiltInVoice(stored)) return stored;
  if (ownedVoices === null) return stored;
  if (ownedVoices.includes(stored)) return stored;
  if (hasDeviceClip) return stored;
  return SONIOX_DEFAULT_VOICE;
}

/** Managed: `mine` is the account's own voice in the region (`null` none, `undefined` the lookup failed). */
export function reconcileManagedSonioxVoice(
  stored: string,
  mine: { voiceId: string; status: string } | null | undefined,
  hasDeviceClip: boolean,
): string {
  if (mine === undefined) return stored;
  if (!stored || isSonioxBuiltInVoice(stored)) return stored;
  if (mine && mine.status !== 'failed' && mine.voiceId !== stored) return mine.voiceId;
  return reconcileSonioxVoice(stored, mine ? [mine.voiceId] : [], hasDeviceClip);
}
