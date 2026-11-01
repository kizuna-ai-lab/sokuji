import { describe, it, expect } from 'vitest';
import { leaveState } from './leave';

describe('a screen held while its own request runs', () => {
  it('refuses Back during the hold', () => {
    expect(leaveState({ holding: true, leaving: false })).toEqual({ prevent: true, goBack: false });
  });

  it('is free to leave when nothing runs', () => {
    expect(leaveState({ holding: false, leaving: false })).toEqual({ prevent: false, goBack: false });
  });

  it('lets a request that ends by leaving wait for the hold to release, then goes', () => {
    // The request itself asked to leave (sign-in done, session deleted) while it still holds the page.
    expect(leaveState({ holding: true, leaving: true })).toEqual({ prevent: false, goBack: false });
    expect(leaveState({ holding: false, leaving: true })).toEqual({ prevent: false, goBack: true });
  });
});
