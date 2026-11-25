/**
 * Real on-disk hub-cache layouts for the model tests (Python's _real_hf_cache_repo): blobs/, snapshots/<rev>/ and
 * refs/main under a fresh HF_HOME per test, with files added as plain blobs and snapshot symlinks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hubCacheDir, repoDir } from '../models/hfCache';

/** A fresh, empty HF_HOME for one test; returns the cleanup. */
export function freshHfHome(): () => void {
  const prev = process.env.HF_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sokuji-models-hf-'));
  process.env.HF_HOME = home;
  return () => {
    process.env.HF_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  };
}

export function hub(): string {
  return hubCacheDir();
}

/** Creates the repo's blobs/, snapshots/<commit>/ and refs/main = commit. */
export function cacheRepo(repo: string, commit = 'rev1'): { blobs: string; snapshot: string } {
  const dir = repoDir(repo);
  const blobs = path.join(dir, 'blobs');
  const snapshot = path.join(dir, 'snapshots', commit);
  fs.mkdirSync(blobs, { recursive: true });
  fs.mkdirSync(snapshot, { recursive: true });
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'refs', 'main'), commit);
  return { blobs, snapshot };
}

/** Adds `rel` to the repo's snapshot: a blob of `size` bytes and a symlink to it (absolute, as the Python fixture). */
export function cacheFile(repo: string, rel: string, size = 1, { commit = 'rev1', blobName }: { commit?: string; blobName?: string } = {}): { link: string; blob: string } {
  const { blobs, snapshot } = cacheRepo(repo, commit);
  const blob = path.join(blobs, blobName ?? `blob-${rel.replace(/[^A-Za-z0-9]/g, '_')}`);
  if (!fs.existsSync(blob)) fs.writeFileSync(blob, Buffer.alloc(size, 0x78));
  const link = path.join(snapshot, ...rel.split('/'));
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(blob, link);
  return { link, blob };
}

/** Caches a catalog artifact ("org/repo/dir/file") as `cacheFile` does. */
export function cacheArtifact(artifact: string, size = 1): { link: string; blob: string } {
  const parts = artifact.split('/');
  return cacheFile(`${parts[0]}/${parts[1]}`, parts.slice(2).join('/'), size);
}
