// src/lib/view/providerTarget.ts
//
// The Settings target that names one provider's key or sign-in: the page opens Accounts and keys at that
// provider's row. A notice about one provider's key or sign-in names the provider (`namingProvider`) and lands there.
const PREFIX = 'provider:';

/** The target that opens Accounts and keys at this provider's row, its key shown. */
export function providerTarget(providerId: string): string {
  return `${PREFIX}${providerId}`;
}

/** The provider a `provider:<id>` target names; null for any other target. */
export function providerOfTarget(target: string | null | undefined): string | null {
  return target && target.startsWith(PREFIX) && target.length > PREFIX.length ? target.slice(PREFIX.length) : null;
}
