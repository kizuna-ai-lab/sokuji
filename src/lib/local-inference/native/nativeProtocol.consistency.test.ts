import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const PROTOCOL_FILE = join(__dirname, 'nativeProtocol.ts');

// native/ -> local-inference/ -> lib/ -> src/ -> repo root
const SIDECAR_DIR = join(__dirname, '..', '..', '..', '..', 'sidecar', 'sokuji_sidecar');

/** Anti-vacuity floor for the sidecar scan (35 .py files today). */
const MIN_SIDECAR_PY_FILES = 5;

/** Types the sidecar sends that ServerMsg deliberately does not model.
 *  `pong` is the reply to a `ping` health check (server.py). No renderer code
 *  sends `ping` — the affordance is exercised only by the sidecar's own tests
 *  (test_server_envelope.py) — so the renderer's inbox has no reason to carry
 *  it. This asymmetry is by design, not drift. */
const SIDECAR_ONLY = new Set(['pong']);

/** Anti-vacuity floor. Every assertion below is a subset/uniqueness check, and
 *  those pass trivially on an empty set — so a parse that silently yields almost
 *  nothing must throw rather than report "all good". The union has 18 members today. */
const MIN_SERVER_MSG_MEMBERS = 15;

/** `[interfaceName, discriminant]` for every member of the ServerMsg union.
 *  Throws — loudly — if the union, a member's declaration, or a member's
 *  discriminant can't be found, rather than returning a partial set. */
function extractServerMsgDiscriminants(): [string, string][] {
  const source = readFileSync(PROTOCOL_FILE, 'utf-8');

  const union = source.match(/export type ServerMsg = ([^;]+);/);
  if (!union) throw new Error('ServerMsg union declaration not found in nativeProtocol.ts');
  const members = union[1].split('|').map(s => s.trim()).filter(Boolean);
  if (members.length < MIN_SERVER_MSG_MEMBERS) {
    throw new Error(`ServerMsg union parsed to only ${members.length} members ` +
      `(expected >= ${MIN_SERVER_MSG_MEMBERS}) — the extractor is probably broken`);
  }

  return members.map((name): [string, string] => {
    const start = source.indexOf(`export interface ${name} {`);
    if (start === -1) throw new Error(`ServerMsg member ${name}: no "export interface ${name} {" found`);
    // Declarations are consecutive top-level exports, so the next `\nexport `
    // bounds this one's body.
    const next = source.indexOf('\nexport ', start + 1);
    const body = next === -1 ? source.slice(start) : source.slice(start, next);
    const discriminant = body.match(/\btype: '([a-z_]+)'/);
    if (!discriminant) throw new Error(`ServerMsg member ${name} has no "type: '...'" discriminant`);
    return [name, discriminant[1]];
  });
}

function pyFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // moss_tts/ and qwen3_tts/ are subpackages; a non-recursive scan would miss
    // anything they send and turn this net into a false alarm.
    if (entry.isDirectory()) out.push(...pyFilesUnder(full));
    else if (entry.name.endsWith('.py')) out.push(full);
  }
  return out;
}

/** Every `type` name the sidecar constructs in an outbound message. */
function extractSidecarTypeLiterals(): Set<string> {
  const files = pyFilesUnder(SIDECAR_DIR);
  if (files.length < MIN_SIDECAR_PY_FILES) {
    throw new Error(`only ${files.length} .py files found under ${SIDECAR_DIR} ` +
      `(expected >= ${MIN_SIDECAR_PY_FILES}) — the scan is probably pointed at the wrong place`);
  }
  const types = new Set<string>();
  for (const file of files) {
    // Dict-literal construction only. A comparison (`msg["type"] == "x"`) has no
    // colon after "type" and is skipped — that is what keeps this an *outbound* set.
    for (const m of readFileSync(file, 'utf-8').matchAll(/"type":\s*"([a-z_]+)"/g)) types.add(m[1]);
  }
  return types;
}

describe('nativeProtocol ServerMsg discriminants', () => {
  it('every member has a unique type discriminant', () => {
    // A discriminated union with a duplicate discriminant does not discriminate:
    // `Extract<ServerMsg, { type: X }>` widens back to a union and every consumer
    // is forced to cast its way out.
    const byDiscriminant = new Map<string, string[]>();
    for (const [name, type] of extractServerMsgDiscriminants()) {
      byDiscriminant.set(type, [...(byDiscriminant.get(type) ?? []), name]);
    }
    const collisions = [...byDiscriminant.entries()].filter(([, names]) => names.length > 1);
    expect(collisions).toEqual([]);
  });
});

// The renderer's ServerMsg union is a hand-written model of what a separate
// codebase, in another language, sends over the socket. Nothing but this test
// connects the two: rename one side and the other keeps compiling.
describe('nativeProtocol ServerMsg stays consistent with the sidecar wire', () => {
  it('every ServerMsg type is one the sidecar actually sends', () => {
    const sidecar = extractSidecarTypeLiterals();
    const orphans = extractServerMsgDiscriminants()
      .filter(([, type]) => !sidecar.has(type))
      .map(([name, type]) => `${name} ('${type}')`);
    expect(orphans).toEqual([]);
  });

  it('every type the sidecar sends is modelled by ServerMsg, except the ping health-check', () => {
    const modelled = new Set(extractServerMsgDiscriminants().map(([, type]) => type));
    const unmodelled = [...extractSidecarTypeLiterals()]
      .filter(type => !modelled.has(type) && !SIDECAR_ONLY.has(type))
      .sort();
    expect(unmodelled).toEqual([]);
  });
});
