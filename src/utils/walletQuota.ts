import { reportWarning } from '../lib/diagnostics/report';
import type { QuotaData, ExpiringSoon } from '../contexts/UserProfileContext';

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

/** A present part of the payload that failed validation: dropped, but loudly once, so a drifting backend is seen rather than read as "no organization". */
function malformed(key: 'organization' | 'personal', what: string): undefined {
  reportWarning('WalletQuota', `The wallet status carried ${what} this app does not recognise; ignoring it.`, { dedupeKey: `wallet:${key}-malformed` });
  return undefined;
}

/** Keep the organization object only if every field has the right type. */
function parseOrganization(value: unknown): OrganizationQuota | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return malformed('organization', 'an organization');
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string'
    || !isFiniteNum(o.availableMicroUsd) || typeof o.frozen !== 'boolean'
    || (o.role !== 'owner' && o.role !== 'member')) {
    return malformed('organization', 'an organization');
  }
  // Optional: older servers do not send it, and a malformed one is read as absent rather than dropping the organization.
  const committed = isFiniteNum(o.committedBalanceMicroUsd) ? { committedBalanceMicroUsd: o.committedBalanceMicroUsd } : {};
  return { id: o.id, name: o.name, availableMicroUsd: o.availableMicroUsd, ...committed, frozen: o.frozen, role: o.role };
}

/** A well-formed expiring-soon object, or null for null / absent / malformed. */
function parseExpiringSoon(value: unknown): ExpiringSoon | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as Record<string, unknown>;
  if (!isFiniteNum(e.microUsd) || typeof e.usd !== 'string'
    || !isFiniteNum(e.microUsdAtEarliest) || typeof e.usdAtEarliest !== 'string'
    || !isFiniteNum(e.expiresAt)) return null;
  return {
    microUsd: e.microUsd, usd: e.usd,
    microUsdAtEarliest: e.microUsdAtEarliest, usdAtEarliest: e.usdAtEarliest,
    expiresAt: e.expiresAt,
  };
}

/**
 * Keep the personal object only if its balance and frozen flag are valid.
 * `expiringSoon` is lenient: absent or malformed becomes null.
 */
function parsePersonal(value: unknown): PersonalQuota | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return malformed('personal', 'a personal wallet');
  const p = value as Record<string, unknown>;
  if (!isFiniteNum(p.balanceMicroUsd) || typeof p.frozen !== 'boolean') {
    return malformed('personal', 'a personal wallet');
  }
  return { balanceMicroUsd: p.balanceMicroUsd, frozen: p.frozen, expiringSoon: parseExpiringSoon(p.expiringSoon) };
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
