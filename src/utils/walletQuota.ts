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
  /** Present only for organization members (absent from older backends). */
  organization?: unknown;
  /** Present only for organization members (absent from older backends). */
  personal?: unknown;
}

type OrganizationQuota = NonNullable<QuotaData['organization']>;
type PersonalQuota = NonNullable<QuotaData['personal']>;

const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Keep the organization object only if every field has the right type. */
function parseOrganization(value: unknown): OrganizationQuota | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string'
    || !isFiniteNum(o.availableMicroUsd) || typeof o.frozen !== 'boolean'
    || (o.role !== 'owner' && o.role !== 'member')) return undefined;
  return { id: o.id, name: o.name, availableMicroUsd: o.availableMicroUsd, frozen: o.frozen, role: o.role };
}

/** Keep the personal object only if every field has the right type. */
function parsePersonal(value: unknown): PersonalQuota | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  if (!isFiniteNum(p.balanceMicroUsd) || typeof p.frozen !== 'boolean'
    || typeof p.expiringSoon !== 'boolean') return undefined;
  return { balanceMicroUsd: p.balanceMicroUsd, frozen: p.frozen, expiringSoon: p.expiringSoon };
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
  const organization = parseOrganization(s.organization);
  const personal = parsePersonal(s.personal);
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
    ...(organization ? { organization } : {}),
    ...(personal ? { personal } : {}),
  };
}
