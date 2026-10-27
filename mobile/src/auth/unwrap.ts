// better-auth's client returns { data, error } and never throws; the screens
// want a thrown Error with the server's message, and its code for the lines
// that have a translation.
export class AuthError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'AuthError';
  }
}

export function unwrap<T>(result: { data: T; error: { code?: string; message?: string; status?: number } | null }): T {
  if (result.error) {
    throw new AuthError(
      result.error.message || `request failed${result.error.status ? ` (${result.error.status})` : ''}`,
      result.error.code,
      result.error.status,
    );
  }
  return result.data;
}

// The two errors a user actually meets, by better-auth's codes; anything else
// shows the server's own words.
const AUTH_ERROR_KEYS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'mobile.signIn.wrongPassword',
  INVALID_OTP: 'mobile.signIn.wrongCode',
  OTP_EXPIRED: 'mobile.signIn.wrongCode',
};

export function authErrorKey(err: unknown): string | null {
  return err instanceof AuthError && err.code ? AUTH_ERROR_KEYS[err.code] ?? null : null;
}

// The backend requires a name on sign-up; the app has no name field.
export function localPart(email: string): string {
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : at === 0 ? '' : email;
  return name.trim() || 'user';
}
