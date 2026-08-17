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

  // Not "appears somewhere": build.yml has five build steps, each with its own
  // env block, and a gate added to one of them leaves the other four broken.
  // Equal occurrence counts is the cheap way to say "in the same places as
  // every other gate" without parsing YAML.
  it('forwards every gate to the same build steps in CI', () => {
    const workflow = repoFile('.github/workflows/build.yml');

    const counts = Object.fromEntries(
      GATES.map((gate) => [
        gate,
        workflow.split('\n').filter((line) => new RegExp(`^\\s*${gate}:`).test(line)).length,
      ])
    );
    const expected = Math.max(...Object.values(counts));

    expect(expected).toBeGreaterThan(0);
    expect(counts).toEqual(Object.fromEntries(GATES.map((gate) => [gate, expected])));
  });
});
