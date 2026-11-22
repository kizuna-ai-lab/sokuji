// src/lib/run/types.cycle.test.ts
//
// The run contract (types.ts here) sits under the provider definition, the plan and the session: they import it, it
// imports none of them, and no import cycle — of types or of values — passes through any of them or the line-up.
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importCycles, importsOf, SRC } from '../plan/importWalk.testing';

const rel = (files: readonly string[]) => files.map((f) => relative(SRC, f));
const FOLDERS = ['lib/run/', 'lib/provider/', 'lib/plan/', 'lib/session/', 'lib/lineup/'];

describe('the import rules of the run contract', () => {
  it('the run contract imports no provider, plan or session module', () => {
    expect(rel(importsOf(resolve(SRC, 'lib/run/types.ts'))).filter((f) => /^lib\/(provider|plan|session)\//.test(f))).toEqual([]);
  });
  it('no import cycle, type imports included, passes through the run contract, the provider definition, the plan, the session or the line-up', () => {
    expect(importCycles().filter((group) => group.some((f) => FOLDERS.some((folder) => f.startsWith(folder))))).toEqual([]);
  });
  it('the walk follows type imports: the provider definition imports `WireTable` for its type alone', () => {
    expect(rel(importsOf(resolve(SRC, 'lib/provider/types.ts')))).toContain('lib/language/wire.ts');
  });
});
