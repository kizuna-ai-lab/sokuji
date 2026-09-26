import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { startLabel } from './startLabel';
import type { RunState } from '../../../lib/session/types';

/** Returns the default with every `{{x}}` filled from `options`, like the app's real `t`. */
const t = ((_key: string, defaultValue: string, options?: Record<string, unknown>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name]))) as unknown as TFunction;

describe('startLabel', () => {
  it('is null while idle', () => {
    expect(startLabel(t, { phase: 'idle' }, 'basic')).toBeNull();
  });

  it('is null while running or stopping', () => {
    expect(startLabel(t, { phase: 'running', since: 0, legs: {} }, 'basic')).toBeNull();
    expect(startLabel(t, { phase: 'stopping' }, 'advanced')).toBeNull();
  });

  it('shows the basic site\'s connecting word while checking', () => {
    const run: RunState = { phase: 'starting', step: 'checking' };
    expect(startLabel(t, run, 'basic')).toBe('Connecting...');
  });

  it('shows the advanced site\'s initializing word while checking', () => {
    const run: RunState = { phase: 'starting', step: 'checking' };
    expect(startLabel(t, run, 'advanced')).toBe('Initializing...');
  });

  it('shows loading progress on both sites', () => {
    const run: RunState = {
      phase: 'starting',
      step: 'opening',
      loading: { leg: 'speaker', stage: 'asr', done: 1, total: 3 },
    };
    expect(startLabel(t, run, 'basic')).toBe('Loading (1/3)...');
    expect(startLabel(t, run, 'advanced')).toBe('Loading (1/3)...');
  });
});
