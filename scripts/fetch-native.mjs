#!/usr/bin/env node
/**
 * Fetches the pinned native archive for one platform into resources/native/, where both packagers copy it as an extra
 * resource and the engine reads it (electron/native-dir.js).
 *
 *   node scripts/fetch-native.mjs [--sku <sku>] [--from <dir>]
 *
 * The version is package.json's `nativeVersion`; the expected sha256 per SKU is in scripts/native-archives.json (copied
 * from the release's manifest.json). A mismatch of either stops the build. `--from` takes the archive from a directory
 * instead of the GitHub release `native-v<version>`. A no-op when resources/native/contract.json already names the
 * version.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'kizuna-ai-lab/sokuji';

/** Streams a .tar.zst into destDir; absolute paths, `..` and link entries are refused. fzstd + tar-stream are pure JS. */
function extractTarZst(archivePath, destDir) {
  const fzstd = require('fzstd');
  const tarStream = require('tar-stream');
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const root = path.resolve(destDir);
    const extract = tarStream.extract();
    const rs = fs.createReadStream(archivePath);
    let failed = false;
    let active = null;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      try { rs.destroy(); } catch { /* closing */ }
      try { extract.destroy(); } catch { /* closing */ }
      try { active?.destroy(); } catch { /* closing */ }
      reject(err);
    };
    // tar-stream re-emits next(err) on the entry's own stream as well: without a listener there that is an
    // unhandled 'error' event, which crashed the process (and failed vitest's run) after the rejection was handled.
    const refuse = (stream, next, err) => {
      stream.on('error', () => {});
      stream.resume();
      fail(err);
      next(err);
    };
    extract.on('entry', (header, stream, next) => {
      const target = path.resolve(destDir, header.name);
      if (path.isAbsolute(header.name) || (target !== root && !target.startsWith(root + path.sep))) {
        return refuse(stream, next, new Error(`unsafe path in archive: ${header.name}`));
      }
      if (header.type === 'symlink' || header.type === 'link') {
        return refuse(stream, next, new Error(`unsupported link member in archive: ${header.name}`));
      }
      if (header.type === 'directory') {
        fs.mkdirSync(target, { recursive: true });
        stream.resume();
        return next();
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const ws = fs.createWriteStream(target, { mode: header.mode || 0o644 });
      active = ws;
      stream.on('error', fail);
      ws.on('error', fail);
      ws.once('close', () => { if (active === ws) active = null; if (!failed) next(); });
      stream.pipe(ws);
    });
    extract.on('finish', resolve);
    extract.on('error', fail);
    let draining = false;
    const dctx = new fzstd.Decompress((chunk) => { if (!extract.write(Buffer.from(chunk))) draining = true; });
    rs.on('error', fail);
    rs.on('data', (d) => {
      try { dctx.push(new Uint8Array(d)); } catch (err) { return fail(err); }
      if (draining) { rs.pause(); extract.once('drain', () => { draining = false; rs.resume(); }); }
    });
    rs.on('end', () => {
      try { dctx.push(new Uint8Array(0), true); } catch (err) { return fail(err); }
      extract.end();
    });
  });
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function installedVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'contract.json'), 'utf8')).version ?? null; } catch { return null; }
}

export async function fetchNative({ root, sku, from, nativeVersion, archives, log = console.log }) {
  if (!sku) throw new Error('no native archive for this platform');
  if (archives.version !== nativeVersion) {
    throw new Error(`package.json nativeVersion ${nativeVersion} does not match scripts/native-archives.json ${archives.version}`);
  }
  const expected = archives.sha256?.[sku];
  if (!expected) throw new Error(`scripts/native-archives.json has no sha256 for ${sku}`);

  const dest = path.join(root, 'resources', 'native');
  if (installedVersion(dest) === nativeVersion) {
    log(`resources/native is already ${nativeVersion}`);
    return dest;
  }

  const name = `sokuji-native-${sku}-v${nativeVersion}.tar.zst`;
  const work = fs.mkdtempSync(path.join(root, '.fetch-native-'));
  try {
    let archive;
    if (from) {
      archive = path.join(from, name);
    } else {
      const url = `https://github.com/${REPO}/releases/download/native-v${nativeVersion}/${name}`;
      log(`downloading ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      archive = path.join(work, name);
      fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    }
    const got = sha256(archive);
    if (got !== expected) throw new Error(`${name}: sha256 ${got} does not match native-archives.json (${expected})`);

    const unpacked = path.join(work, 'unpacked');
    await extractTarZst(archive, unpacked);
    const top = fs.readdirSync(unpacked);
    if (top.length !== 1 || !fs.statSync(path.join(unpacked, top[0])).isDirectory()) {
      throw new Error(`${name}: expected one top-level directory, got ${top.join(', ') || 'nothing'}`);
    }
    const dir = path.join(unpacked, top[0]);
    const have = installedVersion(dir);
    if (have !== nativeVersion) throw new Error(`${name}: contract.json names version ${have}, expected ${nativeVersion}`);

    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(dir, dest);
    log(`resources/native is ${nativeVersion} (${sku})`);
    return dest;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const root = path.resolve(here, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const archives = JSON.parse(fs.readFileSync(path.join(here, 'native-archives.json'), 'utf8'));
  const { detectSku } = require('../electron/sidecar-sku.js');
  const sku = opt('--sku') ?? detectSku(process.platform, { arch: process.arch });
  await fetchNative({ root, sku, from: opt('--from'), nativeVersion: pkg.nativeVersion, archives });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`fetch-native: ${e.message}`); process.exit(1); });
}
