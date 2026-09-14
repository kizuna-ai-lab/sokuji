// onnxruntime-web side of parity/pcs47-probe-matmulinteger.py: run the same DynamicQuantizeLinear -> MatMulInteger
// graph on WASM (1 thread) and compare every output with native onnxruntime and exact integer math.
import { readFile } from 'node:fs/promises';
import { ort } from '/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/research-asr-punctuation/benchmark/punctuation-restoration/lib/node-env.mjs';

const DIR = '/home/jiangzhuo/.cache/sokuji-punct-bench/pcs47-probe/matmulinteger';
const meta = JSON.parse(await readFile(`${DIR}/meta.json`, 'utf8'));
const bytes = async (name) => new Uint8Array(await readFile(`${DIR}/${name}`));
const i32 = async (name) => {
  const b = await bytes(name);
  return new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(await bytes('probe.onnx'), { executionProviders: ['wasm'] });
const xb = await bytes('X.bin');
const X = new Float32Array(xb.buffer, xb.byteOffset, xb.byteLength / 4);
const r = await session.run({ X: new ort.Tensor('float32', X, [1, meta.T, meta.D]) });

const xqNative = await bytes('xq-native.bin');
let xqDiff = 0;
for (let i = 0; i < xqNative.length; i++) if (r.xq.data[i] !== xqNative[i]) xqDiff++;
console.log(`DynamicQuantizeLinear: scale wasm ${r.xs.data[0]} native ${meta.xs}; zero point wasm ${r.xz.data[0]} native ${meta.xz}; xq differs in ${xqDiff} of ${xqNative.length}`);

function diff(label, a, b) {
  let n = 0;
  let max = 0;
  const examples = [];
  for (let i = 0; i < a.length; i++) {
    const d = Number(a[i]) - Number(b[i]);
    if (d !== 0) {
      n++;
      if (Math.abs(d) > max) max = Math.abs(d);
      if (examples.length < 3) examples.push({ i, a: Number(a[i]), b: Number(b[i]) });
    }
  }
  console.log(`${label.padEnd(24)} differs in ${n} of ${a.length}, max |diff| ${max}`, examples.length ? JSON.stringify(examples) : '');
}
const Y = r.Y.data;
diff('wasm vs exact', Y, await i32('Y-exact.bin'));
diff('wasm vs native (opt)', Y, await i32('Y-native-opt.bin'));
diff('wasm vs native (noopt)', Y, await i32('Y-native-noopt.bin'));
console.log('native:', meta.machine, 'onnxruntime', meta.ort);
