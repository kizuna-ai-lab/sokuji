// Child process of lifetime.test.mjs: starts a native call, then process.exit()s while it is
// in flight. process.exit() does not end the environment (no cleanup hooks run), so the addon
// must stop and join its worker threads in an exit handler of its own.
//
//   node exit-mid-run.mjs <asr|translate|tts|tts-offline> <delay|callback> [exit code]
//
//   delay      exit 50 ms after the call is made (the call may still be loading its input)
//   callback   exit from inside the call's first progress / token / audio callback
// Writes "exiting" to stdout just before it exits.
import { writeSync } from 'node:fs';
import { jfk, loadAddon, nativeDir, cpuDevice } from '../helpers.mjs';

const [kind, mode, code = '0'] = process.argv.slice(2);
const env = process.env;
const sk = loadAddon();
sk.init({ moduleDir: nativeDir(), threads: 4 });

const exit = () => {
  writeSync(1, 'exiting\n');
  process.exit(Number(code));
};
const onCallback = () => { if (mode === 'callback') exit(); };

// Supertonic streams one chunk per 300 codepoints: 392 codepoints are two chunks.
const LONG = 'Hello from the parity gate. '.repeat(14);

if (kind === 'asr') {
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, cpuDevice());
  const one = jfk(), long = new Float32Array(480000);   // 30 s
  for (let i = 0; i < long.length; i += one.length) long.set(one.subarray(0, Math.min(one.length, long.length - i)), i);
  m.run(long, 'en', { onProgress: onCallback }).catch(() => {});
} else if (kind === 'translate') {
  const t = await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, cpuDevice(), { nCtx: 2048 });
  t.chat([{ role: 'user', content: 'Write a long story about a lighthouse.' }], { maxTokens: 512 },
         { onToken: onCallback }).catch(() => {});
} else if (kind === 'tts') {
  const tts = await sk.ttsLoad(env.SK_TEST_TTS_SUPERTONIC_DIR, sk.devices().find((d) => d.kind === 'cpu')?.index, { family: 'supertonic' });
  tts.synth(LONG, 'en', 1, { onAudio: onCallback }).catch(() => {});
} else if (kind === 'tts-offline') {
  // moss decodes the whole utterance before its one callback: nothing can interrupt it.
  const tts = await sk.ttsLoad(env.SK_TEST_TTS_MOSS_DIR, sk.devices().find((d) => d.kind === 'cpu')?.index, { family: 'moss_tts_nano' });
  tts.synth('Hello from MOSS.', null, 1, { onAudio: onCallback }).catch(() => {});
} else {
  throw new Error(`unknown kind ${kind}`);
}
if (mode === 'delay') setTimeout(exit, 50);
