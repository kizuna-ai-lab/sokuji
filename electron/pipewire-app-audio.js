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

const STREAM_CLASS = 'Stream/Output/Audio';
const CAPTURE_SINK_NAME = 'sokuji_app_capture';
const CAPTURE_SINK_DESCRIPTION = 'Sokuji App Capture';

// Module id of the null sink created by connectAppSource(), so disconnect can
// unload exactly the module we made instead of pattern-matching the graph.
let captureModuleId = null;

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

/**
 * List the applications currently playing audio.
 * @returns {Promise<Array<{deviceId: string, label: string}>>}
 */
async function listAppSources({ exec = defaultExec } = {}) {
  try {
    return parseAppStreams(await dumpGraph(exec))
      // A crashed session can leave our capture sink behind; offering it would
      // let the user capture Sokuji's own tap.
      .filter((s) => s.label !== CAPTURE_SINK_DESCRIPTION)
      .map(({ deviceId, label }) => ({ deviceId, label }));
  } catch (e) {
    console.warn('[Sokuji] [PipeWire] Failed to list application audio sources:', e.message);
    return [];
  }
}

/**
 * Tap one application's audio.
 * @param {string} deviceId - `app:<nodeId>`
 * @returns {Promise<{success: boolean, monitorLabel?: string, error?: string}>}
 */
async function connectAppSource(deviceId, { exec = defaultExec } = {}) {
  const id = String(deviceId);
  if (!id.startsWith('app:')) {
    return { success: false, error: `Not an application source: ${deviceId}` };
  }

  // A previous selection must be torn down first, or its links keep feeding the
  // same capture sink and both applications are translated at once.
  await disconnectAppSource({ exec });

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

    return { success: true, monitorLabel: CAPTURE_SINK_DESCRIPTION };
  } catch (e) {
    // Never leave the null sink behind: it shows up as a phantom audio device
    // in the user's system settings and outlives the app.
    await disconnectAppSource({ exec });
    return { success: false, error: `Failed to link application audio: ${e.message}` };
  }
}

/**
 * Remove the capture sink. Its links die with it.
 * Safe to call when nothing is connected.
 * @returns {Promise<{success: boolean}>}
 */
async function disconnectAppSource({ exec = defaultExec } = {}) {
  if (!captureModuleId) return { success: true };
  try {
    await exec(`pactl unload-module ${captureModuleId}`);
  } catch (e) {
    console.warn('[Sokuji] [PipeWire] Failed to unload capture sink:', e.message);
  }
  captureModuleId = null;
  return { success: true };
}

module.exports = {
  parseAppStreams,
  resolvePortIds,
  listAppSources,
  connectAppSource,
  disconnectAppSource,
  CAPTURE_SINK_NAME,
  CAPTURE_SINK_DESCRIPTION,
};
