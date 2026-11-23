/**
 * Whether a model is on disk (port of native_models.model_status), from the hub cache alone. A multi-quant card
 * asked about without a variant is ready when any rung is cached (load-time resolution only loads cached rungs); a
 * named variant must itself be cached. A TTS card's preset assets are required either way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { splitArtifact } from '../catalog';
import { cachedFilePath, checkRepoPath, repoDir, snapshotPath } from './hfCache';
import { downloadSpecs, extraFileSpecs, ladderArtifacts, type DownloadSpecs } from './specs';

export type ModelStatus = 'ready' | 'absent';

/**
 * Every whole repo of the spec has a snapshot and no interrupted blob: an `<etag>.incomplete` whose finished blob is
 * missing (a stale one beside its finished blob is a leftover, not an interruption).
 */
function reposCached(specs: DownloadSpecs): boolean {
  for (const r of specs.repos) {
    if (snapshotPath(r) === null) return false;
    const blobs = path.join(repoDir(r), 'blobs');
    let names: string[] = [];
    try {
      names = fs.readdirSync(blobs);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (name.endsWith('.incomplete') && !fs.existsSync(path.join(blobs, name.split('.')[0]))) return false;
    }
  }
  return true;
}

const cached = ([repo, file]: readonly [string, string]) => cachedFilePath(repo, file) !== null;

export function modelStatus(modelId: string, repo?: string | null): ModelStatus {
  try {
    const specs = downloadSpecs(modelId, repo);
    for (const r of specs.repos) checkRepoPath(r);
    for (const [r, f] of specs.files ?? []) checkRepoPath(r, f);
    if (!reposCached(specs)) return 'absent';
    const ladder = repo == null ? ladderArtifacts(modelId) : [];
    if (ladder.length > 0) {
      const anyRung = ladder.some((artifact) => {
        const [r, fname] = splitArtifact(artifact);
        return fname !== null && cached([r, fname]);
      });
      if (!anyRung) return 'absent';
    } else if (specs.files && !specs.files.every(cached)) {
      return 'absent';
    }
    if (!extraFileSpecs(modelId).every(cached)) return 'absent';
    return 'ready';
  } catch {
    return 'absent';
  }
}
