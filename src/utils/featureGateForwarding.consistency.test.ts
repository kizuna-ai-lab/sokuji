/**
 * A feature gate only works if its env var actually REACHES the build. Twice
 * now that has silently not happened:
 *
 * - `extension/vite.config.ts` forwards env keys through an explicit `define`
 *   list, because Vite's automatic loading reads the extension directory rather
 *   than the root `.env` these flags are documented in. A key missing from that
 *   list reads `false` in extension builds however it is configured (fixed once
 *   in 15640c27, for exactly one key).
 * - `.github/workflows/build.yml` forwards each gate to five build steps.
 *   `VITE_ENABLE_KIZUNA_AI` was never in any of them, so every released
 *   artifact had the whole Kizuna family off regardless of the repo secrets.
 *
 * Both failures are invisible: the app builds, the tests pass, and the provider
 * is simply absent. So derive the gates from the code that READS them and
 * assert the two forwarding sites cover that set, rather than trusting three
 * hand-maintained lists to stay in step.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf-8');

/** The gates that exist, taken from the only file that reads them. */
const GATES: string[] = (() => {
  const source = repoFile('src/utils/environment.ts');
  const found = source.match(/import\.meta\.env\.(VITE_ENABLE_[A-Z0-9_]+)/g) ?? [];
  return [...new Set(found.map((m) => m.replace('import.meta.env.', '')))].sort();
})();

/**
 * Gates for providers the extension cannot offer at all, so the extension build
 * has no reason to carry them. LOCAL_NATIVE drives the Electron sidecar, which
 * is registered behind `isElectron()` as well.
 */
const ELECTRON_ONLY = new Set(['VITE_ENABLE_LOCAL_NATIVE']);

describe('feature gates reach the builds that need them', () => {
  // Guards the derivation itself: if the regex ever stops matching, every
  // assertion below would vacuously pass over an empty set.
  it('finds the gates environment.ts reads', () => {
    expect(GATES.length).toBeGreaterThanOrEqual(4);
    expect(GATES).toContain('VITE_ENABLE_KIZUNA_AI');
  });

  it('forwards every non-Electron-only gate through the extension define list', () => {
    const config = repoFile('extension/vite.config.ts');

    const missing = GATES.filter(
      (gate) => !ELECTRON_ONLY.has(gate) && !config.includes(`'import.meta.env.${gate}'`)
    );

    expect(missing).toEqual([]);
  });

  // Per env block, not per file. Comparing total occurrence counts would let an
  // uneven distribution pass — build.yml has more `env:` blocks than the ones
  // that build the app, so five appearances do not mean five *build steps*.
  //
  // Which blocks must carry the gates is derived rather than hardcoded to a
  // count: a step that builds the app always points itself at the backend, so
  // `VITE_BACKEND_URL` marks exactly those blocks. That also makes a newly
  // added build step fail here until it forwards the gates too.
  it('forwards every gate in every CI env block that builds the app', () => {
    const buildBlocks = envBlocks(repoFile('.github/workflows/build.yml')).filter((block) =>
      block.env.has('VITE_BACKEND_URL')
    );

    expect(buildBlocks.length).toBeGreaterThan(0);

    const incomplete = buildBlocks
      .map((block) => ({
        line: block.line,
        missing: GATES.filter((gate) => !block.env.has(gate)),
      }))
      .filter((block) => block.missing.length > 0);

    expect(incomplete).toEqual([]);
  });

  // Forwarding the right name from the wrong namespace is the same silent
  // failure as not forwarding it at all: `secrets.X` and `vars.X` are separate
  // stores, and an undefined one expands to the empty string, which reads as a
  // closed gate. v0.36.3 shipped with the whole Kizuna family off for exactly
  // this reason — the values were set as repository *variables* while the
  // workflow read *secrets*.
  //
  // Gates belong in `vars`: their value is compiled into the published client,
  // so it is public by construction, and GitHub redacts secret values wherever
  // they appear in logs — a secret set to `true` censors that word throughout
  // the build output. `vars` also prints its values in `gh variable list`,
  // which is what makes a misconfiguration visible before a release rather
  // than after.
  it('reads every gate from the vars namespace, never from secrets', () => {
    const buildBlocks = envBlocks(repoFile('.github/workflows/build.yml')).filter((block) =>
      block.env.has('VITE_BACKEND_URL')
    );

    const wrongNamespace = buildBlocks.flatMap((block) =>
      GATES.filter((gate) => {
        const value = block.env.get(gate);
        return value !== undefined && !/\$\{\{\s*vars\./.test(value);
      }).map((gate) => ({ line: block.line, gate, value: block.env.get(gate) }))
    );

    expect(wrongNamespace).toEqual([]);
  });
});

/**
 * The `env:` mappings of a GitHub workflow, as key→value maps tagged with the
 * line the block opens on so a failure names the offender. The value matters as
 * much as the key: it carries which namespace the entry reads from.
 *
 * Indentation-based rather than a YAML parse: the repo has no YAML dependency,
 * and `env:` blocks are flat `KEY: value` mappings, which is the one shape this
 * needs to read.
 */
function envBlocks(yaml: string): { line: number; env: Map<string, string> }[] {
  const lines = yaml.split('\n');
  const blocks: { line: number; env: Map<string, string> }[] = [];

  const indentOf = (line: string) => line.length - line.trimStart().length;

  lines.forEach((line, index) => {
    if (!/^\s*env:\s*$/.test(line)) return;

    const env = new Map<string, string>();
    for (let i = index + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      if (indentOf(lines[i]) <= indentOf(line)) break;

      const entry = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (entry) env.set(entry[1], entry[2]);
    }
    blocks.push({ line: index + 1, env });
  });

  return blocks;
}
