/**
 * The Gemini suites' fixtures: the models, a key, the settings the adapter
 * suites build from, the server's frames as the binary frames the Live
 * API sends, and a clock that counts its live timers. Test-only: nothing
 * but a test imports it (the session-side guard's kit rule holds it to
 * that), and the adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';
import type { SharedSettings } from '../../lib/provider/types';
import { buildGemini, type GeminiConfig } from './config';
import { GEMINI_DEFAULTS, type GeminiCredentials, type GeminiSettings } from './settings';

export const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
export const TRANSLATE = 'gemini-3.5-live-translate-preview';
/** Shaped as a real key (`AIza…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: GeminiCredentials = { apiKey: 'AIzaTestKey0123456789' };
export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'ja-JP' && d.target === 'en-US',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: TRANSLATE }, { id: DIALOGUE }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'en-US', target: 'ja-JP' }, speech: true, turns: 'auto' };

/** A leg's config: Gemini's defaults with `model` saved. */
export function configFor(model: string, context: SessionContext = AUTO_CTX, patch: Partial<GeminiSettings> = {}): GeminiConfig {
  return buildGemini(context, { ...GEMINI_DEFAULTS, model, ...patch }, SHARED) as GeminiConfig;
}

/** A server frame as the Live API sends it — binary JSON, read as an ArrayBuffer (`binaryType = 'arraybuffer'`). */
export function serverFrame(message: Record<string, unknown>): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** `samples` of 24 kHz pcm as a model audio part carries it: base64 of little-endian Int16. */
export function b64(samples: number, fill = 9): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The server frames the suites send, by name. */
export const SERVER = {
  setupComplete: () => serverFrame({ setupComplete: { sessionId: 'sid-1' } }),
  input: (text: string) => serverFrame({ serverContent: { inputTranscription: { text } } }),
  output: (text: string) => serverFrame({ serverContent: { outputTranscription: { text } } }),
  audio: (samples = 2400, mimeType = 'audio/pcm;rate=24000') => serverFrame({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType, data: b64(samples) } }] } } }),
  turnComplete: () => serverFrame({ serverContent: { turnComplete: true } }),
  interrupted: () => serverFrame({ serverContent: { interrupted: true } }),
  goAway: () => serverFrame({ goAway: { timeLeft: '50s' } }),
  handle: (newHandle: string, resumable = true) => serverFrame({ sessionResumptionUpdate: { newHandle, resumable } }),
};

/** A virtual clock that counts its live timers — what a stop must leave at zero (a copy of `soniox/testing.ts`'s; choice 21). */
export function trackedClock(): { clock: VirtualClock; timers: () => number } {
  const inner = createVirtualClock(0);
  const live = new Set<symbol>();
  const clock: VirtualClock = {
    now: () => inner.now(),
    advance: (ms) => inner.advance(ms),
    setTimeout(fn, ms) {
      const id = Symbol('timer');
      live.add(id);
      const cancel = inner.setTimeout(() => { live.delete(id); fn(); }, ms);
      return () => { live.delete(id); cancel(); };
    },
  };
  return { clock, timers: () => live.size };
}
