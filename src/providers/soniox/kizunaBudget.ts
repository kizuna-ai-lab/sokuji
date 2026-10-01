/**
 * What Kizuna AI's backend charges a managed Soniox session to start, and
 * how long it grants one — mirrored so the start gate and the grant-end
 * words can be right before the backend says so (Stage 2 Kizuna Soniox,
 * rulings 3 and 6). Ported from `sonioxManagedMinBalance.ts` (deleted
 * since). KEEP IN SYNC with sokuji-backend
 * `src/services/soniox-budget.ts` (the conservative rates) and
 * `src/config/soniox.ts` (`MIN_SESSION_S`, `MAX_TRANSCRIPTION_SESSION_S`,
 * `TTS_KEY_MAX_TTL_S`, `MAX_SYNTHESIS_SESSION_S`); `kizunaBudget.test.ts`
 * restates the arithmetic. The backend's 402 stays the authority.
 */
import type { BalanceShape } from '../../lib/session/types';
import { isSttRole, leaseRequest, requestedRoles, type StreamRole } from './leaseRequest';
import type { SonioxSettings } from './settings';

/** One stream's conservative budget rate in µUSD per hour: any `*_stt` role, any `*_tts` role. Integers, so the floor's ceil is exact. */
export const SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR = { stt: 1_100_000, tts: 1_400_000 } as const;
/** The shortest session the backend starts, in seconds. */
export const SONIOX_MANAGED_MIN_SESSION_S = 60;
/** The longest grant for a session with no synthesis stream. */
export const SONIOX_MAX_TRANSCRIPTION_SESSION_S = 18_000;
/** The longest grant for a session that speaks: its TTS key lives at most an hour. */
export const SONIOX_MAX_SYNTHESIS_SESSION_S = 3_600;

/** The backend's start floor for a stream set: its shortest session at the set's rate, rounded up — `ceil((n_stt × stt + n_tts × tts) × 60 / 3600)`. */
export function sonioxStartFloorMicroUsd(stt: number, tts: number): number {
  const rate = stt * SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.stt + tts * SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.tts;
  return Math.ceil((rate * SONIOX_MANAGED_MIN_SESSION_S) / 3600);
}

/** The floor of a role list: its STT roles at the STT rate, the rest at the TTS rate. */
export function sonioxRolesFloorMicroUsd(roles: readonly StreamRole[]): number {
  const stt = roles.filter(isSttRole).length;
  return sonioxStartFloorMicroUsd(stt, roles.length - stt);
}

/**
 * Kizuna Soniox's `minimumBalance`: the floor of the roles this start's
 * lease would ask for (choice 19) — split Both's second STT stream, the
 * speaker's TTS stream, and, only with the participant-speech flag on,
 * the participant's (ruling 2).
 */
export function kizunaSonioxMinimumBalance(shape: BalanceShape, s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>, participantSpeech = false): number {
  return sonioxRolesFloorMicroUsd(requestedRoles(leaseRequest(shape, s, participantSpeech)));
}

/** The per-session cap the backend holds a grant to (`maxSessionSecondsFor`). */
export function sonioxSessionCapSeconds(withSpeech: boolean): number {
  return withSpeech ? SONIOX_MAX_SYNTHESIS_SESSION_S : SONIOX_MAX_TRANSCRIPTION_SESSION_S;
}
