import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DETECTOR_WORKER_TYPES } from '../../turn/turnDetection';

const WORKERS_DIR = __dirname;
const SHARED_DIR = join(WORKERS_DIR, '_shared');

/** Workers that still run a FrameProcessor of their own, and why. */
const EXEMPT: Record<string, string> = {
  'native-vad.worker.ts': "Local Native's, until step 4",
  'voxtral-webgpu.worker.ts': "Voxtral 4B's, until step 3",
};

const read = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8');

/** Non-test `.ts` files of a directory: `*.test.ts` is excluded, `*.testing.ts` is not. */
const sources = (dir: string, prefix: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ path: `${prefix}${name}`, source: read(dir, name) }));

const frameProcessorUsers = [...sources(WORKERS_DIR, ''), ...sources(SHARED_DIR, '_shared/')]
  .filter(({ source }) => source.includes('new FrameProcessor('))
  .map(({ path }) => path);

const detectorWorkers = DETECTOR_WORKER_TYPES.map((type) => ({ name: `${type}.worker.ts`, source: read(WORKERS_DIR, `${type}.worker.ts`) }));

describe('who runs a FrameProcessor', () => {
  it('is the detector core, the legacy loop kept for the replay, and the two exempt workers', () => {
    expect(frameProcessorUsers.sort()).toEqual(
      ['_shared/turn-detector-core.ts', '_shared/legacy-vad-loop.testing.ts', ...Object.keys(EXEMPT)].sort(),
    );
  });

  for (const [name, why] of Object.entries(EXEMPT)) {
    it(`${name} stays out of the gate: ${why}`, () => {
      expect(read(WORKERS_DIR, name)).not.toMatch(/_shared\/turn-gate/);
    });
  }
});

describe('the detector-type workers decode the detector\'s segments and run no VAD of their own', () => {
  it('finds them', () => {
    // Guards the list itself: an empty one would pass every test below.
    expect(detectorWorkers.map((w) => w.name).sort()).toEqual([
      'cohere-transcribe-webgpu.worker.ts',
      'granite-speech-webgpu.worker.ts',
      'qwen3-asr-webgpu.worker.ts',
      'voxtral-3b-webgpu.worker.ts',
      'whisper-webgpu.worker.ts',
    ]);
  });

  for (const { name, source } of detectorWorkers) {
    describe(name, () => {
      it('imports no VAD, gate, Silero model or wasm-only runtime, and has no processingVad', () => {
        expect(source).not.toContain('@ricky0123/vad-web');
        expect(source).not.toContain('_shared/turn-gate');
        expect(source).not.toContain('silero_vad');
        expect(source).not.toContain('onnxruntime-all');
        expect(source).not.toContain('processingVad');
      });

      it("takes the detector's segments from its init message's port", () => {
        expect(source).toMatch(/new SegmentInbox\(msg\.segmentPort,/);
      });

      it('routes stop to the inbox', () => {
        expect(source).toMatch(/case 'stop':/);
      });
    });
  }
});

describe('turn-detector.worker.ts', () => {
  const source = read(WORKERS_DIR, 'turn-detector.worker.ts');

  it('opens the Smart Turn link from its init message', () => {
    expect(source).toMatch(/openTurnLink\(msg\.turnPort, msg\.vad,/);
  });

  it('closes the link on dispose', () => {
    expect(source.slice(source.indexOf('function handleDispose'))).toMatch(/turnLink\?\.close\(\)/);
  });
});
