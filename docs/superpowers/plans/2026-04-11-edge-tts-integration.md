# Edge TTS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Edge TTS as a free, high-quality online TTS option alongside existing local piper/sherpa-onnx models in the LOCAL_INFERENCE provider, with streaming MP3 decode for low-latency playback.

**Architecture:** Edge TTS connects via WebSocket to Bing's speech synthesis service, receives MP3 chunks, decodes them to PCM in a Web Worker using mpg123-decoder WASM, and streams audio chunks back to the main thread through a new `generateStream()` method on TtsEngine. The LocalInferenceClient branches between the existing synchronous `generate()` path and the new streaming path based on the TTS model engine type.

**Tech Stack:** TypeScript, Web Workers (classic JS), WebSocket API, mpg123-decoder (WASM), Zustand, React

**Spec:** `docs/superpowers/specs/2026-04-11-edge-tts-integration-design.md`

---

### Task 1: Install mpg123-decoder dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install mpg123-decoder**

```bash
npm install mpg123-decoder
```

- [ ] **Step 2: Verify installation**

```bash
npm ls mpg123-decoder
```

Expected: Shows mpg123-decoder in dependency tree.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mpg123-decoder dependency for Edge TTS MP3 decoding"
```

---

### Task 2: Edge TTS core library — SSML + token generation

**Files:**
- Create: `src/lib/edge-tts/edgeTts.ts`

This file contains the core Edge TTS protocol logic adapted from cloudflare-edge-tts for standard browser/Electron WebSocket API. It exports functions used by the Edge TTS worker.

- [ ] **Step 1: Create the Edge TTS core module**

```typescript
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

function makeConnectionId(): string {
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
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit src/lib/edge-tts/edgeTts.ts 2>&1 | head -20
```

Expected: No errors (or only errors from missing project-wide config, not from this file's logic).

- [ ] **Step 3: Commit**

```bash
git add src/lib/edge-tts/edgeTts.ts
git commit -m "feat(edge-tts): add core library — SSML, token generation, frame parsing"
```

---

### Task 3: Edge TTS voice list service

**Files:**
- Create: `src/lib/edge-tts/voiceList.ts`

Caches the voice list in memory, provides filtering by locale.

- [ ] **Step 1: Create the voice list module**

```typescript
// src/lib/edge-tts/voiceList.ts

import { fetchVoiceList, type Voice } from './edgeTts';

let cachedVoices: Voice[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get the full Edge TTS voice list, with 24h in-memory cache.
 */
export async function getEdgeTtsVoices(): Promise<Voice[]> {
  if (cachedVoices && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVoices;
  }
  cachedVoices = await fetchVoiceList();
  cacheTimestamp = Date.now();
  return cachedVoices;
}

/**
 * Filter voices by BCP-47 language code (e.g. 'en', 'ja', 'zh').
 * Matches the first segment of the voice's Locale (e.g. 'en-US' matches 'en').
 */
export function filterVoicesByLanguage(voices: Voice[], lang: string): Voice[] {
  const langLower = lang.toLowerCase();
  return voices.filter(v => {
    const voiceLang = v.Locale.split('-')[0].toLowerCase();
    return voiceLang === langLower;
  });
}

/**
 * Get a display-friendly name for a voice.
 * E.g. "en-US-AvaMultilingualNeural" → "Ava Multilingual (Female)"
 */
export function getVoiceDisplayName(voice: Voice): string {
  // FriendlyName is like "Microsoft Ava Online (Natural) - English (United States)"
  // ShortName is like "en-US-AvaMultilingualNeural"
  // Extract the descriptive part from ShortName
  const parts = voice.ShortName.split('-');
  // Last part is like "AvaMultilingualNeural" — strip "Neural" suffix
  const rawName = parts.slice(2).join('-').replace(/Neural$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return `${rawName} (${voice.Gender})`;
}

/**
 * Clear the cached voice list (for testing or forced refresh).
 */
export function clearVoiceCache(): void {
  cachedVoices = null;
  cacheTimestamp = 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/edge-tts/voiceList.ts
git commit -m "feat(edge-tts): add voice list service with caching and locale filtering"
```

---

### Task 4: Extend TTS worker message types

**Files:**
- Modify: `src/lib/local-inference/types.ts`

Add the two new streaming message types (`audio-chunk` and `audio-done`) to the TTS worker protocol.

- [ ] **Step 1: Read the current TTS types**

Read `src/lib/local-inference/types.ts` and locate the `TtsWorkerOutMessage` union type (around line 280-297).

- [ ] **Step 2: Add streaming message types**

After the existing `TtsDisposedMessage` interface and before the `TtsWorkerOutMessage` union, add:

```typescript
export interface TtsAudioChunkMessage {
  type: 'audio-chunk';
  samples: Float32Array;
  sampleRate: number;
}

export interface TtsAudioDoneMessage {
  type: 'audio-done';
  generationTimeMs: number;
}
```

Then update the `TtsWorkerOutMessage` union to include them:

```typescript
export type TtsWorkerOutMessage = TtsReadyMessage | TtsStatusMessage | TtsResultMessage | TtsErrorMessage | TtsDisposedMessage | TtsAudioChunkMessage | TtsAudioDoneMessage;
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/types.ts
git commit -m "feat(edge-tts): add audio-chunk and audio-done streaming message types"
```

---

### Task 5: Register Edge TTS in model manifest

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts`

Add the `edge-tts` engine type, the `isCloudModel` field, and the manifest entry.

- [ ] **Step 1: Read the manifest file**

Read `src/lib/local-inference/modelManifest.ts` to locate:
1. `TtsEngineType` union type (around line 27)
2. `ModelManifestEntry` interface (around line 53)
3. The `MODEL_MANIFEST` array — find the last TTS entry to add after it
4. `getTtsModelsForLanguage` function (around line 2963)

- [ ] **Step 2: Add 'edge-tts' to TtsEngineType**

Find the `TtsEngineType` definition and add `'edge-tts'`:

```typescript
export type TtsEngineType =
  'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits' | 'supertonic' | 'piper-plus' | 'edge-tts';
```

- [ ] **Step 3: Add isCloudModel to ModelManifestEntry**

Add `isCloudModel?: boolean;` to the `ModelManifestEntry` interface, after the existing optional TTS fields:

```typescript
  // Cloud model flag — skips download checks, always "ready"
  isCloudModel?: boolean;
```

- [ ] **Step 4: Add Edge TTS manifest entry**

Add the entry to `MODEL_MANIFEST` array, after the last TTS model entry:

```typescript
  // ── Edge TTS (Online) ──────────────────────────────────────────────────
  {
    id: 'edge-tts',
    type: 'tts',
    name: 'Edge TTS (Online)',
    languages: [],  // accepts all languages — checked via multilingual flag
    multilingual: true,
    engine: 'edge-tts',
    isCloudModel: true,
    sortOrder: 0,  // show first in TTS list
    variants: {},   // no files to download
  },
```

- [ ] **Step 5: Update getTtsModelsForLanguage to handle multilingual TTS**

The existing function filters by `m.languages.includes(lang)`. Edge TTS has `multilingual: true` and empty `languages`, so update the filter:

```typescript
export function getTtsModelsForLanguage(lang: string): ModelManifestEntry[] {
  return MODEL_MANIFEST.filter(m =>
    m.type === 'tts' && (m.multilingual || m.languages.includes(lang))
  );
}
```

- [ ] **Step 6: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat(edge-tts): register Edge TTS in model manifest with isCloudModel flag"
```

---

### Task 6: Extend TtsEngine with streaming support and edge-tts routing

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts`

Add `generateStream()` method and edge-tts worker routing in `init()`.

- [ ] **Step 1: Read the current TtsEngine**

Read `src/lib/local-inference/engine/TtsEngine.ts` fully to confirm exact line numbers.

- [ ] **Step 2: Add AudioChunkCallback type export**

After the `TtsResult` interface (around line 23), add:

```typescript
export type AudioChunkCallback = (samples: Float32Array, sampleRate: number) => void;
```

- [ ] **Step 3: Add streaming state to the class**

After the `pendingGenerate` field (around line 36), add:

```typescript
  private pendingStream: {
    onChunk: AudioChunkCallback;
    resolve: (result: { generationTimeMs: number }) => void;
    reject: (error: Error) => void;
  } | null = null;
```

- [ ] **Step 4: Add edge-tts worker routing in init()**

The `init()` method currently has two paths: `isPiperPlus` and sherpa-onnx. Add a third path for edge-tts.

Find the line `const isPiperPlus = model.engine === 'piper-plus';` (around line 73) and add below it:

```typescript
    const isEdgeTts = model.engine === 'edge-tts';
```

Find the section that checks `ModelManager.isModelReady` (around line 68-71). Wrap it so edge-tts skips the check:

```typescript
    if (!isEdgeTts) {
      // Load model file blob URLs from IndexedDB (only .data + package-metadata.json)
      const manager = ModelManager.getInstance();
      if (!await manager.isModelReady(modelId)) {
        throw new Error(`TTS model "${modelId}" is not downloaded. Download it first via Model Management.`);
      }
      // ... existing fileUrls and dataPackageMetadata logic ...
    }
```

Find the worker URL selection (around line 96-98). Add edge-tts as a third option:

```typescript
      const workerUrl = isEdgeTts
        ? './workers/edge-tts.worker.js'
        : isPiperPlus
          ? './workers/piper-plus-tts.worker.js'
          : './workers/sherpa-onnx-tts.worker.js';
```

In the `onmessage` handler, add cases for the new streaming message types, after the `'result'` case:

```typescript
          case 'audio-chunk':
            if (this.pendingStream) {
              this.pendingStream.onChunk(msg.samples, msg.sampleRate);
            }
            break;

          case 'audio-done':
            if (this.pendingStream) {
              this.pendingStream.resolve({ generationTimeMs: msg.generationTimeMs });
              this.pendingStream = null;
            }
            break;
```

Add the edge-tts init message sending branch. After the piper-plus and sherpa-onnx init blocks:

```typescript
      if (isEdgeTts) {
        this.worker.postMessage({ type: 'init' });
      } else if (isPiperPlus) {
        // ... existing piper-plus init ...
      } else {
        // ... existing sherpa-onnx init ...
      }
```

- [ ] **Step 5: Add the generateStream method**

After the existing `generate()` method (around line 224), add:

```typescript
  /**
   * Generate speech audio with streaming output.
   * Each decoded PCM chunk is delivered via onChunk callback immediately.
   * Returns a Promise that resolves when the full audio is done.
   *
   * Used by Edge TTS and other streaming TTS engines.
   */
  async generateStream(
    text: string,
    sid: number,
    speed: number,
    lang?: string,
    onChunk?: AudioChunkCallback,
  ): Promise<{ generationTimeMs: number }> {
    if (!this.worker || !this.isReady) {
      throw new Error('TTS engine not initialized');
    }
    if (this.pendingGenerate || this.pendingStream) {
      throw new Error('A generation request is already in progress');
    }

    const sanitizedText = TtsEngine.stripEmoji(text);
    if (!sanitizedText) {
      return { generationTimeMs: 0 };
    }

    return new Promise((resolve, reject) => {
      this.pendingStream = {
        onChunk: onChunk || (() => {}),
        resolve,
        reject,
      };
      this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed, lang });
    });
  }
```

- [ ] **Step 6: Update error handling in onmessage for streaming**

In the existing `'error'` case handler, add pendingStream rejection after the pendingGenerate rejection:

```typescript
          case 'error':
            this.onError?.(msg.error);
            if (!this.isReady) {
              // ... existing init error handling ...
            }
            if (this.pendingGenerate) {
              this.pendingGenerate.reject(new Error(msg.error));
              this.pendingGenerate = null;
            }
            if (this.pendingStream) {
              this.pendingStream.reject(new Error(msg.error));
              this.pendingStream = null;
            }
            break;
```

- [ ] **Step 7: Update dispose() for streaming state**

In `dispose()`, add cleanup for pendingStream before the existing pendingGenerate cleanup:

```typescript
    if (this.pendingStream) {
      this.pendingStream.reject(new Error('TTS engine disposed'));
      this.pendingStream = null;
    }
```

- [ ] **Step 8: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts
git commit -m "feat(edge-tts): extend TtsEngine with generateStream() and edge-tts worker routing"
```

---

### Task 7: Create Edge TTS Web Worker

**Files:**
- Create: `public/workers/edge-tts.worker.js`

Classic JS worker that handles WebSocket connection, receives MP3 chunks, decodes them with mpg123-decoder, and streams PCM back to main thread.

- [ ] **Step 1: Create the worker file**

```javascript
// public/workers/edge-tts.worker.js
//
// Edge TTS Web Worker — connects to Bing TTS via WebSocket,
// receives MP3 chunks, decodes to PCM with mpg123-decoder,
// and streams audio-chunk messages back to main thread.

/* global MPEGDecoderWebWorker */

// ── Edge TTS protocol constants (duplicated from edgeTts.ts for worker context) ──

var TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
var READALOUD_BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
var SYNTHESIS_URL = 'wss://' + READALOUD_BASE + '/edge/v1';
var CHROMIUM_FULL_VERSION = '143.0.3650.75';
var CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
var SEC_MS_GEC_VERSION = '1-' + CHROMIUM_FULL_VERSION;

// ── State ──

var decoder = null;
var isReady = false;

// ── Helpers ──

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
}

function makeConnectionId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function makeMuid() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(function(b) { return b.toString(16).padStart(2, '0'); })
    .join('')
    .toUpperCase();
}

async function makeSecMsGec() {
  var winEpoch = 11644473600;
  var secondsToNs = 1e9;
  var ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= secondsToNs / 100;
  var payload = ticks.toFixed(0) + TRUSTED_CLIENT_TOKEN;
  var digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(digest))
    .map(function(b) { return b.toString(16).padStart(2, '0'); })
    .join('')
    .toUpperCase();
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function removeInvalidXmlChars(text) {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    ' '
  );
}

function normalizeVoiceName(voice) {
  var trimmed = voice.trim();
  var providerMatch = /^([a-z]{2,}-[A-Z]{2,})-([^:]+):.+Neural$/.exec(trimmed);
  if (providerMatch) {
    return normalizeVoiceName(providerMatch[1] + '-' + providerMatch[2] + 'Neural');
  }
  var shortMatch = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!shortMatch) return trimmed;
  var lang = shortMatch[1];
  var region = shortMatch[2];
  var name = shortMatch[3];
  if (name.includes('-')) {
    var parts = name.split('-');
    region += '-' + parts[0];
    name = parts.slice(1).join('-');
  }
  return 'Microsoft Server Speech Text to Speech Voice (' + lang + '-' + region + ', ' + name + ')';
}

function buildSynthesisUrl(secMsGec, connectionId) {
  return SYNTHESIS_URL +
    '?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN +
    '&Sec-MS-GEC=' + secMsGec +
    '&Sec-MS-GEC-Version=' + encodeURIComponent(SEC_MS_GEC_VERSION) +
    '&ConnectionId=' + connectionId;
}

function buildSpeechConfigMessage() {
  return 'X-Timestamp:' + timestamp() + '\r\n' +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
}

function buildSsmlMessage(requestId, voice, text, speed) {
  var rateStr = speed >= 0 ? '+' + speed + '%' : speed + '%';
  var ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    "<voice name='" + normalizeVoiceName(voice) + "'>" +
    "<prosody pitch='+0Hz' rate='" + rateStr + "' volume='+0%'>" +
    escapeXml(removeInvalidXmlChars(text)) +
    '</prosody></voice></speak>';

  return 'X-RequestId:' + requestId + '\r\n' +
    'Content-Type:application/ssml+xml\r\n' +
    'X-Timestamp:' + timestamp() + 'Z\r\n' +
    'Path:ssml\r\n\r\n' +
    ssml;
}

function parseTextHeaders(message) {
  var separator = message.indexOf('\r\n\r\n');
  var headerText = separator >= 0 ? message.slice(0, separator) : message;
  var headers = {};
  headerText.split('\r\n').forEach(function(line) {
    var colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
    }
  });
  return headers;
}

function parseBinaryAudioFrame(data) {
  if (data.length < 2) throw new Error('binary frame missing header length');
  var headerLength = (data[0] << 8) | data[1];
  if (data.length < 2 + headerLength) throw new Error('binary frame truncated');
  var headerText = new TextDecoder().decode(data.slice(2, 2 + headerLength));
  var headers = {};
  headerText.split('\r\n').forEach(function(line) {
    var colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
    }
  });
  return { headers: headers, body: data.slice(2 + headerLength) };
}

// ── Init Handler ──

async function handleInit() {
  var startTime = performance.now();

  try {
    postMessage({ type: 'status', message: 'Loading MP3 decoder...' });

    // Import mpg123-decoder — bundled as ESM, use dynamic import
    // The decoder WASM is loaded from the npm package
    var mod = await import('/node_modules/mpg123-decoder/dist/mpg123-decoder.min.js');
    var MPEGDecoder = mod.MPEGDecoder || mod.default?.MPEGDecoder;
    if (!MPEGDecoder) {
      throw new Error('Failed to load MPEGDecoder from mpg123-decoder');
    }
    decoder = new MPEGDecoder();
    await decoder.ready;

    isReady = true;
    var loadTimeMs = Math.round(performance.now() - startTime);
    postMessage({
      type: 'ready',
      loadTimeMs: loadTimeMs,
      numSpeakers: 0,
      sampleRate: 24000,
    });
  } catch (err) {
    postMessage({ type: 'error', error: 'Edge TTS init failed: ' + (err.message || String(err)) });
  }
}

// ── Generate Handler ──

async function handleGenerate(msg) {
  if (!isReady || !decoder) {
    postMessage({ type: 'error', error: 'Edge TTS not initialized' });
    return;
  }

  var text = msg.text;
  var voice = msg.voice || 'en-US-AvaMultilingualNeural';
  // Convert speed multiplier (1.0 = normal) to percent offset (0 = normal)
  var speedPercent = Math.round(((msg.speed || 1.0) - 1.0) * 100);
  var startTime = performance.now();

  try {
    var secMsGec = await makeSecMsGec();
    var connectionId = makeConnectionId();
    var wsUrl = buildSynthesisUrl(secMsGec, connectionId);

    var ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    // Reset decoder state for new synthesis
    decoder.reset();

    await new Promise(function(resolve, reject) {
      var audioReceived = false;

      ws.onopen = function() {
        ws.send(buildSpeechConfigMessage());
        ws.send(buildSsmlMessage(makeConnectionId(), voice, text, speedPercent));
      };

      ws.onmessage = function(event) {
        if (typeof event.data === 'string') {
          var headers = parseTextHeaders(event.data);
          var path = headers.Path;

          if (path === 'turn.end') {
            ws.close();
            return;
          }
          if (path === 'response' || path === 'turn.start' || path === 'audio.metadata') {
            return;
          }
          reject(new Error('unexpected websocket text path: ' + path));
          return;
        }

        // Binary frame — MP3 audio data
        var binary = new Uint8Array(event.data);
        try {
          var parsed = parseBinaryAudioFrame(binary);
          if (parsed.headers.Path !== 'audio') {
            throw new Error('unexpected binary path: ' + parsed.headers.Path);
          }
          if (parsed.body.length === 0) return;

          // Decode MP3 chunk to PCM
          var decoded = decoder.decode(parsed.body);
          if (decoded.samplesDecoded > 0) {
            // mpg123-decoder returns channelData as array of Float32Arrays
            // Edge TTS is mono, so take first channel
            var samples = decoded.channelData[0];
            audioReceived = true;
            postMessage(
              { type: 'audio-chunk', samples: samples, sampleRate: decoded.sampleRate },
              [samples.buffer]
            );
          }
        } catch (decodeErr) {
          console.warn('[EdgeTTS Worker] decode error:', decodeErr);
        }
      };

      ws.onclose = function() {
        if (!audioReceived) {
          reject(new Error('no audio received from Edge TTS'));
          return;
        }
        var generationTimeMs = Math.round(performance.now() - startTime);
        postMessage({ type: 'audio-done', generationTimeMs: generationTimeMs });
        resolve();
      };

      ws.onerror = function(event) {
        reject(new Error('WebSocket error: ' + (event.message || 'connection failed')));
      };
    });
  } catch (err) {
    postMessage({ type: 'error', error: 'Edge TTS generate failed: ' + (err.message || String(err)) });
  }
}

// ── Dispose Handler ──

function handleDispose() {
  if (decoder) {
    decoder.free();
    decoder = null;
  }
  isReady = false;
  postMessage({ type: 'disposed' });
}

// ── Message Dispatcher ──

self.onmessage = function(event) {
  var msg = event.data;
  switch (msg.type) {
    case 'init':
      handleInit();
      break;
    case 'generate':
      handleGenerate(msg);
      break;
    case 'dispose':
      handleDispose();
      break;
    default:
      postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
```

- [ ] **Step 2: Verify the worker file is syntactically valid**

```bash
node -c public/workers/edge-tts.worker.js
```

Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add public/workers/edge-tts.worker.js
git commit -m "feat(edge-tts): add Edge TTS web worker with streaming MP3 decode"
```

---

### Task 8: Adapt LocalInferenceClient for streaming TTS

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts`
- Modify: `src/services/interfaces/IClient.ts`

Branch the per-sentence TTS loop to use `generateStream()` for edge-tts models.

- [ ] **Step 1: Add edgeTtsVoice to LocalInferenceSessionConfig**

In `src/services/interfaces/IClient.ts`, add `edgeTtsVoice` to the `LocalInferenceSessionConfig` interface (around line 128, after `ttsSpeed`):

```typescript
  edgeTtsVoice?: string;
```

- [ ] **Step 2: Read LocalInferenceClient.ts TTS section**

Read `src/services/clients/LocalInferenceClient.ts` lines 486-564 to see the exact current TTS loop.

- [ ] **Step 3: Add edge-tts engine detection**

At the top of the TTS section in `processPipelineJob()` (around line 486, after `if (this.ttsEngine && this.config && !this.disposed)`), add engine detection:

```typescript
        const ttsEntry = getManifestEntry(this.config.ttsModelId || '');
        const isEdgeTts = ttsEntry?.engine === 'edge-tts';
```

This requires importing `getManifestEntry` from `modelManifest.ts`. Check if it's already imported; if not, add:

```typescript
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
```

- [ ] **Step 4: Add streaming TTS path for edge-tts**

Inside the `for` loop over sentences (around line 496-555), wrap the existing TTS call in an if/else:

```typescript
            if (isEdgeTts) {
              // Streaming path — Edge TTS sends audio-chunk messages
              let chunkSampleCount = 0;
              const sentenceStart = performance.now();
              const streamResult = await this.ttsEngine.generateStream(
                sentences[i],
                0,  // sid unused for edge-tts
                this.config.ttsSpeed,
                this.config.targetLanguage,
                (chunkSamples, chunkSampleRate) => {
                  if (this.disposed) return;
                  const resampled = resampleFloat32(chunkSamples, chunkSampleRate, 24000);
                  const int16Audio = float32ToInt16(resampled);
                  chunkSampleCount += int16Audio.length;
                  this.handlers.onConversationUpdated?.({
                    item: assistantItem,
                    delta: { audio: int16Audio },
                  });
                },
              );
              if (this.disposed) return;

              // Track karaoke segments
              const pos = displayText.indexOf(sentences[i], searchFrom);
              const audioTextEnd = pos >= 0 ? pos + sentences[i].length : searchFrom + sentences[i].length;
              searchFrom = audioTextEnd;
              assistantItem.formatted!.audioTextEnd = audioTextEnd;

              const sentenceAudioDuration = chunkSampleCount / 24000;
              cumulativeAudioDuration += sentenceAudioDuration;
              assistantItem.formatted!.audioSegments!.push({
                textEnd: audioTextEnd,
                audioEnd: cumulativeAudioDuration,
              });

              const generateMs = Math.round(performance.now() - sentenceStart);
              this.emitEvent('local.tts.sentence.end', 'server', {
                sentenceIndex: i,
                sentenceCount: sentences.length,
                text: sentences[i],
                generateMs,
                audioDurationMs: Math.round(sentenceAudioDuration * 1000),
              });
            } else {
              // Existing synchronous path — piper/sherpa-onnx
              const sentenceStart = performance.now();
              const ttsResult = await this.ttsEngine.generate(
                sentences[i],
                this.config.ttsSpeakerId,
                this.config.ttsSpeed,
                this.config.targetLanguage,
              );
              // ... rest of existing code unchanged ...
            }
```

Important: The `generate` message for edge-tts needs the voice name. Update TtsEngine to pass the voice. The worker expects `msg.voice`. We need to thread `edgeTtsVoice` from the config through. The simplest approach: add `voice` to the generate message.

- [ ] **Step 5: Thread edgeTtsVoice through generateStream**

In `TtsEngine.generateStream()`, the worker message needs to include the voice. Update the `postMessage` call to include it:

The `generateStream` method signature already has `lang` parameter. For edge-tts, we need to pass voice separately. Add a `voice` parameter to `generateStream`:

In `src/lib/local-inference/engine/TtsEngine.ts`, update `generateStream` signature:

```typescript
  async generateStream(
    text: string,
    sid: number,
    speed: number,
    lang?: string,
    onChunk?: AudioChunkCallback,
    voice?: string,
  ): Promise<{ generationTimeMs: number }>
```

And update the postMessage:

```typescript
      this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed, lang, voice });
```

Then in LocalInferenceClient, pass the voice:

```typescript
              const streamResult = await this.ttsEngine.generateStream(
                sentences[i],
                0,
                this.config.ttsSpeed,
                this.config.targetLanguage,
                (chunkSamples, chunkSampleRate) => { /* ... */ },
                this.config.edgeTtsVoice,
              );
```

- [ ] **Step 6: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/clients/LocalInferenceClient.ts src/services/interfaces/IClient.ts src/lib/local-inference/engine/TtsEngine.ts
git commit -m "feat(edge-tts): adapt LocalInferenceClient for streaming TTS with edge-tts"
```

---

### Task 9: Settings store — add edgeTtsVoice field

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add edgeTtsVoice to LocalInferenceSettings**

In `src/stores/settingsStore.ts`, find the `LocalInferenceSettings` interface (line 119) and add:

```typescript
  edgeTtsVoice: string;  // Edge TTS voice ShortName (e.g. 'en-US-AvaMultilingualNeural')
```

- [ ] **Step 2: Add default value**

In `defaultLocalInferenceSettings` (line 278), add:

```typescript
  edgeTtsVoice: '',  // Auto-select based on target language
```

- [ ] **Step 3: Thread edgeTtsVoice into session config**

In `createLocalInferenceSessionConfig()` (around line 483), add `edgeTtsVoice` to the returned config:

```typescript
    edgeTtsVoice: settings.edgeTtsVoice || undefined,
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(edge-tts): add edgeTtsVoice setting to LocalInferenceSettings"
```

---

### Task 10: Model store — isCloudModel download check bypass

**Files:**
- Modify: `src/stores/modelStore.ts`

- [ ] **Step 1: Read isProviderReady TTS check**

Read `src/stores/modelStore.ts` lines 315-327 to see the current TTS download check.

- [ ] **Step 2: Update TTS check to handle cloud models**

In `isProviderReady()`, the TTS check (lines 315-327) currently requires `modelStatuses[selectedTtsModel] !== 'downloaded'`. Update it to skip the download check for cloud models:

```typescript
      // 3. TTS: if a specific model is selected, it must be downloaded (unless cloud);
      //    otherwise at least 1 TTS model for targetLang must be downloaded
      if (selectedTtsModel) {
        const ttsEntry = getManifestEntry(selectedTtsModel);
        if (ttsEntry?.isCloudModel) {
          // Cloud models (e.g. Edge TTS) don't need download — always ready
        } else {
          if (modelStatuses[selectedTtsModel] !== 'downloaded') return false;
          if (ttsEntry && !ttsEntry.multilingual && !ttsEntry.languages.includes(targetLang)) return false;
        }
      } else {
        const ttsModels = getTtsModelsForLanguage(targetLang);
        const hasTts = ttsModels.some(
          model => model.isCloudModel || modelStatuses[model.id] === 'downloaded'
        );
        if (!hasTts) return false;
      }
```

This requires importing `isCloudModel` access. The `getManifestEntry` is already imported. The `ModelManifestEntry` type already has `isCloudModel?: boolean` from Task 5.

- [ ] **Step 3: Update autoSelectModels TTS logic**

Also in `modelStore.ts`, find the `autoSelectModels` function. The TTS auto-select should consider cloud models as always available. Find where it checks `modelStatuses[m.id] === 'downloaded'` for TTS models and add `|| m.isCloudModel`:

Look for the TTS section in `autoSelectModels` (similar pattern to the isProviderReady TTS block). Update the filter to include cloud models:

```typescript
        // For TTS: cloud models are always available
        const ttsMatch = ttsModels.find(m =>
          (m.isCloudModel || modelStatuses[m.id] === 'downloaded')
          && (m.multilingual || m.languages.includes(targetLang))
        );
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelStore.ts
git commit -m "feat(edge-tts): bypass download check for isCloudModel in model store"
```

---

### Task 11: ModelManagementSection UI — Edge TTS card without download

**Files:**
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx`

- [ ] **Step 1: Read the ModelCard component**

Read `src/components/Settings/sections/ModelManagementSection.tsx` lines 40-210 to understand the ModelCard props and rendering.

- [ ] **Step 2: Update ModelCard to handle cloud models**

The ModelCard currently shows download/downloaded/error states. For cloud models, it should show a different status. 

In the ModelCard function, after the `isNone` check (line 96), add cloud model handling. The simplest approach: treat cloud models as always "downloaded" in the status display, but show "Online" instead of "Downloaded".

Update the `handleClick` function to allow selection of cloud models regardless of download status:

```typescript
  const isCloud = entry && 'isCloudModel' in entry && entry.isCloudModel;

  const handleClick = () => {
    if (disabled || !onSelect) return;
    if (!isCompatible && !isNone) return;
    // Cloud models are always selectable; others need to be downloaded
    if (!isNone && !isCloud && status !== 'downloaded') return;
    onSelect();
  };
```

In the actions section (line 150-210), add a cloud model state before the existing `not_downloaded` check:

```typescript
          {isCloud && (
            <div className="model-card__downloaded model-card__cloud">
              <span className="model-card__status-icon"><CheckCircle size={14} /></span>
              <span>{t('models.online', 'Online')}</span>
            </div>
          )}

          {!isCloud && status === 'not_downloaded' && (
```

And wrap the other status blocks with `!isCloud &&`:

```typescript
          {!isCloud && status === 'downloading' && download && (
            // ... existing download progress ...
          )}

          {!isCloud && status === 'downloaded' && (
            // ... existing downloaded state ...
          )}

          {!isCloud && status === 'error' && (
            // ... existing error state ...
          )}
```

- [ ] **Step 3: Update model size display for cloud models**

In the ModelCard header, the size is shown with `getModelSizeMb(entry, deviceFeatures)`. For cloud models, hide the size:

```typescript
              {!isCloud && <span className="model-card__size">{getModelSizeMb(entry, deviceFeatures)} MB</span>}
```

- [ ] **Step 4: Update auto-select logic for TTS**

In the auto-select effect (around line 379-388), update the TTS check to consider cloud models as available:

```typescript
    const ttsOk = currentTts && (
      (currentTts.isCloudModel || statuses[ttsModel] === 'downloaded') &&
      (currentTts.multilingual || currentTts.languages.includes(targetLanguage))
    );
    if (!ttsOk) {
      const match = pickBestModel(getManifestByType('tts').filter(m =>
        (m.isCloudModel || statuses[m.id] === 'downloaded') &&
        (m.multilingual || m.languages.includes(targetLanguage))
      ));
```

- [ ] **Step 5: Update compatible TTS filtering**

The `compatibleTtsModels` memo (line 463-465) filters by `m.languages.includes(targetLanguage)`. Update to handle multilingual:

```typescript
  const compatibleTtsModels = useMemo(
    () => ttsModels.filter(m => m.multilingual || m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );
  const incompatibleTtsModels = useMemo(
    () => ttsModels.filter(m => !m.multilingual && !m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );
```

- [ ] **Step 6: Verify types compile and app renders**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx
git commit -m "feat(edge-tts): update ModelCard UI for cloud models — online status, no download"
```

---

### Task 12: Voice picker UI in ProviderSpecificSettings

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`

When edge-tts is selected as TTS model, show a voice dropdown instead of the speaker ID slider.

- [ ] **Step 1: Read the TTS settings section**

Read `src/components/Settings/sections/ProviderSpecificSettings.tsx` lines 1340-1380 to see the TTS Settings section.

- [ ] **Step 2: Add voice picker imports**

At the top of the file, add:

```typescript
import { getEdgeTtsVoices, filterVoicesByLanguage, getVoiceDisplayName } from '../../../lib/edge-tts/voiceList';
```

- [ ] **Step 3: Add voice list state**

Inside the LOCAL_INFERENCE rendering function, before the return, add state for the voice list:

```typescript
  const [edgeTtsVoices, setEdgeTtsVoices] = useState<import('../../../lib/edge-tts/edgeTts').Voice[]>([]);
  const isEdgeTtsSelected = localInferenceSettings.ttsModel === 'edge-tts';

  useEffect(() => {
    if (!isEdgeTtsSelected) return;
    let cancelled = false;
    getEdgeTtsVoices()
      .then(voices => {
        if (!cancelled) setEdgeTtsVoices(voices);
      })
      .catch(err => console.warn('[EdgeTTS] Failed to fetch voice list:', err));
    return () => { cancelled = true; };
  }, [isEdgeTtsSelected]);

  const filteredVoices = useMemo(
    () => filterVoicesByLanguage(edgeTtsVoices, localInferenceSettings.targetLanguage),
    [edgeTtsVoices, localInferenceSettings.targetLanguage],
  );

  // Auto-select first voice when target language changes or no voice selected
  useEffect(() => {
    if (!isEdgeTtsSelected || filteredVoices.length === 0) return;
    const currentVoice = localInferenceSettings.edgeTtsVoice;
    const isCurrentValid = filteredVoices.some(v => v.ShortName === currentVoice);
    if (!isCurrentValid) {
      updateLocalInferenceSettings({ edgeTtsVoice: filteredVoices[0].ShortName });
    }
  }, [isEdgeTtsSelected, filteredVoices, localInferenceSettings.edgeTtsVoice, updateLocalInferenceSettings]);
```

Note: `useState` and `useEffect` should already be imported. `useMemo` might need to be added to the import.

- [ ] **Step 4: Add voice picker dropdown**

In the TTS Settings section, after the speed slider and in place of the speaker ID slider when edge-tts is selected:

Replace the speaker ID section (lines 1358-1379) with a conditional:

```typescript
          {(() => {
            const ttsEntry = getManifestEntry(localInferenceSettings.ttsModel);
            if (ttsEntry?.engine === 'edge-tts') {
              // Voice picker for Edge TTS
              return (
                <div className="setting-item">
                  <div className="setting-label">
                    <span>{t('settings.edgeTtsVoice', 'Voice')}</span>
                  </div>
                  <select
                    value={localInferenceSettings.edgeTtsVoice}
                    onChange={(e) => updateLocalInferenceSettings({ edgeTtsVoice: e.target.value })}
                    disabled={isSessionActive || filteredVoices.length === 0}
                    className="select-input"
                  >
                    {filteredVoices.length === 0 && (
                      <option value="">{t('settings.loadingVoices', 'Loading voices...')}</option>
                    )}
                    {filteredVoices.map(voice => (
                      <option key={voice.ShortName} value={voice.ShortName}>
                        {getVoiceDisplayName(voice)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            // Speaker ID slider for local models
            const numSpeakers = ttsEntry?.numSpeakers ?? 1;
            return numSpeakers > 1 ? (
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.ttsSpeakerId', 'Speaker ID')}</span>
                  <span className="setting-value">{localInferenceSettings.ttsSpeakerId}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={numSpeakers - 1}
                  step="1"
                  value={Math.min(localInferenceSettings.ttsSpeakerId, numSpeakers - 1)}
                  onChange={(e) => updateLocalInferenceSettings({ ttsSpeakerId: parseInt(e.target.value) })}
                  className="slider"
                  disabled={isSessionActive}
                />
              </div>
            ) : null;
          })()}
```

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(edge-tts): add voice picker dropdown for Edge TTS in settings"
```

---

### Task 13: Provider display name rename + i18n

**Files:**
- Modify: `src/types/Provider.ts`
- Modify: `src/locales/en/translation.json`
- Modify: All other `src/locales/*/translation.json` files (30 locales)

- [ ] **Step 1: Update display name in Provider.ts**

In `src/types/Provider.ts`, find `getProviderDisplayName` case for `LOCAL_INFERENCE` (line 84-85):

Change:
```typescript
    case Provider.LOCAL_INFERENCE:
      return 'Local (Offline)';
```

To:
```typescript
    case Provider.LOCAL_INFERENCE:
      return 'Free';
```

- [ ] **Step 2: Update English locale**

In `src/locales/en/translation.json`, find the `local_inference` section (line 459) and update:

```json
    "local_inference": {
      "name": "Free",
      "description": "Free Speech Recognition (ASR) + Translation + Speech Synthesis (TTS)",
      "noKeyRequired": "No API key required",
```

Also add new keys for Edge TTS UI:

Find the `settings` section and add these keys:

```json
    "edgeTtsVoice": "Voice",
    "loadingVoices": "Loading voices...",
```

Find the `models` section and add:

```json
    "online": "Online",
```

- [ ] **Step 3: Update other locale files**

For the remaining 30 locale files, update the `local_inference.name` key from its current value to the equivalent of "Free" in each language. The `description` and `noKeyRequired` can be updated similarly.

Use a script or manually update each file. The key changes per locale:

- `name`: "Free" (most languages can use "Free" or their translation)
- Add `"online": "Online"` to the `models` section
- Add `"edgeTtsVoice": "Voice"` and `"loadingVoices": "Loading voices..."` to the `settings` section

For the locale name translations, common translations:
- ja: "無料", zh: "免费", ko: "무료", de: "Kostenlos", fr: "Gratuit", es: "Gratis", pt: "Gratuito", it: "Gratuito", ru: "Бесплатно", ar: "مجاني"

- [ ] **Step 4: Verify app compiles**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/Provider.ts src/locales/
git commit -m "feat(edge-tts): rename LOCAL_INFERENCE display to 'Free' + i18n updates"
```

---

### Task 14: ProviderSpecificSettings auto-select fix

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`

The auto-select logic in ProviderSpecificSettings (around line 119-128) filters TTS models by `m.languages.includes(targetLang) && modelStatuses[m.id] === 'downloaded'`. This won't find edge-tts. Fix it.

- [ ] **Step 1: Read the auto-select logic**

Read `src/components/Settings/sections/ProviderSpecificSettings.tsx` lines 110-130.

- [ ] **Step 2: Update TTS auto-select filter**

Find the TTS auto-select block (around line 122-128):

```typescript
    if (!currentTtsEntry || !currentTtsEntry.languages.includes(targetLang)) {
      const firstMatch = pickBestModel(allTts.filter(m =>
        m.languages.includes(targetLang) && modelStatuses[m.id] === 'downloaded'
      ));
```

Update to:

```typescript
    if (!currentTtsEntry || (!currentTtsEntry.multilingual && !currentTtsEntry.languages.includes(targetLang))) {
      const firstMatch = pickBestModel(allTts.filter(m =>
        (m.multilingual || m.languages.includes(targetLang)) && (m.isCloudModel || modelStatuses[m.id] === 'downloaded')
      ));
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "fix(edge-tts): update TTS auto-select to handle multilingual cloud models"
```

---

### Task 15: Worker import path resolution

**Files:**
- Possibly modify: `public/workers/edge-tts.worker.js`
- Possibly modify: `vite.config.ts`

The worker uses `import('/node_modules/mpg123-decoder/dist/mpg123-decoder.min.js')` which may not resolve correctly in production builds. This task verifies and fixes the import.

- [ ] **Step 1: Test the worker in dev mode**

```bash
npm run dev
```

Open the app, select LOCAL_INFERENCE provider, select Edge TTS as TTS model. Open DevTools console and check for worker errors.

- [ ] **Step 2: Determine correct import strategy**

The mpg123-decoder package may need to be:
a) Copied to `public/workers/` alongside the worker (if it's a standalone WASM + JS bundle)
b) Loaded via a different import path
c) Pre-bundled and placed in `public/`

Check the mpg123-decoder package structure:

```bash
ls node_modules/mpg123-decoder/dist/
```

If the package has a standalone ESM build with WASM, copy the necessary files:

```bash
cp node_modules/mpg123-decoder/dist/mpg123-decoder.min.js public/workers/
cp node_modules/mpg123-decoder/dist/mpg123-decoder.min.wasm public/workers/ 2>/dev/null || true
```

Then update the import in the worker:

```javascript
var mod = await import('./mpg123-decoder.min.js');
```

Alternatively, if the package uses `@aspect-build/aspect-bundler` or similar, we may need to use `importScripts` instead of dynamic `import`. Adapt based on the actual package structure.

- [ ] **Step 3: Test again and verify audio plays**

Start dev server, select Edge TTS, start a session with ASR + translation, verify TTS audio plays through speakers.

- [ ] **Step 4: Commit any fixes**

```bash
git add public/workers/ vite.config.ts
git commit -m "fix(edge-tts): resolve mpg123-decoder import path for worker"
```

---

### Task 16: Integration test — full pipeline

**Files:**
- No new files — manual testing

- [ ] **Step 1: Test in dev mode**

```bash
npm run dev
```

1. Open the app
2. Select "Free" provider (formerly "Local (Offline)")
3. Verify provider name shows "Free"
4. Go to model management, verify "Edge TTS (Online)" appears in TTS section with "Online" tag
5. Select Edge TTS
6. Verify voice picker appears in TTS Settings
7. Verify voices load and filter by target language
8. Change target language — verify voice auto-switches
9. Start a session (need ASR + translation models downloaded)
10. Speak — verify translated text appears and TTS audio plays with Edge TTS voice

- [ ] **Step 2: Test with local TTS model**

1. Switch TTS model back to a local piper model
2. Verify speaker ID slider reappears
3. Start session — verify local TTS still works

- [ ] **Step 3: Test edge cases**

1. Edge TTS with no internet — verify error message appears, doesn't crash
2. Switch between Edge TTS and local TTS models while session is not active
3. Verify speed slider works with Edge TTS

- [ ] **Step 4: Run existing tests**

```bash
npm run test
```

Verify no regressions in existing tests.

- [ ] **Step 5: Build for production**

```bash
npm run build
```

Verify build succeeds with no errors.

- [ ] **Step 6: Commit any remaining fixes**

```bash
git add -A
git commit -m "test: verify Edge TTS integration — full pipeline working"
```
