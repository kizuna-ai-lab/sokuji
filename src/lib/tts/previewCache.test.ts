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

  it('clears only the given namespace, leaving every other source cached', () => {
    // The cache is shared across both halves of the preview feature (managed
    // Soniox's `soniox:<region>`/`managed:<region>` and Local Native's
    // `native:<modelId>`). A source-change effect that clears the whole map
    // would defeat the namespacing this cache module exists to provide.
    const soniox = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    const native = previewCacheKey('native:moss_tts_nano', 'custom:1', 'ja', 1.0);
    setCachedPreview(soniox, sample);
    setCachedPreview(native, sample);
    clearPreviewCache('soniox:us');
    expect(getCachedPreview(soniox)).toBeUndefined();
    expect(getCachedPreview(native)).toBe(sample);
  });

  it('a namespace that happens to be a prefix of another does not clear it', () => {
    // `soniox:us` must not also match `soniox:us-2` -- the split has to
    // respect the `|` separator, not do a bare string-prefix match.
    const a = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    const b = previewCacheKey('soniox:us-2', 'v1', 'ja', 1.0);
    setCachedPreview(a, sample);
    setCachedPreview(b, sample);
    clearPreviewCache('soniox:us');
    expect(getCachedPreview(a)).toBeUndefined();
    expect(getCachedPreview(b)).toBe(sample);
  });
});
