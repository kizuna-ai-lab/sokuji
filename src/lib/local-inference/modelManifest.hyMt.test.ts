import { describe, it, expect } from 'vitest';
import {
  getManifestEntry,
  pickBestModel,
  type ModelManifestEntry,
} from './modelManifest';

describe('HY-MT1.5-1.8B manifest entry', () => {
  const entry = getManifestEntry('hy-mt15-1.8b-translation');

  it('exists in the manifest', () => {
    expect(entry).toBeDefined();
  });

  it('is a multilingual WebGPU translation model with hfModelId pointing at onnx-community', () => {
    expect(entry?.type).toBe('translation');
    expect(entry?.multilingual).toBe(true);
    expect(entry?.requiredDevice).toBe('webgpu');
    expect(entry?.hfModelId).toBe('onnx-community/HY-MT1.5-1.8B-ONNX');
    expect(entry?.translationWorkerType).toBe('hy-mt');
  });

  it('declares all 36 languages from the ONNX repo README', () => {
    const expected = [
      'zh', 'en', 'fr', 'pt', 'es', 'ja', 'tr', 'ru', 'ar', 'ko',
      'th', 'it', 'de', 'vi', 'ms', 'id', 'tl', 'hi', 'pl', 'cs',
      'nl', 'km', 'my', 'fa', 'gu', 'ur', 'te', 'mr', 'he', 'bn',
      'ta', 'uk', 'bo', 'kk', 'mn', 'ug',
    ];
    expect(entry?.languages).toEqual(expected);
    expect(entry?.languages.length).toBe(36);
  });

  it('exposes q4 and q4f16 variants with correct file lists', () => {
    const q4 = entry?.variants['q4'];
    const q4f16 = entry?.variants['q4f16'];
    expect(q4?.dtype).toBe('q4');
    expect(q4f16?.dtype).toBe('q4f16');
    expect(q4f16?.requiredFeatures).toEqual(['shader-f16']);

    // 5 shared metadata files + 2 onnx files per variant
    expect(q4?.files.length).toBe(7);
    expect(q4f16?.files.length).toBe(7);

    const q4Names = q4?.files.map(f => f.filename) ?? [];
    expect(q4Names).toContain('onnx/model_q4.onnx');
    expect(q4Names).toContain('onnx/model_q4.onnx_data');
    expect(q4Names).toContain('tokenizer.json');
    expect(q4Names).toContain('chat_template.jinja');

    const q4f16Names = q4f16?.files.map(f => f.filename) ?? [];
    expect(q4f16Names).toContain('onnx/model_q4f16.onnx');
    expect(q4f16Names).toContain('onnx/model_q4f16.onnx_data');
  });

  it('is marked recommended with sortOrder 1 (highest local-translation priority)', () => {
    expect(entry?.recommended).toBe(true);
    expect(entry?.sortOrder).toBe(1);
  });
});

describe('Translation model sortOrder migration', () => {
  it('demotes translategemma-4b to sortOrder 2', () => {
    const tg = getManifestEntry('translategemma-4b-translation');
    expect(tg?.sortOrder).toBe(2);
    expect(tg?.recommended).toBe(true);
  });

  it('demotes qwen3-0.6b to sortOrder 3', () => {
    const q = getManifestEntry('qwen3-0.6b-translation');
    expect(q?.sortOrder).toBe(3);
    expect(q?.recommended).toBe(true);
  });
});

describe('pickBestModel preference', () => {
  it('selects HY-MT1.5 over TranslateGemma and Qwen3 when all are recommended', () => {
    const hy = getManifestEntry('hy-mt15-1.8b-translation') as ModelManifestEntry;
    const tg = getManifestEntry('translategemma-4b-translation') as ModelManifestEntry;
    const q  = getManifestEntry('qwen3-0.6b-translation') as ModelManifestEntry;
    expect(pickBestModel([tg, q, hy])?.id).toBe('hy-mt15-1.8b-translation');
    expect(pickBestModel([hy, tg])?.id).toBe('hy-mt15-1.8b-translation');
  });
});
