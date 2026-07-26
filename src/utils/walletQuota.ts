import type { QuotaData } from '../contexts/UserProfileContext';

/** Raw shape returned by the backend `/api/wallet/status` endpoint. */
export interface WalletStatus {
  /** Balance in micro-USD (1 USD = 1,000,000). */
  balanceMicroUsd?: number;
  frozen: boolean;
  last30DaysUsageMicroUsd?: number;
  /** @deprecated Legacy alias for `balanceMicroUsd`; same units. */
  balance?: number;
  /** @deprecated Legacy alias for `last30DaysUsageMicroUsd`; same units. */
  usage?: number;
}

/**
 * Runtime type guard for the raw `/api/wallet/status` payload.
 *
 * The response is parsed as untyped JSON, so guard the shape at this trust
 * boundary: a drifting backend must not produce a `QuotaData` with a
 * `NaN`/`undefined` balance that the Start-button gate would then misread.
 * Either the current or the legacy money field satisfies the guard.
 */
export function isWalletStatus(value: unknown): value is WalletStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  return typeof v.frozen === 'boolean'
    && (num(v.balanceMicroUsd) || num(v.balance))
    && (num(v.last30DaysUsageMicroUsd) || num(v.usage));
}

/**
 * Map the backend wallet status into the frontend `QuotaData` shape.
 *
 * `balance` carries micro-USD (1 USD = 1,000,000). It always gets set, which the
 * Start-button gate `hasValidBalance` requires (`quota.balance !== undefined &&
 * >= 0`); omitting it silently disables the button for backend-managed providers.
 *
 * Throws on a malformed payload — callers fetch inside try/catch and fail closed
 * (quota stays null → Start disabled), which is safer than propagating bad data.
 */
export function mapWalletStatusToQuota(s: unknown): QuotaData {
  if (!isWalletStatus(s)) {
    throw new Error('Invalid wallet status payload');
  }
  const balance = s.balanceMicroUsd ?? s.balance ?? 0;
  const usage = s.last30DaysUsageMicroUsd ?? s.usage ?? 0;
  return {
    balance,
    frozen: s.frozen,
    last30DaysUsage: usage,
    // Compatibility fields used elsewhere in the UI.
    total: balance,
    used: usage,
    remaining: s.frozen ? 0 : balance,
    resetDate: null,
    plan: 'free',
  };
}
