/**
 * The Soniox suites' shared fixtures: the wire's messages, a clock that
 * counts its live timers, the settings and key the adapter suites start
 * from. Test-only: nothing but a test imports it (the session-side
 * consistency test's "only test-only modules import the adapter test kit"
 * holds it to that), and the adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';
import type { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import type { SharedSettings } from '../../lib/provider/types';
import type { SonioxCredentials } from './settings';
import type { SonioxToken } from './sttStream';

export type Json = Record<string, unknown>;

export const SHARED: SharedSettings = { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [] };
/** An own key: the STT key speaks too. */
export const KEY: SonioxCredentials = { region: 'us', stt: 'test-key', tts: 'test-key' };
export const AUTO_CTX: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };

/** The STT socket, as opposed to a TTS one. */
export const isStt = (s: FakeSocket) => s.url.endsWith('/transcribe-websocket');
/** `samples` of TTS audio as the server sends it: base64 little-endian Int16. */
export const b64 = (samples: number) => btoa(String.fromCharCode(...new Uint8Array(new Int16Array(samples).fill(9).buffer)));
/** One STT message carrying these tokens. */
export const msg = (...tokens: SonioxToken[]) => JSON.stringify({ tokens });
export const orig = (text: string, is_final = true): SonioxToken => ({ text, is_final, translation_status: 'original', language: 'en', start_ms: 0, end_ms: 500 });
export const tr = (text: string, language = 'ja', source_language = 'en'): SonioxToken => ({ text, is_final: true, translation_status: 'translation', language, source_language });
export const END: SonioxToken = { text: '<end>', is_final: true };
export const FIN: SonioxToken = { text: '<fin>', is_final: true };
export const ERROR_503 = JSON.stringify({ error_code: 503, error_message: 'Service unavailable' });

/** A virtual clock that counts its live timers: what a stop must leave at zero. */
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
