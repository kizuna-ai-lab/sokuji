import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Chunked prefill belongs to qwen35-translation.worker.ts and nowhere else.
 *
 * Qwen3.5's ONNX export unrolls its recurrent layers along the sequence
 * dimension, so feeding its prompt one token at a time beats one batched pass
 * by 6.3x on a GB10. Every other model in the roster has a healthy batched
 * path and pays only the per-dispatch floor, so the same loop is a large
 * regression there — measured on a GB10 against a 110-token prompt:
 *
 *   Qwen3-0.6B    3.4x slower      HunyuanMT-1.8B  12.6x slower
 *   Qwen2.5-0.5B  4.8x slower      Qwen3.5-0.8B     5.5x FASTER
 *
 * The failure this guards against is someone reading the Qwen3.5 worker,
 * seeing a 5x win, and lifting the loop into a second worker or a shared
 * helper. See #306.
 */

// Captured at module scope: reading import.meta.url lazily from inside a
// separately-declared function resolves to a truncated URL under this
// Vite/Vitest version (same reason as harness-consolidation.test.ts).
const here = import.meta.url;

const WORKER_DIR = fileURLToPath(new URL('.', here));
const OWNER = 'qwen35-translation.worker.ts';

// Read the roster off disk so a worker added later is covered without anyone
// remembering to list it here.
const WORKERS = readdirSync(WORKER_DIR)
  .filter((name) => name.endsWith('.worker.ts'))
  .sort();

const read = (name: string) => readFileSync(`${WORKER_DIR}${name}`, 'utf8');

// The marks of driving the model's forward pass by hand and threading a cache
// through it — what chunked prefill needs and nothing else here does.
const PREFILL_MARKERS = ['DynamicCache', 'past_key_values', 'model.forward('];

describe('chunked prefill is confined to Qwen3.5', () => {
  it('finds the Qwen3.5 worker on disk', () => {
    expect(WORKERS).toContain(OWNER);
    expect(WORKERS.length).toBeGreaterThan(5);
  });

  it.each(PREFILL_MARKERS)('%s appears in the Qwen3.5 worker', (marker) => {
    expect(read(OWNER)).toContain(marker);
  });

  it.each(WORKERS.filter((name) => name !== OWNER))(
    '%s does not prefill in chunks',
    (name) => {
      const source = read(name);
      for (const marker of PREFILL_MARKERS) {
        expect(
          source,
          `${name} contains "${marker}". Chunked prefill is a 3.4-12.6x REGRESSION for ` +
            `every model except Qwen3.5, whose ONNX export unrolls its recurrent layers ` +
            `along the sequence dimension. See #306 before copying it here.`,
        ).not.toContain(marker);
      }
    },
  );

  it('is actually wired into the translate path, not just defined', () => {
    const source = read(OWNER);
    expect(source).toContain('async function prefillOneTokenAtATime');
    expect(source).toContain('await prefillOneTokenAtATime(');
    // The cache reaches generate(), and is released afterwards: generate()
    // deliberately keeps a caller-supplied cache alive.
    expect(source).toContain('past_key_values: prefilled');
    expect(source).toContain('prefilled?.dispose()');
  });

  it('feeds exactly one token per pass', () => {
    const source = read(OWNER);
    // Chunk sizes 2..32 were measured slower than a single batched pass even
    // on Qwen3.5; only M=1 escapes the bad path. If this loop ever grows a
    // chunk size, that measurement has to be redone first.
    expect(source).toContain("new Tensor('int64', [ids[at]], [1, 1])");
  });
});
