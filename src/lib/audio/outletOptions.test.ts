import { describe, it, expect } from 'vitest';
import { entryValue, outletEntries, outletSelectValue, parseEntryValue } from './outletOptions';

const DEVICES = [{ deviceId: 'airpods', label: 'AirPods Pro' }, { deviceId: 'mbp', label: 'MacBook Pro Speakers' }];

describe('outletEntries', () => {
  it('lists follow-default three ways, then each device three ways, in the boards\' order', () => {
    expect(outletEntries(DEVICES)).toEqual([
      { device: null, channel: 'auto' },
      { device: null, channel: 'left' },
      { device: null, channel: 'right' },
      { device: 'airpods', channel: 'both', label: 'AirPods Pro' },
      { device: 'airpods', channel: 'left', label: 'AirPods Pro' },
      { device: 'airpods', channel: 'right', label: 'AirPods Pro' },
      { device: 'mbp', channel: 'both', label: 'MacBook Pro Speakers' },
      { device: 'mbp', channel: 'left', label: 'MacBook Pro Speakers' },
      { device: 'mbp', channel: 'right', label: 'MacBook Pro Speakers' },
    ]);
  });

  it('with no devices, only the follow-default entries', () => {
    expect(outletEntries([])).toHaveLength(3);
  });
});

describe('entryValue / parseEntryValue', () => {
  it('round-trips every entry', () => {
    for (const entry of outletEntries(DEVICES)) {
      expect(parseEntryValue(entryValue(entry))).toEqual({ device: entry.device, channel: entry.channel });
    }
  });

  it('reads an unknown value as follow-default, auto', () => {
    expect(parseEntryValue('')).toEqual({ device: null, channel: 'auto' });
    expect(parseEntryValue('airpods#centre')).toEqual({ device: 'airpods', channel: 'auto' });
  });
});

describe('outletSelectValue — which entry the select shows', () => {
  it('follow-default, auto: the plain follow-default entry in a meeting, the resolved channel face-to-face', () => {
    expect(outletSelectValue('other', { device: null, channel: 'auto' }, false)).toBe('#auto');
    expect(outletSelectValue('other', { device: null, channel: 'auto' }, true)).toBe('#right');
    expect(outletSelectValue('them', { device: null, channel: 'auto' }, true)).toBe('#left');
  });

  it('a chosen channel shows as itself, with or without a device', () => {
    expect(outletSelectValue('me', { device: null, channel: 'left' }, false)).toBe('#left');
    expect(outletSelectValue('me', { device: 'airpods', channel: 'right' }, true)).toBe('airpods#right');
  });

  it('a device on auto shows the resolved channel: both in a meeting, the ear face-to-face', () => {
    expect(outletSelectValue('me', { device: 'airpods', channel: 'auto' }, false)).toBe('airpods#both');
    expect(outletSelectValue('them', { device: 'airpods', channel: 'auto' }, true)).toBe('airpods#left');
  });
});

describe('outletSelectValue — a stored device that is no longer listed', () => {
  const listed = [{ deviceId: 'airpods' }];
  it('reads as follow-default with its channel kept', () => {
    expect(outletSelectValue('me', { device: 'gone', channel: 'left' }, false, listed)).toBe('#left');
  });
  it('keeps a listed device', () => {
    expect(outletSelectValue('me', { device: 'airpods', channel: 'left' }, false, listed)).toBe('airpods#left');
  });
  it('keeps the stored id without a devices argument', () => {
    expect(outletSelectValue('me', { device: 'gone', channel: 'left' }, false)).toBe('gone#left');
  });
});
