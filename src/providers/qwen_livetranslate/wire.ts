/**
 * Qwen LiveTranslate's wire (spec 2026-10-13, §6; the owner's probe,
 * `scripts/dev/wire-probe/qwen.mts`): the socket URL and its one upgrade
 * header, the client events the adapter sends, the server's events read
 * defensively, and the words and codes of its errors. Pure: no socket, no
 * timer.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import type { UpgradeHeaders } from '../../lib/contract/headerSocket';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { QwenConfig } from './config';
import { ENDPOINTS, type EndpointId } from './endpoints';
import type { QwenCredentials } from './settings';

export { base64ToPcm } from '../../lib/contract/pcm64';

/** The endpoint's socket with the model in its query; the key is never there (D3). */
export function socketUrl(endpoint: EndpointId, model: string): string {
  return `${ENDPOINTS[endpoint].socket}?model=${encodeURIComponent(model)}`;
}

/**
 * The upgrade's one header (D3). The one function of the session side that
 * reads the key: what it returns goes to the header seam alone, never a
 * frame, a word or a log. `Origin` is never checked, so nothing is removed.
 */
export function qwenHeaders(k: QwenCredentials): UpgradeHeaders {
  return { set: { Authorization: `Bearer ${k.apiKey}` } };
}

/** The session's one update (a second is refused, close 1007): `translation.language` is required, the voice sits under `audio.output`. */
export interface SessionUpdate {
  type: 'session.update';
  session: {
    /** Declared only with a screen source: frames are ignored without it, and a declaration with no frame ends the session at its first turn (spec 2026-10-22). */
    input_modalities?: Array<'audio' | 'video'>;
    output_modalities: Array<'text' | 'audio'>;
    /** `corpus.phrases`: source term → its translation; a common word is replaced too (probe 2026-10-13). */
    translation: { language: string; corpus?: { phrases: Record<string, string> } };
    audio: {
      /** 24 kHz goes straight through; `turn_detection: null` is push-to-talk; speaker detection with a silence is a chosen pause. */
      input: { format: { type: 'pcm'; sample_rate: number }; turn_detection?: null | { type: 'speaker_detection'; silence_duration_ms: number } };
      /** Only on a leg that speaks; the clone speaks as `default`. */
      output?: { voice: string };
    };
    enable_voice_clone?: true;
    voice_clone_options?: { frequency: 'always' | 'once' };
  };
}

/** `video`: the leg has a screen source, so the session declares video beside audio. */
export function sessionUpdate(c: Pick<QwenConfig, 'target' | 'speech' | 'voice' | 'manual' | 'phrases' | 'silenceMs'>, o: { video: boolean }): SessionUpdate {
  const format = { type: 'pcm' as const, sample_rate: SAMPLE_RATE };
  const voice = c.voice;
  const hasPhrases = Object.keys(c.phrases).length > 0;
  return {
    type: 'session.update',
    session: {
      ...(o.video ? { input_modalities: ['audio', 'video'] as Array<'audio' | 'video'> } : {}),
      output_modalities: c.speech ? ['text', 'audio'] : ['text'],
      translation: hasPhrases ? { language: c.target, corpus: { phrases: { ...c.phrases } } } : { language: c.target },
      audio: {
        // The pause is undocumented for 3.8 but honoured (probe 2026-10-13): it rides speaker detection, the default kind, so speakers stay labelled.
        input: c.manual ? { format, turn_detection: null }
          : c.silenceMs !== null ? { format, turn_detection: { type: 'speaker_detection', silence_duration_ms: c.silenceMs } }
            : { format },
        ...(c.speech ? { output: { voice: voice.kind === 'clone' ? 'default' : voice.name } } : {}),
      },
      // `always` re-clones each turn, so each voice follows whoever is speaking; `once` keeps the first speaker's (probe 2026-10-13). No extra tokens either way.
      ...(c.speech && voice.kind === 'clone' ? { enable_voice_clone: true as const, voice_clone_options: { frequency: voice.frequency } } : {}),
    },
  };
}

/** One chunk as it goes up: base64 of little-endian Int16, as it came. */
export function appendFrame(pcm: Int16Array): string {
  return JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmToBase64(pcm) });
}

/**
 * One screen frame as it goes up: base64 of the JPEG's bytes. It follows the
 * first audio on the wire, and later frames are sent as they come (spec
 * 2026-10-22). In 32 KiB steps, which `String.fromCharCode` spreads safely.
 */
export function imageFrame(jpeg: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < jpeg.length; i += 0x8000) binary += String.fromCharCode(...jpeg.subarray(i, i + 0x8000));
  return JSON.stringify({ type: 'input_image_buffer.append', image: btoa(binary) });
}

/**
 * A push-to-talk release, and a cancel, which is one: the turn closes and its
 * response ends with `response.done`. Never `input_audio_buffer.clear`: with
 * speech in the buffer it breaks the next turn, and during a response it cuts
 * that response off (probe 2026-10-14).
 */
export const COMMIT = { type: 'input_audio_buffer.commit' } as const;
/** Stop: answered by `session.finished`, which nothing waits for. */
export const FINISH = { type: 'session.finish' } as const;

/** A server event: its type, and whatever else it carries, read field by field where used. */
export interface ServerEvent {
  type: string;
  [field: string]: unknown;
}

/**
 * A text frame as an event. A refusal can come with no `type`, only a code and
 * words — a key whose account has not enabled the model in its region, after
 * `session.update` (probe 2026-10-23) — and is read as the `error` it is.
 */
export function decodeServerEvent(data: unknown): ServerEvent {
  if (typeof data !== 'string') throw new Error('Qwen sent a binary frame where JSON text was expected.');
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Qwen sent a frame with no type.');
  const { type, code, message } = parsed as { type?: unknown; code?: unknown; message?: unknown };
  if (typeof type === 'string') return parsed as ServerEvent;
  if (typeof code === 'string' && typeof message === 'string') return { type: 'error', error: { code, message } };
  throw new Error('Qwen sent a frame with no type.');
}

/** A field as a string, else null. */
export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** An `error` event's `{ code, message }`: `invalid_value` at the update, `COMMON_ERROR` at the first speech (an unknown voice). */
export interface QwenError {
  code: string | null;
  message: string | null;
}

export function errorOf(e: ServerEvent): QwenError {
  const error = (typeof e.error === 'object' && e.error !== null ? e.error : {}) as { code?: unknown; message?: unknown };
  return { code: str(error.code), message: str(error.message) };
}

/** Qwen's own words, clipped, naming its code. */
export function errorWords(e: QwenError): string {
  const said = (e.message ?? '').trim() || 'Qwen reported an error without words.';
  const clipped = said.length > 300 ? `${said.slice(0, 300)}…` : said;
  return `[Qwen${e.code ? ` ${e.code}` : ''}] ${clipped}`;
}

/** The notice code its words fall under (spec §6): the key, a limit, a request the model refuses, a model the key's region has not enabled, else the server's. */
export function errorCode(e: QwenError): string {
  const said = `${e.code ?? ''} ${e.message ?? ''}`;
  if (/InvalidApiKey|InvalidApiToken|API Token is expired/i.test(said)) return 'auth';
  if (/rate limit|throttl|quota exceeded|Allocated quota/i.test(said)) return 'rate_limit';
  if (/not supported|invalid_value|InvalidParameter|invalid .*parameter/i.test(said)) return 'client';
  if (/AccessDenied/.test(said)) return 'model_access_denied';
  return 'server';
}
