// src/lib/share/wifiQr.ts
const escape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/** The text a phone camera reads as "join this Wi-Fi" (spec 2026-10-04 §6). */
export function wifiQrText(ssid: string, password: string): string {
  return password ? `WIFI:T:WPA;S:${escape(ssid)};P:${escape(password)};;` : `WIFI:T:nopass;S:${escape(ssid)};;`;
}
