/**
 * Staging a TTS model's files for audio.cpp (tts_backend._stage_for_native). The hub cache's snapshot entries are
 * symlinks to extensionless blobs, and audio.cpp canonicalizes a path before choosing a loader by its extension, so it
 * would see the blob and refuse it. A hard link is a second name for the same file that canonicalization leaves alone:
 * the file is linked into <hub cache>/sokuji-tts-staging/<org--repo>__<rev>/<path>, keeping its extension, with no copy
 * of the weights. Where a hard link is impossible (another volume, a filesystem without them) it is copied atomically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TTS_STAGING_DIRNAME } from '../catalog';
import { checkRepoPath, hubCacheDir } from '../models/hfCache';

export function stagingRoot(): string {
  return path.join(hubCacheDir(), TTS_STAGING_DIRNAME);
}

/** The link and copy calls, replaceable in tests (a cross-device link, a racing link). */
const DEFAULTS = { link: fs.promises.link, copyFile: fs.promises.copyFile };
export const stagingSeams = { ...DEFAULTS };
export function restoreStagingSeams(): void {
  Object.assign(stagingSeams, DEFAULTS);
}

/** Both paths name the same file (symlinks followed). */
async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([fs.promises.stat(a, { bigint: true }), fs.promises.stat(b, { bigint: true })]);
    return x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

/** Copies to a temporary name next to `dest`, then renames over it: a reader never sees half a file. */
async function copyAtomic(source: string, dest: string): Promise<void> {
  const tmp = `${dest}.tmp${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    await stagingSeams.copyFile(source, tmp);
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}

/** Stages `source` (a snapshot entry of `repo` at `rev`, path `relPath`) and returns the staged path. */
export async function stageForNative(repo: string, rev: string, relPath: string, source: string): Promise<string> {
  checkRepoPath(repo, relPath);
  checkRepoPath(rev);
  const staged = path.join(stagingRoot(), `${repo.split('/').join('--')}__${rev}`, ...relPath.split('/'));
  if (await sameFile(staged, source)) return staged;                  // already staged: nothing to do
  await fs.promises.mkdir(path.dirname(staged), { recursive: true });
  await fs.promises.rm(staged, { force: true });                     // a stale entry from an older blob
  const real = await fs.promises.realpath(source);                   // link the blob, never the symlink
  try {
    await stagingSeams.link(real, staged);
  } catch (e) {
    // A concurrent load may have just staged the same file.
    if ((e as NodeJS.ErrnoException).code === 'EEXIST' && await sameFile(staged, source)) return staged;
    await copyAtomic(real, staged);
  }
  return staged;
}
