import { describe, it, expect } from 'vitest';
import { ZoomAIProviderConfig } from './ZoomAIProviderConfig';

describe('ZoomAIProviderConfig', () => {
  it('exposes exactly the 5 Scribe source languages', () => {
    const values = new ZoomAIProviderConfig().resolveSourceLanguages().map((l) => l.value).sort();
    expect(values).toEqual(['en-US', 'es-ES', 'it-IT', 'ja-JP', 'zh-CN']);
  });

  it('en-US allows many targets including zh-CN and ja-JP', () => {
    const t = new ZoomAIProviderConfig().resolveTargetLanguages('en-US').map((l) => l.value);
    expect(t).toContain('zh-CN');
    expect(t).toContain('ja-JP');
    expect(t).not.toContain('en-US');
  });

  it('non-English sources allow only en-US', () => {
    for (const src of ['zh-CN', 'ja-JP', 'es-ES', 'it-IT']) {
      const t = new ZoomAIProviderConfig().resolveTargetLanguages(src).map((l) => l.value);
      expect(t).toEqual(['en-US']);
    }
  });

  it('getConfig reports text-only always and no voices', () => {
    const cfg = new ZoomAIProviderConfig().getConfig();
    expect(cfg.capabilities.textOnlyCapability).toBe('always');
    expect(cfg.voices).toEqual([]);
    expect(cfg.id).toBe('zoom_ai');
  });
});
