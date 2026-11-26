// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchNative } from './fetch-native.mjs';

const VERSION = '1.2.0';
const SKU = 'linux-x64';
const NAME = `sokuji-native-${SKU}-v${VERSION}.tar.zst`;

/** One 512-byte ustar entry plus its padded body. */
function tarEntry(name, body, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0' + '00', 257);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([h, body, pad]);
}

function makeArchive(dir, entries) {
  const tar = Buffer.concat([...entries.map(([n, b, t]) => tarEntry(n, Buffer.from(b), t)), Buffer.alloc(1024)]);
  const tarPath = join(dir, 'a.tar');
  writeFileSync(tarPath, tar);
  execFileSync('zstd', ['-q', '-f', tarPath, '-o', join(dir, NAME)]);
  rmSync(tarPath);
  return createHash('sha256').update(readFileSync(join(dir, NAME))).digest('hex');
}

const good = (version = VERSION) => [
  [`sokuji-native-${SKU}-v${VERSION}/contract.json`, JSON.stringify({ abi: 2, version })],
  [`sokuji-native-${SKU}-v${VERSION}/sokuji_native_node.node`, 'ADDON'],
  [`sokuji-native-${SKU}-v${VERSION}/libsokuji_native.so`, 'LIB'],
  [`sokuji-native-${SKU}-v${VERSION}/NOTICES.txt`, 'notices'],
];

describe('fetchNative', () => {
  let tmp, root, from, hash;
  const run = (over = {}) => fetchNative({
    root, sku: SKU, from, nativeVersion: VERSION, archives: { version: VERSION, sha256: { [SKU]: hash } }, log: () => {}, ...over,
  });
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fetch-native-'));
    root = join(tmp, 'repo');
    from = join(tmp, 'from');
    mkdirSync(root, { recursive: true });
    mkdirSync(from, { recursive: true });
    hash = makeArchive(from, good());
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('unpacks the four files into resources/native', async () => {
    await run();
    const dir = join(root, 'resources', 'native');
    for (const f of ['contract.json', 'sokuji_native_node.node', 'libsokuji_native.so', 'NOTICES.txt']) expect(existsSync(join(dir, f)), f).toBe(true);
    expect(readFileSync(join(dir, 'sokuji_native_node.node'), 'utf8')).toBe('ADDON');
  });

  it('refuses a sha256 mismatch and leaves nothing behind', async () => {
    await expect(run({ archives: { version: VERSION, sha256: { [SKU]: 'a'.repeat(64) } } })).rejects.toThrow(/sha256/);
    expect(existsSync(join(root, 'resources', 'native'))).toBe(false);
  });

  it('refuses when package.json nativeVersion and native-archives.json differ', async () => {
    await expect(run({ nativeVersion: '1.3.0' })).rejects.toThrow(/nativeVersion.*1\.3\.0.*1\.2\.0/);
  });

  it('refuses an entry that climbs out of the directory', async () => {
    hash = makeArchive(from, [[`sokuji-native-${SKU}-v${VERSION}/contract.json`, '{}'], ['../evil', 'x']]);
    await expect(run()).rejects.toThrow(/unsafe path/);
    expect(existsSync(join(tmp, 'evil'))).toBe(false);
  });

  it('refuses a link entry', async () => {
    hash = makeArchive(from, [[`sokuji-native-${SKU}-v${VERSION}/x`, '', '2']]);
    await expect(run()).rejects.toThrow(/link/);
  });

  it('refuses an archive whose contract names another version', async () => {
    hash = makeArchive(from, good('9.9.9'));
    await expect(run()).rejects.toThrow(/contract.*9\.9\.9/);
  });

  it('a second run with the same version does nothing', async () => {
    await run();
    const marker = join(root, 'resources', 'native', 'marker');
    writeFileSync(marker, 'm');
    await run();
    expect(existsSync(marker)).toBe(true);
  });

  it('a second platform at the same version is fetched, not skipped', async () => {
    await run();
    const other = 'linux-arm64';
    const name = `sokuji-native-${other}-v${VERSION}.tar.zst`;
    copyFileSync(join(from, NAME), join(from, name));
    const sum = createHash('sha256').update(readFileSync(join(from, name))).digest('hex');
    const logs = [];
    await run({ sku: other, archives: { version: VERSION, sha256: { [other]: sum } }, log: (m) => logs.push(m) });
    expect(logs.join('\n')).toMatch(/linux-arm64/);
    expect(logs.join('\n')).not.toMatch(/already/);
  });

  it('replaces an older unpack', async () => {
    const dir = join(root, 'resources', 'native');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'contract.json'), JSON.stringify({ abi: 2, version: '1.1.0' }));
    writeFileSync(join(dir, 'stale'), 's');
    await run();
    expect(existsSync(join(dir, 'stale'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'contract.json'), 'utf8')).version).toBe(VERSION);
  });

  it('says so for a platform with no archive', async () => {
    await expect(run({ sku: null })).rejects.toThrow(/no native archive for this platform/);
  });
});
