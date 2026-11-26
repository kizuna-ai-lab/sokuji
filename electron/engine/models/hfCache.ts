/**
 * The Hugging Face hub cache, read and written in huggingface_hub's own layout so the Python engine, the TS engine and
 * any other hub client share one set of downloads:
 *
 *   <hub>/models--org--name/refs/main             the commit `main` points at
 *   <hub>/models--org--name/snapshots/<commit>/…  the repo's files, as symlinks into blobs/
 *   <hub>/models--org--name/blobs/<etag>          the content, named by its etag (sha256 for LFS files)
 *
 * The offline lookups follow hf_hub_download / snapshot_download with local_files_only=True.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const COMMIT_HASH = /^[0-9a-f]{40}$/;

/** HF_HUB_CACHE, else HF_HOME/hub, else (XDG_CACHE_HOME or ~/.cache)/huggingface/hub — huggingface_hub's own order. */
export function hubCacheDir(): string {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  const home = process.env.HF_HOME || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'huggingface');
  return path.join(home, 'hub');
}

/**
 * Throws unless every segment of the repo id and of the file path is a plain name — not empty, `.` or `..`, and free
 * of backslashes — so no repo id or file a message names can reach outside the cache.
 */
export function checkRepoPath(repo: string, file?: string | null): void {
  const bad = (s: string) => s === '' || s === '.' || s === '..' || s.includes('\\');
  if (repo.split('/').some(bad) || (file != null && file.split('/').some(bad))) {
    throw new Error(`refusing an unsafe repo path: ${file != null ? `${repo}/${file}` : repo}`);
  }
}

/** `org/name` → `models--org--name`. */
export function repoFolder(repo: string): string {
  return `models--${repo.split('/').join('--')}`;
}

export function repoDir(repo: string): string {
  return path.join(hubCacheDir(), repoFolder(repo));
}

/** The commit a ref names, or the revision itself when it already is a commit hash; null when the ref is unknown. */
export function resolveRevision(repo: string, revision = 'main'): string | null {
  if (COMMIT_HASH.test(revision)) return revision;
  try {
    const commit = fs.readFileSync(path.join(repoDir(repo), 'refs', revision), 'utf8').trim();
    return commit || null;
  } catch {
    return null;
  }
}

/**
 * The local path of `file` in the revision's snapshot, or null when it is not cached (a dangling link is not cached).
 * For `main`, a file its snapshot lacks is looked for in the others, newest first: files cached under an earlier commit
 * (another card's download, an import) stay usable after `main` moves on. Only reading falls back; a download decides
 * by the pointer under the hub's commit, so it still fetches that commit's own bytes.
 */
export function cachedFilePath(repo: string, file: string, revision = 'main'): string | null {
  const commit = resolveRevision(repo, revision);
  const rel = file.split('/');
  const snapshots = path.join(repoDir(repo), 'snapshots');
  if (commit !== null) {
    const p = path.join(snapshots, commit, ...rel);
    if (fs.existsSync(p)) return p;
  }
  if (revision !== 'main') return null;
  let others: string[];
  try {
    others = fs.readdirSync(snapshots).filter((c) => c !== commit);
  } catch {
    return null;
  }
  const found = others.map((c) => path.join(snapshots, c, ...rel)).filter((p) => fs.existsSync(p));
  if (found.length === 0) return null;
  const mtime = (p: string) => fs.lstatSync(p).mtimeMs;
  return found.sort((a, b) => mtime(b) - mtime(a))[0];
}

/** The revision's snapshot directory, or null when the repo was never fetched. */
export function snapshotPath(repo: string, revision = 'main'): string | null {
  const commit = resolveRevision(repo, revision);
  if (commit === null) return null;
  const p = path.join(repoDir(repo), 'snapshots', commit);
  return fs.existsSync(p) ? p : null;
}

export interface CachedFile {
  /** The path relative to its revision's snapshot root, `/`-separated. */
  readonly relPath: string;
  readonly filePath: string;
  /** Where the content lives: the link's target, or the file itself when the snapshot holds a copy. */
  readonly blobPath: string;
  readonly size: number;
}

export interface CachedRevision {
  readonly commit: string;
  readonly snapshotDir: string;
  readonly files: readonly CachedFile[];
}

export interface CachedRepo {
  readonly repo: string;
  readonly dir: string;
  readonly revisions: readonly CachedRevision[];
  /** The bytes of every distinct blob a revision's file points at. */
  readonly sizeOnDisk: number;
}

function walkFiles(dir: string, rel: string, out: Array<[string, string]>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkFiles(p, r, out);
    else out.push([r, p]);
  }
}

/**
 * One repo's cached revisions and files (huggingface_hub's scan of a cached repo); null when the repo has no cache
 * folder or no snapshots. A link whose blob is gone is skipped. Throws when the folder cannot be read.
 */
export function scanRepo(repo: string): CachedRepo | null {
  const dir = repoDir(repo);
  const snapshots = path.join(dir, 'snapshots');
  if (!fs.existsSync(snapshots)) return null;
  const revisions: CachedRevision[] = [];
  const blobSizes = new Map<string, number>();
  for (const entry of fs.readdirSync(snapshots, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const snapshotDir = path.join(snapshots, entry.name);
    const found: Array<[string, string]> = [];
    walkFiles(snapshotDir, '', found);
    const files: CachedFile[] = [];
    for (const [relPath, filePath] of found) {
      let blobPath: string;
      let size: number;
      try {
        blobPath = fs.realpathSync(filePath);
        size = fs.statSync(blobPath).size;
      } catch {
        continue;
      }
      blobSizes.set(blobPath, size);
      files.push({ relPath, filePath, blobPath, size });
    }
    revisions.push({ commit: entry.name, snapshotDir, files });
  }
  let sizeOnDisk = 0;
  for (const size of blobSizes.values()) sizeOnDisk += size;
  return { repo, dir, revisions, sizeOnDisk };
}

/**
 * Points snapshots/<commit>/<file> at blobs/<blobName> with a relative link, as huggingface_hub does; copies the blob
 * instead where links need a privilege the process lacks (Windows without developer mode). Returns the snapshot path.
 */
export function writeSnapshotLink(repo: string, commit: string, file: string, blobName: string): string {
  const dir = repoDir(repo);
  const pointer = path.join(dir, 'snapshots', commit, ...file.split('/'));
  const blob = path.join(dir, 'blobs', blobName);
  fs.mkdirSync(path.dirname(pointer), { recursive: true });
  fs.rmSync(pointer, { force: true });
  try {
    fs.symlinkSync(path.relative(path.dirname(pointer), blob), pointer);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
    fs.copyFileSync(blob, pointer);
  }
  return pointer;
}

/** Records the commit a ref points at (refs/<ref>). */
export function writeRef(repo: string, ref: string, commit: string): void {
  const p = path.join(repoDir(repo), 'refs', ...ref.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let current: string | null = null;
  try {
    current = fs.readFileSync(p, 'utf8');
  } catch {
    // no ref yet
  }
  if (current !== commit) fs.writeFileSync(p, commit);
}

const repoLocks = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` while no other caller holds `repo`'s lock in this engine: what goes into a repo's cache — a blob put in
 * place or taken back, its snapshot links, `main` — is decided by one writer at a time, so an import that fails cannot
 * take back a blob another import or a download has just started to use. In-process: the engine is the cache's one writer.
 */
export async function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = repoDir(repo);
  const before = repoLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = before.then(() => mine);
  repoLocks.set(key, tail);
  await before;
  try {
    return await fn();
  } finally {
    release();
    if (repoLocks.get(key) === tail) repoLocks.delete(key);
  }
}

/** `withRepoLock` over several repos, taken in one order so two callers never wait on each other. */
export function withRepoLocks<T>(repos: readonly string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(repos)].sort();
  const run = (i: number): Promise<T> => (i === sorted.length ? fn() : withRepoLock(sorted[i], () => run(i + 1)));
  return run(0);
}
