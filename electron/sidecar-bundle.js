const fs = require('fs');
const os = require('os');
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

async function _fetchJson(url, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`manifest fetch failed: HTTP ${r.status}`);
  return r.json();
}

async function _downloadToFile(url, dest, onProgress, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r.ok || !r.body) throw new Error(`bundle fetch failed: HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length') || 0);
  let downloaded = 0;
  const ws = fs.createWriteStream(dest);
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      if (!ws.write(Buffer.from(value))) {
        await new Promise((res, rej) => {
          const onDrain = () => { ws.off('error', onErr); res(); };
          const onErr = (e) => { ws.off('drain', onDrain); rej(e); };
          ws.once('drain', onDrain);
          ws.once('error', onErr);
        });
      }
      onProgress?.({ downloaded, total });
    }
  } catch (err) {
    ws.destroy();
    throw err;
  }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
}

// Download → verify → extract → atomic swap into userData/sidecar/<sku>.
async function installBundle({ sku, baseUrl, userDataDir, onProgress, fetchImpl = fetch }) {
  if (!baseUrl) {
    throw new Error('sidecar bundle hosting is not configured (set SOKUJI_SIDECAR_BUNDLE_BASE_URL)');
  }
  const manifest = await _fetchJson(`${baseUrl.replace(/\/$/, '')}/manifest.json`, fetchImpl);
  const entry = pickBundle(manifest, sku);
  if (!entry) throw new Error(`no bundle for sku ${sku} in manifest`);

  const dest = bundleInstallDir(userDataDir, sku);
  const tmpArchive = path.join(os.tmpdir(), archiveName(sku, entry.version));
  await _downloadToFile(entry.url, tmpArchive, onProgress, fetchImpl);
  await verifySha256(tmpArchive, entry.sha256);

  const tmpDir = `${dest}.tmp`;
  const oldDir = `${dest}.old`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(oldDir, { recursive: true, force: true });
  await extractTarZst(tmpArchive, tmpDir);
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
  fs.rmSync(tmpArchive, { force: true });
  fs.writeFileSync(path.join(dest, 'bundle.json'), JSON.stringify({ sku, version: entry.version }));
  return { version: entry.version };
}

module.exports = {
  archiveName, bundleInstallDir, bundleStatus, pickBundle,
  verifySha256, extractTarZst, installBundle,
};
