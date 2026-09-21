// onnxruntime-web side of parity/pcs47-probe-layers.py: run the augmented graphs on WASM (1 thread), compare
// every exposed tensor with the native run, in graph order.
// usage: node parity/pcs47-probe-layers.mjs int8 fp32
import { readFile, writeFile } from 'node:fs/promises';
import { ort } from '/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/research-asr-punctuation/benchmark/punctuation-restoration/lib/node-env.mjs';

const OUT = '/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47-probe';
const man = JSON.parse(await readFile(`${OUT}/manifest.json`, 'utf8'));
ort.env.wasm.numThreads = 1;
const short = (n) => n.replace('/bert_model/', '').replace('/encoder/', '').replace(/_output_0.*$/, '');
const summary = {};

for (const tag of process.argv.slice(2)) {
  const m = man.models[tag];
  const session = await ort.InferenceSession.create(new Uint8Array(await readFile(`${OUT}/${m.model}`)), { executionProviders: ['wasm'] });
  summary[tag] = {};
  for (const [k, ids] of Object.entries(man.inputs)) {
    const flat = ids[0];
    const r = await session.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(flat.map(BigInt)), [1, flat.length]) });
    console.log(`\n== ${tag} ${k} (${flat.length} ids)`);
    const rows = [];
    for (const e of m.entries.filter((x) => x.input === k)) {
      const bytes = new Uint8Array(await readFile(`${OUT}/${e.file}`));
      const got = r[e.name].data;
      if (e.kind === 'xq') {
        let n = 0;
        for (let i = 0; i < bytes.length; i++) if (got[i] !== bytes[i]) n++;
        rows.push({ kind: 'xq', name: short(e.name), differ: n, of: bytes.length });
        console.log(`xq     ${short(e.name).padEnd(56)} differs ${n} / ${bytes.length}`);
      } else {
        const want = new Float32Array(bytes.buffer);
        let maxAbs = 0;
        let maxVal = 0;
        let n = 0;
        for (let i = 0; i < want.length; i++) {
          const d = Math.abs(got[i] - want[i]);
          if (d > 0) n++;
          if (d > maxAbs) maxAbs = d;
          if (Math.abs(want[i]) > maxVal) maxVal = Math.abs(want[i]);
        }
        rows.push({ kind: e.kind, name: short(e.name), differ: n, of: want.length, maxAbs, maxVal });
        console.log(`${e.kind.padEnd(6)} ${short(e.name).padEnd(56)} differs ${n} / ${want.length}  max |diff| ${maxAbs.toExponential(2)}  (max |value| ${maxVal.toExponential(2)})`);
      }
    }
    summary[tag][k] = rows;
  }
  await session.release();
}
await writeFile(`${OUT}/comparison.json`, JSON.stringify(summary, null, 1));
console.log(`\nwrote ${OUT}/comparison.json`);
