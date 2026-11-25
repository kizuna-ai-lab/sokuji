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

const detectorWorkers = DETECTOR_WORKER_TYPES.filter((type) => type !== 'sherpa-onnx').map((type) => ({ name: `${type}.worker.ts`, source: read(WORKERS_DIR, `${type}.worker.ts`) }));

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
        expect(source).toMatch(/case 'stop':\s*inbox\?\.stop\(msg\.epoch\)/);
        expect(source).not.toMatch(/case 'flush':/);
      });
    });
  }
});

// The classic script: it cannot import SegmentInbox, so it carries a plain-JS twin. Until step 5 it still has its own VAD
// path for a load with no segment port.
describe('sherpa-onnx-asr.worker.js (a classic script)', () => {
  const source = readFileSync(join(WORKERS_DIR, '../../../../public/workers/sherpa-onnx-asr.worker.js'), 'utf8');

  it('is the one worker of the sherpa-onnx type in the detector list', () => {
    expect(DETECTOR_WORKER_TYPES).toContain('sherpa-onnx');
  });

  it("takes the detector's segments from its init message's port", () => {
    expect(source).toMatch(/var segmentPort = msg\.segmentPort \|\| null;/);
    expect(source).toMatch(/if \(segmentPort\) inbox = createSegmentInbox\(segmentPort\);/);
  });

  it('creates no VAD and no audio buffer when it has a port', () => {
    expect(source).toMatch(/if \(!segmentPort\) \{[\s\S]*?createVad\([\s\S]*?new CircularBuffer\([\s\S]*?\n      \}/);
  });

  it('routes stop to the inbox and closes it first on dispose', () => {
    expect(source).toMatch(/case 'stop':\s*if \(inbox\) inbox\.stop\(msg\.epoch\)/);
    const dispose = source.slice(source.indexOf('async function handleDispose'));
    expect(dispose.indexOf('await closing.close()')).toBeGreaterThan(0);
    expect(dispose.indexOf('await closing.close()')).toBeLessThan(dispose.indexOf('recognizer.free()'));
  });

  it('decodes in one place, for both turn sources', () => {
    expect(source.match(/recognizer\.decode\(/g)).toHaveLength(1);
  });
});

describe('turn-detector.worker.ts', () => {
  const source = read(WORKERS_DIR, 'turn-detector.worker.ts');

  it('opens the Smart Turn link from its init message', () => {
    expect(source).toMatch(/openTurnLink\(msg\.turnPort, msg\.vad,/);
  });

  it('closes the link on dispose', () => {
    const start = source.indexOf('function handleDispose');
    const next = source.indexOf('\nfunction ', start + 1);
    expect(source.slice(start, next === -1 ? undefined : next)).toMatch(/turnLink\?\.close\(\)/);
  });
});
