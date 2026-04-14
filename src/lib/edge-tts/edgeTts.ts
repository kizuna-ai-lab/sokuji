// src/lib/edge-tts/edgeTts.ts

/**
 * Edge TTS core library — adapted from cloudflare-edge-tts for browser/Electron.
 * Uses standard WebSocket API instead of Cloudflare Worker's fetch-based upgrade.
 */

export const DEFAULT_VOICE = 'en-US-AvaMultilingualNeural';

const READALOUD_BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VOICE_LIST_URL = `https://${READALOUD_BASE}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const SYNTHESIS_URL = `wss://${READALOUD_BASE}/edge/v1`;
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
export const EDGE_TTS_CHROMIUM_MAJOR = CHROMIUM_MAJOR_VERSION;
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

const BASE_HEADERS = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  'Accept-Language': 'en-US,en;q=0.9',
};

const VOICE_HEADERS = {
  ...BASE_HEADERS,
  Authority: 'speech.platform.bing.com',
  'Sec-CH-UA': `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
  'Sec-CH-UA-Mobile': '?0',
  Accept: '*/*',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

// ── Types ────────────────────────────────────────────────────────────────

export interface Voice {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  SuggestedCodec: string;
  FriendlyName: string;
  Status: string;
  VoiceTag: {
    ContentCategories: string[];
    VoicePersonalities: string[];
  };
}

export interface TtsInput {
  text: string;
  voice?: string;
  speed?: number;  // -100 to +200 percent, default 0
}

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function removeInvalidXmlCharacters(text: string): string {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    ' ',
  );
}

export function makeConnectionId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function makeMuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
}

export async function makeSecMsGec(): Promise<string> {
  const winEpoch = 11644473600;
  const secondsToNs = 1e9;
  let ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= secondsToNs / 100;
  const payload = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function normalizeVoiceName(voice: string): string {
  const trimmed = voice.trim();
  const providerMatch = /^([a-z]{2,}-[A-Z]{2,})-([^:]+):.+Neural$/.exec(trimmed);
  if (providerMatch) {
    const [, locale, baseName] = providerMatch;
    return normalizeVoiceName(`${locale}-${baseName}Neural`);
  }
  const shortMatch = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!shortMatch) return trimmed;
  const [, lang] = shortMatch;
  let [, , region, name] = shortMatch;
  if (name.includes('-')) {
    const [regionSuffix, ...nameParts] = name.split('-');
    region += `-${regionSuffix}`;
    name = nameParts.join('-');
  }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
}

// ── WebSocket URL + message builders ─────────────────────────────────────

export function buildSynthesisUrl(secMsGec: string, connectionId: string): string {
  const url = new URL(SYNTHESIS_URL);
  url.searchParams.set('TrustedClientToken', TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', secMsGec);
  url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION);
  url.searchParams.set('ConnectionId', connectionId);
  return url.toString();
}

export function buildSpeechConfigMessage(): string {
  return (
    `X-Timestamp:${timestamp()}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
}

export function buildSsmlMessage(requestId: string, voice: string, text: string, speed: number = 0): string {
  const rateStr = speed >= 0 ? `+${speed}%` : `${speed}%`;
  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${normalizeVoiceName(voice)}'><prosody pitch='+0Hz' rate='${rateStr}' volume='+0%'>${escapeXml(
      removeInvalidXmlCharacters(text),
    )}</prosody></voice></speak>`;

  return (
    `X-RequestId:${requestId}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    `X-Timestamp:${timestamp()}Z\r\n` +
    'Path:ssml\r\n\r\n' +
    ssml
  );
}

// ── Binary frame parsing ─────────────────────────────────────────────────

export function parseTextHeaders(message: string): Record<string, string> {
  const separator = message.indexOf('\r\n\r\n');
  const headerText = separator >= 0 ? message.slice(0, separator) : message;
  const headers: Record<string, string> = {};
  for (const line of headerText.split('\r\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return headers;
}

export function parseBinaryAudioFrame(data: Uint8Array): { headers: Record<string, string>; body: Uint8Array } {
  if (data.length < 2) throw new Error('binary websocket frame missing header length');
  const headerLength = (data[0] << 8) | data[1];
  if (data.length < 2 + headerLength) throw new Error('binary websocket frame truncated');
  const headerText = new TextDecoder().decode(data.slice(2, 2 + headerLength));
  const headers: Record<string, string> = {};
  for (const line of headerText.split('\r\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return { headers, body: data.slice(2 + headerLength) };
}

// ── Cookie helper ────────────────────────────────────────────────────────

export function makeCookie(): string {
  return `muid=${makeMuid()};`;
}

// ── Voice list ───────────────────────────────────────────────────────────

export async function fetchVoiceList(): Promise<Voice[]> {
  const secMsGec = await makeSecMsGec();
  const url = `${VOICE_LIST_URL}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const response = await fetch(url, { headers: VOICE_HEADERS });
  if (!response.ok) throw new Error(`Voice list request failed with status ${response.status}`);
  return (await response.json()) as Voice[];
}
