/**
 * The vocabulary of a reconnect, declared at the contract's layer so the
 * adapter contract can name it without reaching into `src/lib/session/`.
 * The policy that uses it lives in `src/lib/session/reconnect.ts`, which
 * re-exports these. Platform-neutral: types only.
 */

/** How the connection was lost. */
export type DropCause = 'close' | 'error' | 'timeout' | 'stall';

export interface DropInfo {
  cause: DropCause;
  closeCode?: number;
  errorCode?: string;
  /** The adapter's verdict: whether a reconnect is worth trying. */
  retryable: boolean;
  /** Whether the credentials come from the Kizuna lease (as opposed to the user's own key). */
  managed: boolean;
}

export interface ReconnectedInfo {
  attempts: number;
  credentialsReissued: boolean;
  /** Time spent fetching credentials, summed across the attempts. */
  reissueMs: number;
  /** The drop came within the flapping window of the previous reconnect, so it continued that drop's budget. */
  budgetShared: boolean;
}

export interface GiveUp {
  attempts: number;
  reason: 'timeout' | 'refused' | 'terminal_error' | 'session_cap' | 'lease_ended';
  /** The code the leg fails with: `connection_lost`, except a final refusal's own code. */
  code: string;
  message: string;
  /** The last failed attempt's code. */
  errorCode?: string;
  refusalCode?: string;
  /** The final refusal's notice params (a frozen organization's name and role). */
  params?: Record<string, string | number>;
}
