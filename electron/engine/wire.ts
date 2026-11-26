/**
 * The outbound wire contract (port of sidecar/sokuji_sidecar/wire.py). wire_schema.json is the single source of truth
 * for every outbound message's type and top-level field names; it is checked at the one outbound funnel (Conn.send).
 *
 * Strict (throw) when SOKUJI_WIRE_STRICT=1 — the engine's tests set it, so every message a test sends is checked.
 * Otherwise fail-open: the violation is reported to stderr, once per type, and the message goes through — a contract
 * bug must never take down a live session. A crash inside the check itself fails open the same way outside strict
 * mode, and surfaces raw inside it.
 *
 * Scope: top-level field names and presence only; values and nested shapes are the renderer's to read defensively.
 */
import rawSchema from './wire_schema.json';

export interface MessageSpec { required: ReadonlySet<string>; optional: ReadonlySet<string> }

export const SCHEMA: Readonly<Record<string, MessageSpec>> = Object.fromEntries(
  Object.entries(rawSchema as Record<string, unknown>)
    .filter(([type]) => type !== '_comment')
    .map(([type, spec]) => {
      const s = spec as { required: string[]; optional: string[] };
      return [type, { required: new Set(s.required), optional: new Set(s.optional) }];
    }),
);

export class WireContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireContractError';
  }
}

const warned = new Set<string>();

/** Forgets which types were reported, so a test sees its own report. */
export function resetWireWarningsForTests(): void {
  warned.clear();
}

/** Checks one outbound message against the schema: throws in strict mode; otherwise reports once per type and returns. */
export function checkOutbound(obj: Record<string, unknown>): void {
  if (process.env.SOKUJI_WIRE_STRICT === '1') {
    const problem = problemOf(obj);
    if (problem !== null) throw new WireContractError(problem);
    return;
  }
  let problem: string | null;
  try {
    problem = problemOf(obj);
  } catch (e) {
    problem = `validator crashed: ${String(e)}`;
  }
  if (problem === null) return;
  const key = typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? String(obj.type) : '<not an object>';
  if (warned.has(key)) return;
  warned.add(key);
  process.stderr.write(`[wire] contract violation: ${problem}\n`);
}

function problemOf(obj: Record<string, unknown>): string | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    // wire.py's `obj.get("type")` on a non-dict: the raw bug, as Python raises it.
    throw new TypeError(`'${Array.isArray(obj) ? 'list' : typeof obj}' object has no attribute 'get'`);
  }
  const type = obj.type;
  const keys = Object.keys(obj).filter((k) => k !== 'type');
  if (type === undefined || type === null) return `outbound message has no 'type': ${JSON.stringify(Object.keys(obj).sort())}`;
  const spec = SCHEMA[String(type)];
  if (!spec) return `unknown outbound type: '${String(type)}'`;
  const missing = [...spec.required].filter((f) => !keys.includes(f)).sort();
  if (missing.length > 0) return `${String(type)}: missing required field(s) ${JSON.stringify(missing)}`;
  const extra = keys.filter((k) => !spec.required.has(k) && !spec.optional.has(k)).sort();
  if (extra.length > 0) return `${String(type)}: unexpected field(s) ${JSON.stringify(extra)}`;
  return null;
}
