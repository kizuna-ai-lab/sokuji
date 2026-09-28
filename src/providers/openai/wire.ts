/**
 * OpenAI Realtime's GA wire, spoken directly (survey §1.4–1.5, §2.12): the
 * URL and its subprotocols, the client frames the adapter sends, the
 * server's frames decoded, a response told in-band or out-of-band, a
 * translation's final text, and a server `error` as a notice code and
 * words. The client frames are typed by the `openai` SDK's realtime types,
 * imported for types only, widened where the API is ahead of the SDK
 * (`languages` / `keywords`, a `null` noise reduction). Pure: no socket, no
 * timer.
 */
import type {
  ConversationItemCreateEvent,
  InputAudioBufferAppendEvent,
  InputAudioBufferClearEvent,
  InputAudioBufferCommitEvent,
  RealtimeAudioConfigInput,
  RealtimeAudioConfigOutput,
  RealtimeAudioInputTurnDetection,
  RealtimeError,
  RealtimeSessionCreateRequest,
  ResponseCreateEvent,
} from 'openai/resources/realtime/realtime';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { RealtimeConfig, TurnDetection } from './config';
import type { RealtimeCredentials } from './settings';
import type { TranscriptionHint } from './transcription';

/** The GA endpoint the SDK dials (`openai/realtime/internal-base.js:41-50`); the model rides in its query, fixed at creation. */
export const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime';

export function realtimeUrl(c: Pick<RealtimeConfig, 'model'>): string {
  return `${REALTIME_WS_URL}?model=${encodeURIComponent(c.model)}`;
}

/**
 * The subprotocols a socket authenticates with (choice 7;
 * `openai/realtime/websocket.js:29-32`): `realtime`, and the key as
 * `openai-insecure-api-key.<key>`, which a browser sets itself — no upgrade
 * header on any platform, no ephemeral token. Never the beta tag: this is
 * the GA protocol. The one function of the session side that reads the
 * key; what it returns is never framed, worded or logged.
 */
export function realtimeProtocols(k: RealtimeCredentials): string[] {
  return ['realtime', `openai-insecure-api-key.${k.apiKey}`];
}

/** `session.update`, the SDK's own request widened where the API is ahead of it: the transcription's `languages` / `keywords` (`transcription.ts`), and a noise reduction of `null`, which turns it off. */
export interface WireSessionUpdate {
  type: 'session.update';
  session: Omit<RealtimeSessionCreateRequest, 'audio'> & {
    audio: {
      input: Omit<RealtimeAudioConfigInput, 'transcription' | 'noise_reduction'> & {
        transcription: TranscriptionHint;
        noise_reduction: RealtimeAudioConfigInput.NoiseReduction | null;
      };
      output?: RealtimeAudioConfigOutput;
    };
  };
}

/** Detection as the wire takes it: the server answers each turn itself, and never interrupts a translation still playing (`OpenAIProviderConfig.ts:100-116`). */
function turnDetectionOf(d: TurnDetection | null): RealtimeAudioInputTurnDetection | null {
  if (d === null) return null;
  if (d.type === 'semantic_vad') return { type: 'semantic_vad', create_response: true, interrupt_response: false, eagerness: d.eagerness };
  return {
    type: 'server_vad', create_response: true, interrupt_response: false,
    threshold: d.threshold, prefix_padding_ms: d.prefixPaddingMs, silence_duration_ms: d.silenceDurationMs,
  };
}

/**
 * The session's configuration, sent once `session.created` arrives: the old
 * `buildOpenAIRealtimeSession` (`openAIRealtimeSession.ts:61-111`) — a
 * translator by its instructions, with no tools (`OpenAIClient.ts:727-730`),
 * the voice under `audio.output` only on a leg that speaks — with two
 * changes: noise reduction "None" is `null` (ruling 16), and no temperature
 * (ruling 6), which the GA session never took.
 */
export function sessionUpdate(c: RealtimeConfig): WireSessionUpdate {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: c.modalities,
      instructions: c.instructions,
      max_output_tokens: c.maxTokens,
      tool_choice: 'none',
      tools: [],
      audio: {
        input: {
          turn_detection: turnDetectionOf(c.turnDetection),
          transcription: c.transcription,
          noise_reduction: c.noiseReduction === null ? null : { type: c.noiseReduction },
        },
        ...(c.voice ? { output: { voice: c.voice } } : {}),
      },
      ...(c.reasoningEffort ? { reasoning: { effort: c.reasoningEffort } } : {}),
    },
  };
}

/** One chunk as it goes up: 24 kHz PCM16 mono, the contract's own rate and the GA default — no resampling. */
export function appendFrame(pcm: Int16Array): string {
  const frame: InputAudioBufferAppendEvent = { type: 'input_audio_buffer.append', audio: pcmToBase64(pcm) };
  return JSON.stringify(frame);
}

/** A release with speech, under manual turns: what the press appended becomes an input item. */
export const COMMIT: InputAudioBufferCommitEvent = { type: 'input_audio_buffer.commit' };
/** A release without speech: the press's audio is dropped, not left to join the next turn (spec, "Defects removed by construction"). */
export const CLEAR: InputAudioBufferClearEvent = { type: 'input_audio_buffer.clear' };

/** Typed text as an input item of the adapter's own id, which the translation's `previous_item_id` then names (`OpenAIGAClient.ts:819-867`). */
export function textItem(itemId: string, text: string): ConversationItemCreateEvent {
  return { type: 'conversation.item.create', item: { id: itemId, type: 'message', role: 'user', content: [{ type: 'input_text', text }] } };
}

/**
 * An in-band response for the input the conversation ends with (a released
 * press, a typed text): `event_id` names it in the error that may refuse
 * it, and its metadata names it in the response it creates, told apart
 * from one the server's own detection created (choice 10).
 */
export function responseCreate(eventId: string): ResponseCreateEvent {
  return { type: 'response.create', event_id: eventId, response: { metadata: { request: eventId } } };
}

/** The request an in-band response names back (`responseCreate`'s metadata), if any. */
export function requestOf(response: { metadata?: unknown } | undefined): string | undefined {
  const request = (response?.metadata as { request?: unknown } | null | undefined)?.request;
  return typeof request === 'string' ? request : undefined;
}

/** The drift anchor's metadata: how its response is told apart when it comes back (ruling 2). */
export const ANCHOR_METADATA = { purpose: 'anchor' } as const;

/**
 * The drift anchor (ruling 2; `MainPanel.tsx:4245-4325` before `aecaae2b`,
 * `openAIRealtimeSession.ts:189-206`): an out-of-band, text-only response
 * carrying this leg's instructions — kept out of the conversation, its
 * output discarded. The instructions go only when not blank, as the old
 * builder sent them.
 */
export function anchorResponse(eventId: string, instructions: string): ResponseCreateEvent {
  return {
    type: 'response.create',
    event_id: eventId,
    response: { conversation: 'none', output_modalities: ['text'], ...(instructions ? { instructions } : {}), metadata: { ...ANCHOR_METADATA } },
  };
}

/** A response out of band: kept out of the conversation (`conversation_id` null, the SDK) or the anchor's own (its metadata). The anchor's are the only ones this adapter asks for. */
export function isOutOfBand(response: { conversation_id?: unknown; metadata?: unknown } | undefined): boolean {
  if (!response) return false;
  const metadata = response.metadata as { purpose?: unknown } | null | undefined;
  return response.conversation_id === null || metadata?.purpose === ANCHOR_METADATA.purpose;
}

/** A server event as the adapter reads it: a JSON object with a string `type`; the adapter reads each through its SDK type. */
export type ServerEvent = { type: string } & Record<string, unknown>;

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer (choice 15). Throws when it is not a JSON object with a string `type`. */
export function decodeServerEvent(data: unknown): ServerEvent {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
  return parsed as ServerEvent;
}

/**
 * A translation's final text (choice 5): trimmed, and unwrapped when the
 * model answered in JSON (`{"final_text": …}`) — copied from
 * `src/utils/textUtils.ts`, which only the old clients use. Applied to the
 * `.done` text alone, as the old client did, so a wrapped answer streams
 * raw and settles unwrapped.
 */
export function unwrapTranslationText(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of ['final_text', 'final', 'text', 'translation', 'result', 'query']) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'string') return value.trim();
      }
    }
  } catch {
    // Not JSON: the text as it stands.
  }
  return trimmed;
}

export type ErrorCode = 'auth' | 'rate_limit' | 'client' | 'server' | 'segment_ended';

/**
 * A server `error` as a notice code (choice 14): OpenAI Translate's mapping
 * (its choice 9), copied, and one more — the 60-minute cap's
 * `session_expired` is the run's end, worded as the segment ended
 * (`segment_ended`: "This segment has ended — tap Start Session to
 * continue."), not a refused request. A hypothesis the live test's
 * `session.error` frames settle.
 */
export function errorCode(e: Partial<RealtimeError>): ErrorCode {
  if (e.code === 'session_expired') return 'segment_ended';
  if (e.code === 'invalid_api_key') return 'auth';
  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
  if (e.type === 'invalid_request_error') return 'client';
  return 'server';
}

/** A server `error` in OpenAI's own words, as the `{{detail}}` of its notice: `[OpenAI <code, else type>] <message>`. */
export function errorWords(e: Partial<RealtimeError>): string {
  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
}
