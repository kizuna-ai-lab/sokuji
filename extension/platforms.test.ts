import { describe, it, expect } from 'vitest';
import { PLATFORMS, PLATFORM_HOSTNAMES, platformsByProfile } from './platforms';

describe('platform registry', () => {
  it('has the 13 canonical platforms with unique hostnames', () => {
    expect(PLATFORMS).toHaveLength(13);
    expect(new Set(PLATFORM_HOSTNAMES).size).toBe(13);
  });

  it('every match pattern is https://<hostname>/*', () => {
    for (const p of PLATFORMS) {
      expect(p.matchPattern, p.hostname).toBe(`https://${p.hostname}/*`);
    }
  });

  it('every entry has a non-empty display name and short name', () => {
    for (const p of PLATFORMS) {
      expect(p.displayName, p.hostname).toBeTruthy();
      expect(p.shortName, p.hostname).toBeTruthy();
    }
  });

  it('grouped entries share a groupLabel and a consistent group key', () => {
    const grouped = PLATFORMS.filter(p => p.group);
    for (const p of grouped) expect(p.groupLabel, p.hostname).toBeTruthy();
    // two groups today: teams (3 members) and telemost (2 members)
    expect(grouped.filter(p => p.group === 'teams')).toHaveLength(3);
    expect(grouped.filter(p => p.group === 'telemost')).toHaveLength(2);
  });

  it('uses app.slack.com (not slack.com) as the canonical Slack host', () => {
    expect(PLATFORM_HOSTNAMES).toContain('app.slack.com');
    expect(PLATFORM_HOSTNAMES).not.toContain('slack.com');
  });

  it('groups both Yandex Telemost domains under the telemost group (standard profile)', () => {
    for (const hostname of ['telemost.yandex.ru', 'telemost.yandex.com']) {
      expect(PLATFORMS).toContainEqual(expect.objectContaining({
        hostname,
        contentProfile: 'standard',
        group: 'telemost',
      }));
    }
  });

  it('partitions cleanly by content profile', () => {
    expect(platformsByProfile('zoom').map(p => p.hostname)).toEqual(['app.zoom.us']);
    expect(platformsByProfile('jitsi').map(p => p.hostname)).toEqual(['meet.jit.si']);
    expect(platformsByProfile('standard')).toHaveLength(11);
  });
});
