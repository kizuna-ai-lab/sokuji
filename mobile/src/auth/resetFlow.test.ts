import { describe, it, expect } from 'vitest';
import { resetThenSignIn } from './resetFlow';

// Setting a new password is two requests: the reset (which spends the code)
// and a sign-in with the new password. When only the sign-in fails, the code
// is gone and the password is changed: the page must not ask for the code again.
describe('resetThenSignIn', () => {
  it('resets, then signs in', async () => {
    const order: string[] = [];
    const result = await resetThenSignIn({ reset: async () => { order.push('reset'); }, signIn: async () => { order.push('signIn'); }, log: () => {} });
    expect(order).toEqual(['reset', 'signIn']);
    expect(result).toBe('signedIn');
  });

  it('fails as the reset failed, without signing in', async () => {
    const order: string[] = [];
    await expect(resetThenSignIn({
      reset: async () => { throw new Error('Invalid OTP'); },
      signIn: async () => { order.push('signIn'); },
      log: () => {},
    })).rejects.toThrow('Invalid OTP');
    expect(order).toEqual([]);
  });

  it('says the password is reset when only the sign-in after it fails', async () => {
    const logged: string[] = [];
    const result = await resetThenSignIn({ reset: async () => {}, signIn: async () => { throw new Error('offline'); }, log: (line) => logged.push(line) });
    expect(result).toBe('resetOnly');
    expect(logged[0]).toContain('offline');
  });
});
