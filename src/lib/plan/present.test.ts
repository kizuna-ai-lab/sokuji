// src/lib/plan/present.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyProvider } from '../provider/types';
import { stubProvider } from './testing';

// A fresh module per case: what one case registers is not seen by the next.
let present: typeof import('./present');
beforeEach(async () => {
  vi.resetModules();
  present = await import('./present');
});

describe('the providers offered here', () => {
  it('throws while no list is registered', () => {
    expect(() => present.presentHosts()).toThrow(/No provider list is registered/);
  });

  it("answers the registered reader's value, read when asked", () => {
    let offered: readonly AnyProvider[] = [stubProvider('soniox')];
    present.registerPresentProviders(() => offered);
    expect(present.presentHosts()).toBe(offered);
    offered = [stubProvider('openai')];
    expect(present.presentHosts()).toBe(offered);
  });
});
