import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import {
  archiveName, bundleInstallDir, pickBundle, verifySha256, extractTarZst, installBundle,
  requiredSidecarVersion, bundleBaseUrl, stagingDir, stagedBytes, pruneStaging,
  downloadPart, concatParts, removeBundle,
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
    const partName = archiveName(sku, version);

    const fetchImpl = async (url) => {
      if (url.endsWith('/manifest.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            version,
            bundles: [{
              sku, version, sha256, size: archiveBuf.length, installedSize: 64,
              parts: [{ name: partName, size: archiveBuf.length, sha256 }],
            }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
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
        installBundle({
          sku, version, userDataDir: root, fetchImpl,
          statfs: () => ({ bavail: 1e9, bsize: 4096 }), env: {},
        })
      ).rejects.toThrow('simulated rename failure');
    } finally {
      fsMod.renameSync = realRenameSync;
    }

    // Rollback worked: dest exists and is still the PREVIOUS bundle — not a
    // half-promoted new one, and not missing entirely.
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(path.join(dest, 'marker.txt'), 'utf8')).toBe('PREVIOUS');
    expect(existsSync(`${dest}.old`)).toBe(false);
  });
});

// A minimal fetch Response stand-in: one chunk, then done.
function fetchResponse(bytes, { status = 200 } = {}) {
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(bytes.length) },
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true } : ((sent = true), { done: false, value: Uint8Array.from(bytes) }),
      }),
    },
  };
}

const sha = (buf) => crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');

describe('requiredSidecarVersion / bundleBaseUrl (spec S1/S4/S11)', () => {
  it('env override wins; package field is the default; missing field throws', () => {
    expect(requiredSidecarVersion({ env: { SOKUJI_SIDECAR_VERSION: '9.9.9' } })).toBe('9.9.9');
    expect(requiredSidecarVersion({ env: {}, pkg: { sidecarVersion: '0.1.0' } })).toBe('0.1.0');
    expect(requiredSidecarVersion({ env: {} })).toBe(req('../package.json').sidecarVersion);
    expect(() => requiredSidecarVersion({ env: {}, pkg: {} })).toThrow(/sidecarVersion/);
  });
  it('derives the GitHub release URL from the version, env override replaces it', () => {
    expect(bundleBaseUrl('0.1.0', {}))
      .toBe('https://github.com/kizuna-ai-lab/sokuji/releases/download/sidecar-v0.1.0');
    expect(bundleBaseUrl('0.1.0', { SOKUJI_SIDECAR_BUNDLE_BASE_URL: 'http://localhost:8000/' }))
      .toBe('http://localhost:8000');
  });
});

describe('staging (spec S6)', () => {
  it('stagedBytes counts only files of this sku+version; pruneStaging drops the rest', () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-stage-'));
    mkdirSync(stagingDir(u), { recursive: true });
    const keep = archiveName('mac', '0.1.0');
    writeFileSync(path.join(stagingDir(u), `${keep}.001`), Buffer.alloc(10));
    writeFileSync(path.join(stagingDir(u), `${keep}.002`), Buffer.alloc(5));
    writeFileSync(path.join(stagingDir(u), archiveName('mac', '0.0.9')), Buffer.alloc(99));
    expect(stagedBytes(u, 'mac', '0.1.0')).toBe(15);
    pruneStaging(u, keep);
    expect(existsSync(path.join(stagingDir(u), archiveName('mac', '0.0.9')))).toBe(false);
    expect(existsSync(path.join(stagingDir(u), `${keep}.001`))).toBe(true);
  });
});

describe('downloadPart resume decision table (spec S7)', () => {
  const payload = Buffer.from('0123456789abcdef');
  const part = { name: 'p', size: payload.length, sha256: sha(payload) };

  it('complete + valid staged part: no fetch at all', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, payload);
    const fetchImpl = vi.fn();
    await downloadPart({ url: 'u', dest, part, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('partial staged part: resumes with a Range header and appends', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, payload.subarray(0, 6));
    const fetchImpl = vi.fn(async (_u, opts) => {
      expect(opts.headers.Range).toBe('bytes=6-');
      return fetchResponse(payload.subarray(6), { status: 206 });
    });
    const seen = [];
    await downloadPart({ url: 'u', dest, part, fetchImpl, onPartProgress: (n) => seen.push(n) });
    expect(readFileSync(dest)).toEqual(payload);
    expect(seen.at(-1)).toBe(payload.length); // progress includes the staged offset
  });

  it('server ignoring Range (HTTP 200) restarts from zero', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, payload.subarray(0, 6));
    const fetchImpl = vi.fn(async () => fetchResponse(payload, { status: 200 }));
    await downloadPart({ url: 'u', dest, part, fetchImpl });
    expect(readFileSync(dest)).toEqual(payload);
  });

  it('corrupt complete staged part: re-downloads from zero', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, Buffer.alloc(payload.length, 0x7a)); // right size, wrong bytes
    const fetchImpl = vi.fn(async (_u, opts) => {
      expect(opts.headers.Range).toBeUndefined();
      return fetchResponse(payload);
    });
    await downloadPart({ url: 'u', dest, part, fetchImpl });
    expect(readFileSync(dest)).toEqual(payload);
  });

  it('sha mismatch after download deletes the part and rejects', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    const fetchImpl = vi.fn(async () => fetchResponse(Buffer.from('WRONG-BYTES-16!!')));
    await expect(downloadPart({ url: 'u', dest, part, fetchImpl })).rejects.toThrow(/sha256/);
    expect(existsSync(dest)).toBe(false);
  });
});

describe('concatParts', () => {
  it('reassembles parts byte-identically', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-cat-'));
    writeFileSync(path.join(d, 'a'), 'hello ');
    writeFileSync(path.join(d, 'b'), 'world');
    await concatParts([path.join(d, 'a'), path.join(d, 'b')], path.join(d, 'out'));
    expect(readFileSync(path.join(d, 'out'), 'utf8')).toBe('hello world');
  });
});

describe('installBundle v2 pipeline (spec S4-S9)', () => {
  const fixture = readFileSync(path.join(__dirname, '__fixtures__', 'bundle-sample.tar.zst'));
  const bigStatfs = () => ({ bavail: 1e9, bsize: 4096 });   // plenty of space
  const jsonResponse = (obj) => ({ ok: true, status: 200, json: async () => obj });

  function manifestFor(parts, { version = '9.9.9' } = {}) {
    return {
      version,
      bundles: [{
        sku: 'mac', version, sha256: sha(fixture), size: fixture.length,
        installedSize: 64, parts,
      }],
    };
  }

  function fetchFor(manifest, partBytes) {
    return vi.fn(async (url, opts) => {
      if (String(url).endsWith('/manifest.json')) return jsonResponse(manifest);
      const name = String(url).split('/').pop();
      // Serve staged-resume requests too: honor a Range header with a 206 slice.
      const bytes = partBytes[name];
      const range = opts?.headers?.Range;
      if (range) {
        const from = Number(/bytes=(\d+)-/.exec(range)[1]);
        return fetchResponse(bytes.subarray(from), { status: 206 });
      }
      return fetchResponse(bytes);
    });
  }

  it('single part: downloads, extracts, swaps, writes bundle.json, stops sidecar', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '9.9.9');
    const manifest = manifestFor([{ name, size: fixture.length, sha256: sha(fixture) }]);
    const stopSidecar = vi.fn();
    const phases = [];
    const r = await installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [name]: fixture }),
      statfs: bigStatfs, stopSidecar, env: {},
      onProgress: (p) => phases.push(p.phase),
    });
    expect(r).toEqual({ version: '9.9.9' });
    expect(readFileSync(path.join(u, 'sidecar', 'mac', 'app', 'hi.txt'), 'utf8')).toBe('hi');
    expect(JSON.parse(readFileSync(path.join(u, 'sidecar', 'mac', 'bundle.json'), 'utf8')))
      .toEqual({ sku: 'mac', version: '9.9.9' });
    expect(stopSidecar).toHaveBeenCalled();
    expect(phases).toContain('download');
    expect(phases).toContain('extract');
    expect(stagedBytes(u, 'mac', '9.9.9')).toBe(0);          // staging cleaned
  });

  it('waits for extracted files to close before promoting the bundle', async () => {
    const fsMod = req('fs');
    const realCreateWriteStream = fsMod.createWriteStream;
    const realRenameSync = fsMod.renameSync;
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const sku = 'mac';
    const version = '9.9.9';
    const name = archiveName(sku, version);
    const dest = path.join(u, 'sidecar', sku);
    const tmpDir = `${dest}.tmp`;
    const manifest = manifestFor([{ name, size: fixture.length, sha256: sha(fixture) }]);
    let openExtractedFiles = 0;

    fsMod.createWriteStream = (file, options) => {
      const ws = realCreateWriteStream(file, options);
      if (path.resolve(file).startsWith(`${path.resolve(tmpDir)}${path.sep}`)) {
        ws.once('finish', () => { openExtractedFiles += 1; });
        ws.once('close', () => { openExtractedFiles -= 1; });
      }
      return ws;
    };
    fsMod.renameSync = (from, to) => {
      if (path.resolve(from) === path.resolve(tmpDir) &&
          path.resolve(to) === path.resolve(dest) && openExtractedFiles > 0) {
        const error = new Error('simulated Windows EPERM: extracted file handle still open');
        error.code = 'EPERM';
        throw error;
      }
      return realRenameSync(from, to);
    };

    try {
      await expect(installBundle({
        sku, version, userDataDir: u,
        fetchImpl: fetchFor(manifest, { [name]: fixture }),
        statfs: bigStatfs, env: {},
      })).resolves.toEqual({ version });
    } finally {
      fsMod.createWriteStream = realCreateWriteStream;
      fsMod.renameSync = realRenameSync;
    }

    expect(readFileSync(path.join(dest, 'app', 'hi.txt'), 'utf8')).toBe('hi');
  });

  it('multi part: reassembles, verifies the whole archive, installs', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '9.9.9');
    const cut = Math.floor(fixture.length / 2);
    const p1 = fixture.subarray(0, cut);
    const p2 = fixture.subarray(cut);
    const manifest = manifestFor([
      { name: `${name}.001`, size: p1.length, sha256: sha(p1) },
      { name: `${name}.002`, size: p2.length, sha256: sha(p2) },
    ]);
    await installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [`${name}.001`]: p1, [`${name}.002`]: p2 }),
      statfs: bigStatfs, env: {},
    });
    expect(readFileSync(path.join(u, 'sidecar', 'mac', 'app', 'hi.txt'), 'utf8')).toBe('hi');
  });

  it('rejects a manifest whose entry version differs (strict matching, spec S2)', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '8.8.8');
    const manifest = manifestFor([{ name, size: fixture.length, sha256: sha(fixture) }],
      { version: '8.8.8' });
    await expect(installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [name]: fixture }), statfs: bigStatfs, env: {},
    })).rejects.toThrow(/strict matching/);
  });

  it('fails early with exact numbers when disk is short (spec S8)', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '9.9.9');
    const manifest = manifestFor([{ name, size: fixture.length, sha256: sha(fixture) }]);
    await expect(installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [name]: fixture }),
      statfs: () => ({ bavail: 1, bsize: 4096 }),          // ~4 KB free
      env: {},
    })).rejects.toThrow(/disk space/);
  });

  it('removeBundle deletes the installed tree', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-rm-'));
    mkdirSync(path.join(u, 'sidecar', 'mac'), { recursive: true });
    writeFileSync(path.join(u, 'sidecar', 'mac', 'bundle.json'), '{}');
    removeBundle(u, 'mac');
    expect(existsSync(path.join(u, 'sidecar', 'mac'))).toBe(false);
  });
});
