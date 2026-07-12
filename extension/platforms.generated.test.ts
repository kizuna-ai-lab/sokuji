import { describe, it, expect } from 'vitest';
import { serializePlatformsForVanilla, PLATFORM_HOSTNAMES } from './platforms';

describe('vanilla platform serialization', () => {
  it('emits a global assignment with hostname/guidanceKey/pluginKey per platform', () => {
    const js = serializePlatformsForVanilla();
    expect(js).toContain('globalThis.SOKUJI_PLATFORMS');
    // Eval in a bare sandbox to read the data back.
    const g: any = {};
    new Function('globalThis', js)(g);
    expect(g.SOKUJI_PLATFORMS.map((p: any) => p.hostname).sort()).toEqual([...PLATFORM_HOSTNAMES].sort());
    const slack = g.SOKUJI_PLATFORMS.find((p: any) => p.hostname === 'app.slack.com');
    expect(slack.guidanceKey).toBe('slack');
    expect(slack.pluginKey).toBe('slack');
    const meet = g.SOKUJI_PLATFORMS.find((p: any) => p.hostname === 'meet.google.com');
    expect(meet.guidanceKey).toBeUndefined();
  });

  it('carries no icons (vanilla scripts do not need them)', () => {
    const js = serializePlatformsForVanilla();
    expect(js).not.toContain('data:image');
    expect(js).not.toContain('icon');
  });
});
