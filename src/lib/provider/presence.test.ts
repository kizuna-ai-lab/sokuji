import { describe, it, expect, vi } from 'vitest';
import { isPresent, type PresenceEnv } from './presence';

const release = (platform: PresenceEnv['platform'], enabled: string[] = [], more: Partial<PresenceEnv> = {}): PresenceEnv =>
  ({ platform, dev: false, enabled: new Set(enabled), kizuna: true, switchOn: () => false, ...more });

const plain = { id: 'plain', kind: 'own-key' as const, platforms: ['electron', 'extension'] as const };
const gated = { id: 'gated', kind: 'own-key' as const, platforms: ['electron'] as const, flagged: true as const };
const tested = { ...gated, testerSwitch: 'debug:tested' };

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
    expect(isPresent(gated, { platform: 'electron', dev: true, enabled: new Set(), kizuna: true, switchOn: () => false })).toBe(true);
  });

  it('never offers a provider off its platforms, listed or not', () => {
    expect(isPresent(gated, { platform: 'web', dev: true, enabled: new Set(['gated']), kizuna: true, switchOn: () => false })).toBe(false);
  });

  it('offers a managed provider only where the Kizuna umbrella is on, in a development build too', () => {
    const managed = { id: 'm', kind: 'managed' as const, platforms: ['electron', 'extension', 'web'] as const };
    expect(isPresent(managed, release('electron', [], { kizuna: false }))).toBe(false);
    expect(isPresent(managed, release('electron'))).toBe(true);
    expect(isPresent(managed, { platform: 'electron', dev: true, enabled: new Set(), kizuna: false, switchOn: () => false })).toBe(false);
  });

  it('lets a tester switch offer a flagged provider in a release build, on its platforms only', () => {
    expect(isPresent(tested, release('electron', [], { switchOn: (k) => k === 'debug:tested' }))).toBe(true);
    expect(isPresent(tested, release('electron', [], { switchOn: () => false }))).toBe(false);
    expect(isPresent(tested, release('web', [], { switchOn: () => true }))).toBe(false);
  });

  it('asks the switch only for a flagged provider nothing else offers', () => {
    const switchOn = vi.fn(() => true);
    expect(isPresent(plain, release('electron', [], { switchOn }))).toBe(true);
    expect(switchOn).not.toHaveBeenCalled();
    expect(isPresent(tested, release('electron', ['gated'], { switchOn }))).toBe(true);
    expect(switchOn).not.toHaveBeenCalled();
  });
});
