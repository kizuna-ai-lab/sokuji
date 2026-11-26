/**
 * Imports a model the person downloaded themselves (where the hub cannot be reached): the files they name go into the
 * hub cache exactly where a download would have put them — blobs/<sha256>, a snapshot link, the `main` ref — so the
 * model is "ready" afterwards, and a later online download finds the blob and only adds the link. Every card is one
 * pinned file (plus a speech card's preset), so what to expect is known offline: the file names, from `downloadSpecs`.
 * A file is accepted when it is the one named, a GGUF with a readable header, and — where the published catalog lists its hash — the
 * published bytes; it is hashed here, so a wrong or truncated file never reaches the cache.
 */
import { catalog } from '@handy-computer/models';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GgufError, readHeader } from '../ggufHeader';
import { checkRepoPath, repoDir, writeRef, writeSnapshotLink } from './hfCache';
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

export class ImportError extends Error {}

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

/** Streams the file through sha256, reporting each run of bytes. */
async function sha256Of(file: string, onBytes: (n: number) => void, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 << 20 })) {
    if (signal?.aborted) throw new ImportError('cancelled');
    hash.update(chunk as Buffer);
    onBytes((chunk as Buffer).length);
  }
  return hash.digest('hex');
}

/** The commit a snapshot is filed under: the catalog's pin where it lists the file, else one made from the bytes. */
const commitFor = (repo: string, file: string, sha256: string, known?: KnownFile): string =>
  known?.revision ?? createHash('sha1').update(`${repo}/${file}@${sha256}`).digest('hex');

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
  if (!specs.files || specs.files.length === 0) throw new ImportError(`${modelId} cannot be imported: it is not a single published file`);
  const byName = new Map(paths.map((p) => [path.basename(p), p]));
  const wanted = specs.files.map(([repo, file]) => ({ repo, file, name: path.posix.basename(file), from: byName.get(path.posix.basename(file)) }));
  const missing = wanted.filter((w) => w.from === undefined).map((w) => w.name);
  if (missing.length > 0) throw new ImportError(`missing: ${missing.join(', ')}`);

  let total = 0;
  for (const w of wanted) {
    checkRepoPath(w.repo, w.file);
    const st = fs.statSync(w.from!, { throwIfNoEntry: false });
    if (!st?.isFile() || st.size === 0) throw new ImportError(`${w.name} is not a readable file`);
    if (w.name.endsWith('.gguf') && !(await isGguf(w.from!))) throw new ImportError(`${w.name} is not a GGUF file`);
    total += st.size * 2;   // read to hash it, then read again to copy it
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

  try {
    for (const w of wanted) {
      const from = w.from!;
      const sha = await sha256Of(from, tick, signal);
      const known = knownFile(w.repo, w.file);
      if (known && known.sha256 !== sha) {
        throw new ImportError(`${w.name} is not the published file (its sha256 is ${sha.slice(0, 12)}…, expected ${known.sha256.slice(0, 12)}…): download it again`);
      }
      const dir = repoDir(w.repo);
      const blob = path.join(dir, 'blobs', sha);
      if (!fs.existsSync(blob)) {
        fs.mkdirSync(path.dirname(blob), { recursive: true });
        const incomplete = `${blob}.incomplete`;
        fs.rmSync(incomplete, { force: true });
        try {
          await fs.promises.copyFile(from, incomplete, fs.constants.COPYFILE_FICLONE);
        } catch (e) {
          fs.rmSync(incomplete, { force: true });
          throw e;
        }
        if (signal?.aborted) {
          fs.rmSync(incomplete, { force: true });
          return 'cancelled';
        }
        fs.renameSync(incomplete, blob);
      }
      tick(fs.statSync(blob).size);
      const commit = commitFor(w.repo, w.file, sha, known);
      writeSnapshotLink(w.repo, commit, w.file, sha);
      writeRef(w.repo, 'main', commit);
    }
  } catch (e) {
    if (e instanceof ImportError && e.message === 'cancelled') return 'cancelled';
    throw e;
  }
  await send({ type: 'model_progress', model: modelId, downloaded: total, total });
  return 'ready';
}
