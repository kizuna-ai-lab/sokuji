import { describe, it, expect } from 'vitest';
import { decodeServerEvent, errorCode, errorWords } from './openaiWire';

describe("OpenAI's decoder and error words, lifted at their third user (Stage 2 OpenAI Live, choice 4)", () => {
  it('decodes a text frame or an ArrayBuffer into an event with a string type', () => {
    expect(decodeServerEvent('{"type":"session.started","session":{"id":"live_1"}}')).toEqual({ type: 'session.started', session: { id: 'live_1' } });
    expect(decodeServerEvent(new TextEncoder().encode('{"type":"error"}').buffer)).toEqual({ type: 'error' });
  });

  it('throws on anything else', () => {
    expect(() => decodeServerEvent(new Blob(['{}']))).toThrow('a server frame of an unexpected kind ([object Blob])');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('[1]')).toThrow('a server frame that is not a JSON object');
    expect(() => decodeServerEvent('{"kind":"x"}')).toThrow('a server frame with no type');
  });

  it("reads a key refused, a limit or a quota, an invalid request, else the service's", () => {
    expect(errorCode({ code: 'invalid_api_key' })).toBe('auth');
    expect(errorCode({ code: 'rate_limit_exceeded' })).toBe('rate_limit');
    expect(errorCode({ code: 'insufficient_quota', type: 'insufficient_quota' })).toBe('rate_limit');
    expect(errorCode({ type: 'invalid_request_error', code: 'forbidden' })).toBe('client');
    expect(errorCode({ type: 'server_error' })).toBe('server');
  });

  it("words an error as OpenAI said it: its code, else its type, and its message", () => {
    expect(errorWords({ type: 'invalid_request_error', code: 'forbidden', message: 'Voice session access denied.' })).toBe('[OpenAI forbidden] Voice session access denied.');
    expect(errorWords({ type: 'server_error' })).toBe('[OpenAI server_error] the server reported an error');
    expect(errorWords({})).toBe('[OpenAI error] the server reported an error');
  });
});
