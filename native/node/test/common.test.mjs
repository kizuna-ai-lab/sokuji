import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cpuModuleDir, loadAddon, nativeDir, tempContractDir } from './helpers.mjs';

const sk = loadAddon();

// macOS diagnostic: if the child is still running after 8 s, `sample` its stacks so a hang in init shows where.
function spawnSampled(args, opts) {
  const out = join(mkdtempSync(join(tmpdir(), 'sk-sample-')), 'sample.txt');
  if (process.platform === 'darwin') {
    spawn('sh', ['-c', `sleep 8; for p in $(pgrep -f 'input-type=module'); do sample $p 3 -file ${out} >/dev/null 2>&1; done`], { stdio: 'ignore', detached: true }).unref();
  }
  const r = spawnSync(process.execPath, args, opts);
  let sampled = '';
  try {
    // The node frames above the addon fill the first thousands of characters; keep the part that matters:
    // everything from the addon's callback down (all threads), and the "top of stack" summary at the end.
    const text = readFileSync(out, 'utf8').split('\n').map((l) => l.slice(0, 240)).join('\n');
    const at = text.indexOf('CallbackData');
    const body = at >= 0 ? text.slice(Math.max(0, text.lastIndexOf('\n', at))) : text;
    const top = text.indexOf('Sort by top of stack');
    sampled = body.slice(0, 14000) + (top >= 0 ? '\n...\n' + text.slice(top, top + 4000) : '');
  } catch {}
  r.sampled = sampled;
  return r;
}

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
  const moduleDir = cpuModuleDir();   // these tests are about the log sink, not a GPU backend's init
  const child = `
    import { loadAddon } from ${JSON.stringify(helpers)};
    const lines = [];
    const t0 = Date.now();
    const mark = (what) => process.stderr.write('[child +' + (Date.now() - t0) + 'ms] ' + what + '\\n');
    const report = () => { process.stdout.write(JSON.stringify(lines)); mark('reported'); };
    const timer = setTimeout(() => { mark('timer fired: no sk_init line'); report(); }, 10000);
    process.on('exit', () => mark('exit event'));
    mark('helpers imported');
    const addon = loadAddon();
    mark('addon loaded');
    addon.init({ moduleDir: ${JSON.stringify(moduleDir)}, onLog: (level, message) => {
      lines.push({ level, message });
      if (message.startsWith('sk_init: ')) { clearTimeout(timer); report(); }
    } });
    mark('init returned');`;
  const r = spawnSampled(['--input-type=module', '-e', child], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}\nstdout: ${r.stdout}\nstderr: ${r.stderr}\nsample: ${r.sampled}`);
  const lines = JSON.parse(r.stdout);
  assert.ok(lines.some((l) => l.level === 1 && /^sk_init: \d+ device\(s\)/.test(l.message)), r.stdout);
});

test('with a sink set, warnings and errors still reach stderr at once', () => {
  // The library prints level >= 2 to stderr only when no sink is set; the line that names an
  // unsupported op right before GGML_ABORT would otherwise sit in the async queue and die
  // with the process. ggml's GGML_BACKEND_PATH load is never silent: a missing file there
  // logs a level-3 line during sk_init, and init still succeeds.
  const helpers = new URL('./helpers.mjs', import.meta.url).href;
  const moduleDir = cpuModuleDir();   // these tests are about the log sink, not a GPU backend's init
  const missing = join(tempContractDir({ abi: 2 }), 'no-such-backend.so');
  const child = `
    import { loadAddon } from ${JSON.stringify(helpers)};
    const lines = [];
    const t0 = Date.now();
    const mark = (what) => process.stderr.write('[child +' + (Date.now() - t0) + 'ms] ' + what + '\\n');
    const report = () => { process.stdout.write(JSON.stringify(lines)); mark('reported'); };
    const timer = setTimeout(() => { mark('timer fired: no sk_init line'); report(); }, 10000);
    process.on('exit', () => mark('exit event'));
    mark('helpers imported');
    const addon = loadAddon();
    mark('addon loaded');
    addon.init({ moduleDir: ${JSON.stringify(moduleDir)}, onLog: (level, message) => {
      lines.push({ level, message });
      if (message.startsWith('sk_init: ')) { clearTimeout(timer); report(); }
    } });
    mark('init returned');`;
  const r = spawnSampled(['--input-type=module', '-e', child], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GGML_BACKEND_PATH: missing },
  });
  assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}\nstdout: ${r.stdout}\nstderr: ${r.stderr}\nsample: ${r.sampled}`);
  const line = `load_backend: failed to load ${missing}`;
  assert.ok(r.stderr.split('\n').some((l) => l.startsWith(`[sokuji_native] ${line}`)), r.stderr);
  const lines = JSON.parse(r.stdout);
  assert.ok(lines.some((l) => l.level === 3 && l.message.startsWith(line)), r.stdout);   // the sink still gets it
});
