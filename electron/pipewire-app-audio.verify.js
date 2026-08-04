// Real-PipeWire acceptance check for the per-application tap (issue #335).
//
//   node electron/pipewire-app-audio.verify.js                      # source tree
//   node electron/pipewire-app-audio.verify.js dist-electron/pipewire-app-audio.js
//
// Pass a module path to check the BUILT bundle instead of the source. Worth
// doing before a release: a module missing from vite.config.ts's electron input
// map is absent from dist-electron entirely, and only a run like this notices.
//
// The unit tests all use a fake exec, so nothing else proves this works against
// a real PipeWire graph. Uses a silent null-sink playback as the stand-in
// "application", so the run is completely inaudible and self-cleaning.
//
// The load-bearing assertion is `tap-is-additive`: linking must ADD a path to
// our capture sink while leaving the application's existing link in place. If
// the stream were moved instead, the user would stop hearing the app.
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const { spawn } = require('child_process');
const target = process.argv[2]
  ? require('path').resolve(process.cwd(), process.argv[2])
  : './pipewire-app-audio.js';
const { listAppSources, connectAppSource, disconnectAppSource } = require(target);
console.log(`# module under test: ${target}`);

const sh = async (cmd, args) => (await execFileP(cmd, args)).stdout.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = true;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} - ${detail}`);
  if (!cond) ok = false;
};

// An interrupted run must not leak a null sink or a stray player - a leftover
// sink is exactly the phantom audio device this script exists to rule out.
// SIGPIPE matters in practice: piping this through `head` kills it mid-run.
let probeModule = null;
let player = null;
let cleaningUp = false;

function cleanupSync(reason) {
  if (cleaningUp) return;
  cleaningUp = true;
  if (reason) console.log(`# cleaning up after ${reason}`);
  if (player) { try { player.kill(); } catch {} player = null; }
  const { execFileSync } = require('child_process');
  // Unload our own module first, then sweep by name in case a previous run died
  // before it could record its id.
  const ids = new Set();
  if (probeModule) ids.add(probeModule);
  try {
    const short = execFileSync('pactl', ['list', 'modules', 'short'], { encoding: 'utf8' });
    for (const line of short.split('\n')) {
      if (/sokuji_verify_probe|sokuji_app_capture/.test(line)) ids.add(line.split('\t')[0]);
    }
  } catch {}
  for (const id of ids) { try { execFileSync('pactl', ['unload-module', String(id)]); } catch {} }
  probeModule = null;
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGPIPE']) {
  process.on(sig, () => { cleanupSync(sig); process.exit(1); });
}
process.on('uncaughtException', (e) => { cleanupSync('uncaught ' + e.message); process.exit(1); });

(async () => {
  try {
    probeModule = await sh('pactl', ['load-module', 'module-null-sink',
      'sink_name=sokuji_verify_probe', 'sink_properties=device.description=SokujiVerifyProbe']);
    player = spawn('paplay', ['--raw', '--format=s16le', '--rate=48000', '--channels=2',
      '--device=sokuji_verify_probe', '/dev/zero']);
    await sleep(1500);

    const sources = await listAppSources();
    const probe = sources.find((s) => /paplay|pacat/i.test(s.label));
    check('lists-the-playing-application', !!probe,
      `found ${sources.length} source(s): ${sources.map((s) => s.label).join(', ') || '(none)'}`);
    if (!probe) throw new Error('cannot continue without a source');

    const before = await sh('pw-link', ['-l']);
    const r = await connectAppSource(probe.deviceId);
    check('connect-succeeds', r.success === true, `monitorLabel=${r.monitorLabel} error=${r.error ?? '-'}`);

    await sleep(500);
    const links = await sh('pw-link', ['-l']);
    const toCapture = (links.match(/sokuji_app_capture/g) || []).length;
    check('links-into-the-capture-sink', toCapture >= 2, `${toCapture} link line(s) mention sokuji_app_capture`);

    // The whole point: the app must still be connected to its original sink.
    const stillOnProbe = links.includes('sokuji_verify_probe');
    check('tap-is-additive', stillOnProbe,
      stillOnProbe ? 'application still linked to its original sink'
                   : 'STREAM WAS MOVED - the user would stop hearing the app');

    const sources2 = await sh('pactl', ['list', 'sources', 'short']);
    // The monitor being listed here proves nothing: Chromium does not publish
    // monitor sources as audioinput devices, so the renderer could never record
    // it. What has to exist is the remapped source over that monitor.
    check('capture-source-is-recordable', sources2.includes('sokuji_app_capture_mic'),
      'sokuji_app_capture_mic present in the source list');

    await disconnectAppSource();
    await sleep(500);
    const sinks = await sh('pactl', ['list', 'sinks', 'short']);
    const sources3 = await sh('pactl', ['list', 'sources', 'short']);
    check('teardown-leaves-nothing',
      !sinks.includes('sokuji_app_capture') && !sources3.includes('sokuji_app_capture'),
      'capture sink and source removed');

    void before;
  } catch (e) {
    console.log('ERROR', e.message);
    ok = false;
  } finally {
    try { await disconnectAppSource(); } catch {}
    cleanupSync(null);
  }
  console.log(ok ? 'VERIFY OK' : 'VERIFY FAILED');
  process.exit(ok ? 0 : 1);
})();
