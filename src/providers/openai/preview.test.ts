import { describe, it, expect } from 'vitest';
import type { ClipDeps } from '../../lib/tts/clip';
import { previewRealtimeVoice } from './preview';

const decoded = { audio: new Float32Array([0.1]), sampleRate: 48000 };

function deps(): ClipDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: (async (url: string) => { calls.push(url); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as Response; }) as unknown as typeof fetch,
    decode: async () => decoded,
  };
}

describe('previewRealtimeVoice (preset voice preview)', () => {
  it("plays the voice's published sample", async () => {
    const d = deps();
    expect(await previewRealtimeVoice('marin', undefined, d)).toBe(decoded);
    expect(d.calls).toEqual(['https://cdn.openai.com/API/voice-previews/marin.flac']);
  });

  it('returns null without fetching for a voice it does not list', async () => {
    const d = deps();
    expect(await previewRealtimeVoice('fable', undefined, d)).toBeNull();
    expect(d.calls).toEqual([]);
  });
});
