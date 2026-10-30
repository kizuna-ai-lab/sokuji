import { describe, it, expect } from 'vitest';
import { signOutAndForget } from './signOutFlow';

// A sign-out the server refuses (an expired session, no network) must still
// drop the local session, or the user has no way back to the sign-in screen.
describe('signOutAndForget', () => {
  it('signs out, then forgets', async () => {
    const order: string[] = [];
    await signOutAndForget({ signOut: async () => { order.push('signOut'); }, forget: async () => { order.push('forget'); }, log: () => {} });
    expect(order).toEqual(['signOut', 'forget']);
  });

  it('forgets even when the sign-out is refused, and does not throw', async () => {
    const order: string[] = [];
    const logged: string[] = [];
    await signOutAndForget({ signOut: async () => { throw new Error('offline'); }, forget: async () => { order.push('forget'); }, log: (line) => logged.push(line) });
    expect(order).toEqual(['forget']);
    expect(logged[0]).toContain('offline');
  });
});

describe('signOutAndForget when forgetting fails', () => {
  it('does not throw, and logs it', async () => {
    const logged: string[] = [];
    await expect(signOutAndForget({ signOut: async () => {}, forget: async () => { throw new Error('storage'); }, log: (l) => logged.push(l) })).resolves.toBeUndefined();
    expect(logged.join(' ')).toContain('storage');
  });
});
