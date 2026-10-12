import { describe, it, expect, vi } from 'vitest';
import { listMicrophoneUsers, deviceNameOf } from './mic-users-win.js';

/** An execFile double that answers with `stdout`, or fails with `error`. */
function fakeExecFile({ stdout = '', error = null } = {}) {
  return vi.fn((_file, _args, _options, callback) => {
    queueMicrotask(() => callback(error, stdout, ''));
    return {};
  });
}

const rows = (list) => JSON.stringify(list);

describe('deviceNameOf', () => {
  it('drops the USB vendor:product suffix Chromium appends to a label', () => {
    expect(deviceNameOf('Microphone (2- Logi C270 HD WebCam) (046d:0825)')).toBe('Microphone (2- Logi C270 HD WebCam)');
  });

  it('leaves a label without the suffix as it is', () => {
    expect(deviceNameOf('マイク (AU05)')).toBe('マイク (AU05)');
  });
});

describe('listMicrophoneUsers', () => {
  it('runs the probe in a hidden PowerShell that loads no profile and asks nothing', async () => {
    const execFile = fakeExecFile({ stdout: '[]' });
    await listMicrophoneUsers('マイク (AU05)', { execFile, timeoutMs: 1234 });

    const [file, args, options] = execFile.mock.calls[0];
    expect(file).toBe('powershell.exe');
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    expect(options).toMatchObject({ windowsHide: true, timeout: 1234 });
    // -EncodedCommand takes the script as base64 of UTF-16LE.
    const script = Buffer.from(args[5], 'base64').toString('utf16le');
    expect(script).toContain('IAudioSessionManager2');
    expect(script).toContain('ConvertTo-Json');
  });

  it('names the other applications using that device, by their description', async () => {
    const execFile = fakeExecFile({ stdout: rows([
      { device: 'マイク (AU05)', pid: 4120, name: 'Zoom', description: 'Zoom Meetings' },
      { device: 'マイク (AU05)', pid: 1248, name: 'python', description: '' },
      { device: 'マイク (Anker PowerConf C200)', pid: 777, name: 'Teams', description: 'Microsoft Teams' },
    ]) });

    expect(await listMicrophoneUsers('マイク (AU05)', { execFile })).toEqual({ ok: true, users: ['Zoom Meetings', 'python.exe'] });
  });

  it('leaves out Sokuji itself, the system session and repeats', async () => {
    const execFile = fakeExecFile({ stdout: rows([
      { device: 'Mic (USB)', pid: 0, name: 'Idle', description: '' },
      { device: 'Mic (USB)', pid: 900, name: 'Sokuji', description: 'Sokuji' },
      { device: 'Mic (USB)', pid: 51, name: 'obs64', description: 'OBS Studio' },
      { device: 'Mic (USB)', pid: 52, name: 'obs64', description: 'OBS Studio' },
    ]) });

    expect(await listMicrophoneUsers('Mic (USB) (1ae7:2002)', { execFile, ownPids: [900] }))
      .toEqual({ ok: true, users: ['OBS Studio'] });
  });

  it('says nobody else when the device is found with no other sessions', async () => {
    const execFile = fakeExecFile({ stdout: rows([{ device: 'Mic', pid: 900, name: 'Sokuji', description: 'Sokuji' }]) });
    expect(await listMicrophoneUsers('Mic', { execFile, ownPids: [900] })).toEqual({ ok: true, users: [] });
  });

  it('says nobody when the device is there and no session is active on it', async () => {
    const execFile = fakeExecFile({ stdout: rows([{ device: 'Mic', pid: -1, name: '', description: '' }]) });
    expect(await listMicrophoneUsers('Mic', { execFile })).toEqual({ ok: true, users: [] });
  });

  it('cannot tell when no capture device carries that name', async () => {
    const execFile = fakeExecFile({ stdout: rows([{ device: 'Other', pid: 5, name: 'x', description: '' }]) });
    expect(await listMicrophoneUsers('Mic', { execFile })).toEqual({ ok: true, users: null });
  });

  it('cannot tell when no capture device lists any session', async () => {
    const execFile = fakeExecFile({ stdout: '[]' });
    expect(await listMicrophoneUsers('Mic', { execFile })).toEqual({ ok: true, users: null });
  });

  it('accepts a lone row that PowerShell printed without its array', async () => {
    const execFile = fakeExecFile({ stdout: JSON.stringify({ device: 'Mic', pid: 7, name: 'Discord', description: 'Discord' }) });
    expect(await listMicrophoneUsers('Mic', { execFile })).toEqual({ ok: true, users: ['Discord'] });
  });

  it('fails softly when PowerShell fails or runs out of time', async () => {
    const error = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' });
    const execFile = fakeExecFile({ error });
    expect(await listMicrophoneUsers('Mic', { execFile })).toEqual({ ok: false, error: 'Command failed' });
  });

  it('fails softly on output that is not the probe’s JSON', async () => {
    const execFile = fakeExecFile({ stdout: 'Add-Type : Cannot add type. Definition of new types is not supported in this language mode.' });
    const result = await listMicrophoneUsers('Mic', { execFile });
    expect(result.ok).toBe(false);
  });

  it('fails softly when execFile itself throws', async () => {
    const execFile = vi.fn(() => { throw new Error('spawn EPERM'); });
    expect(await listMicrophoneUsers('Mic', { execFile })).toEqual({ ok: false, error: 'spawn EPERM' });
  });
});
