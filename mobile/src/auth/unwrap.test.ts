import { describe, it, expect } from 'vitest';
import { unwrap, localPart } from './unwrap';

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
