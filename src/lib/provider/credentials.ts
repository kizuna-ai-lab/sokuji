import { describeCause } from '../diagnostics/describeCause';
import type { AuthContext, CredentialsMissing, CredentialValues, Provider } from './types';

/**
 * A provider's credentials for these settings: `read` sees the values of
 * exactly the fields `fields(s)` shows, a field with nothing saved as ''. A
 * `read` that throws is a provider bug, answered as missing rather than
 * thrown, so no caller has to guard it.
 */
export function readCredentials<S, K extends { missing?: never } & object>(
  p: Pick<Provider<S, K, never>, 'credentials'>,
  s: S,
  saved: CredentialValues,
  auth: AuthContext,
): K | CredentialsMissing {
  const values: CredentialValues = Object.fromEntries(p.credentials.fields(s).map((f) => [f.key, saved[f.key] ?? '']));
  try {
    return p.credentials.read(values, auth);
  } catch (error) {
    return { missing: `Could not read the credentials: ${describeCause(error)}` };
  }
}

/** A `missing` answer, told from credentials by the constraint that `K` has no `missing` member. */
export function isMissing(answer: unknown): answer is CredentialsMissing {
  return typeof (answer as { missing?: unknown } | null)?.missing === 'string';
}
