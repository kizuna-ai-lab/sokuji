// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { getOutputDevices, createSinkWatcher, registerOutputFormFactor } from './output-form-factor.js';

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  // A real killed child still reports its exit, with a null code.
  c.kill = vi.fn((signal) => queueMicrotask(() => c.emit('close', null, signal)));
  return c;
}

// A spawn whose child answers per call: `answer(command, args)` returns
// { code, out } or null to leave the child hanging.
function scriptedSpawn(answer) {
  const calls = [];
  const spawn = vi.fn((command, args, options) => {
    const child = fakeChild();
    calls.push({ command, args, options, child });
    const res = answer(command, args);
    if (res) {
      setImmediate(() => {
        if (res.out) child.stdout.emit('data', Buffer.from(res.out));
        child.emit('close', res.code);
      });
    }
    return child;
  });
  spawn.calls = calls;
  return spawn;
}

const resolvePath = () => '/opt/helper';
const macRow = {
  label: 'Headphones',
  browserLabel: 'External Headphones',
  uid: 'u1',
  isDefault: true,
  transport: 'bltn',
  dataSource: 'hdpn',
  terminalType: 0,
};
const macOut = JSON.stringify([macRow]);

afterEach(() => vi.useRealTimers());

describe('getOutputDevices', () => {
  it("macOS runs the helper's --devices and maps it", async () => {
    const spawn = scriptedSpawn(() => ({ code: 0, out: macOut }));
    const res = await getOutputDevices({ platform: 'darwin', spawn, resolvePath });
    expect(spawn.calls[0].command).toBe('/opt/helper');
    expect(spawn.calls[0].args).toEqual(['--devices']);
    expect(res.ok).toBe(true);
    expect(res.devices).toHaveLength(1);
    expect(res.devices[0]).toMatchObject({ label: 'External Headphones', isDefault: true, formFactor: 'headphones' });
  });

  it('no helper path is no_helper', async () => {
    const spawn = scriptedSpawn(() => ({ code: 0, out: '[]' }));
    expect(await getOutputDevices({ platform: 'win32', spawn, resolvePath: () => null })).toEqual({
      ok: false,
      reason: 'no_helper',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a non-zero exit is exit_<code>', async () => {
    const spawn = scriptedSpawn(() => ({ code: 1, out: '' }));
    expect(await getOutputDevices({ platform: 'darwin', spawn, resolvePath })).toEqual({ ok: false, reason: 'exit_1' });
  });

  it('unparsable output is unparsable', async () => {
    const spawn = scriptedSpawn(() => ({ code: 0, out: 'not json' }));
    expect(await getOutputDevices({ platform: 'darwin', spawn, resolvePath })).toEqual({
      ok: false,
      reason: 'unparsable',
    });
  });

  it('a spawn that throws or a child error is spawn_failed', async () => {
    const throwing = vi.fn(() => {
      throw new Error('ENOENT');
    });
    expect(await getOutputDevices({ platform: 'darwin', spawn: throwing, resolvePath })).toEqual({
      ok: false,
      reason: 'spawn_failed',
    });
    const erroring = vi.fn(() => {
      const c = fakeChild();
      setImmediate(() => c.emit('error', new Error('boom')));
      return c;
    });
    expect(await getOutputDevices({ platform: 'darwin', spawn: erroring, resolvePath })).toEqual({
      ok: false,
      reason: 'spawn_failed',
    });
  });

  it('a helper that never exits is killed at 3 s', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const pending = getOutputDevices({ platform: 'darwin', spawn, resolvePath });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('output past 1 MiB kills the child and is unparsable', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1, 'a')));
      return child;
    });
    expect(await getOutputDevices({ platform: 'darwin', spawn, resolvePath })).toEqual({
      ok: false,
      reason: 'unparsable',
    });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('an empty array is a real answer', async () => {
    const spawn = scriptedSpawn(() => ({ code: 0, out: '[]' }));
    expect(await getOutputDevices({ platform: 'win32', spawn, resolvePath })).toEqual({ ok: true, devices: [] });
  });

  const sinksJson = JSON.stringify([
    { name: 'alsa_output.pci', description: 'Built-in Audio', properties: { 'device.form_factor': 'headphone' }, ports: [] },
  ]);
  const infoJson = JSON.stringify({ default_sink_name: 'alsa_output.pci' });

  it('linux reads run pactl with LC_ALL=C', async () => {
    const spawn = scriptedSpawn((cmd, args) => ({ code: 0, out: args.includes('info') ? infoJson : sinksJson }));
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(res.ok).toBe(true);
    expect(res.devices[0]).toMatchObject({ label: 'Built-in Audio', isDefault: true });
    expect(spawn.calls.length).toBeGreaterThan(0);
    for (const c of spawn.calls) {
      expect(c.command).toBe('pactl');
      expect(c.options.env.LC_ALL).toBe('C');
    }
  });

  it('linux falls back to text when -f json fails', async () => {
    const textSinks = [
      'Sink #1',
      '\tState: RUNNING',
      '\tName: alsa_output.text',
      '\tDescription: Text Sink',
      '\tProperties:',
      '\t\tdevice.form_factor = "speaker"',
      '',
    ].join('\n');
    const spawn = scriptedSpawn((cmd, args) => {
      const json = args.includes('json');
      if (json && args.includes('sinks')) return { code: 1, out: '' };
      if (args.includes('info')) return { code: 0, out: json ? infoJson : 'Default Sink: alsa_output.text\n' };
      return { code: 0, out: textSinks };
    });
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(res.ok).toBe(true);
    expect(res.devices[0]).toMatchObject({ label: 'Text Sink', isDefault: true, formFactor: 'speakers' });
    expect(spawn.calls.some((c) => !c.args.includes('json'))).toBe(true);
  });

  // PipeWire 0.3 (Ubuntu 22.04) keeps device.bus on the card: the read lists the cards too.
  const busless = JSON.stringify([
    { name: 'alsa_output.pci', description: 'Built-in Audio', properties: { 'device.id': '48' }, ports: [] },
  ]);
  const cardsJson = JSON.stringify([{ name: 'alsa_card.pci', properties: { 'object.id': '48', 'device.bus': 'pci' } }]);

  it("linux reads the cards and fills in a sink's missing bus from its card", async () => {
    const spawn = scriptedSpawn((cmd, args) => {
      if (args.includes('info')) return { code: 0, out: infoJson };
      return { code: 0, out: args.includes('cards') ? cardsJson : busless };
    });
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(spawn.calls.map((c) => c.args)).toContainEqual(['-f', 'json', 'list', 'cards']);
    expect(res).toMatchObject({ ok: true, devices: [{ label: 'Built-in Audio', transport: 'builtin' }] });
  });

  it('a failed cards read costs only the bus, never the devices', async () => {
    for (const cards of [{ code: 1, out: '' }, { code: 0, out: 'not json' }]) {
      const spawn = scriptedSpawn((cmd, args) => {
        if (args.includes('info')) return { code: 0, out: infoJson };
        return args.includes('cards') ? cards : { code: 0, out: busless };
      });
      const res = await getOutputDevices({ platform: 'linux', spawn });
      expect(res).toMatchObject({ ok: true, devices: [{ label: 'Built-in Audio', isDefault: true, transport: 'unknown' }] });
      // The json attempt stands: a bad cards answer does not send the read to the text form.
      expect(spawn.calls.every((c) => c.args.includes('json'))).toBe(true);
    }
  });

  // The cards only add a bus: a cards child that never exits must not cost the devices.
  it('a hung cards read is stopped 500 ms after the sinks are in, and the devices still return', async () => {
    vi.useFakeTimers();
    const spawn = scriptedSpawn((cmd, args) => {
      if (args.includes('cards')) return null;
      return { code: 0, out: args.includes('info') ? infoJson : busless };
    });
    let result;
    getOutputDevices({ platform: 'linux', spawn }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(499);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    expect(result).toMatchObject({ ok: true, devices: [{ label: 'Built-in Audio', isDefault: true, transport: 'unknown' }] });
    const cards = spawn.calls.find((c) => c.args.includes('cards'));
    expect(cards.child.kill).toHaveBeenCalledWith('SIGKILL');
    // The json attempt stood: no text read was started.
    expect(spawn.calls).toHaveLength(3);
  });

  it('a slow cards read that answers within 500 ms of the sinks still supplies the bus', async () => {
    vi.useFakeTimers();
    const spawn = scriptedSpawn((cmd, args) => {
      if (args.includes('cards')) return null;
      return { code: 0, out: args.includes('info') ? infoJson : busless };
    });
    let result;
    getOutputDevices({ platform: 'linux', spawn }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(300);
    const cards = spawn.calls.find((c) => c.args.includes('cards')).child;
    cards.stdout.emit('data', Buffer.from(cardsJson));
    cards.emit('close', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toMatchObject({ ok: true, devices: [{ transport: 'builtin' }] });
    expect(cards.kill).not.toHaveBeenCalled();
  });

  it('a read that fails on the sinks stops its cards child', async () => {
    const spawn = scriptedSpawn((cmd, args) => {
      if (args.includes('cards')) return null;
      return { code: 1, out: '' };
    });
    // Both forms fail on the sinks long before the deadline, which would kill what is left.
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(res).toEqual({ ok: false, reason: 'exit_1' });
    const cards = spawn.calls.filter((c) => c.args.includes('cards'));
    expect(cards).toHaveLength(2);
    for (const c of cards) expect(c.child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('the text form lists the cards in text too', async () => {
    const textSinks = ['Sink #1', '\tName: a', '\tDescription: A', '\tProperties:', '\t\tdevice.id = "48"', ''].join('\n');
    const textCards = ['Card #47', '\tName: alsa_card.pci', '\tProperties:', '\t\tdevice.bus = "pci"', '\t\tobject.id = "48"', ''].join('\n');
    const spawn = scriptedSpawn((cmd, args) => {
      if (args.includes('json')) return { code: 1, out: '' };
      if (args.includes('info')) return { code: 0, out: 'Default Sink: a\n' };
      return { code: 0, out: args.includes('cards') ? textCards : textSinks };
    });
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(spawn.calls.map((c) => c.args)).toContainEqual(['list', 'cards']);
    expect(res).toMatchObject({ ok: true, devices: [{ label: 'A', isDefault: true, transport: 'builtin' }] });
  });

  it('a failed text info only loses the default', async () => {
    const textSinks = ['Sink #1', '\tName: a', '\tDescription: A', '\tProperties:', ''].join('\n');
    const spawn = scriptedSpawn((cmd, args) => {
      if (args.includes('json')) return { code: 1, out: '' };
      return args.includes('info') ? { code: 1, out: '' } : { code: 0, out: textSinks };
    });
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(res.ok).toBe(true);
    expect(res.devices[0].isDefault).toBe(false);
  });

  it('raw is capped', async () => {
    const props = { 'device.form_factor': 'headphone' };
    for (let i = 0; i < 20; i++) props[`extra.key${i}`] = 'x'.repeat(300);
    const spawn = scriptedSpawn((cmd, args) => ({
      code: 0,
      out: args.includes('info') ? infoJson : JSON.stringify([{ name: 'n', description: 'D', properties: props, ports: [] }]),
    }));
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(res.ok).toBe(true);
    const raw = res.devices[0].raw;
    expect(Object.keys(raw).length).toBeLessThanOrEqual(12);
    for (const v of Object.values(raw)) if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(120);
  });

  it('a hung linux read starts nothing after its deadline and kills every child', async () => {
    vi.useFakeTimers();
    const children = [];
    const spawn = vi.fn(() => {
      const c = fakeChild();
      children.push(c);
      return c;
    });
    let result;
    getOutputDevices({ platform: 'linux', spawn }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    const spawnedAtDeadline = spawn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawn).toHaveBeenCalledTimes(spawnedAtDeadline);
    for (const c of children) expect(c.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('linux falls back to text when the json info is not parsable', async () => {
    const textSinks = ['Sink #1', '\tName: t', '\tDescription: Text Sink', '\tProperties:', ''].join('\n');
    const spawn = scriptedSpawn((cmd, args) => {
      const json = args.includes('json');
      if (args.includes('info')) return { code: 0, out: json ? 'garbage' : 'Default Sink: t\n' };
      return { code: 0, out: json ? sinksJson : textSinks };
    });
    const res = await getOutputDevices({ platform: 'linux', spawn });
    expect(res.ok).toBe(true);
    expect(res.devices[0]).toMatchObject({ label: 'Text Sink', isDefault: true });
  });

  it('a multi-byte label split across chunks arrives intact', async () => {
    const bytes = Buffer.from(JSON.stringify([{ label: 'x', browserLabel: 'ヘッドホン', isDefault: true, transport: 'bltn' }]));
    const cut = bytes.indexOf(Buffer.from('ヘ')) + 1; // inside the first character
    const spawn = vi.fn(() => {
      const c = fakeChild();
      setImmediate(() => {
        c.stdout.emit('data', bytes.subarray(0, cut));
        c.stdout.emit('data', bytes.subarray(cut));
        c.emit('close', 0);
      });
      return c;
    });
    const res = await getOutputDevices({ platform: 'darwin', spawn, resolvePath });
    expect(res.devices[0].label).toBe('ヘッドホン');
  });

  // A console program started from a GUI parent opens a window of its own
  // unless windowsHide is set, and --devices runs on every devicechange.
  it('every read child is spawned hidden, with stdin and stderr ignored', async () => {
    const hidden = (c) => {
      expect(c.options.windowsHide).toBe(true);
      expect(c.options.stdio).toEqual(['ignore', 'pipe', 'ignore']);
    };
    for (const platform of ['darwin', 'win32']) {
      const spawn = scriptedSpawn(() => ({ code: 0, out: '[]' }));
      await getOutputDevices({ platform, spawn, resolvePath });
      expect(spawn.calls).toHaveLength(1);
      hidden(spawn.calls[0]);
    }
    // Both pactl forms (info, sinks and cards each): the json attempt fails, so the text one runs too.
    const spawn = scriptedSpawn((cmd, args) => (args.includes('json') ? { code: 1, out: '' } : { code: 0, out: '' }));
    await getOutputDevices({ platform: 'linux', spawn });
    expect(spawn.calls).toHaveLength(6);
    for (const c of spawn.calls) {
      hidden(c);
      expect(c.options.env.LC_ALL).toBe('C');
    }
  });

  it('an unsupported platform is unsupported_platform', async () => {
    expect(await getOutputDevices({ platform: 'freebsd', spawn: vi.fn() })).toEqual({
      ok: false,
      reason: 'unsupported_platform',
    });
  });
});

describe('createSinkWatcher', () => {
  function setup(extra = {}) {
    vi.useFakeTimers();
    const children = [];
    const spawn = vi.fn(() => {
      const c = fakeChild();
      children.push(c);
      return c;
    });
    const onChange = vi.fn();
    const warn = vi.fn();
    const watcher = createSinkWatcher({ spawn, onChange, warn, ...extra });
    const line = (i, s) => children[i].stdout.emit('data', Buffer.from(s + '\n'));
    return { children, spawn, onChange, warn, watcher, line };
  }

  it('runs pactl subscribe with LC_ALL=C', () => {
    const { watcher, spawn } = setup();
    watcher.start();
    expect(spawn.mock.calls[0][0]).toBe('pactl');
    expect(spawn.mock.calls[0][1]).toEqual(['subscribe']);
    expect(spawn.mock.calls[0][2].env.LC_ALL).toBe('C');
  });

  it('runs pactl subscribe hidden, with stdin and stderr ignored', () => {
    const { watcher, spawn } = setup();
    watcher.start();
    // Nothing drains stderr: a long-lived child must not fill and block on it.
    expect(spawn.mock.calls[0][2]).toMatchObject({ windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  });

  it('pushes once for a burst of sink changes', () => {
    const { watcher, line, onChange } = setup();
    watcher.start();
    line(0, "Event 'change' on sink #1");
    line(0, "Event 'change' on sink #2");
    vi.advanceTimersByTime(100);
    line(0, "Event 'change' on sink #1");
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a default sink change pushes', () => {
    const { watcher, line, onChange } = setup();
    watcher.start();
    line(0, "Event 'change' on server");
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // Chromium on Linux misses some Bluetooth and PipeWire sinks coming and going.
  it('a sink appearing or going pushes, coalesced with the rest of its burst', () => {
    const { watcher, line, onChange } = setup();
    watcher.start();
    line(0, "Event 'new' on sink #7");
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
    line(0, "Event 'remove' on sink #7");
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(2);

    line(0, "Event 'new' on sink #8");
    line(0, "Event 'change' on sink #8");
    line(0, "Event 'change' on server");
    vi.advanceTimersByTime(199);
    line(0, "Event 'remove' on sink #8");
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('a relaunched watcher pushes once, so changes made while it was down are read', () => {
    const { watcher, children, spawn, onChange } = setup({ backoffMs: [1000] });
    watcher.start();
    // The first launch is no catch-up: the read that started the watcher is current.
    children[0].emit('spawn');
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();

    children[0].emit('close', 1);
    vi.advanceTimersByTime(1000);
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1].emit('spawn');
    vi.advanceTimersByTime(199);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a relaunch that fails to start or dies at once pushes nothing; a change it reported still pushes', () => {
    const { watcher, children, line, onChange } = setup({ backoffMs: [1000] });
    watcher.start();
    children[0].emit('close', 1);

    // pactl missing: an error, never a spawn.
    vi.advanceTimersByTime(1000);
    children[1].emit('error', new Error('ENOENT'));
    children[1].emit('close', -2);
    // The server down: pactl starts, cannot connect, and exits.
    vi.advanceTimersByTime(1000);
    children[2].emit('spawn');
    vi.advanceTimersByTime(50);
    children[2].emit('close', 1);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();

    // One that reported a change before it went: that change is real.
    vi.advanceTimersByTime(500);
    children[3].emit('spawn');
    line(3, "Event 'change' on sink #1");
    children[3].emit('close', 1);
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the watcher ignores other events', () => {
    const { watcher, line, onChange } = setup();
    watcher.start();
    line(0, "Event 'new' on source #3");
    line(0, "Event 'change' on source #3");
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the watcher restarts with backoff and warns once', () => {
    const { watcher, children, spawn, warn } = setup({ backoffMs: [1000, 5000] });
    watcher.start();
    children[0].emit('close', 1);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(spawn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1].emit('close', 1);
    vi.advanceTimersByTime(4999);
    expect(spawn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(spawn).toHaveBeenCalledTimes(3);
    children[2].emit('close', 1);
    vi.advanceTimersByTime(5000);
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('start twice keeps one child', () => {
    const { watcher, spawn } = setup();
    watcher.start();
    watcher.start();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('stop kills the child and no restart follows', () => {
    const { watcher, children, spawn, onChange, line } = setup();
    watcher.start();
    line(0, "Event 'change' on server");
    watcher.stop();
    expect(children[0].kill).toHaveBeenCalled();
    children[0].emit('close', null);
    vi.advanceTimersByTime(120000);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('registerOutputFormFactor', () => {
  function setup(platform) {
    vi.useFakeTimers();
    const handlers = {};
    const ipcMain = { handle: vi.fn((name, fn) => (handlers[name] = fn)) };
    const emitters = { powerMonitor: new EventEmitter(), app: new EventEmitter() };
    const windows = [{ webContents: { send: vi.fn() } }, { webContents: { send: vi.fn() } }];
    const children = [];
    const spawn = vi.fn((command, args) => {
      const c = fakeChild();
      children.push(c);
      // Reads fail fast; the long-lived subscribe child stays up.
      if (args[0] !== 'subscribe') setImmediate(() => c.emit('close', 1));
      return c;
    });
    registerOutputFormFactor({
      ipcMain,
      powerMonitor: emitters.powerMonitor,
      app: emitters.app,
      getWindows: () => windows,
      platform,
      spawn,
      resolvePath: () => null,
    });
    return { handlers, ...emitters, windows, children, spawn };
  }

  it('starts the watcher on Linux only, pushes to every window, stops on window-all-closed', async () => {
    const linux = setup('linux');
    expect(linux.spawn).not.toHaveBeenCalled();
    const read = linux.handlers['get-output-devices']();
    await vi.advanceTimersByTimeAsync(10);
    await read;
    const subscribe = linux.spawn.mock.calls.find((c) => c[1][0] === 'subscribe');
    expect(subscribe).toBeTruthy();

    const watcherChild = linux.children[linux.spawn.mock.calls.indexOf(subscribe)];
    watcherChild.stdout.emit('data', Buffer.from("Event 'change' on sink #4\n"));
    vi.advanceTimersByTime(200);
    for (const w of linux.windows) expect(w.webContents.send).toHaveBeenCalledWith('output-devices:changed');

    linux.powerMonitor.emit('resume');
    for (const w of linux.windows) expect(w.webContents.send).toHaveBeenCalledTimes(2);

    linux.app.emit('window-all-closed');
    expect(watcherChild.kill).toHaveBeenCalled();

    const mac = setup('darwin');
    const macRead = mac.handlers['get-output-devices']();
    await vi.advanceTimersByTimeAsync(10);
    expect(await macRead).toEqual({ ok: false, reason: 'no_helper' });
    expect(mac.spawn).not.toHaveBeenCalled();
  });

  it('before-quit also stops the watcher', async () => {
    const linux = setup('linux');
    const read = linux.handlers['get-output-devices']();
    await vi.advanceTimersByTimeAsync(10);
    await read;
    const idx = linux.spawn.mock.calls.findIndex((c) => c[1][0] === 'subscribe');
    linux.app.emit('before-quit');
    expect(linux.children[idx].kill).toHaveBeenCalled();
  });
});
