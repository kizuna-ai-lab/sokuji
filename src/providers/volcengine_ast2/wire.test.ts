import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { redact } from '../../lib/diagnostics/redact';
import { data as proto } from './proto/ast2-proto.js';
import { API_KEY, APP_KEY, SERVER, serverFrame } from './testing';
import {
  AST2_ENDPOINT, AST2_RESOURCE_ID, EventType, OFFLINE, OK_STATUS, REFUSED_UPGRADE, ast2Url, audioFrame, decodeResponse, eventName, finishSessionFrame, isOk,
  startSessionFrame, statusFailureCode, statusText, toNumber,
} from './wire';

const decodeRequest = (bytes: Uint8Array) => proto.speech.ast.TranslateRequest.decode(bytes);
const ids = { session: 's-1', connection: 'c-1' };

/** The names a secret credential is read through: the credentials' type, the Access Token's field and the API key's. */
const SECRET_NAMES = new Set(['Ast2Credentials', 'accessKey', 'apiKey']);

/** The functions of a module that name a secret credential, `<module>` for a use outside any function; an import names nothing. */
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
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && SECRET_NAMES.has(node.text)) readers.add(enclosing(node));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true));
  return [...readers].sort();
}

describe("Doubao AST 2.0's wire", () => {
  it('puts the legacy App ID and Access Token, or the API key, in the socket query, beside the resource id (ruling 2)', () => {
    expect(AST2_ENDPOINT).toBe('wss://openspeech.bytedance.com/api/v4/ast/v2/translate');
    expect(ast2Url(APP_KEY)).toBe(`${AST2_ENDPOINT}?api_resource_id=volc.service_type.10053&api_app_key=1234567890&api_access_key=sk-ast2token0123456`);
    expect(ast2Url(API_KEY)).toBe(`${AST2_ENDPOINT}?api_resource_id=volc.service_type.10053&api_key=key-ast2api0123456789`);
    expect(ast2Url({ kind: 'apiKey', apiKey: 'a&b=c d' })).toContain('api_key=a%26b%3Dc+d');
  });

  it('meets the Access Token and the API key in the URL builder alone, and the URL, wherever it lands, is masked (ruling 2)', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['ast2Url']);
    // The scan's control: a read in any other function, nested or not, or at the top level, is named; an import is not.
    expect(secretReaders([
      "import type { Ast2Credentials } from './settings';",
      'export function url(k: Ast2Credentials) { return k.apiKey; }',
      'export const frame = (k: { accessKey: string }) => [k].map((c) => c.accessKey);',
      "const leaked = { apiKey: 'x' };",
    ].join('\n'))).toEqual(['<module>', 'frame', 'url']);
    // The shared list masks every credential the builder puts in the query, by the names it uses.
    expect(redact(ast2Url(APP_KEY))).toBe(`${AST2_ENDPOINT}?api_resource_id=volc.service_type.10053&api_app_key=[REDACTED]&api_access_key=[REDACTED]`);
    expect(redact(ast2Url(API_KEY))).toBe(`${AST2_ENDPOINT}?api_resource_id=volc.service_type.10053&api_key=[REDACTED]`);
  });

  it('words a socket that failed before it opened, once for the check and the start: online the credentials, offline the device', () => {
    expect(REFUSED_UPGRADE).toBe('Doubao refused the connection before it opened: check the App ID and the Access Token, or the API key.');
    expect(OFFLINE).toBe('The device is offline: Doubao could not be reached.');
  });

  it('starts a speaking session: 16 kHz pcm in, 24 kHz Ogg Opus out, no speaker id (the voice is cloned), the libraries, the App ID in its meta', () => {
    const start = decodeRequest(startSessionFrame({ ids, sequence: 0, mode: 's2s', source: 'zh', target: 'en', corpus: { boostingTableId: 'hot-1' }, appKey: '1234567890' }));
    expect(start.event).toBe(EventType.StartSession);
    expect(start.requestMeta).toMatchObject({ Endpoint: AST2_RESOURCE_ID, AppKey: '1234567890', ResourceID: AST2_RESOURCE_ID, SessionID: 's-1', ConnectionID: 'c-1', Sequence: 0 });
    expect(start.user).toMatchObject({ uid: 'sokuji-user', platform: 'web' });
    expect(start.sourceAudio).toMatchObject({ format: 'pcm', rate: 16000, bits: 16, channel: 1 });
    expect(start.request).toMatchObject({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en', speakerId: '', corpus: { boostingTableId: 'hot-1' } });
    expect(start.targetAudio).toMatchObject({ format: 'ogg_opus', rate: 24000 });
  });

  it('starts a text-only session with no target audio, and the API key mode with no App ID', () => {
    const start = decodeRequest(startSessionFrame({ ids, sequence: 0, mode: 's2t', source: 'ko', target: 'zh' }));
    expect(start.request).toMatchObject({ mode: 's2t', sourceLanguage: 'ko', targetLanguage: 'zh' });
    expect(start.request?.corpus ?? null).toBeNull();
    expect(start.targetAudio ?? null).toBeNull();
    expect(start.requestMeta?.AppKey).toBe('');
  });

  it("sends a packet's own bytes, never its backing buffer's, and finishes the session", () => {
    const packet = new Int16Array([9, 1, -2, 3, 9]).subarray(1, 4);
    const audio = decodeRequest(audioFrame(ids, 5, packet));
    expect(audio.event).toBe(EventType.TaskRequest);
    expect(audio.requestMeta).toMatchObject({ SessionID: 's-1', ConnectionID: 'c-1', Sequence: 5 });
    const bytes = audio.sourceAudio!.binaryData!;
    expect(Array.from(new Int16Array(new Uint8Array(bytes).buffer))).toEqual([1, -2, 3]);
    const finish = decodeRequest(finishSessionFrame(ids, 6));
    expect(finish.event).toBe(EventType.FinishSession);
    expect(finish.requestMeta).toMatchObject({ SessionID: 's-1', Sequence: 6 });
  });

  it('decodes a binary frame, and refuses anything else, or a frame cut short', () => {
    const r = decodeResponse(SERVER.subtitle('source', 'response', '你好', { sequence: 3, startTime: 10, endTime: 900 }));
    expect(r.event).toBe(EventType.SourceSubtitleResponse);
    expect(r).toMatchObject({ text: '你好', startTime: 10, endTime: 900 });
    expect(r.responseMeta).toMatchObject({ Sequence: 3, StatusCode: OK_STATUS });
    expect(() => decodeResponse('text')).toThrow(/unexpected kind/);
    expect(() => decodeResponse(new Blob([]))).toThrow(/unexpected kind/);
    const whole = new Uint8Array(serverFrame({ event: EventType.SourceSubtitleResponse, text: 'a long enough text' }));
    expect(() => decodeResponse(whole.slice(0, whole.length - 4).buffer)).toThrow();
  });

  it("reads 0, none or 20000000 as OK; a 4xxxxxxx status as the client's fault, anything else as the service's (choice 4)", () => {
    expect(isOk(0)).toBe(true);
    expect(isOk(undefined)).toBe(true);
    expect(isOk(OK_STATUS)).toBe(true);
    expect(isOk(45000001)).toBe(false);
    expect(statusFailureCode(45000001)).toBe('client');
    expect(statusFailureCode(55000031)).toBe('server');
    expect(statusFailureCode(11200)).toBe('server');
    expect(statusText(45000001, 'invalid language')).toBe('[Doubao 45000001] invalid language');
    expect(statusText(undefined, '')).toBe('[Doubao no status] no message');
  });

  it('names events for frames, and reads an int64 as a number', () => {
    expect(eventName(EventType.TTSSentenceStart)).toBe('TTSSentenceStart');
    expect(eventName(999)).toBe('event_999');
    expect(toNumber(61000)).toBe(61000);
    expect(toNumber({ toNumber: () => 7 })).toBe(7);
    expect(toNumber(null)).toBeUndefined();
  });
});
