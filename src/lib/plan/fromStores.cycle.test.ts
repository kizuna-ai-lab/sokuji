// src/lib/plan/fromStores.cycle.test.ts
//
// The rule at the top of fromStores.ts: it imports the provider registry, so nothing the registry imports may import
// it. Walks the static imports from the registry through the source files: relative specifiers only (the project has
// no path aliases), and not type-only imports, which are erased and make no cycle.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/** The source file a relative specifier names, or null for one that is not code (a stylesheet, a JSON file, a wasm). */
function resolveFrom(file: string, spec: string): string | null {
  const base = join(dirname(file), spec.split('?')[0]);
  const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx'].map((ext) => base + ext), join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((c) => /\.(ts|tsx|js|jsx)$/.test(c) && existsSync(c)) ?? null;
}

/** Every source file `entry` reaches through its static imports, by absolute path. */
function reached(entry: string): Set<string> {
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

describe('the import-cycle rule of fromStores.ts', () => {
  const fromStores = resolve(SRC, 'lib/plan/fromStores.ts');

  it('nothing the provider registry imports reaches it', () => {
    const files = reached('providers/registry.ts');
    expect(files.has(resolve(SRC, 'stores/providerStore.ts'))).toBe(true); // the walk goes past the registry's own imports
    expect(files.has(fromStores)).toBe(false);
  });

  it('the walk finds it where a file does import it', () => {
    expect(reached('lib/session/appShape.ts').has(fromStores)).toBe(true);
  });
});
