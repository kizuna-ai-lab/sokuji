import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { buildLive, type LiveConfig } from './config';
import { LIVE_DEFAULTS } from './settings';
import { appendFrame, LIVE_WS_URL, liveHeaders, muteFrame, SESSION_CLOSE, sessionStart, stampOf, unmuteFrame } from './wire';

const KEY = { apiKey: 'sk-proj-liveWire0123456789' };
const CONFIG = buildLive(
  { direction: { source: 'zh_CN', target: 'en' }, speech: true, turns: 'auto' },
  LIVE_DEFAULTS,
  { pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 }, reversed: () => false, segmentation: { mode: 'pause', sentencesPerRow: 0 }, models: [] },
) as LiveConfig;

/** The names the key is read through: the credentials' type and its one field, a string literal naming either too, and any use of the header builder outside its own declaration (OpenAI Translate's `wire.test.ts` scan). */
const SECRET_NAMES = new Set(['LiveCredentials', 'apiKey']);
const BUILDER_NAME = 'liveHeaders';

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

describe("OpenAI Live's wire (ruling 7; U9)", () => {
  it('dials the Live endpoint bare — no query, no subprotocol — with a Bearer header and Origin removed', () => {
    expect(LIVE_WS_URL).toBe('wss://api.openai.com/v1/live/sessions');
    expect(liveHeaders(KEY)).toEqual({ set: { Authorization: `Bearer ${KEY.apiKey}` }, remove: ['Origin'] });
  });

  it('reads the key, in `wire.ts`, in the header builder alone', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['liveHeaders']);
    // The scan's control: a read elsewhere is named; an import is not.
    expect(secretReaders([
      "import type { LiveCredentials } from './settings';",
      'export function url(k: LiveCredentials) { return k.apiKey; }',
      "export function leakIndexed(k: Record<string, string>) { return k['apiKey']; }",
      'export function leakForwarded(k: Parameters<typeof liveHeaders>[0]) { return liveHeaders(k).set; }',
    ].join('\n'))).toEqual(['leakForwarded', 'leakIndexed', 'url']);
  });

  it("starts the session as the old client did: PCM16 at 24 kHz, the voice, the prompt, delegation to the client — null is refused (U12)", () => {
    expect(sessionStart(CONFIG, 'start_1')).toEqual({
      type: 'session.start',
      event_id: 'start_1',
      session: { model: 'gpt-live-1', instructions: CONFIG.instructions, audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } }, delegation: { type: 'client' } },
    });
  });

  it('sends audio as base64 of its own bytes, and the mute, unmute and close frames by name', () => {
    const pcm = new Int16Array([1, -2, 300, -32768]);
    const frame = JSON.parse(appendFrame(pcm.subarray(1, 3))) as { type: string; audio: string };
    expect(frame.type).toBe('session.input_audio.append');
    expect(base64ToPcm(frame.audio)).toEqual(new Int16Array([-2, 300]));
    expect(muteFrame('mute_2')).toEqual({ type: 'session.input_audio.mute', event_id: 'mute_2' });
    expect(unmuteFrame('unmute_3')).toEqual({ type: 'session.input_audio.unmute', event_id: 'unmute_3' });
    expect(SESSION_CLOSE).toEqual({ type: 'session.close' });
  });

  it('reads a stamp as a finite number, else null', () => {
    expect([stampOf(1_600), stampOf('1600'), stampOf(null), stampOf(Number.NaN)]).toEqual([1_600, null, null, null]);
  });
});
