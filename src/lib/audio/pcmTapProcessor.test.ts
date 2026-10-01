import { beforeAll, describe, it, expect, vi } from 'vitest';

interface TapProcessor {
  port: { posted: Float32Array[] };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
let Tap: new (options?: { processorOptions?: { chunk?: number } }) => TapProcessor;

beforeAll(async () => {
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = {
      posted: [] as Float32Array[],
      postMessage(message: Float32Array) { this.posted.push(message); },
    };
  });
  vi.stubGlobal('registerProcessor', (name: string, ctor: typeof Tap) => {
    if (name === 'pcm-tap-processor') Tap = ctor;
  });
  await import('./worklets/pcm-tap-processor.js');
});

const quantum = (value: number) => new Float32Array(128).fill(value);

describe('pcm-tap-processor', () => {
  it('posts a chunk each time `chunk` frames have arrived', () => {
    const tap = new Tap({ processorOptions: { chunk: 256 } });
    tap.process([[quantum(0.5)]], [[new Float32Array(128)]]);
    expect(tap.port.posted).toHaveLength(0);
    tap.process([[quantum(0.25)]], [[new Float32Array(128)]]);
    expect(tap.port.posted).toHaveLength(1);
    expect(tap.port.posted[0]).toHaveLength(256);
    expect(tap.port.posted[0][0]).toBe(0.5);
    expect(tap.port.posted[0][255]).toBe(0.25);
  });

  it('counts an input with nothing connected as silence, so the tap stays clocked', () => {
    const tap = new Tap({ processorOptions: { chunk: 256 } });
    tap.process([[]], [[new Float32Array(128)]]);
    tap.process([[]], [[new Float32Array(128)]]);
    expect(tap.port.posted).toHaveLength(1);
    expect(tap.port.posted[0].every((s) => s === 0)).toBe(true);
  });

  it('keeps running', () => {
    const tap = new Tap({ processorOptions: { chunk: 256 } });
    expect(tap.process([[quantum(0)]], [[new Float32Array(128)]])).toBe(true);
  });
});
