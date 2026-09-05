import { describe, it, expect } from 'vitest';
import { managedVoicePollDelayMs } from './managedVoicePolling';

describe('managedVoicePollDelayMs', () => {
  it('waits 1.5s before each of the first two polls, then 3s before every later one', () => {
    expect([0, 1, 2, 3, 4, 40].map(managedVoicePollDelayMs)).toEqual([1_500, 1_500, 3_000, 3_000, 3_000, 3_000]);
  });
});
