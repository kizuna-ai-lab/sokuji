/**
 * One fixture per pattern, each traced to the line that produces the shape.
 * A pattern with no named source does not belong in the list: the panel is
 * user-visible and clipboard-exportable, so every rule here has to earn its
 * false-positive risk against a credential this app actually handles.
 */
import { describe, it, expect } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  // errorTracking.ts:57 already redacted these three; redact() takes over the list.
  it('redacts OpenAI sk- keys', () => {
    expect(redact('Error with sk-abc123def456')).toBe('Error with [REDACTED]');
  });

  it('redacts Google AIza keys', () => {
    expect(redact('Key: AIzaSyB-example123')).toBe('Key: [REDACTED]');
  });

  it('redacts key- prefixed tokens', () => {
    expect(redact('Using key-abcdef12345')).toBe('Using [REDACTED]');
  });

  // EphemeralTokenService.ts:190 — `{ value: 'ek_...' }` is the client secret
  // minted for WebRTC; :200 logs the whole response body when the shape is wrong.
  it('redacts OpenAI ephemeral client secrets', () => {
    expect(redact('secret ek_a1b2c3d4e5f6g7 expired')).toBe('secret [REDACTED] expired');
  });

  // GeminiClient.ts:138-139 — `${MODELS_ENDPOINT}?key=${apiKey}`. The parameter
  // name stays so the reader knows which call failed.
  it('redacts credential query parameters but keeps the parameter name', () => {
    expect(redact('GET https://x/v1/models?key=AIzaSyB-example123&pageToken=abc'))
      .toBe('GET https://x/v1/models?key=[REDACTED]&pageToken=abc');
    expect(redact('POST /s?api_key=deadbeef1234&x=1')).toBe('POST /s?api_key=[REDACTED]&x=1');
    expect(redact('wss://r/?access_token=zzzzzzzzzzzz')).toBe('wss://r/?access_token=[REDACTED]');
  });

  // VolcengineSTClient.ts:79-86 signs the WebSocket URL SigV4-style, and
  // `X-Credential` carries the account's access key id verbatim. The rule is
  // anchored on `[?&]`, so a bare `signature` alternative does not reach
  // `?X-Signature=` — the `X-` prefix sits between the delimiter and the name.
  // The original fixtures used invented URLs and missed this entirely.
  it('redacts Volcengine signed-URL credentials', () => {
    const url =
      'wss://openspeech.bytedance.com/api/v3/sauc?Action=Sauc&X-Algorithm=HMAC-SHA256' +
      '&X-Credential=AKLTabc123def456%2F20260827%2Fcn-north-1%2Fsauc%2Frequest' +
      '&X-Date=20260827T000000Z&X-Signature=9f8e7d6c5b4a3210';
    const out = redact(url);
    expect(out).not.toContain('AKLTabc123def456');
    expect(out).not.toContain('9f8e7d6c5b4a3210');
    // The parameter names survive, so the reader still knows which call failed.
    expect(out).toContain('X-Credential=[REDACTED]');
    expect(out).toContain('X-Signature=[REDACTED]');
    // Non-credential parameters are untouched.
    expect(out).toContain('X-Algorithm=HMAC-SHA256');
    expect(out).toContain('X-Date=20260827T000000Z');
  });

  it('redacts Bearer tokens but keeps the scheme', () => {
    expect(redact('Authorization: Bearer sess_abcdef123456'))
      .toBe('Authorization: Bearer [REDACTED]');
  });

  // OpenAITranslateGAClient.ts:501 — `sokuji-auth.${this.apiKey}` is the relay
  // WebSocket subprotocol; the carrier name stays, the token goes.
  it('redacts the relay auth subprotocol token', () => {
    expect(redact('subprotocols: sokuji-auth.sess_TOKEN_VALUE_1234, json'))
      .toBe('subprotocols: sokuji-auth.[REDACTED], json');
  });

  // Named in #441. UserProfileContext and settingsStore:1121 carry auth errors
  // that can quote the account address.
  it('redacts e-mail addresses', () => {
    expect(redact('wallet fetch failed for user@example.co.jp'))
      .toBe('wallet fetch failed for [REDACTED]');
  });

  it('redacts every occurrence, not just the first', () => {
    expect(redact('sk-aaabbbcccddd and AIzaSyBcDeFgHiJk')).toBe('[REDACTED] and [REDACTED]');
  });

  it('leaves ordinary error text alone', () => {
    expect(redact('TypeError: undefined is not a function'))
      .toBe('TypeError: undefined is not a function');
    // Guards against an over-broad token= rule eating prose.
    expect(redact('the request token was rejected')).toBe('the request token was rejected');
    // Short identifiers are not credentials; the {10,} floor keeps them.
    expect(redact('device sk-1 selected')).toBe('device sk-1 selected');
  });

  it('is a no-op on empty input', () => {
    expect(redact('')).toBe('');
  });
});
