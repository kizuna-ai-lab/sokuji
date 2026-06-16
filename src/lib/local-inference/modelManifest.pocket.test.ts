import { describe, it, expect } from 'vitest';
import { getManifestEntry, getManifestByType } from './modelManifest';

describe('pocket-tts manifest entry', () => {
  it('is registered as a tts/pocket model', () => {
    const entry = getManifestEntry('pocket-tts');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('tts');
    expect(entry!.engine).toBe('pocket');
  });

  it('appears in the tts model list', () => {
    const ids = getManifestByType('tts').map((m) => m.id);
    expect(ids).toContain('pocket-tts');
  });

  it('defaults lsdSteps to 1', () => {
    const entry = getManifestEntry('pocket-tts');
    expect(entry!.ttsConfig?.lsdSteps).toBe(1);
  });
});
