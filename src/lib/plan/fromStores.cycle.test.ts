// src/lib/plan/fromStores.cycle.test.ts
//
// The rule at the top of fromStores.ts: it imports the provider registry, so nothing the registry imports may import
// it. Walks the imports from the registry through the source files (`importWalk.testing.ts`).
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reached, SRC } from './importWalk.testing';

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
