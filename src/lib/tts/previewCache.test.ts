import { describe, it, expect, beforeEach } from 'vitest';
import { previewCacheKey, getCachedPreview, setCachedPreview, clearPreviewCache } from './previewCache';

const sample = { audio: new Float32Array([0.1]), sampleRate: 24000 };

describe('previewCache', () => {
  beforeEach(() => clearPreviewCache());

  it('returns what was stored under the same key', () => {
    const k = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    setCachedPreview(k, sample);
    expect(getCachedPreview(k)).toBe(sample);
  });

  it('namespaces by source, so the same id under two sources cannot collide', () => {
    // `custom:1` means different clips under different TTS models
    // (voiceStoreFor(custom, modelId)); the old useRef was unambiguous only
    // because it lived inside one section bound to one source.
    const a = previewCacheKey('native:moss_tts_nano', 'custom:1', 'ja', 1.0);
    const b = previewCacheKey('native:supertonic', 'custom:1', 'ja', 1.0);
    setCachedPreview(a, sample);
    expect(getCachedPreview(b)).toBeUndefined();
  });

  it('distinguishes language and speed', () => {
    const k = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    setCachedPreview(k, sample);
    expect(getCachedPreview(previewCacheKey('soniox:us', 'v1', 'en', 1.0))).toBeUndefined();
    expect(getCachedPreview(previewCacheKey('soniox:us', 'v1', 'ja', 1.2))).toBeUndefined();
  });

  it('survives across callers, which is the whole point', () => {
    // The cache outlives any one component: a second listen after closing and
    // reopening the panel must not take another lease and spend again.
    const k = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    setCachedPreview(k, sample);
    clearPreviewCache();
    expect(getCachedPreview(k)).toBeUndefined();
    setCachedPreview(k, sample);
    expect(getCachedPreview(k)).toBe(sample);
  });
});
