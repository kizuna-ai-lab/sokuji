import type { QuotaData } from '../contexts/UserProfileContext';

/** Raw shape returned by the backend `/api/wallet/status` endpoint. */
export interface WalletStatus {
  balance: number;
  frozen: boolean;
  usage: number;
}

/**
 * Runtime type guard for the raw `/api/wallet/status` payload.
 *
 * The response is parsed as untyped JSON, so guard the shape at this trust
 * boundary: a drifting backend (missing/null/non-numeric fields) must not
 * produce a `QuotaData` with a `NaN`/`undefined` balance that the Start-button
 * gate would then misread.
 */
export function isWalletStatus(value: unknown): value is WalletStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.balance === 'number' && Number.isFinite(v.balance) &&
    typeof v.frozen === 'boolean' &&
    typeof v.usage === 'number' && Number.isFinite(v.usage)
  );
}

/**
 * Map the backend wallet status into the frontend `QuotaData` shape.
 *
 * Critically, this always sets `balance` (and `frozen`), which the Start-button
 * gate `hasValidBalance` requires (`quota.balance !== undefined && >= 0`). The
 * previous placeholder omitted `balance`, which silently disabled the button for
 * the backend-managed (KizunaAI) providers.
 *
 * Throws on a malformed payload — callers fetch inside try/catch and fail closed
 * (quota stays null → Start disabled), which is safer than propagating bad data.
 */
export function mapWalletStatusToQuota(s: unknown): QuotaData {
  if (!isWalletStatus(s)) {
    throw new Error('Invalid wallet status payload');
  }
  return {
    balance: s.balance,
    frozen: s.frozen,
    last30DaysUsage: s.usage,
    // Compatibility fields used elsewhere in the UI.
    total: s.balance,
    used: s.usage,
    remaining: s.frozen ? 0 : s.balance,
    resetDate: null,
    plan: 'free',
  };
}
