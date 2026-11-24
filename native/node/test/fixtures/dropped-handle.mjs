// Child process of lifetime.test.mjs, run with --expose-gc: drops handles and collects them.
//
//   node --expose-gc dropped-handle.mjs <asr|translate|tts|asr-unloaded|stream>
//
// asr, translate, tts   load a model, never unload it, drop it, collect it
// asr-unloaded          the same after unload(): the finalizer has nothing to warn about
// stream                drop an open AsrStream without close(): the model's stream slot frees
// Prints one JSON line: the warnings the log sink got, the longest gap between two ticks of a
// 5 ms timer (the JS thread's stall) over the collection, and the process's thread counts.
import { writeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { jfk, loadAddon, nativeDir, threadCount } from '../helpers.mjs';

const kind = process.argv[2];
const env = process.env;
const sk = loadAddon();
const log = [];
sk.init({ moduleDir: nativeDir(), threads: 2, onLog: (level, message) => log.push({ level, message }) });
const warnings = () => log.filter((l) => l.level === 2 && /collected without unload/.test(l.message));
const cpu = sk.devices().find((d) => d.kind === 'cpu')?.index;

// Starts the process-wide worker that loads run on, so it is not counted as the handle's thread.
await sk.asrLoad('/nonexistent.gguf', null).catch(() => {});
const baseline = threadCount();

let stall = 0, last = performance.now();
const ticker = setInterval(() => {
  const now = performance.now();
  stall = Math.max(stall, now - last);
  last = now;
}, 5);

// The handle lives only in this function's frame: once it returns, nothing refers to it.
async function loadAndDrop() {
  if (kind === 'translate') return void await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, null, { nCtx: 2048 });
  if (kind === 'tts') return void await sk.ttsLoad(env.SK_TEST_TTS_SUPERTONIC_DIR, cpu, { family: 'supertonic' });
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, null);
  if (kind === 'asr-unloaded') await m.unload();
}

async function collectUntil(done, ms = 20000) {
  for (const t0 = performance.now(); performance.now() - t0 < ms; ) {
    gc();
    await sleep(20);
    if (await done()) return true;
  }
  return false;
}

const result = { kind, baseline };
if (kind === 'stream') {
  const m = await sk.asrLoad(env.SK_TEST_ASR_STREAM_GGUF, null);
  await (async () => {
    const s = m.openStream('en');
    await s.feed(jfk().slice(0, 8000));
  })();   // `s` is unreachable now, still open
  let reopened = null;
  result.freed = await collectUntil(() => {
    try {
      reopened = m.openStream('en');
      return true;
    } catch (e) {
      if (!/already open/.test(e.message)) throw e;   // only the stream's slot still being held is expected
      return false;
    }
  });
  // The collected stream's native close was queued before the next open, and before this run.
  await reopened.feed(jfk().slice(0, 8000));
  reopened.close();
  result.text = (await m.run(jfk(), 'en')).toLowerCase();
  await m.unload();
} else {
  await loadAndDrop();
  stall = 0; last = performance.now();
  if (kind === 'asr-unloaded') {
    await collectUntil(() => false, 1000);   // nothing to wait for: give the finalizer time to (not) warn
  } else {
    result.collected = await collectUntil(() => warnings().length > 0);
    await collectUntil(() => threadCount() === baseline, 10000);
  }
  result.threadsAfter = threadCount();
}
clearInterval(ticker);
result.maxStallMs = Math.round(stall);
result.warnings = warnings();
writeSync(1, JSON.stringify(result) + '\n');
