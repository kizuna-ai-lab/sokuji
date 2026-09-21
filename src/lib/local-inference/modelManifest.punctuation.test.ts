import { describe, it, expect } from 'vitest';
import { MODEL_MANIFEST, getManifestEntry, getManifestByType, getModelSizeMb } from './modelManifest';

const IDS = ['punct-zh-fireredpunc', 'punct-en-edge', 'punct-multi-sat'];

describe('punctuation manifest entries', () => {
  it('registers exactly three punctuation models', () => {
    expect(getManifestByType('punctuation').map((m) => m.id).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)('%s is hosted from a pinned revision of our own mirror', (id) => {
    const entry = getManifestEntry(id)!;
    expect(entry.type).toBe('punctuation');
    // cdnPath is deliberately unused: getModelDownloadUrl buckets a cdnPath
    // entry as TTS-or-else-ASR, so a punctuation model would silently resolve
    // against the ASR dataset base.
    expect(entry.cdnPath).toBeUndefined();
    expect(entry.hfModelId).toMatch(/^jiangzhuo9357\//);
    expect(entry.hfRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(entry.variants)).toEqual(['default']);
    expect(entry.variants.default.requiredFeatures).toBeUndefined();
    expect(entry.requiredDevice).toBeUndefined();
  });

  it("spells FireRedPunc's Cantonese support 'cantonese', not 'yue' — the app's language list (src/utils/languages.ts) has no 'yue' key, and six sibling manifest entries already use 'cantonese'", () => {
    expect(getManifestEntry('punct-zh-fireredpunc')!.languages).toEqual(['zh', 'cantonese']);
  });

  it('pins the other two entries\' language lists', () => {
    expect(getManifestEntry('punct-en-edge')!.languages).toEqual(['en']);
    expect(getManifestEntry('punct-multi-sat')!.languages).toEqual(['multilingual']);
  });

  it('carries the measured file sizes', () => {
    const zh = getManifestEntry('punct-zh-fireredpunc')!;
    expect(zh.variants.default.files).toEqual([
      { filename: 'punc.q8w.onnx', sizeBytes: 162_771_205 },
      { filename: 'tokenizer.json', sizeBytes: 268_961 },
      { filename: 'out_dict', sizeBytes: 33 },
    ]);
    const en = getManifestEntry('punct-en-edge')!;
    expect(en.variants.default.files).toEqual([
      { filename: 'model.int8.onnx', sizeBytes: 7_490_500 },
      { filename: 'bpe.vocab', sizeBytes: 149_430 },
    ]);
    const sat = getManifestEntry('punct-multi-sat')!;
    expect(sat.variants.default.files).toEqual([
      { filename: 'model.onnx', sizeBytes: 241_945_842 },
      { filename: 'tokenizer.json', sizeBytes: 9_096_718 },
    ]);
  });

  it('reports the sizes the settings section will show', () => {
    // getModelSizeMb is Math.round(sum(sizeBytes) / 1_048_576). Computed from
    // the byte counts above, each of which was checked against the real file:
    //   163,040,199 -> 155.4873 -> 155
    //     7,639,930 ->   7.2861 ->   7
    //   251,042,560 -> 239.4128 -> 239
    expect(getModelSizeMb(getManifestEntry('punct-zh-fireredpunc')!)).toBe(155);
    expect(getModelSizeMb(getManifestEntry('punct-en-edge')!)).toBe(7);
    expect(getModelSizeMb(getManifestEntry('punct-multi-sat')!)).toBe(239);
  });

  it('keeps punctuation models out of every resolver pool', () => {
    // Stage is a separate union from ModelType, so this is structural, but
    // pin it: a punctuation model must never be offered as an engine.
    for (const id of IDS) {
      expect(MODEL_MANIFEST.find((m) => m.id === id)!.asrEngine).toBeUndefined();
      expect(MODEL_MANIFEST.find((m) => m.id === id)!.engine).toBeUndefined();
      expect(MODEL_MANIFEST.find((m) => m.id === id)!.translationWorkerType).toBeUndefined();
    }
  });
});
