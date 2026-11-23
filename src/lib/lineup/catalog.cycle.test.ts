// src/lib/lineup/catalog.cycle.test.ts
//
// The rule at the top of catalog.ts: the catalog is read off the providers, yet it imports neither the registry nor a
// provider, and no store. The stores and some providers read it, so importing one of them from here would close a
// cycle; the registry registers the catalog as it loads instead.
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reached, SRC } from '../plan/importWalk.testing';

describe('the import rule of the line-up catalog', () => {
  it('the catalog reaches no provider module and no store: the registry registers it', () => {
    for (const entry of ['lib/lineup/catalog.ts', 'lib/plan/capsOf.ts']) {
      const files = [...reached(entry)].map((f) => relative(SRC, f));
      expect(files.filter((f) => f.startsWith('providers/') || f.startsWith('stores/')), entry).toEqual([]);
    }
    expect(reached('providers/registry.ts').has(resolve(SRC, 'lib/plan/capsOf.ts'))).toBe(true);
  });
});
