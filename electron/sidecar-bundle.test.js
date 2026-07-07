import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import {
  archiveName, bundleInstallDir, pickBundle, verifySha256, extractTarZst, installBundle,
} from './sidecar-bundle.js';

// Shares the Node module cache with sidecar-bundle.js's own `require('fs')` (core
// modules are a process-wide singleton), so mutating a method here is visible
// inside installBundle — same technique as native-host-manager.test.js's
// child_process/readline monkey-patching.
const req = createRequire(import.meta.url);

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

describe('installBundle rollback', () => {
  it('restores the previous bundle from .old when the promote rename fails', async () => {
    const fsMod = req('fs');
    const realRenameSync = fsMod.renameSync;

    const root = mkdtempSync(path.join(tmpdir(), 'sb-install-'));
    const sku = 'mac';
    const version = `rollback-test-${Date.now()}`;
    const dest = path.join(root, 'sidecar', sku);

    // A "previously installed" bundle already sits at dest.
    fsMod.mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, 'bundle.json'), JSON.stringify({ sku, version: 'old' }));
    writeFileSync(path.join(dest, 'marker.txt'), 'PREVIOUS');

    const fixture = path.join(__dirname, '__fixtures__', 'bundle-sample.tar.zst');
    const archiveBuf = readFileSync(fixture);
    const sha256 = crypto.createHash('sha256').update(archiveBuf).digest('hex');

    const fetchImpl = async (url) => {
      if (url.endsWith('/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            bundles: [{ sku, version, url: 'https://example.invalid/a.tar.zst', sha256 }],
          }),
        };
      }
      return {
        ok: true,
        headers: { get: (n) => (n === 'content-length' ? String(archiveBuf.length) : null) },
        body: {
          getReader: () => {
            let done = false;
            return {
              async read() {
                if (done) return { done: true, value: undefined };
                done = true;
                return { done: false, value: archiveBuf };
              },
            };
          },
        },
      };
    };

    // Force ONLY the tmpDir -> dest promote rename to fail; the earlier
    // dest -> .old rename (call 1) and the later .old -> dest restore rename
    // (call 3, inside installBundle's catch block) go through to the real fs.
    let calls = 0;
    fsMod.renameSync = (from, to) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated rename failure');
      return realRenameSync(from, to);
    };

    try {
      await expect(
        installBundle({ sku, baseUrl: 'https://example.invalid', userDataDir: root, fetchImpl })
      ).rejects.toThrow('simulated rename failure');
    } finally {
      fsMod.renameSync = realRenameSync;
      fsMod.rmSync(path.join(tmpdir(), archiveName(sku, version)), { force: true });
    }

    // Rollback worked: dest exists and is still the PREVIOUS bundle — not a
    // half-promoted new one, and not missing entirely.
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(path.join(dest, 'marker.txt'), 'utf8')).toBe('PREVIOUS');
    expect(existsSync(`${dest}.old`)).toBe(false);
  });
});
