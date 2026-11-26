/**
 * Downloads into the hub cache (huggingface_hub's hf_hub_download, done here): the bytes stream into
 * blobs/<etag>.incomplete, an interrupted file resumes with a Range request, an LFS file is checked against its sha256
 * before it becomes blobs/<etag>, and the snapshot links to it. Then the model-level download (native_models.download):
 * every file of a model, with progress messages and cancellation.
 */
import { createHash, type Hash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cachedFilePath, checkRepoPath, repoDir, withRepoLock, writeRef, writeSnapshotLink } from './hfCache';
import { HubError, fileMetadata, listRepoTree, type FileMetadata, type HubOptions } from './hub';
import { downloadSpecs, ignored, modelSizeAsync } from './specs';

export interface DownloadFileOptions extends HubOptions {
  /** Called with each run of bytes added to the file, the resumed part included (first). */
  onBytes?: (n: number) => void;
}

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : Object.assign(new Error('the download was cancelled'), { name: 'AbortError' });
}

const offline = () => ['1', 'ON', 'YES', 'TRUE'].includes((process.env.HF_HUB_OFFLINE ?? '').toUpperCase());

async function hashPrefix(file: string, hash: Hash): Promise<void> {
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
}

/** Streams the file's bytes into `incomplete`, resuming what is there; the whole file's sha256 when `verify`. */
async function fetchInto(incomplete: string, meta: FileMetadata, verify: boolean, opts: DownloadFileOptions, label: string): Promise<string | null> {
  let start = 0;
  try {
    start = fs.statSync(incomplete).size;
  } catch {
    // nothing to resume
  }
  if (meta.size !== null && start > meta.size) start = 0;    // longer than the file: not a prefix of it
  let hash: Hash | null = verify ? createHash('sha256') : null;
  if (start > 0 && hash) await hashPrefix(incomplete, hash);
  if (start > 0) opts.onBytes?.(start);
  if (meta.size === null || start < meta.size) {
    const headers: Record<string, string> = { 'accept-encoding': 'identity' };
    if (start > 0) headers.range = `bytes=${start}-`;
    const res = await fetch(meta.location, { headers, redirect: 'follow', signal: opts.signal });
    if (!res.ok) throw new HubError(`${label}: HTTP ${res.status}`, res.status);
    let append = start > 0;
    if (append && res.status !== 206) {
      // The server ignored the range and sent the whole file: start over.
      opts.onBytes?.(-start);
      append = false;
      hash = verify ? createHash('sha256') : null;
    }
    // Its folder may have gone since it was made (an import taking back what it had put in a fresh repo): made again.
    const fh = await fs.promises.open(incomplete, append ? 'a' : 'w').catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
      fs.mkdirSync(path.dirname(incomplete), { recursive: true });
      return fs.promises.open(incomplete, append ? 'a' : 'w');
    });
    try {
      if (res.body) {
        for await (const chunk of res.body) {
          // A write may take only part of the chunk: the rest follows.
          for (let off = 0; off < chunk.length;) {
            const { bytesWritten } = await fh.write(chunk, off, chunk.length - off);
            if (bytesWritten <= 0) throw new Error(`${label}: could not be written to the model cache (no progress)`);
            off += bytesWritten;
          }
          hash?.update(chunk);
          opts.onBytes?.(chunk.length);
          if (opts.signal?.aborted) throw abortError(opts.signal);
        }
      }
    } finally {
      await fh.close();
    }
  }
  return hash ? hash.digest('hex') : null;
}

/**
 * Downloads `file` of `repo` at `main` into the hub cache and returns its snapshot path. An already-cached file costs
 * one HEAD; offline, or when the hub cannot be reached, the cached copy is returned if there is one.
 */
export async function downloadFile(repo: string, file: string, opts: DownloadFileOptions = {}): Promise<string> {
  checkRepoPath(repo, file);
  const label = `${repo}/${file}`;
  if (offline()) {
    const cached = cachedFilePath(repo, file);
    if (cached !== null) return cached;
    throw new Error(`${label}: not cached, and HF_HUB_OFFLINE is set`);
  }
  let meta: FileMetadata;
  try {
    meta = await fileMetadata(repo, file, opts);
  } catch (e) {
    const missing = e instanceof HubError && (e.status === 401 || e.status === 403 || e.status === 404);
    if (missing || opts.signal?.aborted) throw e;
    const cached = cachedFilePath(repo, file);
    if (cached !== null) return cached;
    throw e;
  }
  if (!/^[0-9a-f]{40}$/.test(meta.commit) || !SAFE_NAME.test(meta.etag)) throw new Error(`${label}: the hub sent an unusable commit or etag`);
  const dir = repoDir(repo);
  const pointer = path.join(dir, 'snapshots', meta.commit, ...file.split('/'));
  const blob = path.join(dir, 'blobs', meta.etag);
  const incomplete = `${blob}.incomplete`;
  const fetchBlob = async (): Promise<void> => {
    fs.mkdirSync(path.dirname(blob), { recursive: true });
    const digest = await fetchInto(incomplete, meta, SHA256.test(meta.etag), opts, label);
    const got = fs.statSync(incomplete).size;
    if (meta.size !== null && got !== meta.size) throw new Error(`${label}: the download stopped at ${got} of ${meta.size} bytes`);
    if (digest !== null && digest !== meta.etag) {
      fs.rmSync(incomplete, { force: true });
      throw new Error(`${label}: sha256 ${digest} does not match the hub's ${meta.etag}`);
    }
  };
  // The fetch runs without the repo's lock (an import may hold it for minutes); what the cache then holds — the blob
  // put in place, its link, `main` — is decided under it (withRepoLock), so an import taking back a blob cannot
  // interleave with it. A blob that was there when looked at and is gone by then is fetched after all.
  let fetched = false;
  if (!fs.existsSync(pointer) && !fs.existsSync(blob)) {
    await fetchBlob();
    fetched = true;
  }
  for (;;) {
    const done = await withRepoLock(repo, async () => {
      if (fs.existsSync(pointer)) {
        if (fetched) fs.rmSync(incomplete, { force: true });   // filed meanwhile by another writer
        writeRef(repo, 'main', meta.commit);
        return true;
      }
      if (!fs.existsSync(blob)) {
        if (!fetched) return false;
        fs.renameSync(incomplete, blob);
      } else if (fetched) {
        fs.rmSync(incomplete, { force: true });
      }
      writeSnapshotLink(repo, meta.commit, file, meta.etag);
      writeRef(repo, 'main', meta.commit);
      return true;
    }, opts.signal);
    if (done) return pointer;
    await fetchBlob();
    fetched = true;
  }
}

export type Send = (msg: Record<string, unknown>) => Promise<void>;

export interface DownloadModelOptions extends HubOptions {
  /** The chosen variant's artifact or repo (download_specs' override). */
  repo?: string | null;
}

/** What the model-level download reads, patched by tests (Python's monkeypatching of native_models). */
const DEFAULTS = {
  downloadSpecs,
  modelSize: modelSizeAsync,
  downloadFile,
  /** The least time between two in-flight progress messages. */
  progressIntervalMs: 500,
};
export const downloadSeams = { ...DEFAULTS };
export function restoreDownloadSeams(): void {
  Object.assign(downloadSeams, DEFAULTS);
}

function fileSize(p: string): number {
  try {
    return fs.statSync(fs.realpathSync(p)).size;
  } catch {
    return 0;
  }
}

/**
 * Downloads every file of a model, sending model_progress as it goes: in bytes when the size is known (in-flight
 * progress capped at total − 1, the last message exactly total), else in files. 'cancelled' once the signal aborts.
 */
export async function downloadModel(modelId: string, send: Send, opts: DownloadModelOptions = {}): Promise<'ready' | 'cancelled'> {
  const { repo, signal } = opts;
  const specs = downloadSeams.downloadSpecs(modelId, repo);
  const ignore = specs.ignore ?? [];
  const files: Array<[string, string]> = [];
  for (const r of specs.repos) {
    try {
      for (const entry of await listRepoTree(r, opts)) if (!ignored(entry.path, ignore)) files.push([r, entry.path]);
    } catch {
      // an unreachable repo adds nothing; an all-unreachable spec fails below
    }
  }
  files.push(...(specs.files ?? []));
  if (specs.repos.length > 0 && files.length === 0) {
    throw new Error(`no downloadable files for ${modelId} (repos ${JSON.stringify(specs.repos)} unreachable)`);
  }
  const totalUnits = files.length + specs.urls.length;
  let size: number | null = null;
  try {
    size = await downloadSeams.modelSize(repo ? repo : modelId, opts);
  } catch {
    size = null;
  }
  const totalBytes = size || null;
  let doneBytes = 0;
  let doneUnits = 0;
  let inflight = 0;
  let lastSent = Date.now();
  const progress = (downloaded: number, total: number) => send({ type: 'model_progress', model: modelId, downloaded, total });

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) return 'cancelled';
    const [r, fname] = files[i];
    inflight = 0;
    let result: string;
    try {
      result = await downloadSeams.downloadFile(r, fname, {
        ...opts,
        onBytes: (n) => {
          inflight += n;
          if (totalBytes === null || inflight <= 0) return;
          const now = Date.now();
          if (now - lastSent < downloadSeams.progressIntervalMs) return;
          lastSent = now;
          void progress(Math.min(doneBytes + inflight, totalBytes - 1), totalBytes).catch(() => {});
        },
      });
    } catch (e) {
      if (signal?.aborted) return 'cancelled';
      throw e;
    }
    doneBytes += totalBytes !== null ? fileSize(result) : 0;
    doneUnits += 1;
    const final = i === files.length - 1;
    if (totalBytes !== null) await progress(final ? totalBytes : Math.min(doneBytes, totalBytes - 1), totalBytes);
    else await progress(doneUnits, totalUnits);
  }
  return 'ready';
}
