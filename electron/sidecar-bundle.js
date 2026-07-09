const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function archiveName(sku, version) {
  return `sidecar-${sku}-v${version}.tar.zst`;
}

function bundleInstallDir(userDataDir, sku) {
  return path.join(userDataDir, 'sidecar', sku);
}

function bundleStatus(userDataDir, sku) {
  const marker = path.join(bundleInstallDir(userDataDir, sku), 'bundle.json');
  try {
    const j = JSON.parse(fs.readFileSync(marker, 'utf8'));
    return { installed: true, version: j.version || null };
  } catch {
    return { installed: false, version: null };
  }
}

const GITHUB_RELEASES_BASE = 'https://github.com/kizuna-ai-lab/sokuji/releases/download';

// The engine version this app build requires (spec S1/S2): package.json's
// `sidecarVersion` — packaged into the asar by both forge and electron-builder.
// SOKUJI_SIDECAR_VERSION overrides it for hardware verification of a
// not-yet-adopted release (spec S11).
function requiredSidecarVersion({ env = process.env, pkg = null } = {}) {
  if (env.SOKUJI_SIDECAR_VERSION) return env.SOKUJI_SIDECAR_VERSION;
  const p = pkg || require('../package.json');
  if (!p.sidecarVersion) throw new Error('package.json has no sidecarVersion field');
  return p.sidecarVersion;
}

// Where the per-version manifest + archives live (spec S4). The env override is
// the mirror/staging knob (spec S11): it replaces the whole base; the relative
// path layout (manifest.json + part names) is identical everywhere.
function bundleBaseUrl(version, env = process.env) {
  const o = env.SOKUJI_SIDECAR_BUNDLE_BASE_URL;
  if (o) return o.replace(/\/+$/, '');
  return `${GITHUB_RELEASES_BASE}/sidecar-v${version}`;
}

// Download staging lives under userData, NOT os.tmpdir(): /tmp is commonly
// tmpfs on Linux (a 2 GB download must not eat RAM) and does not survive
// reboots (which would kill resume) — spec S6.
function stagingDir(userDataDir) {
  return path.join(userDataDir, 'sidecar', '.staging');
}

// Bytes already staged for this sku+version (drives the renderer's 'paused' state).
function stagedBytes(userDataDir, sku, version) {
  const prefix = archiveName(sku, version);
  const dir = stagingDir(userDataDir);
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === prefix || f.startsWith(`${prefix}.`)) {
        total += fs.statSync(path.join(dir, f)).size;
      }
    }
  } catch { /* no staging dir yet */ }
  return total;
}

// Drop staged files that do not belong to this archive. Version is part of the
// file name, so stale downloads from an older sidecarVersion never survive.
function pruneStaging(userDataDir, keepArchiveName) {
  const dir = stagingDir(userDataDir);
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const f of names) {
    if (f !== keepArchiveName && !f.startsWith(`${keepArchiveName}.`)) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
}

function pickBundle(manifest, sku) {
  return (manifest.bundles || []).find((e) => e.sku === sku);
}

function verifySha256(filePath, wantHex) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (d) => h.update(d));
    rs.on('error', reject);
    rs.on('end', () => {
      const got = h.digest('hex');
      if (got === wantHex) resolve();
      else reject(new Error(`sha256 mismatch: got ${got}, want ${wantHex}`));
    });
  });
}

// Stream a .tar.zst into destDir. fzstd decompresses, tar-stream untars; both
// are pure-JS so Windows needs no system tar/zstd. Backpressure: pause the file
// read when the tar Writable is full, resume on drain.
function extractTarZst(archivePath, destDir) {
  const fzstd = require('fzstd');
  const tarStream = require('tar-stream');
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const root = path.resolve(destDir);
    const extract = tarStream.extract();
    const rs = fs.createReadStream(archivePath);
    // Destroy both streams and reject exactly once. Without this, an error partway
    // through (traversal guard, corrupt zstd frame, disk error) left the tar
    // `extract` transform and/or the archive read stream open — a file descriptor
    // leak on every failed install attempt.
    const fail = (err) => { try { rs.destroy(); } catch {} try { extract.destroy(); } catch {} reject(err); };

    extract.on('entry', (header, stream, next) => {
      const target = path.resolve(destDir, header.name);
      if (target !== root && !target.startsWith(root + path.sep)) {
        stream.resume();
        return next(new Error(`unsafe path in archive: ${header.name}`));
      }
      if (header.type === 'symlink' || header.type === 'link') {
        // Bundles are packed with dereference=True, so a link member means a
        // malformed/tampered archive — fail loud instead of writing an empty file.
        stream.resume();
        return next(new Error(`unsupported link member in archive: ${header.name} (bundles must be packed dereferenced)`));
      }
      if (header.type === 'directory') {
        fs.mkdirSync(target, { recursive: true });
        stream.resume();
        return next();
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const ws = fs.createWriteStream(target, { mode: header.mode || 0o644 });
      stream.on('error', fail);
      ws.on('error', fail);
      ws.on('finish', next);
      stream.pipe(ws);
    });
    extract.on('finish', resolve);
    extract.on('error', fail);

    let draining = false;
    const dctx = new fzstd.Decompress((chunk) => {
      if (!extract.write(Buffer.from(chunk))) draining = true;
    });
    rs.on('error', fail);
    rs.on('data', (d) => {
      // fzstd's push() decodes synchronously and can throw on a corrupt/truncated
      // zstd frame — without this guard that throw escapes the 'data' event and
      // crashes the main process instead of rejecting this promise.
      try {
        dctx.push(new Uint8Array(d));
      } catch (err) {
        return fail(err);
      }
      if (draining) {
        rs.pause();
        extract.once('drain', () => { draining = false; rs.resume(); });
      }
    });
    rs.on('end', () => {
      try {
        dctx.push(new Uint8Array(0), true);
      } catch (err) {
        return fail(err);
      }
      extract.end();
    });
  });
}

// Download one part into `dest`, resuming from already-staged bytes with an
// HTTP Range request (spec S7; GitHub release assets honor Range). The part's
// sha256 is verified afterwards; a mismatching file is deleted before the
// error propagates, so the next attempt restarts that part from zero.
// Resume is not a separate code path — the whole function is idempotent.
async function downloadPart({ url, dest, part, onPartProgress, fetchImpl = fetch, signal }) {
  let offset = 0;
  try { offset = fs.statSync(dest).size; } catch { /* nothing staged */ }
  if (offset > part.size) { fs.rmSync(dest, { force: true }); offset = 0; }
  if (offset === part.size) {
    try {
      await verifySha256(dest, part.sha256);
      onPartProgress?.(part.size);
      return;                                   // complete + valid: skip
    } catch {
      fs.rmSync(dest, { force: true });
      offset = 0;                               // complete + corrupt: restart
    }
  }
  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
  const r = await fetchImpl(url, { headers, signal });
  if (offset > 0 && r.status === 200) {
    offset = 0;                                 // server ignored Range: restart
  } else if (r.status !== 200 && r.status !== 206) {
    throw new Error(`part fetch failed: HTTP ${r.status}`);
  }
  if (!r.body) throw new Error('part fetch failed: empty body');
  const ws = fs.createWriteStream(dest, { flags: offset > 0 ? 'a' : 'w' });
  let received = offset;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!ws.write(Buffer.from(value))) {
        await new Promise((res, rej) => {
          const onDrain = () => { ws.off('error', onErr); res(); };
          const onErr = (e) => { ws.off('drain', onDrain); rej(e); };
          ws.once('drain', onDrain);
          ws.once('error', onErr);
        });
      }
      onPartProgress?.(received);
    }
  } catch (err) {
    ws.destroy();
    throw err;
  }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
  try {
    await verifySha256(dest, part.sha256);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

// Reassemble split parts into the whole archive (multi-part case, spec S5).
async function concatParts(partPaths, outPath) {
  const ws = fs.createWriteStream(outPath);
  for (const p of partPaths) {
    await new Promise((res, rej) => {
      const rs = fs.createReadStream(p);
      rs.on('error', rej);
      ws.on('error', rej);
      rs.on('end', res);
      rs.pipe(ws, { end: false });
    });
  }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
}

async function _fetchJson(url, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`manifest fetch failed: HTTP ${r.status}`);
  return r.json();
}

// Full install pipeline (spec S4-S9):
//   manifest → strict version check → disk preflight → per-part download with
//   resume → reassemble+verify → stop sidecar → extract → atomic swap → clean
//   staging. Idempotent per part, so cancel/crash + re-invoke resumes naturally.
async function installBundle({
  sku, version, userDataDir, onProgress,
  fetchImpl = fetch, signal, stopSidecar, env = process.env,
  statfs = (p) => fs.statfsSync(p),
}) {
  const baseUrl = bundleBaseUrl(version, env);
  const manifest = await _fetchJson(`${baseUrl}/manifest.json`, fetchImpl);
  const entry = pickBundle(manifest, sku);
  if (!entry) throw new Error(`no bundle for sku ${sku} in manifest`);
  if (entry.version !== version) {
    throw new Error(
      `manifest version ${entry.version} does not match required ${version} (strict matching)`);
  }

  // Disk preflight (spec S8): the archive and the unpacked tree coexist briefly.
  let free = null;
  try {
    const s = statfs(userDataDir);
    free = Number(s.bavail) * Number(s.bsize);
  } catch { /* fs without statfs support: skip the preflight */ }
  const need = entry.size + (entry.installedSize || 0) + 512 * 1024 * 1024;
  if (free !== null && free < need) {
    const gb = (n) => (n / 1e9).toFixed(1);
    throw new Error(`not enough disk space: need ~${gb(need)} GB free, have ${gb(free)} GB`);
  }

  const stage = stagingDir(userDataDir);
  fs.mkdirSync(stage, { recursive: true });
  const wholeName = archiveName(sku, version);
  pruneStaging(userDataDir, wholeName);

  const total = entry.size;
  let completed = 0;
  for (const part of entry.parts) {
    await downloadPart({
      url: `${baseUrl}/${part.name}`,
      dest: path.join(stage, part.name),
      part, fetchImpl, signal,
      onPartProgress: (received) =>
        onProgress?.({ phase: 'download', downloaded: completed + received, total }),
    });
    completed += part.size;
  }

  onProgress?.({ phase: 'verify', downloaded: total, total });
  const archive = path.join(stage, wholeName);
  if (entry.parts.length > 1) {
    await concatParts(entry.parts.map((p) => path.join(stage, p.name)), archive);
    await verifySha256(archive, entry.sha256);   // whole-archive identity check
    for (const p of entry.parts) fs.rmSync(path.join(stage, p.name), { force: true });
  }
  // Single part: the staged part IS the archive (same file name) and its
  // sha256 was already verified by downloadPart — no second 2 GB hash pass.

  // A running sidecar holds its python open; on Windows the rename swap below
  // would fail on the locked exe. Stop it first (spec S9) — the renderer
  // restarts it on demand after install.
  stopSidecar?.();

  const dest = bundleInstallDir(userDataDir, sku);
  const tmpDir = `${dest}.tmp`;
  const oldDir = `${dest}.old`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(oldDir, { recursive: true, force: true });
  onProgress?.({ phase: 'extract', downloaded: total, total });
  await extractTarZst(archive, tmpDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Two-rename swap: dest is never deleted before the replacement is ready; on
  // failure the previous bundle is restored from .old before rethrowing.
  let movedExisting = false;
  try {
    if (fs.existsSync(dest)) { fs.renameSync(dest, oldDir); movedExisting = true; }
    fs.renameSync(tmpDir, dest);
  } catch (error) {
    if (movedExisting && !fs.existsSync(dest) && fs.existsSync(oldDir)) fs.renameSync(oldDir, dest);
    throw error;
  }
  fs.rmSync(oldDir, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  fs.writeFileSync(path.join(dest, 'bundle.json'), JSON.stringify({ sku, version }));
  return { version };
}

// Delete an installed bundle (frees several GB — the engine card's Remove action).
// Staged downloads are left alone: version-named files never go stale silently
// (pruneStaging on the next install drops anything that no longer matches).
function removeBundle(userDataDir, sku) {
  fs.rmSync(bundleInstallDir(userDataDir, sku), { recursive: true, force: true });
}

module.exports = {
  archiveName, bundleInstallDir, bundleStatus, pickBundle,
  verifySha256, extractTarZst, installBundle,
  requiredSidecarVersion, bundleBaseUrl, stagingDir, stagedBytes, pruneStaging,
  downloadPart, concatParts, removeBundle,
};
