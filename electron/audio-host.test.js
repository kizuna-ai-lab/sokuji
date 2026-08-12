import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { listAppSources, startCapture, stopCapture, ensureUnityGain } from './audio-host.js';

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = vi.fn();
  return c;
}

const resolvePath = () => 'C:\\app\\sokuji-audio-host.exe';

// The module holds the running child in module scope; leaving one behind makes
// the next test's stopCapture() assertion see a stale kill.
afterEach(() => stopCapture());

describe('listAppSources', () => {
  it('parses the JSON array and prefixes ids with app:', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const p = listAppSources({ spawn, resolvePath });

    child.stdout.emit('data', Buffer.from('[{"id":"pid:42","label":"Zoom","exe":"Zoom.exe","active":true}]'));
    child.emit('close', 0);

    // appKey is what survives a restart; deviceId's pid does not.
    expect(await p).toEqual([
      { deviceId: 'app:pid:42', label: 'Zoom (42)', appKey: 'Zoom.exe', windowTitles: [] },
    ]);
    expect(spawn.mock.calls[0][1]).toEqual(['--list']);
  });

  it('names two instances of one application apart by pid', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });

    // A second Chrome profile is a second, separately capturable Chrome. The
    // helper cannot tell them apart by name and must not try to.
    child.stdout.emit('data', Buffer.from(
      '[{"id":"pid:42","label":"Google Chrome","exe":"chrome.exe"},'
      + '{"id":"pid:77","label":"Google Chrome","exe":"chrome.exe"}]'));
    child.emit('close', 0);

    expect((await p).map((s) => s.label)).toEqual(['Google Chrome (42)', 'Google Chrome (77)']);
  });

  it('leaves a non-pid id out of the name', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('[{"id":"node:31","label":"Firefox","exe":"firefox"}]'));
    child.emit('close', 0);
    expect((await p)[0].label).toBe('Firefox');
  });

  it('carries the window titles through for the row tooltip', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });

    // One process tree, two windows - the case the label alone cannot express.
    child.stdout.emit('data', Buffer.from(
      '[{"id":"pid:42","label":"Google Chrome","exe":"chrome.exe","active":true,'
      + '"windows":["YouTube - Google Chrome","","Docs - Google Chrome"]}]'));
    child.emit('close', 0);

    expect(await p).toEqual([{
      deviceId: 'app:pid:42',
      label: 'Google Chrome (42)',
      appKey: 'chrome.exe',
      windowTitles: ['YouTube - Google Chrome', 'Docs - Google Chrome'],
    }]);
  });

  it('keeps non-ASCII labels intact across chunk boundaries', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });

    // A UTF-8 label split mid-array; Buffer.toString per chunk must still
    // reassemble into valid JSON.
    const json = '[{"id":"pid:7","label":"守望先锋","exe":"Overwatch.exe"}]';
    const buf = Buffer.from(json, 'utf8');
    child.stdout.emit('data', buf.subarray(0, 20));
    child.stdout.emit('data', buf.subarray(20));
    child.emit('close', 0);

    expect(await p).toEqual([
      { deviceId: 'app:pid:7', label: '守望先锋 (7)', appKey: 'Overwatch.exe', windowTitles: [] },
    ]);
  });

  it('falls back to exe when label is empty', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('[{"id":"pid:9","label":"","exe":"foo.exe"}]'));
    child.emit('close', 0);
    expect(await p).toEqual([
      { deviceId: 'app:pid:9', label: 'foo.exe (9)', appKey: 'foo.exe', windowTitles: [] },
    ]);
  });

  it('returns an empty array when the helper is missing', async () => {
    expect(await listAppSources({ spawn: vi.fn(), resolvePath: () => null })).toEqual([]);
  });

  it('returns an empty array on malformed output rather than throwing', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('not json'));
    child.emit('close', 0);
    expect(await p).toEqual([]);
  });

  it('returns an empty array when spawn itself throws', async () => {
    const spawn = () => { throw new Error('ENOENT'); };
    expect(await listAppSources({ spawn, resolvePath })).toEqual([]);
  });
});

describe('startCapture', () => {
  it('spawns with the app: prefix stripped and forwards PCM', () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const onPcm = vi.fn();

    expect(startCapture('app:pid:42', onPcm, vi.fn(), { spawn, resolvePath })).toBe(true);
    expect(spawn.mock.calls[0][1]).toEqual(['--target', 'pid:42']);

    const pcm = Buffer.from([1, 2, 3, 4]);
    child.stdout.emit('data', pcm);
    expect(onPcm).toHaveBeenCalledWith(pcm);
  });

  it('parses stderr JSON lines, tolerating split chunks', () => {
    const child = fakeChild();
    const onEvent = vi.fn();
    startCapture('app:pid:42', vi.fn(), onEvent, { spawn: () => child, resolvePath });

    child.stderr.emit('data', Buffer.from('{"event":"format","sampleRate":240'));
    expect(onEvent).not.toHaveBeenCalled();

    child.stderr.emit('data', Buffer.from('00,"channels":1}\n'));
    expect(onEvent).toHaveBeenCalledWith({ event: 'format', sampleRate: 24000, channels: 1 });
  });

  it('ignores a non-JSON stderr line without dropping the next event', () => {
    const child = fakeChild();
    const onEvent = vi.fn();
    startCapture('app:pid:42', vi.fn(), onEvent, { spawn: () => child, resolvePath });

    child.stderr.emit('data', Buffer.from('garbage\n{"event":"error","code":"target_gone"}\n'));

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ event: 'error', code: 'target_gone' });
  });

  it('reports the helper exiting as an event', () => {
    const child = fakeChild();
    const onEvent = vi.fn();
    startCapture('app:pid:42', vi.fn(), onEvent, { spawn: () => child, resolvePath });

    child.emit('close', 1);

    expect(onEvent).toHaveBeenCalledWith({ event: 'exit', code: 1 });
  });

  it('stays quiet about a helper it killed itself', () => {
    const child = fakeChild();
    const onEvent = vi.fn();
    startCapture('app:pid:42', vi.fn(), onEvent, { spawn: () => child, resolvePath });

    stopCapture();
    // kill() is asynchronous: the child's close lands a millisecond or two
    // later, by which time the renderer has torn this recorder down and built
    // the next one. Measured 1.5-2.2 ms, every run.
    child.emit('close', null);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not blame the new capture for the old helper exiting', () => {
    const first = fakeChild();
    const second = fakeChild();
    let n = 0;
    const spawn = () => (++n === 1 ? first : second);
    const onEventFirst = vi.fn();
    const onEventSecond = vi.fn();

    startCapture('app:pid:1', vi.fn(), onEventFirst, { spawn, resolvePath });
    startCapture('app:pid:2', vi.fn(), onEventSecond, { spawn, resolvePath });
    first.emit('close', null);

    // Both callbacks post to the one app-audio:event channel, so the renderer
    // cannot tell whose exit this was: whichever fires, the live recorder reads
    // it as its own helper dying and falls back to whole-system capture - the
    // user picks one application and gets every application, with the picker
    // still naming the one they picked.
    expect(onEventFirst).not.toHaveBeenCalled();
    expect(onEventSecond).not.toHaveBeenCalled();
  });

  it('drops audio still draining from a replaced helper', () => {
    const first = fakeChild();
    const second = fakeChild();
    let n = 0;
    const spawn = () => (++n === 1 ? first : second);
    const onPcmFirst = vi.fn();
    const onPcmSecond = vi.fn();

    startCapture('app:pid:1', onPcmFirst, vi.fn(), { spawn, resolvePath });
    startCapture('app:pid:2', onPcmSecond, vi.fn(), { spawn, resolvePath });
    // Whatever was buffered in the old pipe would otherwise be mixed into the
    // new application's stream.
    first.stdout.emit('data', Buffer.from([1, 2, 3, 4]));

    expect(onPcmFirst).not.toHaveBeenCalled();
    expect(onPcmSecond).not.toHaveBeenCalled();
  });

  it('kills a previous capture before starting a new one', () => {
    const first = fakeChild();
    const second = fakeChild();
    let n = 0;
    const spawn = () => (++n === 1 ? first : second);

    startCapture('app:pid:1', vi.fn(), vi.fn(), { spawn, resolvePath });
    startCapture('app:pid:2', vi.fn(), vi.fn(), { spawn, resolvePath });

    // Two helpers alive at once would mix both applications into one stream.
    expect(first.kill).toHaveBeenCalledTimes(1);
    expect(second.kill).not.toHaveBeenCalled();
  });

  it('maps the whole-system sentinel to the helper\'s system target', () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);

    startCapture('desktop-audio-loopback', vi.fn(), vi.fn(), { spawn, resolvePath });

    expect(spawn.mock.calls[0][1]).toEqual(['--target', 'system']);
  });

  it('returns false when the helper binary is missing', () => {
    expect(startCapture('app:pid:42', vi.fn(), vi.fn(), { spawn: vi.fn(), resolvePath: () => null }))
      .toBe(false);
  });

  it('returns false when spawn throws', () => {
    const spawn = () => { throw new Error('EACCES'); };
    expect(startCapture('app:pid:42', vi.fn(), vi.fn(), { spawn, resolvePath })).toBe(false);
  });
});

describe('stopCapture', () => {
  it('kills a running helper and is safe to call twice', () => {
    const child = fakeChild();
    startCapture('app:pid:42', vi.fn(), vi.fn(), { spawn: () => child, resolvePath });

    stopCapture();
    expect(child.kill).toHaveBeenCalledTimes(1);

    stopCapture();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('is safe when nothing was ever started', () => {
    expect(() => stopCapture()).not.toThrow();
  });
});

describe('ensureUnityGain', () => {
  const REPAIRED = '{"found":true,"name":"SokujiVirtualAudio","changed":true,"unmuted":false,'
    + '"before":{"output":0.5000,"input":0.5000},"after":{"output":1.0000,"input":1.0000}}';

  it('passes the device name through and returns what the helper measured', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const p = ensureUnityGain('SokujiVirtualAudio', { spawn, resolvePath });

    child.stdout.emit('data', Buffer.from(REPAIRED));
    child.emit('close', 0);

    const result = await p;
    expect(spawn.mock.calls[0][1]).toEqual(['--ensure-unity-gain', 'SokujiVirtualAudio']);
    expect(result.changed).toBe(true);
    expect(result.before).toEqual({ output: 0.5, input: 0.5 });
  });

  it('reports a device that is not registered rather than guessing', async () => {
    const child = fakeChild();
    const p = ensureUnityGain('SokujiVirtualAudio', { spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('{"found":false}'));
    child.emit('close', 0);
    expect(await p).toEqual({ found: false });
  });

  // A helper shipped before this mode existed writes its usage text to stderr
  // and nothing to stdout. That has to read as "could not tell", never as
  // "the device is missing" - the caller treats those differently.
  it('returns null for a helper too old to know the mode', async () => {
    const child = fakeChild();
    const p = ensureUnityGain('SokujiVirtualAudio', { spawn: () => child, resolvePath });
    child.stderr.emit('data', Buffer.from('usage:\n'));
    child.emit('close', 2);
    expect(await p).toBeNull();
  });

  // The helper prints its measurement and then exits 1 when Core Audio refused
  // the write. Trusting the payload would report "found, unchanged" - which the
  // caller reads as "already at unity" while the device is still attenuated.
  it('returns null when the helper reports a measurement but exits non-zero', async () => {
    const child = fakeChild();
    const p = ensureUnityGain('SokujiVirtualAudio', { spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from(
      '{"found":true,"name":"SokujiVirtualAudio","changed":false,"unmuted":false,'
      + '"before":{"output":0.5000,"input":0.5000},"after":{"output":0.5000,"input":0.5000}}'));
    child.stderr.emit('data', Buffer.from('{"event":"error","code":"volume_write_failed"}\n'));
    child.emit('close', 1);
    expect(await p).toBeNull();
  });

  it('returns null when the helper is killed by a signal', async () => {
    const child = fakeChild();
    const p = ensureUnityGain('SokujiVirtualAudio', { spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('{"found":true,"changed":false}'));
    child.emit('close', null, 'SIGKILL');
    expect(await p).toBeNull();
  });

  it('returns null on malformed output instead of throwing', async () => {
    const child = fakeChild();
    const p = ensureUnityGain('SokujiVirtualAudio', { spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('{not json'));
    child.emit('close', 0);
    expect(await p).toBeNull();
  });

  it('returns null when the helper cannot be spawned or found', async () => {
    const throwing = () => { throw new Error('EACCES'); };
    expect(await ensureUnityGain('X', { spawn: throwing, resolvePath })).toBeNull();
    expect(await ensureUnityGain('X', { spawn: () => fakeChild(), resolvePath: () => null })).toBeNull();
  });

  it('returns null when the child errors out', async () => {
    const child = fakeChild();
    const p = ensureUnityGain('X', { spawn: () => child, resolvePath });
    child.emit('error', new Error('ENOENT'));
    expect(await p).toBeNull();
  });
});
