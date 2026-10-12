import { describe, it, expect, vi } from 'vitest';
import { MIC_BLOCKED, MIC_IN_USE, MIC_UNREADABLE, explainMicFailure } from './micFailure';
import { MicrophoneCaptureError } from '../../modern-audio/microphoneCaptureError';
import { SourceOpenError } from '../../session/source';

/** What getUserMedia rejects with: a DOMException's name and Chromium's message. */
const rejection = (name: string, message: string) => new MicrophoneCaptureError(Object.assign(new Error(message), { name }));
const IN_USE = () => rejection('NotReadableError', 'Audio capture device already in use');

describe('explainMicFailure', () => {
  it('names the applications using the device when Windows can tell', async () => {
    const appsUsing = vi.fn(async () => ['Zoom Meetings', 'python.exe']);
    const failure = IN_USE();

    const explained = await explainMicFailure(failure, 'Microphone (AU05)', appsUsing);

    expect(appsUsing).toHaveBeenCalledWith('Microphone (AU05)');
    expect(explained).toBeInstanceOf(SourceOpenError);
    const error = explained as SourceOpenError;
    expect(error.code).toBe(MIC_IN_USE);
    expect(error.params).toEqual({ device: 'Microphone (AU05)', apps: 'Zoom Meetings, python.exe' });
    expect(error.cause).toBe(failure);
  });

  it('keeps the names out of the message, which reaches the logs and analytics, but keeps what Chromium said', async () => {
    const explained = await explainMicFailure(IN_USE(), 'Mic', async () => ['Zoom Meetings']) as SourceOpenError;

    expect(explained.message).not.toContain('Zoom');
    expect(explained.message).toContain('1 other application');
    expect(explained.message).toContain('NotReadableError: Audio capture device already in use');
  });

  it.each([
    ['nobody else is using it', async () => [] as string[]],
    ['Windows cannot tell', async () => null],
    ['the lookup fails', async (): Promise<string[] | null> => { throw new Error('ipc gone'); }],
  ])('says the device could not be opened when %s', async (_case, appsUsing) => {
    const explained = await explainMicFailure(rejection('NotReadableError', 'Failed to access audio capture device'), 'Mic', appsUsing) as SourceOpenError;

    expect(explained.code).toBe(MIC_UNREADABLE);
    expect(explained.params).toEqual({ device: 'Mic' });
    expect(explained.message).toContain('NotReadableError: Failed to access audio capture device');
  });

  it('treats an AbortError as a device that would not open', async () => {
    const explained = await explainMicFailure(rejection('AbortError', ''), 'Mic', async () => ['OBS Studio']) as SourceOpenError;
    expect(explained.code).toBe(MIC_IN_USE);
  });

  it.each(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])('reads a %s as Windows privacy settings, without asking who uses the device', async (name) => {
    const appsUsing = vi.fn(async () => ['Zoom']);
    const explained = await explainMicFailure(rejection(name, 'System Permissions prevented access to audio capture device'), 'Mic', appsUsing) as SourceOpenError;

    expect(explained.code).toBe(MIC_BLOCKED);
    expect(explained.params).toBeUndefined();
    expect(explained.message).toContain(`${name}: System Permissions prevented access`);
    expect(appsUsing).not.toHaveBeenCalled();
  });

  it('leaves any other failure as it is', async () => {
    const notFound = rejection('NotFoundError', 'Requested device not found');
    const plain = new Error('No microphone is selected.');
    const appsUsing = vi.fn(async () => ['Zoom']);

    expect(await explainMicFailure(notFound, 'Mic', appsUsing)).toBe(notFound);
    expect(await explainMicFailure(plain, 'Mic', appsUsing)).toBe(plain);
    expect(appsUsing).not.toHaveBeenCalled();
  });
});
