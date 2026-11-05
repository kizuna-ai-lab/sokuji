import { describe, it, expect, vi } from 'vitest';
import { guardPorts, type PlaybackPort, type RunnerDeps } from './ports';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

const pcm = new Int16Array(240);
const guarded = (playback: Partial<PlaybackPort>) =>
  guardPorts({ playback: { audio() {}, held() {}, clear() {}, live() {}, ...playback }, analytics: { track() {} } } as unknown as RunnerDeps).playback;
const reportsOf = (name: string) => reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes(name));

describe('guardPorts — analytics', () => {
  it('redacts every string value before the port sees it', () => {
    const track = vi.fn();
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const deps = { playback: { audio() {}, held() {}, clear() {}, live() {} }, analytics: { track } } as unknown as RunnerDeps;
    guardPorts(deps).analytics.track('error_occurred', { error_type: 'x', error_message: `failed with ${secret}`, severity: 'high', recoverable: true });
    const sent = track.mock.calls[0][1] as { error_message: string };
    expect(sent.error_message).not.toContain(secret);
    expect(sent.error_message).toContain('failed with');
  });
});

describe('guardPorts — playback (agent text)', () => {
  it('audio answers the outlets, and none from a port that throws or answers nothing', () => {
    reportErrorSpy.mockClear();
    expect(guarded({ audio: () => ['me'] }).audio('speaker', 1, pcm)).toEqual(['me']);
    expect(guarded({ audio: () => undefined as never }).audio('speaker', 1, pcm)).toEqual([]);
    const throwing = guarded({ audio: () => { throw new Error('sink gone'); } });
    expect(throwing.audio('speaker', 1, pcm)).toEqual([]);
    expect(throwing.audio('speaker', 2, pcm)).toEqual([]);
    expect(reportsOf('playback.audio')).toHaveLength(1);
  });

  it('passes onVoiceIdle through when the port has it, and only then', () => {
    reportErrorSpy.mockClear();
    expect(guarded({}).onVoiceIdle).toBeUndefined();

    const off = vi.fn();
    let kept: ((voice: 'speaker' | 'participant') => void) | undefined;
    const onVoiceIdle = vi.fn((listener: (voice: 'speaker' | 'participant') => void) => { kept = listener; return off; });
    const listener = vi.fn();
    const unsubscribe = guarded({ onVoiceIdle }).onVoiceIdle!(listener);
    kept!('participant');
    expect(listener).toHaveBeenCalledWith('participant');
    unsubscribe();
    expect(off).toHaveBeenCalledTimes(1);

    const throwing = guarded({ onVoiceIdle: () => { throw new Error('no playback'); } });
    const noop = throwing.onVoiceIdle!(listener);
    expect(() => noop()).not.toThrow();
    expect(reportsOf('playback.onVoiceIdle')).toHaveLength(1);
  });
});
