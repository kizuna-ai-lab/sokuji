// electron/entry-map.consistency.test.js
//
// The main-process build has a hand-written entry map in vite.config.ts, and a
// companion `external: [/^\.\/[a-z0-9-]+$/]` rule that keeps every relative
// sibling require a runtime require instead of inlining it (rolldown mangles
// CJS exports when it inlines an entry — see the comment on that rule).
//
// Those two halves must agree. Add a module under electron/, require it from
// another main-process file, and forget the entry line, and the failure is
// silent in every place you would look: `npm run build` succeeds with no
// warning, dist-electron/main.js still emits require("./your-module"), and the
// whole vitest suite stays green because tests require the *source* file and
// never touch the bundle. The only symptom is the packaged app dying at
// startup with MODULE_NOT_FOUND. This test is the missing signal.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(electronDir, '..');

/**
 * The `entry: { ... }` map of the electron() plugin's `main` config, read out
 * of vite.config.ts as text. Importing the config instead would drag in the
 * whole plugin chain for what is a flat list of string literals.
 */
function readEntryMap() {
  const config = readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
  const block = config.match(/main:\s*\{\s*(?:\/\/[^\n]*\n\s*)*entry:\s*\{([^}]*)\}/);
  if (!block) throw new Error('could not locate the main-process entry map in vite.config.ts');

  const entries = [...block[1].matchAll(/'([^']+)':\s*'electron\/([^']+)'/g)]
    .map(([, name, file]) => ({ name, file }));
  if (entries.length === 0) throw new Error('parsed the entry map but found no entries');
  return entries;
}

/**
 * Relative sibling modules a main-process file pulls in. Covers both the plain
 * `require('./x')` form and the bare `'./x'` literal that main.js hands to a
 * platform-selected `require(helper)`, which no require-shaped regex would see.
 */
function siblingRefs(source) {
  const refs = new Set();
  for (const [, spec] of source.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
    refs.add(spec);
  }
  for (const [, spec] of source.matchAll(/['"](\.\/[a-z0-9-]+)['"]/g)) {
    // Only literals that name a real sibling module -- './build/index.html' and
    // friends are paths, not module specifiers.
    if (existsSync(path.join(electronDir, `${spec.slice(2)}.js`))) refs.add(spec);
  }
  return [...refs];
}

const entries = readEntryMap();
const entryFiles = new Set(entries.map((e) => e.file));

describe('main-process entry map', () => {
  it.each(entries)('$name points at a file that exists', ({ file }) => {
    expect(existsSync(path.join(electronDir, file))).toBe(true);
  });

  it.each(entries)('$name requires nothing that is missing from the map', ({ file }) => {
    const source = readFileSync(path.join(electronDir, file), 'utf8');
    const missing = siblingRefs(source)
      .map((spec) => (spec.endsWith('.js') ? spec.slice(2) : `${spec.slice(2)}.js`))
      .filter((target) => !entryFiles.has(target));

    // Every miss here is a require that survives into dist-electron pointing at
    // a chunk the build never emits.
    expect(
      missing,
      `electron/${file} requires ${missing.join(', ')}, which vite.config.ts does not build. ` +
        `Add them to the electron() main entry map.`
    ).toEqual([]);
  });
});
