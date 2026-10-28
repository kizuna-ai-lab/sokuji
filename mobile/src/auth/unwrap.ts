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

// The errors a user actually meets, by better-auth's codes; anything else
// reads as a general failure.
const AUTH_ERROR_KEYS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'mobile.signIn.wrongPassword',
  // An address that does not parse (sign-up and every email-otp route check it): the desktop's words.
  INVALID_EMAIL: 'auth.invalidEmail',
  INVALID_OTP: 'mobile.signIn.wrongCode',
  OTP_EXPIRED: 'mobile.signIn.wrongCode',
};

export function authErrorKey(err: unknown): string | null {
  if (!(err instanceof AuthError)) return null;
  // The backend caps code emails per address; a 429 is that cap, whatever the body says.
  if (err.status === 429) return 'mobile.signIn.tooManyRequests';
  return err.code ? AUTH_ERROR_KEYS[err.code] ?? null : null;
}

// The backend requires a name on sign-up; the app has no name field.
export function localPart(email: string): string {
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : at === 0 ? '' : email;
  return name.trim() || 'user';
}
