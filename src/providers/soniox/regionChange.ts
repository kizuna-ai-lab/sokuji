/**
 * Changing a Soniox region loses the custom voice: a clone is a UUID inside
 * one region's project, and each region has its own voice field. So a change
 * that would leave a custom voice behind asks first, and nothing is ever
 * copied across regions.
 */
import { currentAuth } from '../../app/currentAuth';
import { currentRunPhase } from '../../app/runPhase';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
import { SONIOX_DEFAULT_VOICE, isSonioxBuiltInVoice } from '../../lib/soniox/ttsCatalog';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionChangeStore } from '../../stores/regionChangeStore';
import { sonioxVoiceField, type SonioxSettings } from './settings';
import { reconcileSonioxVoiceField } from './voiceFieldReconcile';

export type SonioxRegionWarning = { kind: 'built-in'; name: string } | { kind: 'custom' };

/** What changing `from` → `to` costs the voice: nothing, or the custom voice, replaced by the new region's own. */
export function sonioxRegionWarning(s: SonioxSettings, from: SonioxRegion, to: SonioxRegion): SonioxRegionWarning | null {
  const current = s[sonioxVoiceField(from)];
  if (!current || isSonioxBuiltInVoice(current)) return null;
  const target = s[sonioxVoiceField(to)];
  if (target && !isSonioxBuiltInVoice(target)) return { kind: 'custom' };
  return { kind: 'built-in', name: target || SONIOX_DEFAULT_VOICE };
}

const entryOf = (p: AnyProvider) => useProviderStore.getState().entries[p.id];

/** `auth` serves only the reconciliation of the new region's voice field after the write; the change itself needs no account. */
export async function requestSonioxRegionChange(p: AnyProvider, from: SonioxRegion, to: SonioxRegion, auth?: AuthContext): Promise<boolean> {
  if (from === to || currentRunPhase() !== 'idle') return false;
  const entry = entryOf(p);
  if (!entry) return false;
  const warning = sonioxRegionWarning(entry.settings as SonioxSettings, from, to);
  if (warning) {
    const ok = await useRegionChangeStore.getState().ask({
      providerId: p.id as 'soniox' | 'kizunaai_soniox',
      managed: p.kind === 'managed',
      from,
      to,
      warning,
    });
    if (!ok) return false;
    // The page moved while the question was open: a run began, or the region changed elsewhere.
    if (currentRunPhase() !== 'idle') return false;
    const now = entryOf(p);
    if (!now || asSonioxRegion((now.settings as SonioxSettings).region) !== from) return false;
  }
  await useProviderStore.getState().updateSettings(p, { region: to });
  void reconcileSonioxVoiceField(p, to, () => currentAuth() ?? auth);
  return true;
}
