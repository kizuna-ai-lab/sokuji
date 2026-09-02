// Cross-check the JS mel front end and tokenizer decoder against the Python references.
import { readFileSync } from 'node:fs';
import { logMel, parseWav } from './www/mel.js';

const HERE = '/home/jiangzhuo/.claude/jobs/c6177dc7/tmp';
const ref = JSON.parse(readFileSync(`${HERE}/www/jfk_ref.json`, 'utf8'));
const filters = JSON.parse(readFileSync(`${HERE}/www/mel_filters.json`, 'utf8'));
const wavBuf = readFileSync(`${HERE}/clips/jfk.wav`);
const audio = parseWav(wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength));
const t0 = performance.now();
const mel = logMel(audio, filters);
const ms = performance.now() - t0;
const refMel = new Float32Array(readFileSync(`${HERE}/www/jfk_mel_ref.bin`).buffer.slice(0));
const [nm, T] = ref.melShape;
console.log(`js mel: ${mel.nMels}x${mel.T} in ${ms.toFixed(0)}ms ; ref ${nm}x${T}`);
if (mel.T !== T) console.log('FRAME COUNT MISMATCH');
let maxAbs = 0, sumAbs = 0, n = 0;
for (let m = 0; m < nm; m++) for (let t = 0; t < Math.min(T, mel.T); t++) {
  const d = Math.abs(mel.data[m * mel.T + t] - refMel[m * T + t]);
  if (d > maxAbs) maxAbs = d; sumAbs += d; n++;
}
console.log(`mel max abs diff ${maxAbs.toExponential(3)} mean ${(sumAbs / n).toExponential(3)}`);

// tokenizer: node lacks fetch for file paths, so shim loadTokenizer's fetch
globalThis.fetch = async (p) => ({ json: async () => JSON.parse(readFileSync(p, 'utf8')) });
const { loadTokenizer } = await import('./www/tokenizer.js');
const tok = await loadTokenizer(`${HERE}/qwen3-asr-onnx/output/qwen3-asr-0.6b/tokenizer.json`);
let ok = true;
ref.ids.forEach((ids, i) => {
  const s = tok.decode(ids);
  const good = s === ref.decoded[i];
  ok &&= good;
  console.log(`${good ? 'OK ' : 'BAD'} ${JSON.stringify(s)} ${good ? '' : '!= ' + JSON.stringify(ref.decoded[i])}`);
});
console.log('tokenizer', ok ? 'PASS' : 'FAIL');
