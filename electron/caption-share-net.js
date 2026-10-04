// electron/caption-share-net.js
//
// Which of this computer's addresses a phone on the same network can reach
// (spec 2026-10-04 §8): a pure ranking over os.networkInterfaces(). Wi-Fi and
// wired first; virtual adapters and VPNs last, marked so; never loopback,
// IPv6 or link-local. The default gateway is not looked up.

const VIRTUAL = [
  /^docker/i, /^br-/i, /^veth/i, /^virbr/i, /^lxcbr/i, /^lxdbr/i, /^podman/i, /^cni/i, /^flannel/i,
  /^vethernet/i, /^virtualbox/i, /^vboxnet/i, /^vmware/i, /^vmnet/i,
  /^utun/i, /^tun/i, /^tap/i, /^wg/i, /^tailscale/i, /^zerotier/i, /^zt/i,
  /^awdl/i, /^llw/i, /^anpi/i,
];
const WIFI = [/^wlan/i, /^wlp/i, /^wlx/i, /^wi-?fi/i, /wireless/i, /^无线/];
// `Local Area Connection* N` (with the asterisk) is Windows' Mobile Hotspot /
// Wi-Fi Direct adapter: not wired, and not unreachable either.
const WIRED = [/^eth/i, /^enp/i, /^eno/i, /^ens/i, /^ethernet/i, /^以太网/, /^local area connection(?!\*)/i];

const KIND_ORDER = { wifi: 0, wired: 1, other: 2, virtual: 3 };

function isCgnat(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function isPrivate(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function classify(name, address, hardwarePorts) {
  if (isCgnat(address) || VIRTUAL.some((re) => re.test(name))) return 'virtual';
  const hardware = hardwarePorts.get(name);
  if (hardware) return hardware;
  if (WIFI.some((re) => re.test(name))) return 'wifi';
  if (WIRED.some((re) => re.test(name))) return 'wired';
  return 'other';
}

function rankAddresses(interfaces, hardwarePorts = new Map()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces ?? {})) {
    for (const info of list ?? []) {
      const family = info.family === 4 ? 'IPv4' : info.family;
      if (family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      out.push({ address: info.address, label: name, kind: classify(name, info.address, hardwarePorts) });
    }
  }
  return out.sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || Number(isPrivate(b.address)) - Number(isPrivate(a.address))
    || a.label.localeCompare(b.label));
}

/** macOS `networksetup -listallhardwareports`: device → wifi | wired. */
function parseHardwarePorts(text) {
  const map = new Map();
  let port = null;
  for (const line of String(text).split('\n')) {
    const p = line.match(/^Hardware Port:\s*(.+)$/);
    if (p) {
      port = p[1].trim();
      continue;
    }
    const d = line.match(/^Device:\s*(\S+)/);
    if (d && port) {
      if (/wi-?fi|airport/i.test(port)) map.set(d[1], 'wifi');
      else if (/ethernet|\blan\b/i.test(port)) map.set(d[1], 'wired');
      port = null;
    }
  }
  return map;
}

module.exports = { rankAddresses, parseHardwarePorts };
