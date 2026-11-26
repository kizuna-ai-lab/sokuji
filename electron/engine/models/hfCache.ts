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

/** The local path of `file` in the revision's snapshot, or null when it is not cached (a dangling link is not cached). */
export function cachedFilePath(repo: string, file: string, revision = 'main'): string | null {
  const commit = resolveRevision(repo, revision);
  if (commit === null) return null;
  const p = path.join(repoDir(repo), 'snapshots', commit, ...file.split('/'));
  return fs.existsSync(p) ? p : null;
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
  if (current === commit) return;
  // `main` is the one snapshot files are looked up in: moving it to another commit keeps what the old one held and the
  // new one lacks, or files cached under the old commit (another card's, an import's) would read as absent.
  if (ref === 'main' && current) carryOver(repo, current.trim(), commit);
  fs.writeFileSync(p, commit);
}

/** Links into snapshots/<to> every file of snapshots/<from> it does not have (blobs are named by content: safe to share). */
function carryOver(repo: string, from: string, to: string): void {
  const src = path.join(repoDir(repo), 'snapshots', from);
  const dst = path.join(repoDir(repo), 'snapshots', to);
  if (from === to || !fs.existsSync(src)) return;
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = path.join(rel, entry.name);
      const a = path.join(src, r);
      const b = path.join(dst, r);
      if (entry.isDirectory()) { walk(r); continue; }
      if (fs.existsSync(b) || !fs.existsSync(a)) continue;   // the new snapshot's own file wins; a dangling link is dropped
      fs.mkdirSync(path.dirname(b), { recursive: true });
      // The same relative link works from the same depth; where links were copies (Windows), a hard link, else a copy.
      if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(a), b);
      else {
        try { fs.linkSync(a, b); } catch { fs.copyFileSync(a, b); }
      }
    }
  };
  walk('');
}
