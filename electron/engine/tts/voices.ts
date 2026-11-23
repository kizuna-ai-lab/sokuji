/**
 * The built-in voices of a TTS card (port of tts_voices.list_builtin_voices): the loaded model's own presets when it
 * is the card asked about; otherwise, without loading anything, supertonic's fixed preset names, or pocket_tts's
 * preset files read from the cached snapshot. Every other family lists none until it is loaded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { splitArtifact, ttsModel } from '../catalog';
import { snapshotPath } from '../models/hfCache';

const SUPERTONIC_PRESETS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
/** family → (the presets' directory next to the GGUF, their extension). */
const LOAD_FREE_PRESETS: Readonly<Record<string, readonly [string, string]>> = { pocket_tts: ['embeddings', '.safetensors'] };

/** What the listing reads, replaceable in tests (Python's monkeypatching of catalog.tts_model and the snapshot lookup). */
const DEFAULTS = {
  ttsModel: (id: string): { family: string; deployments: ReadonlyArray<{ artifact: string }> } | null => ttsModel(id),
  /** The cached snapshot root holding `subdir` of `repo`, or null. */
  scopedSnapshotDir: (repo: string, _subdir: string): string | null => snapshotPath(repo),
};
export const voicesSeams = { ...DEFAULTS };
export function restoreVoicesSeams(): void {
  Object.assign(voicesSeams, DEFAULTS);
}

export interface VoicesEngine {
  readonly isLoaded: boolean;
  readonly modelId: string | null;
  listBuiltinVoices(): Promise<string[]> | string[];
}

export async function listBuiltinVoices(modelId: string | null = null, engine: VoicesEngine | null = null): Promise<string[]> {
  if (engine?.isLoaded && (modelId === null || modelId === engine.modelId)) return [...(await engine.listBuiltinVoices())];
  const card = modelId ? voicesSeams.ttsModel(modelId) : null;
  const family = card?.family ?? '';
  if (family === 'supertonic') return [...SUPERTONIC_PRESETS];
  const layout = LOAD_FREE_PRESETS[family];
  if (layout === undefined || !card || card.deployments.length === 0) return [];
  const [sub, suffix] = layout;
  const [repo, fname] = splitArtifact(card.deployments[0].artifact);
  if (!fname) return [];
  const slash = fname.lastIndexOf('/');
  const modelDir = slash === -1 ? '' : fname.slice(0, slash);
  const scoped = modelDir ? `${modelDir}/${sub}` : sub;
  const root = voicesSeams.scopedSnapshotDir(repo, scoped);
  if (root === null) return [];
  const dir = path.join(root, ...scoped.split('/'));
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(suffix)).map((n) => n.slice(0, -suffix.length)).sort();
}
