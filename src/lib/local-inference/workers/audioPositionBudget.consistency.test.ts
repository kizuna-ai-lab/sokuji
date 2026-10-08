import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Voxtral Realtime worker must stop generate() before transformers.js
 * runs a decoder step with no audio embedding.
 *
 * The library discovers an exhausted chunk iterator inside the next forward,
 * decodes on the text embedding alone and streams what it samples there — a
 * suffix token like "ished" glued to the end of the utterance, or a one-word
 * segment of it. The budget in `_shared/streaming-generation` counts audio
 * positions against sampled tokens; the worker has to feed it from its chunk
 * generator and its streamer, and hand generate() a stopping criterion built
 * on it (docs/superpowers/notes/2026-10-08-voxtral-realtime-ished-root-cause.md).
 */

const source = readFileSync(join(__dirname, 'voxtral-webgpu.worker.ts'), 'utf8');

describe('voxtral-webgpu.worker.ts audio-position budget', () => {
  it('counts the audio tokens of every chunk it yields', () => {
    expect(source).toMatch(/AudioPositionBudget/);
    expect(source.match(/\.addChunk\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('counts every token the streamer receives after the prompt', () => {
    expect(source).toMatch(/\.tokenSampled\(\)/);
  });

  it('passes generate() a stopping criterion built on the budget', () => {
    expect(source).toMatch(/StoppingCriteria/);
    expect(source).toMatch(/stopping_criteria:/);
    expect(source).toMatch(/\.exhausted\(/);
  });
});
