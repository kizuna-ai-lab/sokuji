import { describe, it, expect } from 'vitest';
import { DEFAULT_OUTLET_CHOICE, isChannelChoice, OUTLET_NAMES, panOf, resolveChannel, resolveOutlet } from './outlets';

describe('resolveChannel', () => {
  it('auto is centred outside face-to-face, for every outlet', () => {
    for (const name of OUTLET_NAMES) expect(resolveChannel(name, 'auto', false)).toBe('both');
  });

  it('auto in face-to-face: the other person right, me left, I hear it too centred (ruling 2)', () => {
    expect(resolveChannel('other', 'auto', true)).toBe('right');
    expect(resolveChannel('them', 'auto', true)).toBe('left');
    expect(resolveChannel('me', 'auto', true)).toBe('both');
  });

  it('a chosen channel holds in every mode', () => {
    expect(resolveChannel('other', 'left', true)).toBe('left');
    expect(resolveChannel('other', 'left', false)).toBe('left');
    expect(resolveChannel('them', 'both', true)).toBe('both');
  });
});

describe('panOf', () => {
  it('maps left to -1, right to 1 and both to no pan', () => {
    expect(panOf('left')).toBe(-1);
    expect(panOf('right')).toBe(1);
    expect(panOf('both')).toBeUndefined();
  });
});

describe('resolveOutlet', () => {
  const present = new Set(['airpods', 'speakers']);

  it('follows the default device when nothing is chosen', () => {
    expect(resolveOutlet('me', DEFAULT_OUTLET_CHOICE, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'airpods' });
  });

  it('uses the chosen device when it is present', () => {
    expect(resolveOutlet('me', { device: 'speakers', channel: 'auto' }, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'speakers' });
  });

  it('an absent device follows the default and keeps nothing else (Review Focus 1)', () => {
    expect(resolveOutlet('me', { device: 'usb-gone', channel: 'right' }, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'airpods', pan: 1 });
  });

  it('no default device at all: the browser default, with the pan still applied', () => {
    expect(resolveOutlet('them', { device: null, channel: 'auto' }, { defaultDevice: undefined, present, faceToFace: true })).toEqual({ pan: -1 });
  });

  it('a centred pick without its device is void: auto, in both contexts', () => {
    const choice = { device: 'gone', channel: 'both' as const };
    expect(resolveOutlet('other', choice, { defaultDevice: 'd', present: new Set(['d']), faceToFace: true })).toEqual({ device: 'd', pan: 1 });
    expect(resolveOutlet('other', choice, { defaultDevice: 'd', present: new Set(['d']), faceToFace: false })).toEqual({ device: 'd' });
  });

  it('carries the resolved channel as a pan', () => {
    expect(resolveOutlet('other', DEFAULT_OUTLET_CHOICE, { defaultDevice: 'airpods', present, faceToFace: true })).toEqual({ device: 'airpods', pan: 1 });
    expect(resolveOutlet('other', { device: null, channel: 'left' }, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'airpods', pan: -1 });
  });
});

describe('isChannelChoice', () => {
  it('accepts the four spellings and nothing else', () => {
    for (const v of ['auto', 'both', 'left', 'right']) expect(isChannelChoice(v)).toBe(true);
    for (const v of ['centre', '', null, undefined, 1, true]) expect(isChannelChoice(v)).toBe(false);
  });
});
