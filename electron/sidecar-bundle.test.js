import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  archiveName, bundleInstallDir, pickBundle, verifySha256, extractTarZst,
} from './sidecar-bundle.js';

describe('archiveName / bundleInstallDir', () => {
  it('archiveName matches the python packer contract', () => {
    expect(archiveName('linux-nvidia', '0.30.6')).toBe('sidecar-linux-nvidia-v0.30.6.tar.zst');
  });
  it('bundleInstallDir installs under userData/sidecar/<sku>', () => {
    expect(bundleInstallDir('/u', 'mac')).toBe(path.join('/u', 'sidecar', 'mac'));
  });
});

describe('pickBundle', () => {
  it('selects the entry matching the sku', () => {
    const m = { bundles: [{ sku: 'nvidia', version: '1', url: 'u' }, { sku: 'mac', version: '1', url: 'v' }] };
    expect(pickBundle(m, 'mac').url).toBe('v');
    expect(pickBundle(m, 'directml')).toBeUndefined();
  });
});

describe('verifySha256', () => {
  it('resolves on match and throws on mismatch', async () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), 'sb-')), 'a');
    writeFileSync(f, 'payload');
    const good = crypto.createHash('sha256').update('payload').digest('hex');
    await expect(verifySha256(f, good)).resolves.toBeUndefined();
    await expect(verifySha256(f, 'deadbeef')).rejects.toThrow(/sha256/);
  });
});

describe('extractTarZst', () => {
  it('extracts a .tar.zst (children at root, no traversal)', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'sb-x-'));
    const fixture = path.join(__dirname, '__fixtures__', 'bundle-sample.tar.zst');
    await extractTarZst(fixture, out);
    expect(readFileSync(path.join(out, 'app', 'hi.txt'), 'utf8')).toBe('hi');
    expect(existsSync(path.join(out, 'bundle.json'))).toBe(true);
  });

  // Fixture generated with the sidecar dev venv (has `zstandard`):
  //   sidecar/.venv/bin/python - <<'PY'
  //   import io, tarfile, zstandard
  //   buf = io.BytesIO()
  //   with tarfile.open(mode="w", fileobj=buf) as t:
  //       real = tarfile.TarInfo("real.txt"); data=b"x"; real.size=len(data)
  //       t.addfile(real, io.BytesIO(data))
  //       link = tarfile.TarInfo("link.txt"); link.type=tarfile.SYMTYPE; link.linkname="real.txt"
  //       t.addfile(link)
  //   comp = zstandard.ZstdCompressor().compress(buf.getvalue())
  //   open("electron/__fixtures__/bundle-symlink.tar.zst","wb").write(comp)
  //   PY
  it('rejects a symlink member (bundles must be dereferenced)', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'sb-sym-'));
    const fixture = path.join(__dirname, '__fixtures__', 'bundle-symlink.tar.zst');
    await expect(extractTarZst(fixture, out)).rejects.toThrow(/link member/);
  });
});
