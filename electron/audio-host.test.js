import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { listAppSources, startCapture, stopCapture } from './audio-host.js';

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
    expect(await p).toEqual([{ deviceId: 'app:pid:42', label: 'Zoom', appKey: 'Zoom.exe' }]);
    expect(spawn.mock.calls[0][1]).toEqual(['--list']);
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

    expect(await p).toEqual([{ deviceId: 'app:pid:7', label: '守望先锋', appKey: 'Overwatch.exe' }]);
  });

  it('falls back to exe when label is empty', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('[{"id":"pid:9","label":"","exe":"foo.exe"}]'));
    child.emit('close', 0);
    expect(await p).toEqual([{ deviceId: 'app:pid:9', label: 'foo.exe', appKey: 'foo.exe' }]);
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
