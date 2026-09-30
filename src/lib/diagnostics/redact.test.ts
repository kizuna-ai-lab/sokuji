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

  // gemini/wire.ts `liveUrl` — `?key=${apiKey}`. The parameter
  // name stays so the reader knows which call failed.
  it('redacts credential query parameters but keeps the parameter name', () => {
    expect(redact('GET https://x/v1/models?key=AIzaSyB-example123&pageToken=abc'))
      .toBe('GET https://x/v1/models?key=[REDACTED]&pageToken=abc');
    expect(redact('POST /s?api_key=deadbeef1234&x=1')).toBe('POST /s?api_key=[REDACTED]&x=1');
    expect(redact('wss://r/?access_token=zzzzzzzzzzzz')).toBe('wss://r/?access_token=[REDACTED]');
  });

  // A SigV4-style signed WebSocket URL puts the account's access key id in
  // `X-Credential` verbatim. No client signs one today (VolcengineSTClient,
  // which did, was removed on 2026-09-20) — the rule is kept as a net for a
  // URL a user pastes into a bug report, and this case is what keeps it
  // honest. It is anchored on `[?&]`, so a bare `signature` alternative does
  // not reach `?X-Signature=` — the `X-` prefix sits between the delimiter and
  // the name. The original fixtures used invented URLs and missed this entirely.
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

  // volcengine_ast2/wire.ts `ast2Url` — Doubao AST 2.0's credentials ride in
  // its socket's query (Stage 2 Volcengine AST2, ruling 2): the legacy App ID
  // and Access Token, or the new console's API key. The resource id is not a
  // secret and stays readable.
  it("redacts Doubao AST 2.0's query credentials, keeping each parameter's name", () => {
    const legacy = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_app_key=1234567890&api_access_key=Abc-Def_ghi';
    expect(redact(legacy)).toBe('wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_app_key=[REDACTED]&api_access_key=[REDACTED]');
    expect(redact('wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_key=0a1b2c3d'))
      .toBe('wss://openspeech.bytedance.com/api/v4/ast/v2/translate?api_resource_id=volc.service_type.10053&api_key=[REDACTED]');
    expect(redact('?API_APP_KEY=a1&Api_Access_Key=b2')).toBe('?API_APP_KEY=[REDACTED]&Api_Access_Key=[REDACTED]');
  });

  // palabraai/wire.ts `directUrl` and `sessionUrl` — Palabra's socket takes the
  // platform key or a REST session's publisher token in its query (Stage 2
  // Palabra, ruling 1): the parameter's name stays, the value goes.
  it("redacts Palabra's socket token, keeping the parameter's name", () => {
    expect(redact('wss://streaming.palabra.ai/streaming-api/4593a758/v1/speech-to-speech/stream?token=plbr_0123456789abcdef'))
      .toBe('wss://streaming.palabra.ai/streaming-api/4593a758/v1/speech-to-speech/stream?token=[REDACTED]');
  });

  // palabraai/wire.ts `restHeaders` / `directUrl` — Palabra's platform key has a
  // documented shape, `plbr_…` (Stage 2 Palabra, choice 10): masked wherever it
  // stands bare, as the other providers' key shapes are.
  it('redacts a bare Palabra platform key', () => {
    expect(redact('Invalid API key plbr_Abc-def_0123456789 for this organization'))
      .toBe('Invalid API key [REDACTED] for this organization');
    expect(redact('plbr_short')).toBe('plbr_short');
  });

  // palabraai/wire.ts `readCreated` — a REST session's publisher token, and its
  // id of the same shape in the owner's probe, are JWTs (Stage 2 Palabra,
  // choice 10): masked whole. A string that only starts like one stays.
  it('redacts a JWT whole', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwdWJsaXNoZXIifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redact(`publisher ${jwt} issued`)).toBe('publisher [REDACTED] issued');
    expect(redact(`{"id":"${jwt}"}`)).toBe('{"id":"[REDACTED]"}');
    expect(redact('eyJ is how every JWT starts')).toBe('eyJ is how every JWT starts');
  });

  it('redacts Bearer tokens but keeps the scheme', () => {
    expect(redact('Authorization: Bearer sess_abcdef123456'))
      .toBe('Authorization: Bearer [REDACTED]');
  });

  // `sokuji-auth.<token>` was the relay WebSocket subprotocol, kept as a net
  // (Stage 2 deletion, choice 6); the carrier name stays, the token goes.
  it('redacts the relay auth subprotocol token', () => {
    expect(redact('subprotocols: sokuji-auth.sess_TOKEN_VALUE_1234, json'))
      .toBe('subprotocols: sokuji-auth.[REDACTED], json');
  });

  // openai_translate/wire.ts `translateProtocols` — OpenAI Translate's own key
  // rides in the `openai-insecure-api-key.` subprotocol (Stage 2 OpenAI
  // Translate, choice 3): the carrier name stays, the key goes, whatever its
  // shape. The first value has no key shape, so only this rule masks it.
  it("redacts OpenAI Translate's key subprotocol, keeping the carrier's name", () => {
    expect(redact('protocols: realtime, openai-insecure-api-key.0a1b2c3d'))
      .toBe('protocols: realtime, openai-insecure-api-key.[REDACTED]');
    expect(redact('["realtime","openai-insecure-api-key.sk-proj-abcdefghijklmnop"]'))
      .toBe('["realtime","openai-insecure-api-key.[REDACTED]"]');
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
