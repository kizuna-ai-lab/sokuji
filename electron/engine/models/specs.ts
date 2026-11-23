/**
 * What a model downloads (port of native_models.py's download_specs / model_size). Every catalog card is one pinned
 * file ("org/repo/dir/file.gguf"), plus pocket-tts-en's preset next to it; an id that is not a card is a bare repo id,
 * fetched whole.
 */
import { asrModel, splitArtifact, translateModel, ttsModel, type TtsModel } from '../catalog';
import { fileMetadata, listRepoTree, type HubOptions } from './hub';

export interface DownloadSpecs {
  repos: string[];
  urls: string[];
  /** (repo, repo-relative path) pairs; absent for a whole-repo spec. */
  files?: Array<[string, string]>;
  /** fnmatch globs a whole-repo listing drops. No spec sets it today; the filter stays for parity. */
  ignore?: string[];
}

/** Python's fnmatch.fnmatchcase: `*` spans `/`, `?` is one character, `[…]` / `[!…]` a class. */
function globRegex(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) {
        out += '\\[';
      } else {
        let body = pattern.slice(i + 1, end).replace(/\\/g, '\\\\');
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        else if (body.startsWith('^')) body = `\\${body}`;
        out += `[${body}]`;
        i = end;
      }
    } else out += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 's');
}

/** True if `filename` matches any ignore glob. */
export function ignored(filename: string, patterns: Iterable<string>): boolean {
  for (const p of patterns) if (globRegex(p).test(filename)) return true;
  return false;
}

/** A TTS card's preset assets (pocket-tts-en's embeddings/alba.safetensors), next to `fname` in the same repo. */
function ttsExtraFiles(card: TtsModel, fname: string): string[] {
  if (card.extraFiles.length === 0) return [];
  const slash = fname.lastIndexOf('/');
  const dir = slash === -1 ? '' : fname.slice(0, slash);
  return card.extraFiles.map(([name]) => (dir ? `${dir}/${name}` : name));
}

function baseSpecs(modelId: string): DownloadSpecs {
  const tts = modelId ? ttsModel(modelId) : null;
  if (tts !== null) {
    const [repo, fname] = splitArtifact(tts.deployments[0].artifact);
    const file = fname ?? '';
    return { repos: [], urls: [], files: [[repo, file], ...ttsExtraFiles(tts, file).map((e): [string, string] => [repo, e])] };
  }
  // The empty id is the implicit default translation model.
  const tr = translateModel(modelId || 'qwen2.5-0.5b');
  if (tr !== null) {
    const [repo, fname] = splitArtifact(tr.deployments[0].artifact);
    return { repos: [], urls: [], files: [[repo, fname ?? '']] };
  }
  const asr = asrModel(modelId);
  if (asr !== null) {
    const [repo, fname] = splitArtifact(asr.deployments[0].artifact);
    if (fname) return { repos: [], urls: [], files: [[repo, fname]] };
    return { repos: [repo], urls: [] };
  }
  return { repos: [modelId], urls: [] };
}

/**
 * A model's download sources. `repo` is the chosen variant's artifact (a single file, carrying a TTS card's presets)
 * or a bare repo id; without it, the card's default rung.
 */
export function downloadSpecs(modelId: string, repo?: string | null): DownloadSpecs {
  if (repo) {
    const [repo2, fname] = splitArtifact(repo);
    if (fname) {
      const tts = modelId ? ttsModel(modelId) : null;
      const extra = tts !== null ? ttsExtraFiles(tts, fname) : [];
      return { repos: [], urls: [], files: [[repo2, fname], ...extra.map((e): [string, string] => [repo2, e])] };
    }
    return { repos: [repo], urls: [] };
  }
  return baseSpecs(modelId);
}

const SIZE_CACHE = new Map<string, number>();

/** The spec a size lookup reads, patched by tests (Python's monkeypatching of download_specs). */
const SIZE_DEFAULTS = { downloadSpecs: (modelId: string): DownloadSpecs => downloadSpecs(modelId) };
export const sizeSeams = { ...SIZE_DEFAULTS };

export function resetSizeCacheForTests(): void {
  SIZE_CACHE.clear();
  Object.assign(sizeSeams, SIZE_DEFAULTS);
}

function catalogSize(modelId: string): number | null {
  const card = asrModel(modelId) ?? translateModel(modelId) ?? ttsModel(modelId);
  return card && card.sizeBytes ? card.sizeBytes : null;
}

/** The download size known without the network: the catalog row's, or one looked up before; else null. */
export function modelSize(modelId: string): number | null {
  return catalogSize(modelId) ?? SIZE_CACHE.get(modelId) ?? null;
}

/**
 * The download size in bytes: the catalog row's; else, looked up once on the hub — one file's size for an artifact,
 * the repo's files (less the ignored ones) for a bare repo id. A failed lookup counts as 0, as in Python.
 */
export async function modelSizeAsync(modelId: string, opts: HubOptions = {}): Promise<number> {
  const known = catalogSize(modelId);
  if (known !== null) return known;
  const cached = SIZE_CACHE.get(modelId);
  if (cached !== undefined) return cached;
  let total = 0;
  const [repo, fname] = splitArtifact(modelId);
  if (fname) {
    try {
      total = (await fileMetadata(repo, fname, opts)).size ?? 0;
    } catch {
      total = 0;
    }
  } else {
    const specs = sizeSeams.downloadSpecs(modelId);
    const ignore = specs.ignore ?? [];
    for (const r of specs.repos) {
      try {
        for (const entry of await listRepoTree(r, opts)) if (!ignored(entry.path, ignore)) total += entry.size;
      } catch {
        // an unreachable repo adds nothing
      }
    }
  }
  SIZE_CACHE.set(modelId, total);
  return total;
}

/** Every quant rung's artifact of a multi-quant card, in rank order; [] for a single-rung card or an unknown id. */
export function ladderArtifacts(modelId: string): string[] {
  const card = modelId ? asrModel(modelId) ?? translateModel(modelId) ?? ttsModel(modelId) : null;
  if (card === null) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of card.deployments) {
    if (seen.has(d.computeType)) continue;
    seen.add(d.computeType);
    out.push(d.artifact);
  }
  return out.length > 1 ? out : [];
}

/** A TTS card's preset assets as (repo, path) pairs next to its default rung; [] for every other card. */
export function extraFileSpecs(modelId: string): Array<[string, string]> {
  const tts = modelId ? ttsModel(modelId) : null;
  if (tts === null || tts.extraFiles.length === 0) return [];
  const [repo, fname] = splitArtifact(tts.deployments[0].artifact);
  return ttsExtraFiles(tts, fname ?? '').map((e): [string, string] => [repo, e]);
}

/** Every rung's files of a TTS card (each quant plus its presets), for a whole-model delete. */
export function ttsRungFiles(modelId: string): Array<[string, string]> {
  const tts = modelId ? ttsModel(modelId) : null;
  if (tts === null) return [];
  const out: Array<[string, string]> = [];
  for (const d of tts.deployments) {
    const [repo, fname] = splitArtifact(d.artifact);
    if (fname === null) continue;
    out.push([repo, fname], ...ttsExtraFiles(tts, fname).map((e): [string, string] => [repo, e]));
  }
  return out;
}
