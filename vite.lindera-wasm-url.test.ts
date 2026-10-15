import { describe, it, expect } from 'vitest';
import { linderaWasmUrl } from './vite.lindera-wasm-url';

const GLUE_ID = '/x/node_modules/lindera-wasm-ipadic-web/lindera_wasm.js';
const transform = (code: string, id: string) =>
  (linderaWasmUrl().transform as (code: string, id: string) => { code: string } | null)(code, id);

describe('linderaWasmUrl', () => {
  it("replaces the glue's default wasm URL, so no bundler emits or inlines the 17 MB file", () => {
    const out = transform("if (x === undefined) { x = new URL('lindera_wasm_bg.wasm', import.meta.url); }", GLUE_ID);
    expect(out?.code).not.toContain('lindera_wasm_bg.wasm');
    expect(out?.code).toContain('never from the build');
  });
  it('leaves every other module alone', () => {
    expect(transform("new URL('lindera_wasm_bg.wasm', import.meta.url)", '/x/src/other.ts')).toBeNull();
  });
  it('fails the build when a new glue no longer names its wasm that way', () => {
    expect(() => transform('const u = wasmUrl();', GLUE_ID)).toThrow(/no longer names its wasm/);
  });
});
