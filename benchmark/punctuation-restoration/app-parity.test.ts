// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// This file is ESM under the node environment, so there is no `__dirname`;
// resolve the corpus against the module URL instead.
import { fileURLToPath } from 'node:url';

const CACHE = join(homedir(), '.cache', 'sokuji-punct-bench');
const DIRS = {
  fireredpunc: join(CACHE, 'fireredpunc-onnx'),
  edge: join(CACHE, 'sherpa', 'sherpa-onnx-online-punct-en-2024-08-06'),
  sat: join(CACHE, 'sat', 'sat-3l-sm-q8w-gather'),
};
const haveModels = Object.values(DIRS).every((d) => existsSync(d));

// Each row: which adapter, which language, which summarize() field, the
// measured value. Sources are in the table above; 0.5 points of tolerance.
const TARGETS = [
  { adapter: 'fireredpunc', lang: 'zh', field: 'breakpoint', expected: 0.915 },
  { adapter: 'edge',        lang: 'en', field: 'breakpoint', expected: 0.923 },
  { adapter: 'sat',         lang: 'ja', field: 'boundary',   expected: 0.941 },
  { adapter: 'sat',         lang: 'ko', field: 'boundary',   expected: 0.909 },
  { adapter: 'sat',         lang: 'ru', field: 'boundary',   expected: 0.966 },
] as const;

describe.skipIf(!haveModels)('the shipped adapters reproduce the benchmark', () => {
  const scores: Record<string, { boundary: number; breakpoint: number }> = {};

  beforeAll(async () => {
    const { ort, fileReader } = await import('./lib/node-env.mjs');
    const { loadCorpus, makeInput, hypothesisFor, scoreInto, newCounts, summarize } =
      await import('./lib/text.mjs');
    const { createFireRedPuncAdapter } =
      await import('../../src/lib/local-inference/workers/_shared/punctuation-fireredpunc');
    const { createEdgePunctEnAdapter } =
      await import('../../src/lib/local-inference/workers/_shared/punctuation-edge-punct-en');
    const { createSatAdapter } =
      await import('../../src/lib/local-inference/workers/_shared/punctuation-sat');

    const items = await loadCorpus(fileURLToPath(new URL('./corpus', import.meta.url)));
    const make = { fireredpunc: createFireRedPuncAdapter, edge: createEdgePunctEnAdapter, sat: createSatAdapter };

    for (const [name, langs] of [['fireredpunc', ['zh']], ['edge', ['en']], ['sat', ['ja', 'ko', 'ru']]] as const) {
      const adapter = make[name]();
      await adapter.load({
        InferenceSession: ort.InferenceSession,
        Tensor: ort.Tensor,
        readFile: fileReader(DIRS[name]),
        executionProviders: ['wasm'],
      });
      for (const lang of langs) {
        const counts = newCounts();
        for (const it of items.filter((i: { lang: string }) => i.lang === lang)) {
          const input = makeInput(it.ref, 'stripped');
          const out = await adapter.run(input);
          const { hyp } = hypothesisFor({ output: 'punct' }, out.text);
          scoreInto(counts, it.ref, hyp);
        }
        const s = summarize(counts);
        scores[`${name}/${lang}`] = { boundary: s.boundary.f, breakpoint: s.breakpoint.f };
      }
      await adapter.release();
    }
  }, 900_000);

  it.each(TARGETS)('$adapter on $lang matches the measured $field F1', ({ adapter, lang, field, expected }) => {
    expect(scores[`${adapter}/${lang}`][field]).toBeCloseTo(expected, 2);
  });
});
