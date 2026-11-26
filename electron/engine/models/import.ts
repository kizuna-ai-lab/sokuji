/**
 * Imports a model the person downloaded themselves (where the hub cannot be reached): the files they name go into the
 * hub cache exactly where a download would have put them — blobs/<sha256>, a snapshot link, the `main` ref — so the
 * model is "ready" afterwards, and a later online download finds the blob and only adds the link. Every card is one
 * pinned file (plus a speech card's preset), so what to expect is known offline: the file names, from `downloadSpecs`.
 * A file is accepted when it is the one named, a GGUF with a readable header, and — where the published catalog lists its hash — the
 * published bytes; it is hashed here, so a wrong or truncated file never reaches the cache.
 */
import { catalog } from '@handy-computer/models';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GgufError, readHeader } from '../ggufHeader';
import { checkRepoPath, repoDir, resolveRevision, withRepoLocks, writeRef, writeSnapshotLink } from './hfCache';
import { downloadSpecs } from './specs';
import type { Send } from './download';

/** A file the published catalog lists: its hash and the commit it is pinned to. */
export interface KnownFile {
  readonly sha256: string;
  readonly size: number;
  readonly revision: string;
}

/** The published entry of `file` in `repo`, from the catalog bundled with the app; undefined for a file it does not list. */
export function knownFile(repo: string, file: string): KnownFile | undefined {
  for (const m of catalog.models) {
    if (m.repository.toLowerCase() !== repo.toLowerCase()) continue;
    for (const f of Object.values(m.files)) {
      if (f.filename === file) return { sha256: f.sha256, size: f.size, revision: m.revision };
    }
  }
  return undefined;
}

/** A refusal a person can act on: `code` and `params` let the interface say it in its own language; `message` is English. */
export class ImportError extends Error {
  constructor(message: string, readonly code: string = 'import_failed', readonly params: Record<string, string> = {}) {
    super(message);
  }
}

/** True when the file starts with a readable GGUF header (a file cut short, or not a GGUF at all, does not). */
async function isGguf(file: string): Promise<boolean> {
  try {
    await readHeader(file);
    return true;
  } catch (e) {
    if (e instanceof GgufError) return false;
    throw e;
  }
}

/**
 * Copies `from` to `to` and returns the sha256 of the bytes written, reporting each run of bytes: one read, so the
 * bytes hashed are the bytes cached even if the person's file changes meanwhile.
 */
async function copyHashing(from: string, to: string, onBytes: (n: number) => void, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const out = await fs.promises.open(to, 'w');
  try {
    for await (const chunk of fs.createReadStream(from, { highWaterMark: 4 << 20 })) {
      if (signal?.aborted) throw new ImportError('cancelled', 'import_cancelled');
      const buf = chunk as Buffer;
      hash.update(buf);
      // A write may take only part of the chunk: the rest follows, so the file holds every byte that was hashed.
      for (let off = 0; off < buf.length;) {
        const { bytesWritten } = await out.write(buf, off, buf.length - off);
        if (bytesWritten <= 0) throw new Error(`${path.basename(from)} could not be written to the model cache (no progress)`);
        off += bytesWritten;
      }
      onBytes(buf.length);
    }
  } finally {
    await out.close();
  }
  return hash.digest('hex');
}

/**
 * The commit one import files a repo's files under — one for all of them, as `main` names one snapshot: the catalog's
 * pin where it lists one of them; else the commit `main` already names, so files already cached there keep resolving;
 * else one made from the files' bytes.
 */
function commitFor(repo: string, files: ReadonlyArray<{ file: string; sha: string; known?: KnownFile }>): string {
  const pinned = files.find((f) => f.known)?.known?.revision;
  if (pinned) return pinned;
  const current = resolveRevision(repo);
  if (current) return current;
  const id = files.map((f) => `${f.file}@${f.sha}`).sort().join('\n');
  return createHash('sha1').update(`${repo}\n${id}`).digest('hex');
}

/** Removes `dir`'s empty `blobs` folder and then `dir` itself if nothing else is in them; never a folder with files. */
function pruneEmpty(dir: string): void {
  for (const d of [path.join(dir, 'blobs'), dir]) {
    try {
      fs.rmdirSync(d);
    } catch {
      return;   // not empty, or gone: leave it
    }
  }
}

/** True while process `pid` runs (EPERM: it runs as another user). */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Removes staging files an engine left in `blobs` when it stopped mid-import (named by its pid, which no longer runs). */
function sweepStaging(blobs: string): void {
  for (const name of fs.readdirSync(blobs)) {
    const m = /^import-(\d+)-[0-9a-f]+\.incomplete$/.exec(name);
    if (m && Number(m[1]) !== process.pid && !running(Number(m[1]))) fs.rmSync(path.join(blobs, name), { force: true });
  }
}

export interface ImportOptions {
  /** The chosen variant's artifact, as a download takes it. */
  repo?: string | null;
  signal?: AbortSignal;
}

/**
 * Imports `paths` as the files of `modelId`: each file the card needs must be among them, by name. Sends model_progress
 * (bytes read over the bytes to read) and returns 'ready', or 'cancelled' once the signal aborts. Throws ImportError
 * with a sentence a person can act on: which file is missing, not a GGUF, or not the published one.
 */
export async function importModel(modelId: string, paths: readonly string[], send: Send, opts: ImportOptions = {}): Promise<'ready' | 'cancelled'> {
  const { signal } = opts;
  const specs = downloadSpecs(modelId, opts.repo);
  if (!specs.files || specs.files.length === 0) throw new ImportError(`${modelId} cannot be imported: it is not a single published file`, 'import_not_importable', { model: modelId });
  const byName = new Map(paths.map((p) => [path.basename(p), p]));
  const wanted = specs.files.map(([repo, file]) => ({ repo, file, name: path.posix.basename(file), from: byName.get(path.posix.basename(file)) }));
  const missing = wanted.filter((w) => w.from === undefined).map((w) => w.name);
  if (missing.length > 0) throw new ImportError(`missing: ${missing.join(', ')}`, 'import_missing', { names: missing.join(', ') });

  let total = 0;
  for (const w of wanted) {
    checkRepoPath(w.repo, w.file);
    const st = fs.statSync(w.from!, { throwIfNoEntry: false });
    if (!st?.isFile() || st.size === 0) throw new ImportError(`${w.name} is not a readable file`, 'import_unreadable', { name: w.name });
    if (w.name.endsWith('.gguf') && !(await isGguf(w.from!))) throw new ImportError(`${w.name} is not a GGUF file`, 'import_not_gguf', { name: w.name });
    total += st.size;
  }

  let done = 0;
  let lastSent = 0;
  const tick = (n: number) => {
    done += n;
    const now = Date.now();
    if (now - lastSent < 300) return;
    lastSent = now;
    void send({ type: 'model_progress', model: modelId, downloaded: Math.min(done, total - 1), total }).catch(() => {});
  };

  // One writer per repo while this import runs (withRepoLocks): another import or a download's last step waits, so a
  // blob this import takes back on failure is one nobody else has started to use.
  let outcome: 'ready' | 'cancelled';
  try {
    outcome = await withRepoLocks(wanted.map((w) => w.repo), async (): Promise<'ready' | 'cancelled'> => {
      // Each file is copied into the repo's blobs under a name of its own while it is hashed, checked, then given its
      // hash's name; the snapshot links and `main` follow once every file is in, one commit per repo.
      const placed: Array<{ repo: string; file: string; sha: string; known?: KnownFile }> = [];
      // What this import put in place, taken back if it fails or is cancelled: only that — a repo may be shared (every
      // speech card's is), and another card's download may be fetching into it meanwhile (it waits only to finish).
      const renamed: string[] = [];
      const touched = new Set<string>();
      try {
        for (const w of wanted) {
          const dir = repoDir(w.repo);
          touched.add(dir);
          const blobs = path.join(dir, 'blobs');
          fs.mkdirSync(blobs, { recursive: true });
          sweepStaging(blobs);
          const incomplete = path.join(blobs, `import-${process.pid}-${randomBytes(6).toString('hex')}.incomplete`);
          // The staging copy is this import's until it is the blob: whatever stops it on the way (a refusal, a read
          // error, a failed rename), it goes (its pid keeps it from a sweep while this engine runs). Once renamed, the
          // removal finds nothing.
          let sha: string;
          let known: KnownFile | undefined;
          try {
            sha = await copyHashing(w.from!, incomplete, tick, signal);
            if (signal?.aborted) throw new ImportError('cancelled', 'import_cancelled');
            known = knownFile(w.repo, w.file);
            if (known && known.sha256 !== sha) {
              throw new ImportError(
                `${w.name} is not the published file (its sha256 is ${sha.slice(0, 12)}…, expected ${known.sha256.slice(0, 12)}…): download it again`,
                'import_mismatch', { name: w.name, got: sha.slice(0, 12), expected: known.sha256.slice(0, 12) },
              );
            }
            // The bytes copied are the ones checked, not only the file looked at first: it may have been replaced while
            // the import waited for the repo, and a file the catalog does not list has no published hash to catch that.
            if (w.name.endsWith('.gguf') && !(await isGguf(incomplete))) {
              throw new ImportError(`${w.name} is not a GGUF file`, 'import_not_gguf', { name: w.name });
            }
            const blob = path.join(blobs, sha);
            // Bytes already cached (an earlier download or import) are kept; the copy is dropped (below).
            if (!fs.existsSync(blob)) {
              fs.renameSync(incomplete, blob);
              renamed.push(blob);
            }
          } finally {
            try { fs.rmSync(incomplete, { force: true }); } catch { /* the error that stopped it is the one to tell */ }
          }
          placed.push({ repo: w.repo, file: w.file, sha, known });
        }
        // Cancelled once every file is in place but before any is published: taken back like any other cancel.
        if (signal?.aborted) throw new ImportError('cancelled', 'import_cancelled');
      } catch (e) {
        // Best effort: a cleanup that fails (a file held open on Windows) must not hide why the import stopped.
        try {
          for (const blob of renamed) fs.rmSync(blob, { force: true });
          for (const dir of touched) pruneEmpty(dir);
        } catch {
          // left for a later import or a delete of the model
        }
        if (e instanceof ImportError && e.code === 'import_cancelled') return 'cancelled';
        throw e;
      }
      for (const repo of new Set(placed.map((p) => p.repo))) {
        const files = placed.filter((p) => p.repo === repo);
        const commit = commitFor(repo, files);
        for (const f of files) writeSnapshotLink(repo, commit, f.file, f.sha);
        writeRef(repo, 'main', commit);
      }
      return 'ready';
    }, signal);
  } catch (e) {
    if (signal?.aborted) return 'cancelled';   // cancelled while waiting for the repo
    throw e;
  }
  if (outcome === 'cancelled') return 'cancelled';
  await send({ type: 'model_progress', model: modelId, downloaded: total, total });
  return 'ready';
}
