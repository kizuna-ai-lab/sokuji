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


// ── Field-level contract ──────────────────────────────────────────────────────
// C4a pinned the TYPE NAMES across the boundary; wire_schema.json (loaded by the
// sidecar's wire.validate_outbound at its single outbound funnel) extends the
// contract to top-level FIELD names. These tests pin that schema against the
// ServerMsg interfaces, so a field added/renamed on one side goes red here.

const WIRE_SCHEMA_FILE = join(SIDECAR_DIR, 'wire_schema.json');

function loadWireSchema(): Map<string, { required: Set<string>; optional: Set<string> }> {
  const raw = JSON.parse(readFileSync(WIRE_SCHEMA_FILE, 'utf-8'));
  delete raw._comment;
  const out = new Map<string, { required: Set<string>; optional: Set<string> }>();
  for (const [mtype, spec] of Object.entries<any>(raw)) {
    // new Set(undefined) is silently empty — a malformed entry must throw,
    // not masquerade as field drift.
    if (!Array.isArray(spec?.required) || !Array.isArray(spec?.optional)) {
      throw new Error(`wire_schema.json entry '${mtype}' is malformed: ` +
        `required/optional must both be arrays`);
    }
    out.set(mtype, { required: new Set(spec.required), optional: new Set(spec.optional) });
  }
  if (out.size < MIN_SERVER_MSG_MEMBERS) {
    throw new Error(`wire schema parsed to only ${out.size} messages — broken load`);
  }
  return out;
}

/** Top-level field names (+ optionality) per ServerMsg member, parsed from the
 *  interface bodies. Throws on anything it cannot parse rather than returning a
 *  partial set. */
function extractServerMsgFields(): Map<string, { required: Set<string>; optional: Set<string> }> {
  // Comments are stripped before brace counting: a brace inside a comment must
  // not corrupt body extraction. Any stripping mistake here fails LOUD — the
  // extracted sets are diffed bidirectionally against the schema.
  const source = readFileSync(PROTOCOL_FILE, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const out = new Map<string, { required: Set<string>; optional: Set<string> }>();
  for (const [name, discriminant] of extractServerMsgDiscriminants()) {
    const start = source.indexOf(`export interface ${name} {`);
    const open = source.indexOf('{', start);
    // Brace-counted body: HardwareInfoResultMsg nests an inline object type.
    let depth = 0; let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) { end = i; break; }
    }
    if (depth !== 0) throw new Error(`unbalanced braces in interface ${name}`);
    const body = source.slice(open + 1, end);
    const required = new Set<string>(); const optional = new Set<string>();
    let level = 0; let field = '';
    const commit = (chunk: string) => {
      const m = chunk.match(/^\s*(\w+)(\?)?\s*:/);
      if (!m) return;
      if (m[1] === 'type') return;
      (m[2] ? optional : required).add(m[1]);
    };
    for (const ch of body) {
      if (ch === '{') level++;
      else if (ch === '}') level--;
      if (ch === ';' && level === 0) { commit(field); field = ''; } else field += ch;
    }
    commit(field);
    out.set(discriminant, { required, optional });
  }
  return out;
}

describe('nativeProtocol ServerMsg fields stay consistent with the wire schema', () => {
  it('every ServerMsg member matches the schema field-for-field', () => {
    const schema = loadWireSchema();
    const mismatches: string[] = [];
    for (const [mtype, ts] of extractServerMsgFields()) {
      const spec = schema.get(mtype);
      if (!spec) { mismatches.push(`${mtype}: absent from wire_schema.json`); continue; }
      const diff = (label: string, a: Set<string>, b: Set<string>) => {
        for (const f of a) if (!b.has(f)) mismatches.push(`${mtype}.${f}: ${label}`);
      };
      diff('required in TS, not in schema', ts.required, spec.required);
      diff('required in schema, not in TS', spec.required, ts.required);
      diff('optional in TS, not in schema', ts.optional, spec.optional);
      diff('optional in schema, not in TS', spec.optional, ts.optional);
    }
    expect(mismatches).toEqual([]);
  });

  it('the schema covers exactly ServerMsg plus the ping health-check', () => {
    const modelled = new Set(extractServerMsgDiscriminants().map(([, t]) => t));
    const schemaKeys = new Set(loadWireSchema().keys());
    const missing = [...modelled].filter(t => !schemaKeys.has(t)).sort();
    const extra = [...schemaKeys].filter(t => !modelled.has(t) && !SIDECAR_ONLY.has(t)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});
