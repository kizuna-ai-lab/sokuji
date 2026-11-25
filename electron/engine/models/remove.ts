/**
 * Deleting a model from the hub cache (port of native_models.delete_model). A repo that one catalog card owns goes
 * whole: its other quants are that card's own. A repo several cards share (every TTS card downloads from
 * audio-cpp/audio.cpp-gguf) loses exactly this card's files, and a blob only when nothing else points at it. Either
 * way the card's hard links under the TTS staging tree go too (a hard link keeps the blob's disk blocks alive), and that
 * prune never depends on the cache scan succeeding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TTS_STAGING_DIRNAME, asrModels, splitArtifact, translateModels, ttsModels } from '../catalog';
import { checkRepoPath, hubCacheDir, scanRepo, type CachedRepo } from './hfCache';
import { downloadSpecs, ttsRungFiles } from './specs';

/** The cache scan, patched by tests to fail (Python's scan_cache_dir raising). */
const DEFAULTS = { scanRepo };
export const removeSeams = { ...DEFAULTS };
export function restoreRemoveSeams(): void {
  Object.assign(removeSeams, DEFAULTS);
}

/** The catalog cards (ASR, translation, TTS) whose deployments download from `repo`. */
export function repoOwnerCards(repo: string): Set<string> {
  const owners = new Set<string>();
  for (const m of [...asrModels(), ...translateModels(), ...ttsModels()]) {
    if (m.deployments.some((d) => splitArtifact(d.artifact)[0] === repo)) owners.add(m.id);
  }
  return owners;
}

/** Removes exactly `fnames` (snapshot-relative) from a cached repo; returns the bytes of the blobs it freed. */
function deleteSharedRepoFiles(info: CachedRepo | null, fnames: readonly string[]): number {
  if (info === null) return 0;
  const wanted = new Set(fnames);
  const all = info.revisions.flatMap((rev) => rev.files);
  const kept = new Set(all.filter((f) => !wanted.has(f.relPath)).map((f) => f.blobPath));
  const removed = new Set<string>();
  let freed = 0;
  for (const f of all.filter((x) => wanted.has(x.relPath))) {
    fs.rmSync(f.filePath, { force: true });
    if (f.blobPath === f.filePath) {
      freed += f.size;                                     // a copied snapshot file (no links): its own bytes
      continue;
    }
    if (kept.has(f.blobPath) || removed.has(f.blobPath)) continue;
    try {
      freed += fs.statSync(f.blobPath).size;
      fs.rmSync(f.blobPath);
      removed.add(f.blobPath);
    } catch {
      // already gone
    }
  }
  return freed;
}

function stagingRoot(): string {
  return path.join(hubCacheDir(), TTS_STAGING_DIRNAME);
}

const stagedPrefix = (repo: string) => `${repo.split('/').join('--')}__`;

function stagedEntries(repo: string): string[] {
  try {
    return fs.readdirSync(stagingRoot()).filter((e) => e.startsWith(stagedPrefix(repo)));
  } catch {
    return [];
  }
}

/** Removes empty directories under (and including) `dir`, deepest first; a non-empty one stays. */
function pruneEmptyDirs(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name));
  try {
    fs.rmdirSync(dir);
  } catch {
    // not empty
  }
}

/** Removes `fnames` from every staged revision of `repo`, then the directories that left empty. */
export function pruneStagedFiles(repo: string, fnames: readonly string[]): void {
  for (const entry of stagedEntries(repo)) {
    const revDir = path.resolve(stagingRoot(), entry);
    for (const rel of new Set(fnames)) {
      const target = path.resolve(revDir, ...rel.split('/'));
      if (!target.startsWith(revDir + path.sep)) continue;                  // never outside its own staged revision
      fs.rmSync(target, { force: true });
    }
    pruneEmptyDirs(revDir);
  }
}

/** Removes every staged revision of `repo` (safe only when one card owns the repo). */
export function pruneStagedRepo(repo: string): void {
  for (const entry of stagedEntries(repo)) fs.rmSync(path.join(stagingRoot(), entry), { recursive: true, force: true });
}

/**
 * Removes a model's cached files and returns the bytes freed. `repo` names a chosen variant (only that rung goes);
 * without it, a TTS card loses every cached rung, so no stray rung keeps the card reading ready.
 */
export async function deleteModel(modelId: string, repo?: string | null): Promise<number> {
  const specs = downloadSpecs(modelId, repo);
  for (const r of specs.repos) checkRepoPath(r);
  for (const [r, f] of specs.files ?? []) checkRepoPath(r, f);
  const wholeRepos = new Set(specs.repos);
  const filesByRepo = new Map<string, string[]>();
  const add = (r: string, f: string) => {
    const list = filesByRepo.get(r) ?? [];
    if (!list.includes(f)) list.push(f);
    filesByRepo.set(r, list);
  };
  for (const [r, f] of specs.files ?? []) add(r, f);
  if (repo == null) for (const [r, f] of ttsRungFiles(modelId)) add(r, f);

  // Pure catalog data, decided before the scan so a failing scan cannot skip the staging prune.
  const shared = new Map<string, string[]>();
  for (const [r, fnames] of filesByRepo) {
    if (repoOwnerCards(r).size > 1) shared.set(r, fnames);
    else wholeRepos.add(r);
  }

  const scans = new Map<string, CachedRepo | null>();
  try {
    for (const r of [...shared.keys(), ...wholeRepos]) scans.set(r, removeSeams.scanRepo(r));
  } catch {
    for (const [r, fnames] of shared) pruneStagedFiles(r, fnames);
    for (const r of wholeRepos) pruneStagedRepo(r);
    return 0;
  }

  let freed = 0;
  for (const [r, fnames] of shared) {
    freed += deleteSharedRepoFiles(scans.get(r) ?? null, fnames);
    pruneStagedFiles(r, fnames);
  }
  for (const r of wholeRepos) {
    const info = scans.get(r) ?? null;
    if (info !== null) {
      freed += info.sizeOnDisk;
      await fs.promises.rm(info.dir, { recursive: true, force: true });
    }
    pruneStagedRepo(r);
  }
  return freed;
}
