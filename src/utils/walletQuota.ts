import type { QuotaData } from '../contexts/UserProfileContext';

/** Raw shape returned by the backend `/api/wallet/status` endpoint. */
export interface WalletStatus {
  balance: number;
  frozen: boolean;
  usage: number;
}

/**
 * Map the backend wallet status into the frontend `QuotaData` shape.
 *
 * Critically, this always sets `balance` (and `frozen`), which the Start-button
 * gate `hasValidBalance` requires (`quota.balance !== undefined && >= 0`). The
 * previous placeholder omitted `balance`, which silently disabled the button for
 * the backend-managed (KizunaAI) providers.
 */
export function mapWalletStatusToQuota(s: WalletStatus): QuotaData {
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
