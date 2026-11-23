/**
 * Local Native reads this device's native facts through the port it is handed (`shared.nativeModels`,
 * `ctx.nativeModels`, `config.host`), never from a store (#578 ruling 18). Its views (.tsx) may read the store.
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import { importsOf, SRC } from '../../lib/plan/importWalk.testing';

describe('Local Native reads no store', () => {
  it('no module of Local Native but its views (.tsx) imports a store', () => {
    const modules = readdirSync(__dirname).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.filter((f) => importsOf(join(__dirname, f)).some((to) => relative(SRC, to).startsWith('stores/')))).toEqual([]);
  });
});
