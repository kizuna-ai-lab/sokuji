import { describe, expect, it } from 'vitest';
import {
  getManifestEntry,
  getModelDownloadUrl,
  selectVariant,
} from './modelManifest';

describe('Supertonic 3 manifest entry', () => {
  const entry = getManifestEntry('supertonic-3');

  it('is registered', () => {
    expect(entry).toBeDefined();
  });

  it('has the expected type/engine/recommended', () => {
    expect(entry!.type).toBe('tts');
    expect(entry!.engine).toBe('supertonic');
    expect(entry!.recommended).toBe(true);
  });

  it('declares numSpeakers = 10 (presets only)', () => {
    expect(entry!.numSpeakers).toBe(10);
  });

  it('uses Supertone/supertonic-3 as the HF model id', () => {
    expect(entry!.hfModelId).toBe('Supertone/supertonic-3');
  });

  it('selects the only variant (default) on any device', () => {
    expect(selectVariant(entry!, [])).toBe('default');
    expect(selectVariant(entry!, ['webgpu'])).toBe('default');
  });

  it('lists 16 files (4 onnx + 2 json + 10 voice json)', () => {
    expect(entry!.variants.default.files).toHaveLength(16);
  });

  it('lists 31 supported languages', () => {
    expect(entry!.ttsConfig!.supportedLanguages).toHaveLength(31);
    expect(entry!.ttsConfig!.supportedLanguages).toContain('en');
    expect(entry!.ttsConfig!.supportedLanguages).not.toContain('zh');
  });

  it('lists 10 preset voices with sids 0..9 in F-then-M order', () => {
    const presets = entry!.ttsConfig!.presetVoices!;
    expect(presets).toHaveLength(10);
    expect(presets.map(p => p.sid)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(presets[0].name).toBe('Sarah');
    expect(presets[7].name).toBe('Robert');
    expect(presets[7].file).toBe('voice_styles/M3.json');
  });

  it('default sid is 7 (Robert)', () => {
    expect(entry!.ttsConfig!.defaultSid).toBe(7);
  });

  it('totalStep is 16', () => {
    expect(entry!.ttsConfig!.totalStep).toBe(16);
  });

  it('total file size is in the [382MiB, 383MiB] envelope', () => {
    const total = entry!.variants.default.files.reduce((s, f) => s + f.sizeBytes, 0);
    expect(total).toBeGreaterThanOrEqual(382 * 1024 * 1024);
    expect(total).toBeLessThanOrEqual(383 * 1024 * 1024);
  });

  it('builds the expected HF download URL', () => {
    const url = getModelDownloadUrl(entry!, 'onnx/duration_predictor.onnx');
    expect(url).toBe(
      'https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx/duration_predictor.onnx',
    );
  });
});
