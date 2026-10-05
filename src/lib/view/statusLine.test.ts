import { describe, expect, it } from 'vitest';
import type { EchoNoticeState } from '../modern-audio/EchoMonitor';
import type { RunEnd, RunState } from '../session/types';
import { statusLine, type StatusLineInput } from './statusLine';

const idleRun: RunState = { phase: 'idle' };
const running = (legs: Partial<Record<'speaker' | 'participant', 'opening' | 'live' | 'reconnecting'>> = { speaker: 'live' }): RunState =>
  ({ phase: 'running', since: 0, legs });
const echo: EchoNoticeState = { cause: 'tts-echo', lagMs: 120, rho: 0.7 } as EchoNoticeState;
const input = (over: Partial<StatusLineInput> = {}): StatusLineInput => ({
  run: idleRun, idle: { kind: 'ready' }, canStart: true, dismissedEnd: null,
  waitingForMicrophone: false, subtitleEntryHint: false, echo: null, ...over,
});

describe('statusLine — cannot start (priority 1)', () => {
  it('words the gate’s refusal with its code and the fix (spec §3)', () => {
    const entry = statusLine(input({ canStart: false, idle: { kind: 'unready', message: 'No microphone is chosen for the speaker leg.', code: 'no_microphone' } }));
    expect(entry).toMatchObject({ key: 'unready:no_microphone', icon: 'mic-off', words: { kind: 'notice', code: 'no_microphone' }, action: { kind: 'settings', target: 'microphone' }, dismiss: null });
  });
  it('picks the icon by the code: credentials → key, balance → wallet, anything else → alert', () => {
    const unready = (code: string, params?: Record<string, string>) => statusLine(input({ canStart: false, idle: { kind: 'unready', message: 'm', code, params } }));
    expect(unready('credentials_missing')?.icon).toBe('key-round');
    expect(unready('sign_in_required')?.icon).toBe('key-round');
    expect(unready('balance_below_floor', { balance: '$0.01' })).toMatchObject({ icon: 'wallet', action: { kind: 'top-up' } });
    expect(unready('quota_pending')?.icon).toBe('wallet');
    expect(unready('not_ready')).toMatchObject({ icon: 'circle-alert', action: null });
  });
  it('an uncoded readiness reason keeps its message and offers nothing', () => {
    expect(statusLine(input({ canStart: false, idle: { kind: 'unready', message: 'HTTP 500' } }))).toMatchObject({ words: { kind: 'notice', code: '', message: 'HTTP 500' }, action: null });
  });
  it('after a start the gate refused or that failed, says why until the next start', () => {
    const lastEnd: RunEnd = { reason: 'start-failed', notice: { code: 'loopback_denied', message: 'denied', leg: 'participant' } };
    expect(statusLine(input({ run: { phase: 'idle', lastEnd } }))).toMatchObject({ key: 'last-end:loopback_denied', action: { kind: 'system-settings', pane: 'screen-recording' } });
    expect(statusLine(input({ run: { phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'credentials_missing', message: 'm' } } } }))).toMatchObject({ key: 'last-end:credentials_missing', icon: 'key-round' });
  });
  // Review Focus 1: a run the lease ended is an event row, never a line.
  it('says nothing for a run that ended on its own, by the user or by the lease', () => {
    for (const lastEnd of [
      { reason: 'user' }, { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'm' } },
      { reason: 'lease-ended', notice: { code: 'budget_exhausted', message: 'm' } }, { reason: 'source-ended', notice: { code: 'source_ended', message: 'm' } },
    ] as RunEnd[]) {
      expect(statusLine(input({ run: { phase: 'idle', lastEnd } })), lastEnd.reason).toBeNull();
    }
  });
  // Review Focus 2: Clear hides this end; the next end, even with the same code, shows.
  it('Clear hides the last end by identity, not by code', () => {
    const first: RunEnd = { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket' } };
    const second: RunEnd = { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket' } };
    expect(statusLine(input({ run: { phase: 'idle', lastEnd: first }, dismissedEnd: first }))).toBeNull();
    expect(statusLine(input({ run: { phase: 'idle', lastEnd: second }, dismissedEnd: first }))).not.toBeNull();
  });
  it('a live gate refusal outranks the last end', () => {
    const lastEnd: RunEnd = { reason: 'start-failed', notice: { code: 'start_failed', message: 'm' } };
    expect(statusLine(input({ run: { phase: 'idle', lastEnd }, canStart: false, idle: { kind: 'unready', message: 'm', code: 'no_microphone' } }))?.key).toBe('unready:no_microphone');
  });
  it('is quiet while starting', () => {
    expect(statusLine(input({ run: { phase: 'starting', step: 'checking' }, idle: { kind: 'starting' }, canStart: false }))).toBeNull();
  });
});

describe('statusLine — while running (priorities 2–5)', () => {
  it('reconnecting, with no action', () => {
    expect(statusLine(input({ run: running({ speaker: 'reconnecting' }), echo }))).toMatchObject({ key: 'reconnecting', icon: 'refresh-cw', words: { kind: 'key', key: 'connectionStatus.reconnecting' }, action: null, dismiss: null });
  });
  it('waiting for a microphone, below reconnecting', () => {
    expect(statusLine(input({ run: running(), waitingForMicrophone: true }))).toMatchObject({ key: 'mic-waiting', icon: 'mic-off', words: { kind: 'notice', code: 'mic_lost_waiting' } });
    expect(statusLine(input({ run: running({ speaker: 'reconnecting' }), waitingForMicrophone: true }))?.key).toBe('reconnecting');
  });
  it('the subtitle layer’s hint, dismissible, above echo (the user just pressed the button)', () => {
    expect(statusLine(input({ run: running(), subtitleEntryHint: true, echo }))).toMatchObject({ key: 'subtitle-entry', icon: 'captions', words: { kind: 'key', key: 'subtitle.enterButton.refreshPageHint' }, dismiss: 'subtitle-entry' });
  });
  it('the microphone wait outranks the subtitle layer’s hint', () => {
    expect(statusLine(input({ run: running(), waitingForMicrophone: true, subtitleEntryHint: true }))).toMatchObject({ key: 'mic-waiting', icon: 'mic-off', dismiss: null });
  });
  // Ruling 11: the overlay opens only while a run is live, so the hint is a running line.
  it('the subtitle layer’s hint only while running', () => {
    expect(statusLine(input({ subtitleEntryHint: true }))).toBeNull();
    expect(statusLine(input({ run: { phase: 'starting', step: 'checking' }, idle: { kind: 'starting' }, canStart: false, subtitleEntryHint: true }))).toBeNull();
  });
  it('echo last, dismissible, with its cause', () => {
    expect(statusLine(input({ run: running(), echo }))).toMatchObject({ key: 'echo:tts-echo', icon: 'triangle-alert', words: { kind: 'echo', cause: 'tts-echo' }, dismiss: 'echo' });
  });
  // Review Focus 3: the dismissal lives on the echo source (`useEchoNotice`), so a dismissed
  // echo arrives here as null and stays hidden once the reconnect clears.
  it('nothing when every condition has cleared', () => {
    expect(statusLine(input({ run: running() }))).toBeNull();
  });
});
