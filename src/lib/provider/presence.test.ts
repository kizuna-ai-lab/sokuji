import { describe, it, expect } from 'vitest';
import { isPresent, type PresenceEnv } from './presence';

const release = (platform: PresenceEnv['platform'], enabled: string[] = []): PresenceEnv =>
  ({ platform, dev: false, enabled: new Set(enabled) });

const plain = { id: 'plain', platforms: ['electron', 'extension'] as const };
const gated = { id: 'gated', platforms: ['electron'] as const, flagged: true as const };

describe('isPresent', () => {
  it('offers a provider on its platforms only', () => {
    expect(isPresent(plain, release('electron'))).toBe(true);
    expect(isPresent(plain, release('web'))).toBe(false);
  });

  it('hides a flagged provider in a release build unless the release lists it', () => {
    expect(isPresent(gated, release('electron'))).toBe(false);
    expect(isPresent(gated, release('electron', ['other']))).toBe(false);
    expect(isPresent(gated, release('electron', ['gated']))).toBe(true);
  });

  it('offers every flagged provider in a development build', () => {
    expect(isPresent(gated, { platform: 'electron', dev: true, enabled: new Set() })).toBe(true);
  });

  it('never offers a provider off its platforms, listed or not', () => {
    expect(isPresent(gated, { platform: 'web', dev: true, enabled: new Set(['gated']) })).toBe(false);
  });
});
