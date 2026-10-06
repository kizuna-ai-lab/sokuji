import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every worker that runs Silero VAD must build the model input through
 * `_shared/silero-input`, which puts the previous frame's last 64 samples in
 * front of each 512-sample frame.
 *
 * All seven VAD workers used to hand the model a bare `[1, VAD_FRAME_SAMPLES]`
 * tensor, each through its own copy of `vadInfer`. Silero v5 reads a frame
 * together with that context — its own wrapper and audio.cpp's port both feed
 * 576 samples — and without it the model detected 44% of meeting speech frames
 * instead of 90% and fired on tonal noise. The copies are enumerated from disk
 * so a new worker cannot bring the bare frame back.
 */

const WORKERS_DIR = __dirname;

const sileroWorkers = readdirSync(WORKERS_DIR)
  .filter(name => name.endsWith('.worker.ts'))
  .map(name => ({ name, source: readFileSync(join(WORKERS_DIR, name), 'utf8') }))
  .filter(({ source }) => source.includes('silero_vad'));

describe('Silero VAD input', () => {
  it('finds the VAD workers', () => {
    // Guards the scan itself: a rename that hid every worker would pass the rest.
    expect(sileroWorkers.map(w => w.name).sort()).toEqual([
      'cohere-transcribe-webgpu.worker.ts',
      'granite-speech-webgpu.worker.ts',
      'native-vad.worker.ts',
      'qwen3-asr-webgpu.worker.ts',
      'voxtral-3b-webgpu.worker.ts',
      'voxtral-webgpu.worker.ts',
      'whisper-webgpu.worker.ts',
    ]);
  });

  for (const { name, source } of sileroWorkers) {
    describe(name, () => {
      it('builds the model input with the shared context', () => {
        expect(source).toMatch(/from '\.\/_shared\/silero-input'/);
        expect(source).toMatch(/\[1, SILERO_INPUT_SAMPLES\]/);
      });

      it('never feeds a bare 512-sample frame', () => {
        expect(source).not.toMatch(/\[1, VAD_FRAME_SAMPLES\]/);
      });

      it('clears the context when it resets the LSTM state', () => {
        const reset = source.match(/function vadResetStates\(\)[^]*?\n\}/)?.[0] ?? '';
        expect(reset).toMatch(/\.reset\(\)/);
      });
    });
  }
});
