import { describe, expect, it } from 'vitest';
import { reconcileManagedSonioxVoice, reconcileSonioxVoice } from './voiceReconcile';

describe('reconcileSonioxVoice', () => {
  it('the table', () => {
    expect(reconcileSonioxVoice('Kenji', [], false)).toBe('Kenji');
    expect(reconcileSonioxVoice('', [], false)).toBe('');
    expect(reconcileSonioxVoice('v1', ['v1'], false)).toBe('v1');
    expect(reconcileSonioxVoice('v1', [], true)).toBe('v1');
    expect(reconcileSonioxVoice('v1', [], false)).toBe('Adrian');
    expect(reconcileSonioxVoice('v1', null, false)).toBe('v1');
  });
});

describe('reconcileManagedSonioxVoice', () => {
  it('adopts the account’s own usable voice, never over a built-in', () => {
    expect(reconcileManagedSonioxVoice('stale', { voiceId: 'v-jp', status: 'ready' }, false)).toBe('v-jp');
    expect(reconcileManagedSonioxVoice('stale', { voiceId: 'v-jp', status: 'processing' }, false)).toBe('v-jp');
    expect(reconcileManagedSonioxVoice('stale', { voiceId: 'v-jp', status: 'failed' }, false)).toBe('Adrian');
    expect(reconcileManagedSonioxVoice('stale', { voiceId: 'v-jp', status: 'failed' }, true)).toBe('stale');
    expect(reconcileManagedSonioxVoice('Kenji', { voiceId: 'v-jp', status: 'ready' }, false)).toBe('Kenji');
    expect(reconcileManagedSonioxVoice('', { voiceId: 'v-jp', status: 'ready' }, false)).toBe('');
    expect(reconcileManagedSonioxVoice('stale', undefined, false)).toBe('stale');
    expect(reconcileManagedSonioxVoice('stale', null, false)).toBe('Adrian');
    expect(reconcileManagedSonioxVoice('v-jp', { voiceId: 'v-jp', status: 'ready' }, false)).toBe('v-jp');
  });
});
