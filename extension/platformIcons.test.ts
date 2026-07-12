import { describe, it, expect } from 'vitest';
import { PLATFORM_ICONS } from './platformIcons';
import { PLATFORM_HOSTNAMES } from './platforms';

describe('platform icons', () => {
  it('has a base64 data-URI icon for every registry hostname', () => {
    for (const host of PLATFORM_HOSTNAMES) {
      expect(PLATFORM_ICONS[host], host).toBeTruthy();
      expect(PLATFORM_ICONS[host].startsWith('data:image/'), host).toBe(true);
    }
  });

  it('has no icons for hostnames absent from the registry', () => {
    // Icons and the registry must stay in lockstep: an icon keyed to a host
    // no longer in PLATFORMS is dead weight the popup can never render.
    for (const host of Object.keys(PLATFORM_ICONS)) {
      expect(PLATFORM_HOSTNAMES, host).toContain(host);
    }
  });
});
