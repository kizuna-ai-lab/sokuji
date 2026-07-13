/**
 * Manual import helpers — pure logic for matching user-provided files against a
 * model's expected file list, plus the structured error the import surfaces.
 *
 * Kept dependency-free (no manifest/storage imports) so the matching rules are
 * trivially unit-testable; the manifest-coupled orchestration lives in
 * ModelManager.importModelFiles.
 */

/** Thrown when an import is incomplete: some required files are still missing. */
export class ModelImportError extends Error {
  /** Expected files that were neither provided nor already stored. */
  missing: string[];
  /** Provided files that matched no expected file (informational). */
  unexpected: string[];
  constructor(missing: string[], unexpected: string[] = []) {
    super(`Missing ${missing.length} required file(s): ${missing.join(', ')}`);
    this.name = 'ModelImportError';
    this.missing = missing;
    this.unexpected = unexpected;
  }
}

export interface MatchResult {
  /** expectedFilename → the providedKey that satisfies it. */
  matched: Record<string, string>;
  /** Expected files with no provided match. */
  missing: string[];
  /** Provided keys that matched no expected file. */
  unexpected: string[];
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Match provided file keys to a model's expected filenames. Each provided key is
 * used at most once. Match precedence per expected file:
 *   1. exact path equality           (`onnx/a.onnx` === `onnx/a.onnx`)
 *   2. relative-path suffix          (dir pick: `repo/onnx/a.onnx` ends with `/onnx/a.onnx`)
 *   3. basename equality             (flat multi-file pick: `a.onnx`)
 */
export function matchImportedFiles(expected: string[], providedKeys: string[]): MatchResult {
  const consumed = new Set<string>();
  const matched: Record<string, string> = {};
  const missing: string[] = [];

  const pick = (predicate: (key: string) => boolean): string | undefined =>
    providedKeys.find((key) => !consumed.has(key) && predicate(key));

  for (const exp of expected) {
    const hit =
      pick((key) => key === exp)
      ?? pick((key) => key.endsWith('/' + exp))
      ?? pick((key) => basename(key) === basename(exp));
    if (hit !== undefined) {
      matched[exp] = hit;
      consumed.add(hit);
    } else {
      missing.push(exp);
    }
  }

  const unexpected = providedKeys.filter((key) => !consumed.has(key));
  return { matched, missing, unexpected };
}

// ─── Download-command guidance ───────────────────────────────────────────────

export type CommandTab = 'hf' | 'curl' | 'wget';

/** One expected file: its repo-relative path and full download URL. */
export interface DownloadCommandFile {
  filename: string;
  url: string;
}

/**
 * Build the copy-paste command the import dialog shows for obtaining files.
 *
 * NOTE on `hf`: `hf download`'s `--include` takes a SINGLE glob; listing files
 * after it makes them positional FILENAMES and silently ignores `--include`
 * (dropping the first listed file). So we pass every file positionally, which is
 * also the documented form (`hf download REPO config.json tokenizer.json`).
 */
export function buildDownloadCommand(
  tab: CommandTab,
  repo: string | undefined,
  localDir: string,
  files: readonly DownloadCommandFile[],
): string {
  if (tab === 'hf' && repo) {
    const names = files.map((f) => `  ${f.filename}`).join(' \\\n');
    return `# Disable Xet if the CDN is blocked on your network\n`
      + `HF_HUB_DISABLE_XET=1 hf download ${repo} \\\n`
      + `  --local-dir ${localDir} \\\n`
      + names;
  }
  if (tab === 'wget') {
    // HF resolve URL path is /org/repo/resolve/main/<file>: 4 directory segments
    // before the file. --cut-dirs=4 strips exactly those, preserving any onnx/
    // subdir; over-cutting flattens onnx/x.onnx into the root and breaks layout.
    return `# run inside an empty "${localDir}" folder\n`
      + files.map((f) => `wget -x -nH --cut-dirs=4 ${f.url}`).join('\n');
  }
  // curl (default / fallback, incl. self-hosted models with no HF repo)
  return files.map((f) => `curl -L --create-dirs -o ${localDir}/${f.filename} \\\n  ${f.url}`).join('\n');
}

/** Minimal shape of a picked file — a Blob plus its display name and (for dir picks) relative path. */
export interface NamedBlob extends Blob {
  name: string;
  webkitRelativePath?: string;
}

/**
 * Build the providedKey → Blob map an import consumes. Directory picks expose a
 * `webkitRelativePath` (preferred, preserves the `onnx/` subpath); flat picks
 * only have `name`.
 */
export function filesToImportMap(files: ArrayLike<NamedBlob>): Map<string, Blob> {
  const map = new Map<string, Blob>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const key = file.webkitRelativePath && file.webkitRelativePath.length > 0
      ? file.webkitRelativePath
      : file.name;
    map.set(key, file);
  }
  return map;
}
