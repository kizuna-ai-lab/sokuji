import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadAddon, nativeDir, tempContractDir } from './helpers.mjs';

const sk = loadAddon();

test('reports ABI 2 and the library version', () => {
  assert.equal(sk.abi(), 2);
  assert.match(sk.version(), /^\d+\.\d+\.\d+$/);
  assert.equal(sk.contract(nativeDir()).abi, 2);
  assert.ok('ggml' in sk.engineVersions() && 'lane' in sk.engineVersions());
});

test('init is idempotent and lists a CPU device', () => {
  const { threads } = sk.init({ moduleDir: nativeDir(), threads: 0 });
  assert.ok(threads >= 1);
  assert.deepEqual(sk.init({ moduleDir: nativeDir(), threads: 3 }), { threads });   // first call wins
  const cpu = sk.devices().find((d) => d.kind === 'cpu');
  assert.ok(cpu && cpu.memTotal > 0 && cpu.memFree > 0);
});

test('init rejects a contract whose ABI differs', () => {
  // helpers.mjs writes a temp dir with contract.json {"abi":1}
  assert.throws(() => sk.contract(tempContractDir({ abi: 1 })), {
    name: 'NativeError',
    status: -1,
    message: 'contract.json ABI 1 != binding ABI 2 (status -1)',
  });
});

test('the log sink gets the init line and does not keep the process alive', () => {
  // A fresh process: init is once per process, and the one above installed no sink.
  // The child exits on its own only if the sink's thread-safe function is unref'd.
  const helpers = new URL('./helpers.mjs', import.meta.url).href;
  const child = `
    import { loadAddon, nativeDir } from ${JSON.stringify(helpers)};
    const lines = [];
    const report = () => process.stdout.write(JSON.stringify(lines));
    const timer = setTimeout(report, 10000);
    loadAddon().init({ moduleDir: nativeDir(), onLog: (level, message) => {
      lines.push({ level, message });
      if (message.startsWith('sk_init: ')) { clearTimeout(timer); report(); }
    } });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}: ${r.stderr}`);
  const lines = JSON.parse(r.stdout);
  assert.ok(lines.some((l) => l.level === 1 && /^sk_init: \d+ device\(s\)/.test(l.message)), r.stdout);
});

test('with a sink set, warnings and errors still reach stderr at once', () => {
  // The library prints level >= 2 to stderr only when no sink is set; the line that names an
  // unsupported op right before GGML_ABORT would otherwise sit in the async queue and die
  // with the process. ggml's GGML_BACKEND_PATH load is never silent: a missing file there
  // logs a level-3 line during sk_init, and init still succeeds.
  const helpers = new URL('./helpers.mjs', import.meta.url).href;
  const missing = join(tempContractDir({ abi: 2 }), 'no-such-backend.so');
  const child = `
    import { loadAddon, nativeDir } from ${JSON.stringify(helpers)};
    const lines = [];
    const report = () => process.stdout.write(JSON.stringify(lines));
    const timer = setTimeout(report, 10000);
    loadAddon().init({ moduleDir: nativeDir(), onLog: (level, message) => {
      lines.push({ level, message });
      if (message.startsWith('sk_init: ')) { clearTimeout(timer); report(); }
    } });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, GGML_BACKEND_PATH: missing },
  });
  assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}: ${r.stderr}`);
  const line = `load_backend: failed to load ${missing}`;
  assert.ok(r.stderr.split('\n').some((l) => l.startsWith(`[sokuji_native] ${line}`)), r.stderr);
  const lines = JSON.parse(r.stdout);
  assert.ok(lines.some((l) => l.level === 3 && l.message.startsWith(line)), r.stdout);   // the sink still gets it
});
