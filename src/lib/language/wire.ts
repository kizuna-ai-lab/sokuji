/**
 * A provider's two-way table between app codes and its vendor's codes
 * (spec §3). A row of one element means the two are the same.
 */
import { parseCode, type LanguageCode } from './code';

export type WireRow = readonly [LanguageCode] | readonly [LanguageCode, string];

export interface WireTable {
  /** The vendor's code. Throws on a code the table lacks: a build is only ever handed an offered code. */
  toWire(code: LanguageCode): string;
  /** The app code for a code the vendor reported, whatever its case; null for one the table lacks, or none. */
  fromWire(raw: string | null | undefined): LanguageCode | null;
  /** Every app code the table holds, in row order. */
  readonly codes: readonly LanguageCode[];
}

export function wireTable(rows: readonly WireRow[]): WireTable {
  const out = new Map<LanguageCode, string>();
  const back = new Map<string, LanguageCode>();
  const codes: LanguageCode[] = [];
  for (const row of rows) {
    const code = row[0];
    const wire = row.length === 2 ? row[1] : row[0];
    if (parseCode(code) === null) throw new Error(`Not an app code: "${code}"`);
    if (out.has(code)) throw new Error(`Duplicate app code: "${code}"`);
    const key = wire.toLowerCase();
    if (back.has(key)) throw new Error(`Duplicate vendor code: "${wire}"`);
    out.set(code, wire);
    back.set(key, code);
    codes.push(code);
  }
  return {
    codes,
    toWire(code) {
      const wire = out.get(code);
      if (wire === undefined) throw new RangeError(`No vendor code for "${code}"`);
      return wire;
    },
    fromWire(raw) {
      if (!raw) return null;
      return back.get(raw.toLowerCase()) ?? null;
    },
  };
}

/** For a provider that never sends a language code (OpenAI Realtime and Live, Local Inference, the fake). */
export function identityWire(): WireTable {
  return {
    codes: [],
    toWire(code) {
      if (parseCode(code) === null) throw new RangeError(`Not an app code: "${code}"`);
      return code;
    },
    fromWire(raw) {
      return raw && parseCode(raw) !== null ? raw : null;
    },
  };
}
