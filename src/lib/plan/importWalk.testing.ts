// src/lib/plan/importWalk.testing.ts
//
// A walk of the static imports through the source files, for the tests that guard an import rule. Relative specifiers
// only (the project has no path aliases), and not type-only imports, which are erased and make no cycle; a dynamic
// `import()` of a relative path is followed too. Imported by tests only.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The `src` directory, by absolute path. */
export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/** The source file a relative specifier names, or null for one that is not code (a stylesheet, a JSON file, a wasm). */
function resolveFrom(file: string, spec: string): string | null {
  const base = join(dirname(file), spec.split('?')[0]);
  const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx'].map((ext) => base + ext), join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((c) => /\.(ts|tsx|js|jsx)$/.test(c) && existsSync(c)) ?? null;
}

/** Every source file `entry` (a path under `src`) reaches through its imports, by absolute path. */
export function reached(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [resolve(SRC, entry)];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    const specs = [...text.matchAll(STATIC)].filter((m) => !m[1]).map((m) => m[2]);
    for (const spec of specs.concat([...text.matchAll(DYNAMIC)].map((m) => m[1]))) {
      const next = resolveFrom(file, spec);
      if (next && !seen.has(next)) todo.push(next);
    }
  }
  return seen;
}
