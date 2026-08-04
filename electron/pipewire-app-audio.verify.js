// Real-PipeWire acceptance check for the per-application tap (issue #335).
//
//   node electron/pipewire-app-audio.verify.js
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
const { listAppSources, connectAppSource, disconnectAppSource } = require('./pipewire-app-audio.js');

const sh = async (cmd, args) => (await execFileP(cmd, args)).stdout.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = true;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} - ${detail}`);
  if (!cond) ok = false;
};

(async () => {
  let probeModule = null;
  let player = null;
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
    check('monitor-is-recordable', sources2.includes('sokuji_app_capture.monitor'),
      'sokuji_app_capture.monitor present in the source list');

    await disconnectAppSource();
    await sleep(500);
    const sinks = await sh('pactl', ['list', 'sinks', 'short']);
    check('teardown-leaves-nothing', !sinks.includes('sokuji_app_capture'),
      'capture sink removed');

    void before;
  } catch (e) {
    console.log('ERROR', e.message);
    ok = false;
  } finally {
    try { await disconnectAppSource(); } catch {}
    if (player) { try { player.kill(); } catch {} }
    if (probeModule) { try { await execFileP('pactl', ['unload-module', probeModule]); } catch {} }
  }
  console.log(ok ? 'VERIFY OK' : 'VERIFY FAILED');
  process.exit(ok ? 0 : 1);
})();
