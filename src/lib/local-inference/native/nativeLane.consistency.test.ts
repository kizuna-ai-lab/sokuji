import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// LOCAL_INFERENCE (WASM) and Local Native are PEER providers: no unifying
// abstraction may grow between them, and the native lane must not reach into
// the WASM lane's engine/worker modules — nor into components/ (a lib layer
// importing UI is an inversion). Nothing but convention enforced this (no
// ESLint, single flat tsconfig), and the boundary was crossed three separate
// times before this net existed. Same-dir imports and the deliberately shared
// top-level storage modules (voiceStorage, nativeVoiceStorage) stay legal.
const FORBIDDEN_SEGMENTS = ['/engine/', '/workers/', '/components/'];

/** Anti-vacuity floor: the lane has 14 .ts files today. */
const MIN_LANE_FILES = 8;

function laneSourceFiles(): string[] {
  const files = readdirSync(__dirname)
    .filter(f => f.endsWith('.ts') && !f.includes('.test.'));
  if (files.length < MIN_LANE_FILES) {
    throw new Error(`only ${files.length} lane files found under ${__dirname} ` +
      `(expected >= ${MIN_LANE_FILES}) — the scan is probably broken`);
  }
  return files;
}

function importPaths(source: string): string[] {
  // Static imports, type imports, re-exports, and dynamic import() calls.
  const out: string[] = [];
  for (const m of source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
    out.push(m[1]);
  }
  return out;
}

describe('native lane import boundary', () => {
  it('no file under native/ imports from the WASM lane or from components', () => {
    const offenders: string[] = [];
    for (const file of laneSourceFiles()) {
      const source = readFileSync(join(__dirname, file), 'utf-8');
      for (const spec of importPaths(source)) {
        // Normalize "../engine/TtsEngine" so segment matching sees "/engine/".
        const normalized = `/${spec.replace(/^(\.\.\/)+|^\.\//, '')}`;
        const hit = FORBIDDEN_SEGMENTS.find(seg =>
          (normalized + '/').includes(seg) && spec.startsWith('..'));
        if (hit) offenders.push(`${file}: '${spec}'`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
