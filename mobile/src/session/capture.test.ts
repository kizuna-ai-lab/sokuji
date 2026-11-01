import { describe, it, expect } from 'vitest';
import { echoCancellationFor, echoRowState, headphones, speakable } from './capture';

const defaults = { echoCancellation: true, echoCancellationOther: false };

describe('what counts as headphones', () => {
  it('wired and Bluetooth, nothing else', () => {
    expect(headphones('headphones')).toBe(true);
    expect(headphones('bluetooth')).toBe(true);
    expect(headphones('speaker')).toBe(false);
    expect(headphones('other')).toBe(false);
  });
});

describe('when the microphone is processed', () => {
  it("on the phone's speaker with its value on, on any other output only with the other value on", () => {
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'speaker' })).toBe(true);
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'headphones' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'bluetooth' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'other' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, echoCancellationOther: true, listen: true, route: 'bluetooth' })).toBe(true);
    expect(echoCancellationFor({ ...defaults, listen: false, route: 'speaker' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, echoCancellation: false, listen: true, route: 'speaker' })).toBe(false);
  });
});

describe('whether the translation may be spoken', () => {
  it('whenever no processing is wanted, and otherwise only with a chain running', () => {
    expect(speakable({ ...defaults, listen: true, route: 'headphones', chain: 'none' })).toBe(true);
    expect(speakable({ ...defaults, listen: true, route: 'bluetooth', chain: 'none' })).toBe(true);
    expect(speakable({ ...defaults, echoCancellationOther: true, listen: true, route: 'bluetooth', chain: 'none' })).toBe(false);
    expect(speakable({ ...defaults, echoCancellationOther: true, listen: true, route: 'bluetooth', chain: 'vendor' })).toBe(true);
    expect(speakable({ ...defaults, listen: true, route: 'speaker', chain: 'vendor' })).toBe(true);
    expect(speakable({ ...defaults, listen: true, route: 'speaker', chain: 'none' })).toBe(false);
    expect(speakable({ ...defaults, listen: true, route: 'speaker', chain: null })).toBe(false);
    expect(speakable({ ...defaults, echoCancellation: false, listen: true, route: 'speaker', chain: 'none' })).toBe(true);
    expect(speakable({ ...defaults, listen: false, route: 'speaker', chain: 'vendor' })).toBe(false);
  });
});

describe('the echo cancellation row', () => {
  it("shows the current output's value, writes the matching value, and asks before turning on away from the speaker", () => {
    expect(echoRowState(defaults, 'speaker')).toEqual({ checked: true, key: 'echoCancellation', confirmBeforeOn: false });
    expect(echoRowState(defaults, 'bluetooth')).toEqual({ checked: false, key: 'echoCancellationOther', confirmBeforeOn: true });
    expect(echoRowState({ ...defaults, echoCancellationOther: true }, 'headphones')).toEqual({ checked: true, key: 'echoCancellationOther', confirmBeforeOn: true });
  });
});
