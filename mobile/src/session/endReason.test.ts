import { describe, it, expect } from 'vitest';
import { endReason } from './endReason';

// What a stored session records as its last status: the terminal detail by
// name, so a session that ended with "sign in again" or an empty balance
// can be told apart from one the user stopped.
describe('endReason', () => {
  it('names the terminal detail', () => {
    expect(endReason('error', 'sign_in_required')).toBe('sign_in_required');
    expect(endReason('error', 'balance_exhausted')).toBe('balance_exhausted');
  });

  it('is error for a terminal error with no detail', () => {
    expect(endReason('error', undefined)).toBe('error');
    expect(endReason('error', '')).toBe('error');
  });

  it('is stopped for a stop', () => {
    expect(endReason('stopped', undefined)).toBe('stopped');
  });
});
