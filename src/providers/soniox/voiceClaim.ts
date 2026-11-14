/**
 * Kizuna Soniox's `prepare` (survey §1.9, §2.3): before a speaking
 * session, claim the account's cloned voice in the region the session runs
 * in — the backend runs Soniox's voice quota as an LRU cache, so a voice
 * chosen days ago may be gone — rebuilding it from this device's clip when
 * it must. Ported from `KizunaAISonioxProviderConfig.prepareToStart`
 * (deleted since). It never refuses a start: a claim that fails
 * runs this session on the built-in voice, says why once the session is up,
 * and leaves the stored choice alone. The routine's sleeps run on the real
 * clock, injectable for tests (ruling 10).
 */
import type { Prepared, RunShape } from '../../lib/session/types';
import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
import { SONIOX_DEFAULT_VOICE, isSonioxBuiltInVoice } from '../../lib/soniox/ttsCatalog';
import { reportWarning } from '../../lib/diagnostics/report';
import { hasVoiceClip, loadVoiceClip } from '../../lib/soniox/voiceClipStorage';
import { ManagedVoicesClient } from './managedVoicesClient';
import { sonioxVoiceField, type SonioxSettings } from './settings';
import { prepareManagedVoice, resolveVoicePrepOutcome } from './voicePrep';

export interface VoiceClaimDeps {
  /** The claim routine; `prepareManagedVoice` by default. */
  prepare?: typeof prepareManagedVoice;
  /** The voices client for the run's region; `new ManagedVoicesClient(getToken, region)` by default. */
  clientFor?(getToken: () => Promise<string | null>, region: SonioxRegion): ManagedVoicesClient;
  /** This device's reference clip, filed under an account; `loadVoiceClip` by default. */
  loadClip?(userId: string | null | undefined): Promise<Blob | null>;
  /** Whether an account's clip is on this device, rejecting when storage cannot be read; `hasVoiceClip` by default. */
  hasDeviceClip?(userId: string | null | undefined): Promise<boolean>;
}

export function createKizunaVoiceClaim(deps: VoiceClaimDeps = {}) {
  const prepare = deps.prepare ?? prepareManagedVoice;
  const clientFor = deps.clientFor ?? ((getToken, region) => new ManagedVoicesClient(getToken, region));
  const loadClip = deps.loadClip ?? loadVoiceClip;
  const hasDeviceClip = deps.hasDeviceClip ?? hasVoiceClip;

  /** True only when storage answered that this account's clip is not here; a read failure proves nothing. */
  async function provablyNoClip(userId: string | null | undefined): Promise<boolean> {
    try {
      return !(await hasDeviceClip(userId));
    } catch (cause) {
      reportWarning('SonioxVoice', 'Could not check this device for the voice clip; the stored voice was left unchanged.', { dedupeKey: 'voice:claim-clip', cause });
      return false;
    }
  }

  return async function claimVoice(shape: RunShape, s: SonioxSettings, signal: AbortSignal): Promise<Prepared<SonioxSettings>> {
    // The speaker's voice, when it speaks: the participant's speech ships off (ruling 2), and turning it on revisits this (the checklist's item 5).
    if (!shape.legs.includes('speaker') || shape.textOnly) return {};
    const region = asSonioxRegion(s.region);
    // A clone is a UUID inside one region's project: that region's own field.
    const field = sonioxVoiceField(region);
    const voice = s[field];
    if (!voice || isSonioxBuiltInVoice(voice)) return {};
    const result = await prepare({
      client: clientFor(() => shape.auth.getToken(), region),
      // This account's clip only: a recording on a shared device is never uploaded under another account.
      loadClip: () => loadClip(shape.auth.userId),
      signal,
      // The payer this start chose.
      payer: () => shape.payer,
    });
    // The start this claim belonged to is gone: nothing to apply.
    if (signal.aborted) return {};
    const outcome = resolveVoicePrepOutcome(result, voice, SONIOX_DEFAULT_VOICE);
    const patch = { [field]: outcome.sessionVoice } as Partial<SonioxSettings>;
    // A fallback is this run's only, unless no clip here can ever rebuild the voice (`clip_required`): then the outcome also carries the default to persist.
    // `clip_required` is also reached when the clip read failed (`loadVoiceClip` swallows it) or the uploaded clip was refused, so the default is persisted only once storage answers that this account's clip is not here.
    if (outcome.notice) {
      if (!outcome.settingsPatch) return { override: patch, notice: outcome.notice };
      const persist = await provablyNoClip(shape.auth.userId);
      if (signal.aborted) return {};
      return persist ? { override: patch, notice: outcome.notice, persist: patch } : { override: patch, notice: outcome.notice };
    }
    // A rebuilt clone has a new id: the run uses it, and it is written back where the stored choice is still the one claimed (`persistIfUnchanged`).
    return outcome.settingsPatch ? { override: patch, persist: patch } : {};
  };
}
