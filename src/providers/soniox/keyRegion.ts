/**
 * Which Soniox regions accept a key (B-11; the owner, 2026-11-17). Each region is its own Soniox project with its own
 * keys, so a key works in one region only: the account page asks every region with the key the user pasted and
 * keeps it where it is accepted, so nobody has to know which region their key came from.
 */
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { SONIOX_REGIONS, type SonioxRegion } from '../../lib/soniox/regions';
import { checkSoniox } from './check';
import type { SonioxCredentials, SonioxSettings } from './settings';

export interface KeyRegions {
  /** The regions whose project accepted the key, in the usual region order. */
  accepted: SonioxRegion[];
  /** The regions that could not be asked (offline, Soniox down, too slow). */
  unreachable: SonioxRegion[];
}

type Check = (k: SonioxCredentials, s: SonioxSettings, ctx: CheckContext) => Promise<CheckResult>;

/** Asks every region at once with `key`, as the readiness check asks the selected one. */
export async function regionsAccepting(key: string, settings: SonioxSettings, check: Check = checkSoniox, signal?: AbortSignal): Promise<KeyRegions> {
  const stt = key.trim();
  const ctx: CheckContext = { pair: { source: 'auto', target: 'en' }, legs: ['speaker'], signal };
  const answers = await Promise.all(SONIOX_REGIONS.map(async (region) => {
    try {
      return { region, answer: (await check({ region, stt, tts: stt }, settings, ctx)).ok ? 'accepted' as const : 'refused' as const };
    } catch {
      return { region, answer: 'unreachable' as const };
    }
  }));
  return {
    accepted: answers.filter((a) => a.answer === 'accepted').map((a) => a.region),
    unreachable: answers.filter((a) => a.answer === 'unreachable').map((a) => a.region),
  };
}
