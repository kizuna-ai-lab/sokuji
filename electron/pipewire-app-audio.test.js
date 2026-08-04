import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseAppStreams,
  resolvePortIds,
  listAppSources,
  connectAppSource,
  disconnectAppSource,
  CAPTURE_SINK_DESCRIPTION,
} from './pipewire-app-audio.js';

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

// The module holds captureModuleId in module scope; release it between tests.
beforeEach(async () => { await disconnectAppSource({ exec: async () => ({ stdout: '' }) }); });

describe('connectAppSource', () => {
  it('creates the null sink and links every channel pair by numeric id', async () => {
    const calls = [];
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls) });

    expect(r.success).toBe(true);
    expect(r.monitorLabel).toBe(CAPTURE_SINK_DESCRIPTION);
    expect(calls.some((c) => c.includes('load-module module-null-sink') && c.includes('sokuji_app_capture'))).toBe(true);
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
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { dump: twoTabs }) });

    expect(r.success).toBe(true);
    expect(calls).toContain('pw-link 91 153');   // first stream
    expect(calls).toContain('pw-link 77 153');   // second stream
    expect(calls).toContain('pw-link 78 142');
  });

  it('fails cleanly when the application stopped playing before selection', async () => {
    const calls = [];
    // Enumeration and selection are seconds apart; the app can quit in between.
    const gone = FULL_DUMP.filter((o) => o.id !== 205);
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { dump: gone }) });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no longer playing/i);
    // Nothing was created, so nothing needs tearing down.
    expect(calls.some((c) => c.includes('load-module'))).toBe(false);
  });

  it('never moves the stream off its existing sink', async () => {
    const calls = [];
    await connectAppSource('app:pid:4242', { exec: fakeExec(calls) });
    // move-sink-input would steal the audio from the user's speakers.
    expect(calls.some((c) => c.includes('move-sink-input'))).toBe(false);
  });

  it('rejects a deviceId that is not an app: id', async () => {
    const calls = [];
    const r = await connectAppSource('desktop-audio-loopback', { exec: fakeExec(calls) });
    expect(r.success).toBe(false);
    expect(calls.some((c) => c.includes('load-module'))).toBe(false);
  });

  it('tears the sink back down when the target node has no ports', async () => {
    const calls = [];
    const dumpNoPorts = FULL_DUMP.filter((o) => o.type !== 'PipeWire:Interface:Port');
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { dump: dumpNoPorts }) });

    expect(r.success).toBe(false);
    // A leaked null sink shows up as a phantom device in system settings.
    expect(calls.some((c) => c.includes('unload-module 536870913'))).toBe(true);
  });

  it('refuses a module id that is not digits', async () => {
    const calls = [];
    // Anything but digits would later be interpolated into a shell string.
    const r = await connectAppSource('app:pid:4242', { exec: fakeExec(calls, { moduleId: '1; rm -rf /' }) });
    expect(r.success).toBe(false);
    expect(calls.some((c) => c.includes('rm -rf'))).toBe(false);
  });

  it('releases a previous tap before creating a new one', async () => {
    const calls = [];
    const exec = fakeExec(calls);
    await connectAppSource('app:pid:4242', { exec });
    calls.length = 0;
    await connectAppSource('app:pid:4242', { exec });

    // Two live taps would feed both applications into the same capture sink.
    expect(calls.some((c) => c.includes('unload-module 536870913'))).toBe(true);
  });
});

describe('disconnectAppSource', () => {
  it('unloads the module recorded by connect and is idempotent', async () => {
    const calls = [];
    const exec = fakeExec(calls);
    await connectAppSource('app:pid:4242', { exec });

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
