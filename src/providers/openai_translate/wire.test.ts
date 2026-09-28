import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { redact } from '../../lib/diagnostics/redact';
import { configFor, KEY, SERVER } from './testing';
import {
  appendFrame, base64ToPcm, computeRms, decodeServerEvent, elapsedMsOf, errorCode, errorWords, isSilentFrame, OUTPUT_RATE, pcmToBase64, sessionUpdate,
  TRANSLATE_WS_URL, translateProtocols, translateUrl,
} from './wire';

/** The names the key is read through: the credentials' type and its one field. A string literal naming either counts too (an indexed or dynamic-property read), and so does any use of the protocol builder outside its own declaration — nothing else in `wire.ts` may call it. */
const SECRET_NAMES = new Set(['TranslateCredentials', 'apiKey']);
const BUILDER_NAME = 'translateProtocols';

/** The functions of a module that name the key, `<module>` for a use outside any function; an import names nothing (Doubao's `wire.test.ts` scan). */
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

describe("OpenAI Translate's wire: the socket", () => {
  it('dials the translations endpoint with the model in its query, and authenticates with two subprotocols — never the beta tag (choice 3)', () => {
    expect(TRANSLATE_WS_URL).toBe('wss://api.openai.com/v1/realtime/translations');
    expect(translateUrl(configFor())).toBe('wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate');
    expect(translateProtocols(KEY)).toEqual(['realtime', 'openai-insecure-api-key.sk-proj-translateKey0123456789']);
    expect(translateProtocols(KEY).some((p) => p.startsWith('openai-beta'))).toBe(false);
    // The URL carries no credential: the key is in the protocols alone.
    expect(translateUrl(configFor())).not.toContain(KEY.apiKey);
  });

  it('reads the key, in `wire.ts`, in the protocol builder alone; the protocols, wherever they land, are masked by their carrier (choice 3)', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['translateProtocols']);
    // The scan's control: a read in any other function, nested or not, or at the top level, is named; an import is not. An indexed read (`k['apiKey']`) and a call forwarded to the builder under a type-only alias are named too — the two evasions an identifier-only scan misses.
    expect(secretReaders([
      "import type { TranslateCredentials } from './settings';",
      'export function url(k: TranslateCredentials) { return k.apiKey; }',
      'export const frame = (k: { apiKey: string }) => [k].map((c) => c.apiKey);',
      "const leaked = { apiKey: 'x' };",
      "export function leakIndexed(k: Record<string, string>) { return k['apiKey']; }",
      'export function leakForwarded(k: Parameters<typeof translateProtocols>[0]) { return translateProtocols(k).join(", "); }',
    ].join('\n'))).toEqual(['<module>', 'frame', 'leakForwarded', 'leakIndexed', 'url']);
    // A key of no key shape (the fixture's `sk-…` would be masked by the bare-shape rule whatever the carrier rule did).
    expect(redact(translateProtocols({ apiKey: '0a1b2c3d' }).join(', '))).toBe('realtime, openai-insecure-api-key.[REDACTED]');
  });
});

describe("OpenAI Translate's wire: session.update", () => {
  it('sends the target alone as the output, and the transcript model with noise reduction off as null (rulings 8, 9)', () => {
    expect(sessionUpdate(configFor())).toEqual({
      type: 'session.update',
      session: { audio: { output: { language: 'en' }, input: { transcription: { model: 'gpt-live-transcribe' }, noise_reduction: null } } },
    });
  });

  it('sends a chosen noise reduction as its type', () => {
    expect(sessionUpdate(configFor(undefined, { noiseReduction: 'Near field' })).session.audio?.input?.noise_reduction).toEqual({ type: 'near_field' });
    expect(sessionUpdate(configFor(undefined, { noiseReduction: 'Far field' })).session.audio?.input?.noise_reduction).toEqual({ type: 'far_field' });
  });

  it('sends neither the source, nor an output transcription, nor a model: the endpoint refuses what it does not take (`OpenAITranslateGAClient.test.ts:27-89`)', () => {
    const update = sessionUpdate(configFor({ direction: { source: 'en', target: 'ja' }, speech: false, turns: 'manual' }));
    expect(update.session.audio?.output).toEqual({ language: 'ja' });
    expect(Object.keys(update.session)).toEqual(['audio']);
    expect(Object.keys(update.session.audio?.input ?? {})).toEqual(['transcription', 'noise_reduction']);
    expect(JSON.stringify(update)).not.toContain('"en"');
  });
});

describe("OpenAI Translate's wire: audio", () => {
  it("sends a chunk as base64 of the view's own bytes, little-endian, never its backing buffer's", () => {
    const backing = new Int16Array([7, 1, -2, 300, 9]);
    const view = backing.subarray(1, 4);
    const frame = JSON.parse(appendFrame(view)) as { type: string; audio: string };
    expect(frame.type).toBe('session.input_audio_buffer.append');
    expect(Object.keys(frame)).toEqual(['type', 'audio']);
    expect(Array.from(base64ToPcm(frame.audio))).toEqual([1, -2, 300]);
    expect(atob(pcmToBase64(new Int16Array([0x0102]))).split('').map((c) => c.charCodeAt(0))).toEqual([0x02, 0x01]);
  });

  it('decodes an output delta, dropping an odd trailing byte where the old decoder threw (survey §1.14.10)', () => {
    expect(Array.from(base64ToPcm(btoa('\x01\x00\x02\x00\x03')))).toEqual([1, 2]);
    expect(base64ToPcm('')).toHaveLength(0);
    expect(OUTPUT_RATE).toBe(24_000);
  });

  it('tells a heartbeat by its content, not its length, and measures RMS for the Logs (`OpenAITranslateGAClient.test.ts:91-144`)', () => {
    expect(isSilentFrame(new Int16Array(4_800))).toBe(true);
    expect(isSilentFrame(new Int16Array(9_600))).toBe(true);
    expect(isSilentFrame(new Int16Array(0))).toBe(true);
    const content = new Int16Array(4_800);
    content[4_799] = 1;
    expect(isSilentFrame(content)).toBe(false);
    expect(computeRms(new Int16Array(0))).toBe(0);
    expect(computeRms(new Int16Array(10))).toBe(0);
    expect(computeRms(new Int16Array(10).fill(-32768))).toBe(1);
    expect(computeRms(new Int16Array(10).fill(1638))).toBeCloseTo(0.05, 3);
  });
});

describe("OpenAI Translate's wire: what comes down", () => {
  it('decodes a text frame and a binary one, and refuses what is not a JSON object with a type', () => {
    expect(decodeServerEvent(SERVER.closed())).toEqual({ event_id: 'event_1', type: 'session.closed' });
    const bytes = new TextEncoder().encode(SERVER.closed());
    expect(decodeServerEvent(bytes.buffer.slice(0) as ArrayBuffer).type).toBe('session.closed');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('[1]')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('null')).toThrow('not a JSON object');
    expect(() => decodeServerEvent('{"delta":"x"}')).toThrow('no type');
    expect(() => decodeServerEvent(new Blob(['{}']))).toThrow('unexpected kind');
  });

  it("reads a delta's elapsed_ms when it is a number, else null (ruling 6)", () => {
    expect(elapsedMsOf({ elapsed_ms: 1_400 })).toBe(1_400);
    expect(elapsedMsOf({ elapsed_ms: 0 })).toBe(0);
    expect(elapsedMsOf({ elapsed_ms: null })).toBeNull();
    expect(elapsedMsOf({})).toBeNull();
    expect(elapsedMsOf({ elapsed_ms: '200' })).toBeNull();
  });

  it("words a server error as OpenAI's own, and codes it: a bad key, a rate or a quota, an invalid request, else the service's (choice 9)", () => {
    expect(errorCode({ type: 'invalid_request_error', code: 'invalid_api_key' })).toBe('auth');
    expect(errorCode({ type: 'invalid_request_error', code: 'rate_limit_exceeded' })).toBe('rate_limit');
    expect(errorCode({ type: 'insufficient_quota', code: 'insufficient_quota' })).toBe('rate_limit');
    expect(errorCode({ type: 'invalid_request_error', code: 'unknown_parameter' })).toBe('client');
    expect(errorCode({ type: 'server_error', code: null })).toBe('server');
    expect(errorCode({})).toBe('server');
    expect(errorWords({ type: 'invalid_request_error', code: 'unknown_parameter', message: "Unknown parameter: 'session.audio.x'." })).toBe("[OpenAI unknown_parameter] Unknown parameter: 'session.audio.x'.");
    expect(errorWords({ type: 'server_error', code: null, message: 'The server had an error.' })).toBe('[OpenAI server_error] The server had an error.');
    expect(errorWords({})).toBe('[OpenAI error] the server reported an error');
  });
});
