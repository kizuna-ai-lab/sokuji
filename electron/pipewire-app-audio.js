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
 * Extract the selectable per-application audio streams from a `pw-dump` array.
 * @param {object[]} dump
 * @returns {Array<{deviceId: string, label: string, nodeId: number, pid: number|null, binary: string|null}>}
 */
function parseAppStreams(dump) {
  if (!Array.isArray(dump)) return [];

  const streams = [];
  for (const obj of dump) {
    const props = obj?.info?.props;
    if (!props || obj.type !== 'PipeWire:Interface:Node') continue;
    if (props['media.class'] !== STREAM_CLASS) continue;

    const pidRaw = props['application.process.id'];
    const pid = typeof pidRaw === 'number' ? pidRaw : null;
    const binary = props['application.process.binary'] ?? null;
    const name = props['application.name'] ?? props['node.name'] ?? binary;
    if (typeof obj.id !== 'number' || !name) continue;

    streams.push({ deviceId: `app:${obj.id}`, label: name, nodeId: obj.id, pid, binary });
  }

  // Two windows of the same app produce identical labels, giving the picker two
  // indistinguishable rows. Suffix the pid only where labels actually collide.
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
  const nodeId = Number.parseInt(String(deviceId).replace(/^app:/, ''), 10);
  if (!String(deviceId).startsWith('app:') || !Number.isInteger(nodeId)) {
    return { success: false, error: `Not an application source: ${deviceId}` };
  }

  // A previous selection must be torn down first, or its links keep feeding the
  // same capture sink and both applications are translated at once.
  await disconnectAppSource({ exec });

  try {
    const { stdout } = await exec(
      `pactl load-module module-null-sink sink_name=${CAPTURE_SINK_NAME} ` +
      `sink_properties=device.description="${CAPTURE_SINK_DESCRIPTION}"`
    );
    const id = stdout.trim();
    // Everything interpolated into a shell string here is either a module
    // constant or an integer we validated. This id comes back from pactl, so
    // pin it to digits before it is ever interpolated again.
    if (!/^\d+$/.test(id)) {
      throw new Error(`pactl returned an unexpected module id: ${JSON.stringify(id)}`);
    }
    captureModuleId = id;
  } catch (e) {
    return { success: false, error: `Failed to create capture sink: ${e.message}` };
  }

  try {
    const dump = await dumpGraph(exec);
    const sink = dump.find((o) =>
      o?.type === 'PipeWire:Interface:Node' &&
      o?.info?.props?.['node.name'] === CAPTURE_SINK_NAME);

    const outs = resolvePortIds(dump, nodeId, 'output');
    const ins = sink ? resolvePortIds(dump, sink.id, 'input') : [];
    if (outs.length === 0 || ins.length === 0) {
      throw new Error('no ports to link (the application may have stopped playing)');
    }

    for (let i = 0; i < Math.min(outs.length, ins.length); i++) {
      // resolvePortIds only ever yields numbers, but assert it: these are the
      // only caller-influenced values reaching a shell string.
      const out = Number(outs[i]);
      const inp = Number(ins[i]);
      if (!Number.isInteger(out) || !Number.isInteger(inp)) {
        throw new Error('refusing to link non-numeric port ids');
      }
      await exec(`pw-link ${out} ${inp}`);
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
