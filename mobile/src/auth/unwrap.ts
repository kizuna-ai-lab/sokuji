// better-auth's client returns { data, error } and never throws; the screens
// want a thrown Error with the server's message, and its code for the lines
// that have a translation.
export class AuthError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'AuthError';
  }
}

// The backend caps code emails per address; a 429 on a request that sends a
// code is that cap, whatever the body says. Other requests have limits of their own.
const CODE_REQUESTS_LIMITED = 'CODE_REQUESTS_LIMITED';

export function unwrap<T>(
  result: { data: T; error: { code?: string; message?: string; status?: number } | null },
  opts: { sendsCode?: boolean } = {},
): T {
  if (result.error) {
    const { message, code, status } = result.error;
    throw new AuthError(
      message || `request failed${status ? ` (${status})` : ''}`,
      opts.sendsCode && status === 429 ? CODE_REQUESTS_LIMITED : code,
      status,
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
  [CODE_REQUESTS_LIMITED]: 'mobile.signIn.tooManyRequests',
};

export function authErrorKey(err: unknown): string | null {
  if (!(err instanceof AuthError)) return null;
  if (err.code && AUTH_ERROR_KEYS[err.code]) return AUTH_ERROR_KEYS[err.code];
  // Any other rate limit (password sign-in, say): the desktop's general words.
  if (err.status === 429) return 'auth.rateLimitExceeded';
  return null;
}

// The backend requires a name on sign-up; the app has no name field.
export function localPart(email: string): string {
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : at === 0 ? '' : email;
  return name.trim() || 'user';
}
