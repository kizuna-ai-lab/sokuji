// A worker_threads Worker of lifetime.test.mjs: loads a model, leaves a call or a stream in
// flight, reports 'running', and waits to be terminated. Its environment's teardown runs the
// addon's cleanup hook and then finalizes the handles it still holds.
//
//   workerData.kind   asr-run | stream-open | translate-run
import { parentPort, workerData } from 'node:worker_threads';
import { jfk, loadAddon, nativeDir, cpuDevice } from '../helpers.mjs';

const env = process.env;
const sk = loadAddon();
sk.init({ moduleDir: nativeDir(), threads: 2 });
const keep = globalThis.keep = [];   // held until the environment is torn down

if (workerData.kind === 'asr-run') {
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, cpuDevice());
  const one = jfk(), long = new Float32Array(480000);
  for (let i = 0; i < long.length; i += one.length) long.set(one.subarray(0, Math.min(one.length, long.length - i)), i);
  let said = false;
  keep.push(m, m.run(long, 'en', { onProgress: () => { if (!said) { said = true; parentPort.postMessage('running'); } } }).catch(() => {}));
} else if (workerData.kind === 'stream-open') {
  const m = await sk.asrLoad(env.SK_TEST_ASR_STREAM_GGUF, cpuDevice());
  const s = m.openStream('en');
  await s.feed(jfk().slice(0, 8000));
  keep.push(m, s);
  parentPort.postMessage('running');
} else if (workerData.kind === 'translate-run') {
  const t = await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, cpuDevice(), { nCtx: 2048 });
  let said = false;
  keep.push(t, t.chat([{ role: 'user', content: 'Write a long story about a lighthouse.' }], { maxTokens: 512 },
    { onToken: () => { if (!said) { said = true; parentPort.postMessage('running'); } } }).catch(() => {}));
} else {
  throw new Error(`unknown kind ${workerData.kind}`);
}
