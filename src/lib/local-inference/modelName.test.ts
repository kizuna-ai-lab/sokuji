import { describe, it, expect } from 'vitest';
import { shortenModelName } from './modelName';
import { MODEL_MANIFEST } from './modelManifest';

describe('shortenModelName', () => {
  it('strips runtime-qualifier noise, whole groups and mixed groups alike', () => {
    expect(shortenModelName('Whisper Large V3 Turbo (WebGPU, 99+ languages)')).toBe('Whisper Large V3 Turbo');
    expect(shortenModelName('Cohere Transcribe (WebGPU)')).toBe('Cohere Transcribe');
    expect(shortenModelName('Streaming Zipformer ZH (int8)')).toBe('Streaming Zipformer ZH');
    expect(shortenModelName('Moonshine Base ZH (quantized)')).toBe('Moonshine Base ZH');
  });

  it('keeps identity-bearing parens: directions, voice language/gender, Online', () => {
    expect(shortenModelName('Opus-MT (ja → en)')).toBe('Opus-MT (ja → en)');
    expect(shortenModelName('Opus-MT (Germanic ↔ Germanic)')).toBe('Opus-MT (Germanic ↔ Germanic)');
    expect(shortenModelName('Piper Talesyntese Medium (Danish, female)')).toBe('Piper Talesyntese Medium (Danish, female)');
    expect(shortenModelName('Edge TTS (Online)')).toBe('Edge TTS (Online)');
  });

  it('keeps the identity half of a mixed group', () => {
    expect(shortenModelName('Whisper Tiny (WebGPU, 99+ languages)')).toBe('Whisper Tiny');
    // Hypothetical mixed group: noise dropped, identity kept.
    expect(shortenModelName('Some TTS (WebGPU, Korean)')).toBe('Some TTS (Korean)');
  });

  it('an explicit shortName wins outright', () => {
    expect(shortenModelName('Whisper Tiny (WebGPU, 99+ languages)', 'Whisper Tiny (WebGPU)')).toBe('Whisper Tiny (WebGPU)');
  });

  it('shortening never CREATES a collision the full names did not already have', () => {
    // Same-type models may share a full name already (opus-mt-ja-en vs
    // opus-mt-jap-en are two repos for one pair) — that duplication is not
    // ours to fix here. The invariant: two models whose SHORT names collide
    // must have had colliding FULL names too.
    const byType = new Map<string, Map<string, string>>();
    for (const m of MODEL_MANIFEST) {
      const short = shortenModelName(m.name, m.shortName);
      const seen = byType.get(m.type) ?? new Map<string, string>();
      byType.set(m.type, seen);
      const priorFull = seen.get(short);
      if (priorFull !== undefined) {
        expect(priorFull, `shortening created a collision at '${short}' (${m.id})`).toBe(m.name);
      }
      seen.set(short, m.name);
    }
  });
});
