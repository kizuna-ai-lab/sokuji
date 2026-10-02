/**
 * Local model catalog — what the docs publish about each local model
 * (sokuji.kizuna.ai/docs/local-models): the manifest's facts a reader chooses
 * by, joined with the provenance and terms of its weights.
 *
 * scripts/export-local-models.ts writes it out as JSON for the docs site.
 */

import { MODEL_MANIFEST, type ModelManifestEntry, type ModelType } from './modelManifest';
import { BUNDLED_PROVENANCE, MODEL_PROVENANCE, type ModelProvenance } from './modelProvenance';

export interface CatalogVariant {
  /** The manifest's variant key, e.g. 'q4f16' or 'default'. */
  dtype: string;
  /** Total download size of the variant's files. */
  bytes: number;
  requiresShaderF16: boolean;
}

export interface CatalogModel extends ModelProvenance {
  id: string;
  name: string;
  type: ModelType;
  languages: string[];
  multilingual: boolean;
  sourceLang?: string;
  targetLang?: string;
  /** Where it runs: the CPU through WASM, the GPU through WebGPU, or an online service. */
  runtime: 'wasm' | 'webgpu' | 'cloud';
  streaming: boolean;
  variants: CatalogVariant[];
}

export interface LocalModelCatalog {
  appVersion: string;
  models: CatalogModel[];
  bundled: (ModelProvenance & { id: string })[];
}

const HF_BASE = 'https://huggingface.co/';

function toCatalogModel(entry: ModelManifestEntry): CatalogModel {
  const provenance = MODEL_PROVENANCE[entry.id];
  if (!provenance) throw new Error(`No provenance for manifest entry '${entry.id}'`);
  const hfUrl = entry.hfModelId
    ? `${HF_BASE}${entry.hfModelId}${entry.hfRevision ? `/tree/${entry.hfRevision}` : ''}`
    : undefined;
  return {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    languages: entry.languages,
    multilingual: entry.multilingual === true,
    sourceLang: entry.sourceLang,
    targetLang: entry.targetLang,
    runtime: entry.isCloudModel ? 'cloud' : entry.requiredDevice === 'webgpu' ? 'webgpu' : 'wasm',
    streaming: entry.type === 'asr-stream',
    variants: entry.isCloudModel ? [] : Object.entries(entry.variants).map(([dtype, variant]) => ({
      dtype,
      bytes: variant.files.reduce((sum, f) => sum + f.sizeBytes, 0),
      requiresShaderF16: variant.requiredFeatures?.includes('shader-f16') ?? false,
    })),
    ...provenance,
    via: provenance.via ?? entry.hfModelId,
    viaUrl: provenance.viaUrl ?? hfUrl,
  };
}

export function buildLocalModelCatalog(appVersion: string): LocalModelCatalog {
  return {
    appVersion,
    models: MODEL_MANIFEST.map(toCatalogModel),
    bundled: Object.entries(BUNDLED_PROVENANCE).map(([id, p]) => ({ id, ...p })),
  };
}
