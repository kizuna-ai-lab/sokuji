// electron/caption-share-net.test.js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rankAddresses, parseHardwarePorts } = require('./caption-share-net.js');

const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal });

describe('rankAddresses', () => {
  it('Linux: Wi-Fi, then wired, then virtual; no loopback, IPv6 or link-local', () => {
    const ranked = rankAddresses({
      lo: [v4('127.0.0.1', true)],
      docker0: [v4('172.17.0.1')],
      wlp2s0: [v4('192.168.1.23'), { address: 'fe80::1', family: 'IPv6', internal: false }],
      enp3s0: [v4('10.0.4.17')],
      tailscale0: [v4('100.88.12.5')],
      virbr0: [v4('192.168.122.1')],
      eth9: [v4('169.254.10.10')],
    });
    expect(ranked.map((a) => [a.label, a.kind])).toEqual([
      ['wlp2s0', 'wifi'],
      ['enp3s0', 'wired'],
      ['docker0', 'virtual'],
      ['virbr0', 'virtual'],
      // 100.64/10 is not a private range: last within its kind (spec §8).
      ['tailscale0', 'virtual'],
    ]);
    expect(ranked[0]).toEqual({ address: '192.168.1.23', label: 'wlp2s0', kind: 'wifi' });
  });

  it('Windows: the Mobile Hotspot adapter is not marked virtual', () => {
    const ranked = rankAddresses({
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
      'vEthernet (WSL)': [v4('172.29.64.1')],
      Ethernet: [v4('10.1.2.3')],
      'Wi-Fi': [v4('192.168.0.12')],
      'Local Area Connection* 10': [v4('192.168.137.1')],
      Tailscale: [v4('100.101.102.103')],
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    });
    expect(ranked.map((a) => [a.label, a.kind])).toEqual([
      ['Wi-Fi', 'wifi'],
      ['Ethernet', 'wired'],
      ['Local Area Connection* 10', 'other'],
      ['vEthernet (WSL)', 'virtual'],
      ['VirtualBox Host-Only Network', 'virtual'],
      ['Tailscale', 'virtual'],
    ]);
  });

  it('macOS: hardware ports name en0/en7; Internet Sharing bridge is other; utun is virtual', () => {
    const ports = new Map([['en0', 'wifi'], ['en7', 'wired']]);
    const ranked = rankAddresses({
      lo0: [v4('127.0.0.1', true)],
      utun3: [v4('100.70.1.2')],
      bridge100: [v4('192.168.2.1')],
      en7: [v4('192.168.1.31')],
      en0: [v4('192.168.1.30')],
    }, ports);
    expect(ranked.map((a) => [a.label, a.kind])).toEqual([
      ['en0', 'wifi'],
      ['en7', 'wired'],
      ['bridge100', 'other'],
      ['utun3', 'virtual'],
    ]);
  });

  it('puts private addresses before public ones within a kind, and accepts a numeric family', () => {
    const ranked = rankAddresses({ eth1: [{ address: '203.0.113.9', family: 4, internal: false }], eth0: [v4('192.168.3.3')] });
    expect(ranked.map((a) => a.address)).toEqual(['192.168.3.3', '203.0.113.9']);
  });

  it('copes with nothing', () => {
    expect(rankAddresses(undefined)).toEqual([]);
    expect(rankAddresses({ eth0: undefined })).toEqual([]);
  });
});

describe('parseHardwarePorts', () => {
  it('reads networksetup -listallhardwareports', () => {
    const out = [
      'Hardware Port: Wi-Fi', 'Device: en0', 'Ethernet Address: aa:bb', '',
      'Hardware Port: Thunderbolt Bridge', 'Device: bridge0', 'Ethernet Address: N/A', '',
      'Hardware Port: USB 10/100/1000 LAN', 'Device: en7', 'Ethernet Address: cc:dd', '',
      'Hardware Port: Ethernet', 'Device: en1', '',
    ].join('\n');
    const map = parseHardwarePorts(out);
    expect(map.get('en0')).toBe('wifi');
    expect(map.get('en7')).toBe('wired');
    expect(map.get('en1')).toBe('wired');
    expect(map.has('bridge0')).toBe(false);
  });
});
