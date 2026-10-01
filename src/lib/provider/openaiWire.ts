/**
 * OpenAI's server events and errors, as the three OpenAI adapters read them:
 * a frame decoded into a typed event, and a server `error` as a notice code
 * and OpenAI's own words. Written in OpenAI Translate's wire, copied into
 * OpenAI Realtime's, and lifted here at their third user, OpenAI Live
 * (Stage 2 OpenAI Live, ruling 9; choice 4): a provider never imports
 * another's folder. The two wires re-export them; Realtime's own code for
 * its 60-minute cap stays its own. Pure.
 */

/** A server event as an adapter reads it: a JSON object with a string `type`, read through its own type after. */
export type ServerEvent = { type: string } & Record<string, unknown>;

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer. Throws when it is not a JSON object with a string `type`. */
export function decodeServerEvent(data: unknown): ServerEvent {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
  return parsed as ServerEvent;
}

/** A server `error` event's `error`: the fields the three endpoints send (the SDK's `RealtimeError`, and OpenAI Live's, which the SDK does not type). */
export interface OpenAIError {
  type?: string;
  code?: string | null;
  message?: string;
  param?: string | null;
}

export type OpenAIErrorCode = 'auth' | 'rate_limit' | 'client' | 'server';

/**
 * A server `error` as a notice code: OpenAI's codes for a bad key, a rate
 * limit and an exhausted quota first, then an invalid request, else the
 * service's (Stage 2 OpenAI Translate, choice 9).
 */
export function errorCode(e: OpenAIError): OpenAIErrorCode {
  if (e.code === 'invalid_api_key') return 'auth';
  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
  if (e.type === 'invalid_request_error') return 'client';
  return 'server';
}

/** A server `error` in OpenAI's own words, as the `{{detail}}` of its notice: `[OpenAI <code, else type>] <message>`. */
export function errorWords(e: OpenAIError): string {
  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
}
