// src/lib/plan/importWalk.testing.ts
//
// A walk of the static imports through the source files, for the tests that guard an import rule. Relative specifiers
// only (the project has no path aliases); a dynamic `import()` of a relative path is followed too. `reached` skips
// type-only imports, which are erased and load nothing. `importsOf` keeps type-only imports: a cycle of types is a
// cycle. Imported by tests only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

/** Every `.ts`/`.tsx` file under `dir`, recursively, by absolute path: no declaration file, test or test helper. */
export function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.d\.ts$|\.test\.|\.testing\./.test(entry.name) ? [path] : [];
  });
}

/** The files `file` imports by a relative specifier, type-only imports included, each once, by absolute path. */
export function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs = [...text.matchAll(STATIC)].map((m) => m[2]).concat([...text.matchAll(DYNAMIC)].map((m) => m[1]));
  return [...new Set(specs.map((spec) => resolveFrom(file, spec)).filter((next): next is string => next !== null))];
}

/**
 * The import cycles among the source files (`sourceFiles`), type-only imports included: each strongly connected group
 * of more than one file (Tarjan), as a sorted list of paths relative to `src`. `graph` is the walk over the real tree
 * by default; a test may pass a small graph (absolute paths, file to the files it imports) to show a cycle is found.
 */
export function importCycles(graph?: ReadonlyMap<string, readonly string[]>): string[][] {
  const files = graph ? [...graph.keys()] : sourceFiles();
  const known = new Set(files);
  const edges = new Map(files.map((file) => [file, (graph ? graph.get(file)! : importsOf(file)).filter((next) => known.has(next))]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  const visit = (file: string): void => {
    index.set(file, index.size);
    low.set(file, index.get(file)!);
    stack.push(file);
    onStack.add(file);
    for (const next of edges.get(file)!) {
      if (!index.has(next)) {
        visit(next);
        low.set(file, Math.min(low.get(file)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(file, Math.min(low.get(file)!, index.get(next)!));
      }
    }
    if (low.get(file) !== index.get(file)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      group.push(member);
    } while (member !== file);
    if (group.length > 1) groups.push(group.map((f) => relative(SRC, f)).sort());
  };
  for (const file of files) if (!index.has(file)) visit(file);
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}
