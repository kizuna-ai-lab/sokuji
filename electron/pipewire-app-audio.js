/**
 * PipeWire per-application audio capture (issue #335).
 *
 * Applications that play audio appear in the PipeWire graph as
 * `Stream/Output/Audio` nodes. We tap one by linking its output ports to a
 * dedicated null sink *in addition to* its existing links, so the application
 * keeps playing through whatever sink it was already using and the user hears
 * no change. Capturing is then just recording that sink's monitor, which
 * Chromium exposes as an ordinary input device.
 */
const { exec: nodeExec } = require('child_process');
const { promisify } = require('util');

const defaultExec = promisify(nodeExec);
const { listWindowTitles, titleForPid } = require('./linux-window-titles.js');

// Labels are NOT truncated here. The device list already ellipsises overflow in
// CSS and now carries the full text as a tooltip, so trimming the data would
// only destroy information the UI can still use.

const STREAM_CLASS = 'Stream/Output/Audio';
const CAPTURE_SINK_NAME = 'sokuji_app_capture';
// Chromium does not publish monitor sources as audioinput devices, so recording
// sokuji_app_capture.monitor directly is impossible however it is labelled -
// enumerateDevices() simply never lists it. A remapped source over that monitor
// is a real source and does show up, which is exactly why the virtual mic in
// pulseaudio-utils.js is built the same way.
const CAPTURE_SOURCE_NAME = 'sokuji_app_capture_mic';
// Underscored on purpose, exactly like sokuji_virtual_output's description.
// pactl splits sink_properties on whitespace, so a description with spaces
// arrives truncated at the first one: "Sokuji App Capture" became "Sokuji", the
// monitor came out as "Monitor of Sokuji", and the renderer - looking for the
// full string - never matched it and silently fell back to whole-system audio.
const CAPTURE_SINK_DESCRIPTION = 'Sokuji_App_Capture';

// Module id of the null sink created by connectAppSource(), so disconnect can
// unload exactly the module we made instead of pattern-matching the graph.
let captureModuleId = null;
let captureSourceModuleId = null;

/**
 * Group the playback streams in a `pw-dump` into one entry per application.
 *
 * Applications routinely open several streams at once - Chromium creates one
 * per audio-producing tab, so a single browser showed up as six identical rows
 * and capturing any one of them would have caught only that tab. Grouping by
 * process id collapses them and lets connectAppSource() tap every stream the
 * application owns, matching the process-tree semantics of the Windows helper.
 *
 * @param {object[]} dump
 * @returns {Array<{deviceId: string, label: string, pid: number|null, nodeIds: number[], binary: string|null}>}
 */
function parseAppStreams(dump) {
  if (!Array.isArray(dump)) return [];

  const byKey = new Map();
  for (const obj of dump) {
    const props = obj?.info?.props;
    if (!props || obj.type !== 'PipeWire:Interface:Node') continue;
    if (props['media.class'] !== STREAM_CLASS) continue;
    if (typeof obj.id !== 'number') continue;

    const pidRaw = props['application.process.id'];
    const pid = typeof pidRaw === 'number' ? pidRaw : null;
    const binary = props['application.process.binary'] ?? null;
    const name = props['application.name'] ?? props['node.name'] ?? binary;
    if (!name) continue;

    // Streams without a pid cannot be grouped, so they stay per-node.
    const key = pid !== null ? `pid:${pid}` : `node:${obj.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.nodeIds.push(obj.id);
    } else {
      byKey.set(key, { deviceId: `app:${key}`, label: name, pid, nodeIds: [obj.id], binary });
    }
  }

  const streams = [...byKey.values()];

  // Two separate processes of the same application are still ambiguous; suffix
  // the pid only for those, never for the common single-instance case.
  const counts = new Map();
  for (const s of streams) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  for (const s of streams) {
    if (counts.get(s.label) > 1 && s.pid !== null) s.label = `${s.label} (${s.pid})`;
  }

  return streams;
}

/**
 * Numeric port ids for one node, sorted by port name.
 *
 * pw-link is given numeric ids rather than `name:port` strings because two
 * instances of the same application share a node.name and cannot be told apart
 * by name. Sorting by port name makes out[i] <-> in[i] a stable channel pairing.
 * @returns {number[]}
 */
function resolvePortIds(dump, nodeId, direction) {
  if (!Array.isArray(dump)) return [];
  return dump
    .filter((o) =>
      o?.type === 'PipeWire:Interface:Port' &&
      o?.info?.direction === direction &&
      o?.info?.props?.['node.id'] === nodeId &&
      typeof o.id === 'number')
    .sort((a, b) =>
      String(a.info.props['port.name']).localeCompare(String(b.info.props['port.name'])))
    .map((o) => o.id);
}

async function dumpGraph(exec) {
  const { stdout } = await exec('pw-dump');
  return JSON.parse(stdout);
}

function findNodeByName(dump, name) {
  if (!Array.isArray(dump)) return undefined;
  return dump.find((o) =>
    o?.type === 'PipeWire:Interface:Node' &&
    o?.info?.props?.['node.name'] === name);
}

const defaultDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Point the remapped source's capture stream at the capture sink's monitor.
 *
 * `master=` is only a hint. pactl turns it into `node.target`, and on PipeWire
 * 0.3.x that name resolves to nothing, because `<sink>.monitor` is a PulseAudio
 * name rather than a node - a sink's monitor is just output ports on the sink
 * itself. The stream still carries `node.autoconnect`, so the session manager
 * falls back to the *default source*: the tap then records whatever the default
 * input carries, identically no matter which application the user picked.
 * Reproduced on PipeWire 0.3.48, where a 1 kHz tone linked into the capture sink
 * read back at 0.6% of full scale (room noise) instead of 61%.
 *
 * createVirtualAudioDevices() in pulseaudio-utils.js has always repaired the
 * same autoconnect by hand for the virtual mic. This is that repair, for the
 * capture tap.
 *
 * Idempotent, and a no-op wherever the session manager already got it right.
 *
 * @returns {Promise<boolean>} true once the stream's only inputs are the monitor
 */
async function bindCaptureSourceToSink({ exec, delay = defaultDelay, attempts = 4 }) {
  // Whether each node was ever seen, which is what separates "this PipeWire
  // builds the remap some other way" from "it has not published the node yet".
  let sawSink = false;
  let sawStream = false;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // The session manager autoconnects asynchronously, so a repair applied
    // before it runs would simply be undone by it. Let the graph settle, then
    // look at what it actually did.
    await delay(150);

    const dump = await dumpGraph(exec);
    const sink = findNodeByName(dump, CAPTURE_SINK_NAME);
    const stream = findNodeByName(dump, `input.${CAPTURE_SOURCE_NAME}`);
    if (sink) sawSink = true;
    if (stream) sawStream = true;
    // Absent is not the same as absent for good. pactl returns a module id the
    // moment the module loads, but PipeWire publishes the node into the graph
    // afterwards, so either of these can simply be late. Spend the attempts
    // before drawing any conclusion - deciding on the first look would report
    // success having never examined the autoconnected links, which is the very
    // bug this exists to prevent.
    if (!sink || !stream) continue;

    // A sink's monitor is its output ports; the remap's capture stream consumes
    // them through its inputs. Both are sorted by port name, so the channels
    // pair up positionally.
    const monitors = resolvePortIds(dump, sink.id, 'output');
    const inputs = resolvePortIds(dump, stream.id, 'input');
    if (monitors.length === 0 || inputs.length === 0) continue;
    // Pairing the overlap while clearing links from every input would leave the
    // surplus input fed by nothing, and the next pass would find a graph it has
    // no complaint about: success reported over a channel of silence. Both
    // lists come from the same null sink, so a mismatch is not a layout to
    // adapt to - it is a graph to leave alone.
    if (monitors.length !== inputs.length) continue;

    const pairs = monitors.map((monitor, i) => [monitor, inputs[i]]);
    const wanted = new Set(pairs.map(([out, inp]) => `${out}:${inp}`));
    const inputSet = new Set(inputs);

    const present = new Set();
    let changed = false;
    for (const obj of dump) {
      if (obj?.type !== 'PipeWire:Interface:Link') continue;
      const props = obj?.info?.props;
      const out = props?.['link.output.port'];
      const inp = props?.['link.input.port'];
      if (!inputSet.has(inp)) continue;
      const pair = `${out}:${inp}`;
      if (wanted.has(pair)) { present.add(pair); continue; }
      // Anything else is the session manager's fallback to the default source.
      if (!Number.isInteger(out) || !Number.isInteger(inp)) continue;
      await exec(`pw-link -d ${out} ${inp}`);
      changed = true;
    }

    for (const [out, inp] of pairs) {
      if (present.has(`${out}:${inp}`)) continue;
      if (!Number.isInteger(out) || !Number.isInteger(inp)) continue;
      await exec(`pw-link ${out} ${inp}`);
      changed = true;
    }

    // Nothing needed changing, so the previous pass stuck: the stream is fed by
    // the capture sink and by nothing else.
    if (!changed) return true;
  }

  // Out of attempts. The sink is ours and must exist; without it there is no tap
  // to bind and no honest way to call this a success.
  if (!sawSink) return false;
  // A stream that never appeared at all is a remap this PipeWire builds some
  // other way. Now that it has had the full budget to show up, leaving its
  // graph alone is a judgement rather than a guess.
  if (!sawStream) return true;
  // Both were there and the wiring would not settle.
  return false;
}

/**
 * List the applications currently playing audio.
 * @returns {Promise<Array<{deviceId: string, label: string}>>}
 */
async function listAppSources({ exec = defaultExec, windowTitles = listWindowTitles } = {}) {
  let streams;
  try {
    streams = parseAppStreams(await dumpGraph(exec))
      // A crashed session can leave our capture sink behind; offering it would
      // let the user capture Sokuji's own tap.
      .filter((s) => s.label !== CAPTURE_SINK_DESCRIPTION);
  } catch (e) {
    console.warn('[Sokuji] [PipeWire] Failed to list application audio sources:', e.message);
    return [];
  }

  // Best-effort enrichment. PipeWire reports "Chromium"/"Playback" for every
  // browser window alike; the X11 window title is what the user recognises.
  // Unavailable on Wayland and without xprop, where the plain name is kept.
  let titles = new Map();
  try {
    titles = await windowTitles();
  } catch (e) {
    console.warn('[Sokuji] [PipeWire] Window titles unavailable:', e.message);
  }

  return streams.map((s) => {
    const title = s.pid !== null ? titleForPid(s.pid, titles) : null;
    // appKey must survive a restart, so it is the binary or application name -
    // never the node id inside deviceId, and never the window title, which
    // changes with whatever the app is showing.
    return {
      deviceId: s.deviceId,
      label: title || s.label,
      appKey: s.binary || s.label || null,
    };
  });
}

/**
 * Tap one application's audio.
 * @param {string} deviceId - `app:<nodeId>`
 * @returns {Promise<{success: boolean, monitorLabel?: string, error?: string}>}
 */
async function connectAppSourceUnsafe(deviceId, { exec = defaultExec, delay = defaultDelay } = {}) {
  const id = String(deviceId);
  if (!id.startsWith('app:')) {
    return { success: false, error: `Not an application source: ${deviceId}` };
  }

  // A previous selection must be torn down first, or its links keep feeding the
  // same capture sink and both applications are translated at once.
  await disconnectAppSourceUnsafe({ exec });

  let dump;
  try {
    dump = await dumpGraph(exec);
  } catch (e) {
    return { success: false, error: `Failed to read the PipeWire graph: ${e.message}` };
  }

  // Re-resolve from the live graph rather than trusting ids captured when the
  // list was built: tabs open and close between enumeration and selection.
  const entry = parseAppStreams(dump).find((s) => s.deviceId === id);
  if (!entry || entry.nodeIds.length === 0) {
    return { success: false, error: 'That application is no longer playing audio' };
  }

  try {
    const { stdout } = await exec(
      `pactl load-module module-null-sink sink_name=${CAPTURE_SINK_NAME} ` +
      `sink_properties=device.description="${CAPTURE_SINK_DESCRIPTION}"`
    );
    const moduleId = stdout.trim();
    // Everything interpolated into a shell string here is either a module
    // constant or an integer we validated. This id comes back from pactl, so
    // pin it to digits before it is ever interpolated again.
    if (!/^\d+$/.test(moduleId)) {
      throw new Error(`pactl returned an unexpected module id: ${JSON.stringify(moduleId)}`);
    }
    captureModuleId = moduleId;
  } catch (e) {
    return { success: false, error: `Failed to create capture sink: ${e.message}` };
  }

  try {
    // The sink only exists after load-module, so re-dump to find its ports.
    const withSink = await dumpGraph(exec);
    const sink = withSink.find((o) =>
      o?.type === 'PipeWire:Interface:Node' &&
      o?.info?.props?.['node.name'] === CAPTURE_SINK_NAME);
    const ins = sink ? resolvePortIds(withSink, sink.id, 'input') : [];
    if (ins.length === 0) throw new Error('capture sink exposed no input ports');

    // Publish the sink's monitor as a real source, or the renderer has nothing
    // it can record.
    const { stdout: srcId } = await exec(
      `pactl load-module module-remap-source master=${CAPTURE_SINK_NAME}.monitor ` +
      `source_name=${CAPTURE_SOURCE_NAME} ` +
      `source_properties=device.description="${CAPTURE_SINK_DESCRIPTION}"`
    );
    const sourceModuleId = srcId.trim();
    if (!/^\d+$/.test(sourceModuleId)) {
      throw new Error(`pactl returned an unexpected module id: ${JSON.stringify(sourceModuleId)}`);
    }
    captureSourceModuleId = sourceModuleId;

    // Link every stream the application owns. One node per tab means linking a
    // single node would capture one tab and silently miss the rest.
    let linked = 0;
    for (const nodeId of entry.nodeIds) {
      const outs = resolvePortIds(withSink, nodeId, 'output');
      for (let i = 0; i < Math.min(outs.length, ins.length); i++) {
        const out = Number(outs[i]);
        const inp = Number(ins[i]);
        if (!Number.isInteger(out) || !Number.isInteger(inp)) {
          throw new Error('refusing to link non-numeric port ids');
        }
        await exec(`pw-link ${out} ${inp}`);
        linked++;
      }
    }
    if (linked === 0) {
      throw new Error('no ports to link (the application may have stopped playing)');
    }

    // The tap is built, but the source the renderer will record still has to be
    // fed by it rather than by the default input. Capturing the wrong device is
    // worse than capturing nothing: the user picked one application, and audio
    // they never chose to share would reach the translation provider.
    if (!await bindCaptureSourceToSink({ exec, delay })) {
      throw new Error(
        'the capture source stayed attached to the default input instead of the tap'
      );
    }

    return { success: true, monitorLabel: CAPTURE_SINK_DESCRIPTION };
  } catch (e) {
    // Never leave the null sink behind: it shows up as a phantom audio device
    // in the user's system settings and outlives the app.
    await disconnectAppSourceUnsafe({ exec });
    return { success: false, error: `Failed to link application audio: ${e.message}` };
  }
}

/**
 * Remove the capture sink. Its links die with it.
 * Safe to call when nothing is connected.
 * @returns {Promise<{success: boolean}>}
 */
async function disconnectAppSourceUnsafe({ exec = defaultExec } = {}) {
  if (!captureModuleId && !captureSourceModuleId) return { success: true };
  // The remapped source depends on the sink's monitor, so it goes first.
  if (captureSourceModuleId) {
    try {
      await exec(`pactl unload-module ${captureSourceModuleId}`);
    } catch (e) {
      console.warn('[Sokuji] [PipeWire] Failed to unload capture source:', e.message);
    }
    captureSourceModuleId = null;
  }
  if (captureModuleId) {
    try {
      await exec(`pactl unload-module ${captureModuleId}`);
    } catch (e) {
      console.warn('[Sokuji] [PipeWire] Failed to unload capture sink:', e.message);
    }
    captureModuleId = null;
  }
  return { success: true };
}

/**
 * Both entry points mutate the same two module ids. Run them one at a time:
 * two overlapping connects would each tear down, then each store its own ids,
 * and whichever finished last would win - leaving the other's null sink and
 * remapped source loaded forever as phantom devices. A rejection must not wedge
 * the queue, so failures are swallowed for the purpose of ordering only.
 */
let lifecycleChain = Promise.resolve();
function serialize(fn) {
  const run = lifecycleChain.then(fn, fn);
  lifecycleChain = run.catch(() => {});
  return run;
}

async function connectAppSource(deviceId, opts = {}) {
  return serialize(() => connectAppSourceUnsafe(deviceId, opts));
}

async function disconnectAppSource(opts = {}) {
  return serialize(() => disconnectAppSourceUnsafe(opts));
}

module.exports = {
  parseAppStreams,
  resolvePortIds,
  bindCaptureSourceToSink,
  listAppSources,
  connectAppSource,
  disconnectAppSource,
  CAPTURE_SINK_NAME,
  CAPTURE_SOURCE_NAME,
  CAPTURE_SINK_DESCRIPTION,
};
