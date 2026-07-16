import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const PROTOCOL_FILE = join(__dirname, 'nativeProtocol.ts');

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
