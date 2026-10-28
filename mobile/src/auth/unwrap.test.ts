import { describe, it, expect } from 'vitest';
import { unwrap, localPart, AuthError, authErrorKey } from './unwrap';

// better-auth's client returns { data, error } and never throws. The prototype
// ignored `error` on sign-out and session reads; every call now goes through
// unwrap(), which turns an error into the thrown Error the screens show.
describe('unwrap', () => {
  it('returns the data when there is no error', () => {
    expect(unwrap({ data: { token: 't' }, error: null })).toEqual({ token: 't' });
  });

  it('throws the error message', () => {
    expect(() => unwrap({ data: null, error: { message: 'Invalid email or password', status: 401 } })).toThrow('Invalid email or password');
  });

  it('names the status when the error has no message', () => {
    expect(() => unwrap({ data: null, error: { status: 500 } })).toThrow('request failed (500)');
  });

  it("carries the server's code and status on the thrown error", () => {
    let thrown: unknown;
    try {
      unwrap({ data: null, error: { code: 'INVALID_OTP', message: 'Invalid OTP', status: 400 } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AuthError);
    expect((thrown as AuthError).code).toBe('INVALID_OTP');
    expect((thrown as AuthError).status).toBe(400);
  });
});

// The two errors a user actually meets have a translated line each; anything
// else shows the server's own words.
describe('authErrorKey', () => {
  it('maps a wrong password', () => {
    expect(authErrorKey(new AuthError('Invalid email or password', 'INVALID_EMAIL_OR_PASSWORD', 401))).toBe('mobile.signIn.wrongPassword');
  });

  it('maps a wrong or expired code', () => {
    expect(authErrorKey(new AuthError('Invalid OTP', 'INVALID_OTP', 400))).toBe('mobile.signIn.wrongCode');
    expect(authErrorKey(new AuthError('OTP expired', 'OTP_EXPIRED', 400))).toBe('mobile.signIn.wrongCode');
  });

  it('maps the backend\'s rate limit on sending codes', () => {
    expect(authErrorKey(new AuthError('Too many requests', undefined, 429))).toBe('mobile.signIn.tooManyRequests');
  });

  it('has no line for anything else', () => {
    expect(authErrorKey(new AuthError('server error', undefined, 500))).toBeNull();
    expect(authErrorKey(new AuthError('too many attempts', 'TOO_MANY_ATTEMPTS', 400))).toBeNull();
    expect(authErrorKey(new Error('network request failed'))).toBeNull();
  });
});

// The backend requires a name on sign-up; the app has no name field, so the
// address's local part stands in.
describe('localPart', () => {
  it('is the part before the @', () => {
    expect(localPart('ayumi.k@example.com')).toBe('ayumi.k');
  });

  it('falls back to "user" for an address with nothing before the @', () => {
    expect(localPart('@example.com')).toBe('user');
  });
});
