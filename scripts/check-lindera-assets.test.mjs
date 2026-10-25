// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLinderaAssets, DICTIONARY_BYTES, LINDERA_WASM_BYTES } from './check-lindera-assets.mjs';

const file = (dir, name, bytes) => writeFileSync(join(dir, name), Buffer.alloc(bytes, 1));

describe('checkLinderaAssets', () => {
  let root, app, ext;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lindera-assets-'));
    app = join(root, 'build');
    ext = join(root, 'extension', 'dist');
    mkdirSync(join(app, 'assets'), { recursive: true });
    mkdirSync(join(ext, 'assets'), { recursive: true });
    file(join(app, 'assets'), 'lindera_wasm_bg-a1b2c3.wasm', LINDERA_WASM_BYTES);
    file(join(ext, 'assets'), 'lindera_wasm_bg-d4e5f6.wasm', LINDERA_WASM_BYTES);
    file(join(app, 'assets'), 'index-abc.js', 1000);
  });
  // The fixtures are tens of MB a run; a watch run would pile them up in the temp directory.
  afterEach(() => rmSync(root, { recursive: true, force: true }));

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

  it('names a script chunk the size of the dictionary as base64, which is how a bundler would inline it', () => {
    file(join(app, 'assets'), 'worker-huge.js', Math.ceil(DICTIONARY_BYTES / 3) * 4);
    expect(checkLinderaAssets([app])).toEqual([expect.stringMatching(/worker-huge\.js/)]);
  });

  it('names a build directory that does not exist, rather than crashing on it', () => {
    expect(checkLinderaAssets([join(root, 'nope')])).toEqual([expect.stringMatching(/nope.*does not exist/)]);
  });

  it('names a build with two Lindera wasms', () => {
    file(join(ext, 'assets'), 'lindera_wasm_bg-twice.wasm', LINDERA_WASM_BYTES);
    expect(checkLinderaAssets([ext])).toEqual([expect.stringMatching(/2 Lindera wasms/)]);
  });

  it('passes the largest chunks the builds have today, under 2 MB', () => {
    file(join(app, 'assets'), 'main-abc.js', 1_600_000);
    expect(checkLinderaAssets([app])).toEqual([]);
  });
});
