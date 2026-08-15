import { describe, it, expect } from 'vitest';
import {
  SONIOX_REGIONS,
  DEFAULT_SONIOX_REGION,
  SONIOX_REGION_LABELS,
  sonioxHosts,
  asSonioxRegion,
} from './regions';

describe('sonioxHosts', () => {
  it('gives US the region-less hosts', () => {
    expect(sonioxHosts('us')).toEqual({
      api: 'api.soniox.com',
      sttRt: 'stt-rt.soniox.com',
      ttsRt: 'tts-rt.soniox.com',
    });
  });

  it('puts the region infix AFTER the service name', () => {
    expect(sonioxHosts('eu')).toEqual({
      api: 'api.eu.soniox.com',
      sttRt: 'stt-rt.eu.soniox.com',
      ttsRt: 'tts-rt.eu.soniox.com',
    });
    expect(sonioxHosts('jp')).toEqual({
      api: 'api.jp.soniox.com',
      sttRt: 'stt-rt.jp.soniox.com',
      ttsRt: 'tts-rt.jp.soniox.com',
    });
  });

  // `eu.api.soniox.com` is the shape everyone reaches for first, and it is
  // NXDOMAIN (DNS-verified 2026-08-15). Asserting the negative keeps a
  // "tidy-up" that flips the two segments from silently breaking every
  // non-US session.
  it('never produces the region-first shape, which does not resolve', () => {
    for (const region of SONIOX_REGIONS) {
      for (const host of Object.values(sonioxHosts(region))) {
        expect(host).not.toMatch(new RegExp(`^${region}\\.`));
      }
    }
  });
});

describe('asSonioxRegion', () => {
  it('passes every known region through', () => {
    expect(SONIOX_REGIONS.map(asSonioxRegion)).toEqual([...SONIOX_REGIONS]);
  });

  // Unlike the backend's parser, this one DEFAULTS rather than returning null:
  // its inputs are a persisted setting and a backend response field, and both
  // must degrade to a working session rather than to a malformed hostname.
  it('falls back to us for anything unrecognized', () => {
    expect(asSonioxRegion('EU')).toBe('us');
    expect(asSonioxRegion('uk')).toBe('us');
    expect(asSonioxRegion(undefined)).toBe('us');
    expect(asSonioxRegion(null)).toBe('us');
    expect(asSonioxRegion(7)).toBe('us');
  });

  it('us is the default region', () => {
    expect(DEFAULT_SONIOX_REGION).toBe('us');
  });
});

describe('SONIOX_REGION_LABELS', () => {
  it('labels every region', () => {
    for (const region of SONIOX_REGIONS) {
      expect(SONIOX_REGION_LABELS[region]).toBeTruthy();
    }
  });
});
