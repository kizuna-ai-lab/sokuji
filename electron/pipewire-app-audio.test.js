import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseAppStreams,
  resolvePortIds,
  listAppSources,
  connectAppSource,
  disconnectAppSource,
  CAPTURE_SINK_DESCRIPTION,
} from './pipewire-app-audio.js';
import { makeSelfIdentity } from './own-app-source.js';

// Shapes copied from a real `pw-dump` on PipeWire 1.x.
const NODE_STREAM = {
  id: 205,
  type: 'PipeWire:Interface:Node',
  info: {
    props: {
      'media.class': 'Stream/Output/Audio',
      'node.name': 'Chromium',
      'application.name': 'Chromium',
      'application.process.binary': 'chromium',
      'application.process.id': 4242,
    },
  },
};
const NODE_SINK = {
  id: 60,
  type: 'PipeWire:Interface:Node',
  info: { props: { 'media.class': 'Audio/Sink', 'node.name': 'alsa_output.hdmi' } },
};
const port = (id, nodeId, direction, portName) => ({
  id,
  type: 'PipeWire:Interface:Port',
  info: { direction, props: { 'node.id': nodeId, 'port.name': portName } },
});
const link = (id, outPort, inPort) => ({
  id,
  type: 'PipeWire:Interface:Link',
  info: { props: { 'link.output.port': outPort, 'link.input.port': inPort } },
});

describe('parseAppStreams', () => {
  it('returns one entry per application, keyed app:pid:<pid>', () => {
    expect(parseAppStreams([NODE_STREAM, NODE_SINK, port(91, 205, 'output', 'output_FL')])).toEqual([
      { deviceId: 'app:pid:4242', label: 'Chromium', pid: 4242, nodeIds: [205], binary: 'chromium' },
    ]);
  });

  it('collapses every stream of one process into a single entry', () => {
    // Chromium opens one stream per audio-producing tab. Six identical rows is
    // what the user actually saw, and capturing one node would have caught only
    // that tab's audio.
    const tabs = [205, 206, 207].map((id) => {
      const n = JSON.parse(JSON.stringify(NODE_STREAM));
      n.id = id;
      return n;
    });
    const result = parseAppStreams(tabs);
    expect(result).toHaveLength(1);
    expect(result[0].deviceId).toBe('app:pid:4242');
    expect(result[0].label).toBe('Chromium');
    expect(result[0].nodeIds).toEqual([205, 206, 207]);
  });

  it('keys streams with no pid by node so they are still selectable', () => {
    const noPid = {
      id: 9, type: 'PipeWire:Interface:Node',
      info: { props: { 'media.class': 'Stream/Output/Audio', 'application.name': 'Weird' } },
    };
    expect(parseAppStreams([noPid])[0].deviceId).toBe('app:node:9');
  });

  it('ignores sinks, ports and non-audio nodes', () => {
    expect(parseAppStreams([NODE_SINK, port(91, 205, 'output', 'output_FL')])).toEqual([]);
  });

  it('falls back to node.name then binary when application.name is absent', () => {
    const noAppName = {
      id: 7,
      type: 'PipeWire:Interface:Node',
      info: { props: { 'media.class': 'Stream/Output/Audio', 'node.name': 'mpv', 'application.process.binary': 'mpv' } },
    };
    expect(parseAppStreams([noAppName])[0].label).toBe('mpv');
  });

  it('suffixes the pid only when two separate processes share a name', () => {
    const a = JSON.parse(JSON.stringify(NODE_STREAM));
    const b = JSON.parse(JSON.stringify(NODE_STREAM));
    b.id = 206;
    b.info.props['application.process.id'] = 4243;
    expect(parseAppStreams([a, b]).map((s) => s.label)).toEqual(['Chromium (4242)', 'Chromium (4243)']);
  });

  it('leaves a single instance unsuffixed', () => {
    // The common case must read as plain "Chromium", not "Chromium (4242)".
    expect(parseAppStreams([NODE_STREAM])[0].label).toBe('Chromium');
  });

  it('tolerates malformed objects without throwing', () => {
    expect(parseAppStreams([null, {}, { type: 'PipeWire:Interface:Node' }])).toEqual([]);
    expect(parseAppStreams(null)).toEqual([]);
  });
});

describe('resolvePortIds', () => {
  // Real dumps list FR before FL; sorting by port.name is what makes the
  // out[i] -> in[i] pairing line up channel-for-channel.
  const dump = [
    port(55, 205, 'output', 'output_FR'),
    port(91, 205, 'output', 'output_FL'),
    port(153, 300, 'input', 'playback_FL'),
    port(142, 300, 'input', 'playback_FR'),
    port(99, 999, 'output', 'output_FL'),
  ];

  it("returns this node's output port ids sorted by port name", () => {
    expect(resolvePortIds(dump, 205, 'output')).toEqual([91, 55]);
  });

  it("returns this node's input port ids sorted by port name", () => {
    expect(resolvePortIds(dump, 300, 'input')).toEqual([153, 142]);
  });

  it('returns an empty array for an unknown node', () => {
    expect(resolvePortIds(dump, 12345, 'output')).toEqual([]);
  });

  it('tolerates a malformed dump', () => {
    expect(resolvePortIds(null, 205, 'output')).toEqual([]);
  });
});

// A graph with one app (node 205, ports 91/55) and our capture sink (node 300).
const FULL_DUMP = [
  NODE_STREAM,
  {
    id: 300,
    type: 'PipeWire:Interface:Node',
    info: { props: { 'media.class': 'Audio/Sink', 'node.name': 'sokuji_app_capture' } },
  },
  port(91, 205, 'output', 'output_FL'),
  port(55, 205, 'output', 'output_FR'),
  port(153, 300, 'input', 'playback_FL'),
  port(142, 300, 'input', 'playback_FR'),
];

function fakeExec(calls, { dump = FULL_DUMP, moduleId = '536870913' } = {}) {
  return async (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('pw-dump')) return { stdout: JSON.stringify(dump) };
    if (cmd.includes('load-module')) return { stdout: `${moduleId}\n` };
    return { stdout: '' };
  };
}

// Binding retries on a real timer. No test here is about timing, so none of
// them should sit through it.
const noWait = async () => {};

// The module holds captureModuleId in module scope; release it between tests.
beforeEach(async () => { await disconnectAppSource({ exec: async () => ({ stdout: '' }) }); });

describe('connectAppSource', () => {
  it('creates the null sink and links every channel pair by numeric id', async () => {
    const calls = [];
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls), delay: noWait });

    expect(r.success).toBe(true);
    expect(r.monitorLabel).toBe(CAPTURE_SINK_DESCRIPTION);
    expect(calls.some((c) => c.includes('load-module module-null-sink') && c.includes('sokuji_app_capture'))).toBe(true);
    // Chromium never lists a monitor source among audioinput devices, so the
    // sink alone leaves the renderer nothing to record and every session
    // silently captures the whole system instead. A remapped source over that
    // monitor is a real source and does get listed.
    expect(calls.some((c) => c.includes('load-module module-remap-source')
      && c.includes('master=sokuji_app_capture.monitor'))).toBe(true);
    // Descriptions go through pactl's whitespace-split argument parsing, so a
    // space here is silently truncated and the label stops matching. Assert both
    // the invariant and the exact value the renderer looks for.
    expect(calls.filter((c) => c.includes('device.description'))
      .every((c) => !/device\.description="[^"]*\s/.test(c))).toBe(true);
    expect(calls.some((c) =>
      c.includes(`sink_properties=device.description="${CAPTURE_SINK_DESCRIPTION}"`))).toBe(true);
    expect(calls).toContain('pw-link 91 153');
    expect(calls).toContain('pw-link 55 142');
  });

  it('links every stream the application owns, not just the first', async () => {
    // One node per Chromium tab: linking only one would capture one tab and
    // silently miss the rest, which is the whole point of grouping by pid.
    const twoTabs = [
      ...FULL_DUMP,
      { id: 206, type: 'PipeWire:Interface:Node', info: { props: {
          'media.class': 'Stream/Output/Audio', 'application.name': 'Chromium',
          'application.process.id': 4242 } } },
      port(77, 206, 'output', 'output_FL'),
      port(78, 206, 'output', 'output_FR'),
    ];
    const calls = [];
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { dump: twoTabs }), delay: noWait });

    expect(r.success).toBe(true);
    expect(calls).toContain('pw-link 91 153');   // first stream
    expect(calls).toContain('pw-link 77 153');   // second stream
    expect(calls).toContain('pw-link 78 142');
  });

  it('fails cleanly when the application stopped playing before selection', async () => {
    const calls = [];
    // Enumeration and selection are seconds apart; the app can quit in between.
    const gone = FULL_DUMP.filter((o) => o.id !== 205);
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { dump: gone }), delay: noWait });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no longer playing/i);
    // Nothing was created, so nothing needs tearing down.
    expect(calls.some((c) => c.includes('load-module'))).toBe(false);
  });

  it('never moves the stream off its existing sink', async () => {
    const calls = [];
    await connectAppSource('app:pid:4242', { exec: fakeExec(calls), delay: noWait });
    // move-sink-input would steal the audio from the user's speakers.
    expect(calls.some((c) => c.includes('move-sink-input'))).toBe(false);
  });

  it('rejects a deviceId that is not an app: id', async () => {
    const calls = [];
    const r = await connectAppSource('desktop-audio-loopback', { exec: fakeExec(calls), delay: noWait });
    expect(r.success).toBe(false);
    expect(calls.some((c) => c.includes('load-module'))).toBe(false);
  });

  it('tears the sink back down when the target node has no ports', async () => {
    const calls = [];
    const dumpNoPorts = FULL_DUMP.filter((o) => o.type !== 'PipeWire:Interface:Port');
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { dump: dumpNoPorts }), delay: noWait });

    expect(r.success).toBe(false);
    // A leaked null sink shows up as a phantom device in system settings.
    expect(calls.some((c) => c.includes('unload-module 536870913'))).toBe(true);
  });

  it('refuses a module id that is not digits', async () => {
    const calls = [];
    // Anything but digits would later be interpolated into a shell string.
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { moduleId: '1; rm -rf /' }), delay: noWait });
    expect(r.success).toBe(false);
    expect(calls.some((c) => c.includes('rm -rf'))).toBe(false);
  });

  it('releases a previous tap before creating a new one', async () => {
    const calls = [];
    const exec = fakeExec(calls);
    await connectAppSource('app:pid:4242', { exec, delay: noWait });
    calls.length = 0;
    await connectAppSource('app:pid:4242', { exec, delay: noWait });

    // Two live taps would feed both applications into the same capture sink.
    expect(calls.some((c) => c.includes('unload-module 536870913'))).toBe(true);
  });
});

// The graph a real PipeWire 0.3.x leaves behind once both modules are loaded:
// the remapped source's capture stream (node 400) exists, but the session
// manager has autoconnected it to the default *microphone* rather than to the
// capture sink's monitor, because master= resolves to nothing on that version.
const DUMP_MISWIRED = [
  ...FULL_DUMP,
  port(310, 300, 'output', 'monitor_FL'),
  port(311, 300, 'output', 'monitor_FR'),
  {
    id: 400,
    type: 'PipeWire:Interface:Node',
    info: { props: { 'media.class': 'Stream/Input/Audio', 'node.name': 'input.sokuji_app_capture_mic' } },
  },
  port(401, 400, 'input', 'input_FL'),
  port(402, 400, 'input', 'input_FR'),
  {
    id: 500,
    type: 'PipeWire:Interface:Node',
    info: { props: { 'media.class': 'Audio/Source', 'node.name': 'alsa_input.builtin_mic' } },
  },
  port(501, 500, 'output', 'capture_FL'),
  port(502, 500, 'output', 'capture_FR'),
  link(600, 501, 401),
  link(601, 502, 402),
];

// Same graph, but already wired the way PipeWire 1.x does it.
const DUMP_CORRECT = [
  ...DUMP_MISWIRED.filter((o) => o.type !== 'PipeWire:Interface:Link'),
  link(600, 310, 401),
  link(601, 311, 402),
];

// The capture sink gone from under us, with the remap stream still present.
const DUMP_SINK_GONE = DUMP_MISWIRED.filter((o) =>
  o.id !== 300 && o?.info?.props?.['node.id'] !== 300);

// A stream with one more input than the sink has monitor ports. Contrived -
// both derive from the same null sink - but the pairing must not quietly wire
// the overlap and clear the rest.
const DUMP_UNEVEN_PORTS = [
  ...DUMP_MISWIRED,
  port(403, 400, 'input', 'input_RC'),
];

/**
 * Returns each dump in turn: the first for every pw-dump before the capture
 * modules exist, the next for every one after. Lets a test change the graph
 * out from under the binding loop.
 */
function fakeExecStages(calls, dumps, { moduleId = '536870913' } = {}) {
  let seen = 0;
  return async (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('pw-dump')) {
      const dump = dumps[Math.min(seen, dumps.length - 1)];
      seen++;
      return { stdout: JSON.stringify(dump) };
    }
    if (cmd.includes('load-module')) return { stdout: `${moduleId}\n` };
    return { stdout: '' };
  };
}

/**
 * A fake graph that responds to the edits made to it, so a repair can be
 * observed converging instead of asserted one call at a time. `pw-link` adds a
 * link and `pw-link -d` removes one, exactly as they do on a real graph.
 */
function fakeExecLiveGraph(calls, initial, { moduleId = '536870913', hideStreamUntilDump = 0 } = {}) {
  const nodesAndPorts = initial.filter((o) => o.type !== 'PipeWire:Interface:Link');
  let links = initial.filter((o) => o.type === 'PipeWire:Interface:Link');
  let nextLinkId = 900;
  let dumps = 0;

  return async (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('pw-dump')) {
      dumps++;
      // pactl hands back a module id the moment the module loads, but PipeWire
      // publishes the node into the graph a moment later. Hide it for the first
      // few dumps to reproduce that gap.
      const nodes = dumps <= hideStreamUntilDump
        ? nodesAndPorts.filter((o) => o.id !== 400 && o?.info?.props?.['node.id'] !== 400)
        : nodesAndPorts;
      return { stdout: JSON.stringify([...nodes, ...links]) };
    }
    if (cmd.includes('load-module')) return { stdout: `${moduleId}\n` };

    const cut = cmd.match(/^pw-link -d (\d+) (\d+)$/);
    if (cut) {
      links = links.filter((l) => l.info.props['link.output.port'] !== Number(cut[1])
        || l.info.props['link.input.port'] !== Number(cut[2]));
      return { stdout: '' };
    }
    const join = cmd.match(/^pw-link (\d+) (\d+)$/);
    if (join) {
      links = [...links, link(nextLinkId++, Number(join[1]), Number(join[2]))];
      return { stdout: '' };
    }
    return { stdout: '' };
  };
}

describe('the remapped source is bound to the capture sink, not the default input', () => {
  // master= is only a hint: pactl turns it into node.target, and on PipeWire
  // 0.3.x "<sink>.monitor" resolves to no node at all. node.autoconnect then
  // sends the stream to the default source, so every application the user picks
  // yields the same audio - whatever the default input happens to carry.
  // Reproduced on PipeWire 0.3.48.

  it('drops the autoconnected link and links the sink monitor instead', async () => {
    const calls = [];
    const r = await connectAppSource('app:pid:4242', {
      exec: fakeExecLiveGraph(calls, DUMP_MISWIRED),
      delay: async () => {},
    });

    expect(r.success).toBe(true);
    expect(calls).toContain('pw-link -d 501 401');
    expect(calls).toContain('pw-link -d 502 402');
    expect(calls).toContain('pw-link 310 401');
    expect(calls).toContain('pw-link 311 402');
  });

  it('leaves a correctly wired graph untouched', async () => {
    const calls = [];
    const r = await connectAppSource('app:pid:4242', {
      exec: fakeExecLiveGraph(calls, DUMP_CORRECT),
      delay: async () => {},
    });

    expect(r.success).toBe(true);
    expect(calls.some((c) => c.startsWith('pw-link -d'))).toBe(false);
    // Already linked; relinking would error on a real graph.
    expect(calls).not.toContain('pw-link 310 401');
  });

  it('fails the tap rather than capturing the wrong device', async () => {
    // A static dump stands in for a session manager that reinstates its link
    // every time. The user picked one application; handing them their
    // microphone instead has to fail loudly, not record the wrong thing.
    const calls = [];
    const r = await connectAppSource('app:pid:4242', {
      exec: fakeExec(calls, { dump: DUMP_MISWIRED }),
      delay: async () => {},
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/capture source/i);
    // And it must not leave the phantom devices behind.
    expect(calls.some((c) => c.includes('unload-module'))).toBe(true);
  });

  it('leaves an unrecognised graph alone instead of guessing', async () => {
    // A PipeWire that builds the remap some other way exposes no
    // input.<source> stream node. Rewiring blind would be worse than nothing.
    const calls = [];
    const r = await connectAppSource('app:pid:4242', {
      exec: fakeExec(calls),   // FULL_DUMP has no remap stream node
      delay: async () => {},
    });

    expect(r.success).toBe(true);
    expect(calls.some((c) => c.startsWith('pw-link -d'))).toBe(false);
  });

  it('waits for a remap stream that PipeWire has not published yet', async () => {
    // pactl returns the module id as soon as the module loads; the node reaches
    // the graph afterwards. Calling the shape unsupported on the first look
    // reports success having never examined the autoconnected links - which is
    // this bug all over again, on a slower machine.
    const calls = [];
    const r = await connectAppSource('app:pid:4242', {
      // Dumps 1 and 2 resolve the application and the new sink; dump 3 is the
      // first binding attempt, and the stream only shows up for dump 4.
      exec: fakeExecLiveGraph(calls, DUMP_MISWIRED, { hideStreamUntilDump: 3 }),
      delay: async () => {},
    });

    expect(r.success).toBe(true);
    // It must have actually done the repair, not shrugged and returned early.
    expect(calls).toContain('pw-link -d 501 401');
    expect(calls).toContain('pw-link 310 401');
  });

  it('fails when the capture sink disappears before binding', async () => {
    // The sink is ours: module-null-sink created it and it was already found
    // once, with ports, before we got here. Its absence now is not an
    // unrecognised remap shape - it means this tap can never carry audio, and
    // reporting success would send the renderer to whole-system capture.
    const calls = [];
    const r = await connectAppSource('app:pid:4242', {
      // Two dumps happen before binding starts: resolving the application, then
      // finding the freshly loaded sink. The sink goes missing only after that.
      exec: fakeExecStages(calls, [DUMP_MISWIRED, DUMP_MISWIRED, DUMP_SINK_GONE]),
      delay: async () => {},
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/capture source/i);
    expect(calls.some((c) => c.includes('unload-module'))).toBe(true);
  });

  it('refuses to half-wire a graph whose port counts do not line up', async () => {
    // Pairing the shorter list while clearing links from every input leaves the
    // surplus input connected to nothing, and the next pass sees a graph it has
    // no complaint about - success reported over a channel of silence.
    const calls = [];
    const r = await connectAppSource('app:pid:4242', {
      exec: fakeExecLiveGraph(calls, DUMP_UNEVEN_PORTS),
      delay: async () => {},
    });

    expect(r.success).toBe(false);
    // Better to leave the graph as found than to rewire part of it.
    expect(calls.some((c) => c.startsWith('pw-link -d'))).toBe(false);
    expect(calls.some((c) => c === 'pw-link 310 401')).toBe(false);
  });
});

describe('disconnectAppSource', () => {
  it('unloads the module recorded by connect and is idempotent', async () => {
    const calls = [];
    const exec = fakeExec(calls);
    await connectAppSource('app:pid:4242', { exec, delay: noWait });

    expect((await disconnectAppSource({ exec })).success).toBe(true);
    expect(calls.some((c) => c.includes('unload-module 536870913'))).toBe(true);

    const before = calls.length;
    expect((await disconnectAppSource({ exec })).success).toBe(true);
    expect(calls.length).toBe(before); // nothing left to unload
  });
});

describe('listAppSources', () => {
  // Window-title enrichment is opt-in per call; default it off so the existing
  // expectations describe the plain PipeWire names.
  const noTitles = async () => new Map();

  it('prefers the window title over the bare application name', async () => {
    // PipeWire reports "Chromium"/"Playback" for every browser window alike.
    const windowTitles = async () => new Map([[4242, 'YouTube - Chromium']]);
    const r = await listAppSources({ exec: fakeExec([]), windowTitles });
    // The window title labels the row, but the binary is what identifies the
    // application next launch - titles change with whatever it is showing.
    expect(r).toEqual([{ deviceId: 'app:pid:4242', label: 'YouTube - Chromium', appKey: 'chromium' }]);
  });

  it('keeps a long title intact for the UI to ellipsise', async () => {
    // The device row already truncates in CSS and shows the full text on hover;
    // trimming here would throw that information away.
    const long = 'x'.repeat(120);
    const windowTitles = async () => new Map([[4242, long]]);
    const [row] = await listAppSources({ exec: fakeExec([]), windowTitles });
    expect(row.label).toBe(long);
  });

  it('keeps the application name when no window matches', async () => {
    // Wayland, no xprop, or a process with no window at all.
    const r = await listAppSources({ exec: fakeExec([]), windowTitles: noTitles });
    expect(r).toEqual([{ deviceId: 'app:pid:4242', label: 'Chromium', appKey: 'chromium' }]);
  });

  it('keeps the application name when title lookup throws', async () => {
    const boom = async () => { throw new Error('xprop exploded'); };
    const r = await listAppSources({ exec: fakeExec([]), windowTitles: boom });
    expect(r).toEqual([{ deviceId: 'app:pid:4242', label: 'Chromium', appKey: 'chromium' }]);
  });

  it('returns only playback streams, projected to {deviceId,label}', async () => {
    // The capture sink in FULL_DUMP is an Audio/Sink, so it must not be listed.
    expect(await listAppSources({ exec: fakeExec([]), windowTitles: noTitles }))
      .toEqual([{ deviceId: 'app:pid:4242', label: 'Chromium', appKey: 'chromium' }]);
  });

  it('never lists the running app itself', async () => {
    // Sokuji's TTS playback is an ordinary Stream/Output/Audio node. On Linux
    // the stream belongs to Chromium's audio-service utility process, so both
    // the binary name and the utility pid must count as "us".
    const ownByBinary = {
      id: 401,
      type: 'PipeWire:Interface:Node',
      info: {
        props: {
          'media.class': 'Stream/Output/Audio',
          'application.name': 'Sokuji',
          'application.process.binary': 'sokuji',
          'application.process.id': 7001,
        },
      },
    };
    const ownByPid = {
      id: 402,
      type: 'PipeWire:Interface:Node',
      info: {
        props: {
          'media.class': 'Stream/Output/Audio',
          'application.name': 'Electron',
          'application.process.binary': 'electron',
          'application.process.id': 9999,
        },
      },
    };
    const selfIdentity = makeSelfIdentity({ execPath: '/usr/lib/sokuji/sokuji', pids: [9000, 9999] });
    const sources = await listAppSources({
      exec: fakeExec([], { dump: [...FULL_DUMP, ownByBinary, ownByPid] }),
      windowTitles: noTitles,
      selfIdentity,
    });
    expect(sources.map((s) => s.label)).toEqual(['Chromium']);
  });

  it('never lists a leaked capture sink from a previous session', async () => {
    const leaked = {
      id: 400,
      type: 'PipeWire:Interface:Node',
      info: { props: { 'media.class': 'Stream/Output/Audio', 'application.name': CAPTURE_SINK_DESCRIPTION } },
    };
    const sources = await listAppSources({ exec: fakeExec([], { dump: [...FULL_DUMP, leaked] }), windowTitles: noTitles });
    expect(sources.map((s) => s.label)).toEqual(['Chromium']);
  });

  it('returns an empty array when pw-dump is unavailable', async () => {
    const exec = async () => { throw new Error('ENOENT'); };
    expect(await listAppSources({ exec, windowTitles: noTitles })).toEqual([]);
  });
});

// Review finding: both entry points mutate the same two module ids. Two
// overlapping connects each tore down, then each stored its own ids, and the
// loser's null sink and remapped source stayed loaded as phantom devices.
describe('capture lifecycle is serialized', () => {
  it('does not interleave two overlapping connects', async () => {
    const order = [];
    let moduleId = 536870913;
    const exec = async (cmd) => {
      if (cmd.startsWith('pw-dump')) return { stdout: JSON.stringify(FULL_DUMP) };
      // Check unload first: 'unload-module' contains 'load-module'.
      if (cmd.includes('unload-module')) { order.push('unload'); return { stdout: '' }; }
      if (cmd.includes('load-module')) {
        order.push(`load ${cmd.includes('null-sink') ? 'sink' : 'source'}`);
        // A gap wide enough for a concurrent call to slip in, if it could.
        await new Promise((r) => setTimeout(r, 5));
        return { stdout: `${moduleId++}\n` };
      }
      return { stdout: '' };
    };

    await Promise.all([
      connectAppSource('app:pid:4242', { exec, delay: noWait }),
      connectAppSource('app:pid:4242', { exec, delay: noWait }),
    ]);
    await disconnectAppSource({ exec });

    // Each connect loads a sink then its source. Interleaving would read
    // sink, sink, source, source and leave one pair loaded forever.
    expect(order.filter((o) => o.startsWith('load')))
      .toEqual(['load sink', 'load source', 'load sink', 'load source']);
  });
});
