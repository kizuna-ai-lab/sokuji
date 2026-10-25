// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLinderaAssets, DICTIONARY_BYTES, LINDERA_WASM_BYTES } from './check-lindera-assets.mjs';

const file = (dir, name, bytes) => writeFileSync(join(dir, name), Buffer.alloc(bytes, 1));

describe('checkLinderaAssets', () => {
  let app, ext;
  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'lindera-assets-'));
    app = join(root, 'build');
    ext = join(root, 'extension', 'dist');
    mkdirSync(join(app, 'assets'), { recursive: true });
    mkdirSync(join(ext, 'assets'), { recursive: true });
    file(join(app, 'assets'), 'lindera_wasm_bg-a1b2c3.wasm', LINDERA_WASM_BYTES);
    file(join(ext, 'assets'), 'lindera_wasm_bg-d4e5f6.wasm', LINDERA_WASM_BYTES);
    file(join(app, 'assets'), 'index-abc.js', 1000);
  });

  it('passes a build that ships exactly one Lindera wasm of the installed size and no dictionary', () => {
    expect(checkLinderaAssets([app, ext])).toEqual([]);
  });

  it('names a build without the wasm, which would fetch it at run time', () => {
    mkdirSync(join(ext, 'other'));
    const problems = checkLinderaAssets([app, join(ext, 'other')]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/other.*no Lindera wasm/);
  });

  it('names a wasm of another size, such as one with a dictionary inside', () => {
    file(join(app, 'assets'), 'lindera_wasm_bg-old.wasm', 17_750_350);
    expect(checkLinderaAssets([app])).toEqual([expect.stringMatching(/lindera_wasm_bg-old\.wasm \(17750350 bytes\)/)]);
  });

  it('names the dictionary when a build carries it, by name or by size', () => {
    file(ext, 'lindera-ipadic-6.2.0.zip', 100);
    file(join(app, 'assets'), 'data-xyz.bin', DICTIONARY_BYTES);
    const problems = checkLinderaAssets([app, ext]);
    expect(problems).toEqual([
      expect.stringMatching(/data-xyz\.bin/),
      expect.stringMatching(/lindera-ipadic-6\.2\.0\.zip/),
    ]);
  });

  it('names a script chunk large enough to carry the dictionary inlined', () => {
    file(join(app, 'assets'), 'worker-huge.js', 15_000_001);
    expect(checkLinderaAssets([app])).toEqual([expect.stringMatching(/worker-huge\.js/)]);
  });
});
