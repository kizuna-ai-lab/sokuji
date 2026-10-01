import { describe, expect, it } from 'vitest';
import { currentRunPhase, registerRunPhase } from './runPhase';

describe('currentRunPhase', () => {
  it('is idle until a reader registers, then reads it', () => {
    expect(currentRunPhase()).toBe('idle');
    registerRunPhase(() => 'running');
    expect(currentRunPhase()).toBe('running');
  });
});
