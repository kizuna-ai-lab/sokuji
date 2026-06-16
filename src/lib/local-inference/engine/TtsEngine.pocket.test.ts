import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the most recent mock worker so the test can drive its onmessage.
let lastWorker: MockWorker;
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  constructor() { lastWorker = this; }
  postMessage(msg: unknown) {
    this.posted.push(msg);
    if ((msg as { type: string }).type === 'init') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', loadTimeMs: 1, numSpeakers: 1, sampleRate: 24000, backend: 'wasm' } } as MessageEvent));
    }
  }
  terminate() {}
}
vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);

import { TtsEngine } from './TtsEngine';

describe('TtsEngine — pocket', () => {
  beforeEach(() => { lastWorker = undefined as unknown as MockWorker; });

  it('inits the pocket model and posts a pocket init message', async () => {
    const engine = new TtsEngine();
    const info = await engine.init('pocket-tts');
    expect(info.sampleRate).toBe(24000);
    const init = lastWorker.posted[0] as { type: string; ttsConfig: { lsdSteps: number } };
    expect(init.type).toBe('init');
    expect(init.ttsConfig.lsdSteps).toBe(1);
  });

  it('generateWithReference posts reference audio and resolves with the result', async () => {
    const engine = new TtsEngine();
    await engine.init('pocket-tts');
    const ref = new Float32Array([0.1, 0.2, 0.3]);
    const p = engine.generateWithReference('hello', ref, 24000, 1.0);
    const gen = lastWorker.posted[1] as { type: string; referenceAudio: Float32Array };
    expect(gen.type).toBe('generate');
    expect(gen.referenceAudio).toEqual(ref);
    // Drive the worker result.
    const out = new Float32Array([0.5, 0.6]);
    lastWorker.onmessage?.({ data: { type: 'result', samples: out, sampleRate: 24000, generationTimeMs: 5 } } as MessageEvent);
    await expect(p).resolves.toMatchObject({ sampleRate: 24000, generationTimeMs: 5 });
  });
});
