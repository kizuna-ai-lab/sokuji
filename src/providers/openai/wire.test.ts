import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { redact } from '../../lib/diagnostics/redact';
import type { SharedSettings } from '../../lib/provider/types';
import { buildRealtime } from './config';
import { migrateRealtimeSettings, REALTIME_DEFAULTS } from './settings';
import { AUTO_CTX, configFor, KEY, MANUAL_CTX, SERVER } from './testing';
import {
  anchorResponse, appendFrame, CLEAR, COMMIT, decodeServerEvent, errorCode, errorWords, isOutOfBand, REALTIME_WS_URL, realtimeProtocols,
  realtimeUrl, requestOf, responseCreate, sessionUpdate, textItem, unwrapTranslationText,
} from './wire';

/** The names the key is read through: the credentials' type and its one field. A string literal naming either counts too (an indexed or dynamic-property read), and so does any use of the protocol builder outside its own declaration (OpenAI Translate's `wire.test.ts` scan). */
const SECRET_NAMES = new Set(['RealtimeCredentials', 'apiKey']);
const BUILDER_NAME = 'realtimeProtocols';

/** The functions of a module that name the key, `<module>` for a use outside any function; an import names nothing. */
function secretReaders(source: string): string[] {
  const readers = new Set<string>();
  const enclosing = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
      if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    }
    return '<module>';
  };
  const isBuilderDeclaration = (node: ts.Identifier): boolean => ts.isFunctionDeclaration(node.parent) && node.parent.name === node;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && (SECRET_NAMES.has(node.text) || (node.text === BUILDER_NAME && !isBuilderDeclaration(node)))) readers.add(enclosing(node));
    if (ts.isStringLiteralLike(node) && SECRET_NAMES.has(node.text)) readers.add(enclosing(node));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true));
  return [...readers].sort();
}

/** `buildRealtime` with `model` the only one on offer, so `effectiveRealtimeModel` picks it outright — `configFor`'s fixed fixture (`testing.ts`'s `SHARED`) never lists a non-2.x model. */
const withModel = (model: string) => {
  const c = buildRealtime(AUTO_CTX, { ...REALTIME_DEFAULTS, model }, {
    pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
    reversed: () => false,
    segmentation: { mode: 'pause', sentencesPerRow: 0 },
    models: [{ id: model }],
  } satisfies SharedSettings);
  if ('refused' in c) throw new Error(c.refused);
  return c;
};

describe("OpenAI Realtime's wire: the socket", () => {
  it('dials the GA endpoint with the model in its query, and authenticates with two subprotocols — never the beta tag (choice 7)', () => {
    expect(REALTIME_WS_URL).toBe('wss://api.openai.com/v1/realtime');
    expect(realtimeUrl(configFor())).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini');
    expect(realtimeProtocols(KEY)).toEqual(['realtime', 'openai-insecure-api-key.sk-proj-realtimeKey0123456789']);
    expect(realtimeProtocols(KEY).some((p) => p.startsWith('openai-beta'))).toBe(false);
    // The URL carries no credential: the key is in the protocols alone.
    expect(realtimeUrl(configFor())).not.toContain(KEY.apiKey);
  });

  it('reads the key, in `wire.ts`, in the protocol builder alone; the protocols, wherever they land, are masked by their carrier (choice 7)', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['realtimeProtocols']);
    // The scan's control: a read in any other function, nested or not, or at the top level, is named; an import is not; an indexed read and a forwarded call are named too.
    expect(secretReaders([
      "import type { RealtimeCredentials } from './settings';",
      'export function url(k: RealtimeCredentials) { return k.apiKey; }',
      'export const frame = (k: { apiKey: string }) => [k].map((c) => c.apiKey);',
      "const leaked = { apiKey: 'x' };",
      "export function leakIndexed(k: Record<string, string>) { return k['apiKey']; }",
      'export function leakForwarded(k: Parameters<typeof realtimeProtocols>[0]) { return realtimeProtocols(k).join(", "); }',
    ].join('\n'))).toEqual(['<module>', 'frame', 'leakForwarded', 'leakIndexed', 'url']);
    // A key of no key shape: the carrier rule masks it.
    expect(redact(realtimeProtocols({ apiKey: '0a1b2c3d' }).join(', '))).toBe('realtime, openai-insecure-api-key.[REDACTED]');
  });
});

describe("OpenAI Realtime's wire: session.update", () => {
  it('configures a translator: its instructions, no tools, audio out in the voice, server VAD that answers each turn and never interrupts, the hint, noise off as null, reasoning (`openAIRealtimeSession.ts:61-111`; ruling 16)', () => {
    const c = configFor();
    expect(sessionUpdate(c)).toEqual({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions: c.instructions,
        max_output_tokens: 'inf',
        tool_choice: 'none',
        tools: [],
        audio: {
          input: {
            turn_detection: { type: 'server_vad', create_response: true, interrupt_response: false, threshold: 0.49, prefix_padding_ms: 500, silence_duration_ms: 500 },
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'ja' },
            noise_reduction: null,
          },
          output: { voice: 'alloy' },
        },
        reasoning: { effort: 'low' },
      },
    });
  });

  it('sends no temperature, whatever was stored (ruling 6), and no model: the socket names it', () => {
    // `migrate` never reads a stored `temperature` (ruling 5): it cannot reach `RealtimeSettings`,
    // so `session.update` cannot carry it either — proven through the real migration, not just
    // the wire's own types (which would omit it whatever `migrate` did).
    const migrated = migrateRealtimeSettings({ temperature: 0.7 }, { legacy: {}, credentials: {} });
    const session = sessionUpdate(configFor(AUTO_CTX, { ...migrated, maxTokens: 2048 })).session;
    expect(session).not.toHaveProperty('temperature');
    expect(session).not.toHaveProperty('model');
    expect(session.max_output_tokens).toBe(2048);
  });

  it('asks for text alone, with no voice, from a leg that does not speak; for no detection under manual turns; semantic VAD by its eagerness', () => {
    const silent = sessionUpdate(configFor({ ...AUTO_CTX, speech: false })).session;
    expect(silent.output_modalities).toEqual(['text']);
    expect(silent.audio).not.toHaveProperty('output');
    expect(sessionUpdate(configFor(MANUAL_CTX)).session.audio.input.turn_detection).toBeNull();
    expect(sessionUpdate(configFor(AUTO_CTX, { turnDetectionMode: 'Semantic', semanticEagerness: 'High' })).session.audio.input.turn_detection)
      .toEqual({ type: 'semantic_vad', create_response: true, interrupt_response: false, eagerness: 'high' });
  });

  it('sends a chosen noise reduction as its type, the context hints to the models that take them, and reasoning to gpt-realtime-2* alone', () => {
    const update = sessionUpdate(configFor(AUTO_CTX, { noiseReduction: 'Far field', transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji, Kizuna AI' }));
    expect(update.session.audio.input.noise_reduction).toEqual({ type: 'far_field' });
    expect(update.session.audio.input.transcription).toEqual({ model: 'gpt-live-transcribe', languages: ['ja'], keywords: ['Sokuji', 'Kizuna AI'] });
    // Through `takesReasoning` itself (`settings.ts`), not a hand-built config: a plain mini and
    // a dated 1.0 snapshot (whose year starts with the same digit as the 2.x family) take none;
    // a 2.x model does.
    expect(sessionUpdate(withModel('gpt-realtime-mini')).session).not.toHaveProperty('reasoning');
    expect(sessionUpdate(withModel('gpt-realtime-2025-08-28')).session).not.toHaveProperty('reasoning');
    expect(sessionUpdate(withModel('gpt-realtime-2.1')).session).toHaveProperty('reasoning');
  });
});

describe("OpenAI Realtime's wire: the client's frames", () => {
  it("sends a chunk as base64 of the view's own bytes, and commits and clears the buffer by name", () => {
    const view = new Int16Array([7, 1, -2, 300, 9]).subarray(1, 4);
    const frame = JSON.parse(appendFrame(view)) as { type: string; audio: string };
    expect(frame.type).toBe('input_audio_buffer.append');
    expect(Object.keys(frame)).toEqual(['type', 'audio']);
    expect(Array.from(base64ToPcm(frame.audio))).toEqual([1, -2, 300]);
    expect(COMMIT).toEqual({ type: 'input_audio_buffer.commit' });
    expect(CLEAR).toEqual({ type: 'input_audio_buffer.clear' });
  });

  it('sends typed text as an input item of its own id, and an in-band response by an event id (`OpenAIGAClient.ts:819-867`; choice 10)', () => {
    expect(textItem('sokuji_text_1', 'Hello there')).toEqual({
      type: 'conversation.item.create',
      item: { id: 'sokuji_text_1', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello there' }] },
    });
    expect(responseCreate('sokuji_3')).toEqual({ type: 'response.create', event_id: 'sokuji_3', response: { metadata: { request: 'sokuji_3' } } });
    expect(requestOf({ metadata: { request: 'sokuji_3' } })).toBe('sokuji_3');
    expect(requestOf({ metadata: null })).toBeUndefined();
    expect(requestOf({ metadata: { request: 3 } })).toBeUndefined();
    expect(requestOf(undefined)).toBeUndefined();
  });

  it('sends the drift anchor out of band, as text, with the instructions when there are any, marked as the anchor (ruling 2)', () => {
    expect(anchorResponse('sokuji_1', 'Translate.')).toEqual({
      type: 'response.create', event_id: 'sokuji_1',
      response: { conversation: 'none', output_modalities: ['text'], instructions: 'Translate.', metadata: { purpose: 'anchor' } },
    });
    expect(anchorResponse('sokuji_2', '').response).not.toHaveProperty('instructions');
  });
});

describe("OpenAI Realtime's wire: what comes down", () => {
  it('decodes a text frame and a binary one, and refuses what is not a JSON object with a type (choice 15)', () => {
    expect(decodeServerEvent(SERVER.cleared())).toEqual({ event_id: 'event_1', type: 'input_audio_buffer.cleared' });
    const bytes = new TextEncoder().encode(SERVER.cleared());
    expect(decodeServerEvent(bytes.buffer.slice(0) as ArrayBuffer).type).toBe('input_audio_buffer.cleared');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('[1]')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('null')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('{"delta":"x"}')).toThrow('no type');
    expect(() => decodeServerEvent(new Blob(['{}']))).toThrow('unexpected kind');
  });

  it('tells an out-of-band response by its null conversation or its anchor metadata, and an in-band one otherwise', () => {
    expect(isOutOfBand({ conversation_id: null, metadata: null })).toBe(true);
    expect(isOutOfBand({ conversation_id: 'conv_1', metadata: { purpose: 'anchor' } })).toBe(true);
    expect(isOutOfBand({ conversation_id: 'conv_1', metadata: null })).toBe(false);
    expect(isOutOfBand({})).toBe(false);
    expect(isOutOfBand(undefined)).toBe(false);
  });

  it('settles a translation trimmed, and unwrapped from JSON (`textUtils.ts:6-25`)', () => {
    expect(unwrapTranslationText('\r\n Hello. ')).toBe('Hello.');
    expect(unwrapTranslationText('{"final_text": " Bonjour. "}')).toBe('Bonjour.');
    expect(unwrapTranslationText('{"translation":"Hola"}')).toBe('Hola');
    expect(unwrapTranslationText('{not json')).toBe('{not json');
    expect(unwrapTranslationText('{"other": 1}')).toBe('{"other": 1}');
    expect(unwrapTranslationText('')).toBe('');
  });

  it("words a server error as OpenAI's own, and codes it: the 60-minute cap as the segment's end, a bad key, a rate or a quota, an invalid request, else the service's (choice 14)", () => {
    expect(errorCode({ type: 'invalid_request_error', code: 'session_expired' })).toBe('segment_ended');
    expect(errorCode({ type: 'invalid_request_error', code: 'invalid_api_key' })).toBe('auth');
    expect(errorCode({ type: 'invalid_request_error', code: 'rate_limit_exceeded' })).toBe('rate_limit');
    expect(errorCode({ type: 'insufficient_quota', code: 'insufficient_quota' })).toBe('rate_limit');
    expect(errorCode({ type: 'invalid_request_error', code: 'conversation_already_has_active_response' })).toBe('client');
    expect(errorCode({ type: 'server_error', code: null })).toBe('server');
    expect(errorCode({})).toBe('server');
    expect(errorWords({ type: 'invalid_request_error', code: 'session_expired', message: 'Your session hit the maximum duration of 60 minutes.' }))
      .toBe('[OpenAI session_expired] Your session hit the maximum duration of 60 minutes.');
    expect(errorWords({})).toBe('[OpenAI error] the server reported an error');
  });
});
