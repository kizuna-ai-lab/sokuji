// src/lib/share/small.test.ts
import { describe, it, expect } from 'vitest';
import { shareUrl } from './url';
import { wifiQrText } from './wifiQr';

describe('shareUrl', () => {
  it('is the selected address and port, or null', () => {
    const base = { running: true, port: 7788, addresses: [], selected: '192.168.1.23', viewers: 0, addressChanged: false };
    expect(shareUrl(base)).toBe('http://192.168.1.23:7788/');
    expect(shareUrl({ ...base, selected: null })).toBeNull();
    expect(shareUrl({ ...base, running: false })).toBeNull();
  });
});

describe('wifiQrText', () => {
  it('escapes the special characters and marks an open network', () => {
    expect(wifiQrText('Meetup-Guest', 'pass')).toBe('WIFI:T:WPA;S:Meetup-Guest;P:pass;;');
    expect(wifiQrText('a;b,c:d"e\\f', 'p;w')).toBe('WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;w;;');
    expect(wifiQrText('Open Net', '')).toBe('WIFI:T:nopass;S:Open Net;;');
  });
});
