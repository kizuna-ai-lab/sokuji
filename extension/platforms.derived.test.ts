import { describe, it, expect } from 'vitest';
import { deriveEnabledSites, deriveSiteInfo, deriveSiteGroups, PLATFORM_HOSTNAMES } from './platforms';

describe('derived popup structures match the pre-registry hand-written values', () => {
  it('ENABLED_SITES = all canonical hostnames', () => {
    expect(deriveEnabledSites().sort()).toEqual([...PLATFORM_HOSTNAMES].sort());
  });

  it('SITE_INFO has name/shortName/icon per hostname and group on grouped members', () => {
    const info = deriveSiteInfo();
    expect(info['meet.google.com']).toMatchObject({ name: 'Google Meet', shortName: 'Meet' });
    expect(info['meet.google.com'].icon.startsWith('data:image/')).toBe(true);
    expect(info['meet.google.com'].group).toBeUndefined();
    expect(info['teams.live.com'].group).toBe('teams');
  });

  it('SITE_GROUPS builds the teams card with Free/Work/M365 sub-labels', () => {
    const groups = deriveSiteGroups();
    expect(Object.keys(groups)).toEqual(['teams']);
    expect(groups.teams.shortName).toBe('Teams');
    expect(groups.teams.sites).toEqual([
      { domain: 'teams.live.com', label: 'Free' },
      { domain: 'teams.microsoft.com', label: 'Work' },
      { domain: 'teams.cloud.microsoft', label: 'M365' },
    ]);
  });
});
