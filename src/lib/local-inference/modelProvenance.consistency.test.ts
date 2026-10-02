// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MODEL_MANIFEST } from './modelManifest';
import { MODEL_PROVENANCE, BUNDLED_PROVENANCE, type ModelProvenance } from './modelProvenance';

// The docs page that lists every local model (sokuji.kizuna.ai/docs/local-models,
// kizuna-ai-lab/sokuji#584) is generated from these rows, so a model added to
// the manifest without its provenance would be offered with no stated terms.

const rows = Object.entries(MODEL_PROVENANCE);

describe('model provenance', () => {
  it('covers every manifest entry', () => {
    const missing = MODEL_MANIFEST.map((m) => m.id).filter((id) => !(id in MODEL_PROVENANCE));
    expect(missing).toEqual([]);
  });

  it('has no row for a model the manifest no longer lists', () => {
    const ids = new Set(MODEL_MANIFEST.map((m) => m.id));
    expect(rows.map(([id]) => id).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('marks exactly the cloud entries as cloud', () => {
    for (const m of MODEL_MANIFEST) {
      expect({ id: m.id, cloud: MODEL_PROVENANCE[m.id]?.tier === 'cloud' })
        .toEqual({ id: m.id, cloud: m.isCloudModel === true });
    }
  });

  it('explains every restricted or unlicensed model', () => {
    // Restricted and unlicensed models stay in the catalog, each with a note
    // saying what its terms restrict (decided on #584).
    const silent = rows
      .filter(([, p]) => p.tier !== 'open' && !p.note?.trim())
      .map(([id]) => id);
    expect(silent).toEqual([]);
  });

  it('names the source archive of every package we host ourselves', () => {
    // A self-hosted package is our own rebuild of a sherpa-onnx archive; the
    // manifest's cdnPath does not say which one, so the row must.
    const unnamed = MODEL_MANIFEST
      .filter((m) => m.cdnPath && !MODEL_PROVENANCE[m.id]?.via)
      .map((m) => m.id);
    expect(unnamed).toEqual([]);
  });

  it('links each field to one https URL', () => {
    const all: [string, ModelProvenance][] = [...rows, ...Object.entries(BUNDLED_PROVENANCE)];
    const bad = all.flatMap(([id, p]) =>
      [p.upstreamUrl, p.viaUrl, p.licenseUrl]
        .filter((u): u is string => u !== undefined && !/^https:\/\/\S+$/.test(u))
        .map((u) => `${id}: ${u}`));
    expect(bad).toEqual([]);
  });
});
