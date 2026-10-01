import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePermissionWarning } from './usePermissionWarning';
import { echoSource } from '../../EchoNotice/useEchoNotice';
import useAudioStore from '../../../stores/audioStore';
import type { RunState } from '../../../lib/session/types';
import type { Leg } from '../../../lib/conversation/types';
import type { EchoWatch } from '../../../lib/audio/capture/echoWatch';

const audioBefore = useAudioStore.getState();
afterEach(() => { useAudioStore.setState(audioBefore, true); });

function participantLeg(overrides: Partial<Leg> = {}): Leg {
  return {
    leg: 'participant',
    session: 's',
    languages: { source: 'en', target: 'ja' },
    segments: [],
    notices: [],
    ...overrides,
  };
}

describe('usePermissionWarning', () => {
  describe('loopback_denied at the end of a run', () => {
    it('opens screen-recording-denied when a run ends idle with a loopback_denied notice', () => {
      const { result, rerender } = renderHook(
        ({ run }: { run: RunState }) => usePermissionWarning(run, []),
        { initialProps: { run: { phase: 'idle' } as RunState } },
      );
      expect(result.current.warning).toBeNull();

      const endedRun: RunState = {
        phase: 'idle',
        lastEnd: { reason: 'start-failed', notice: { code: 'loopback_denied', message: 'm', leg: 'participant' } },
      };
      rerender({ run: endedRun });
      expect(result.current.warning).toBe('screen-recording-denied');

      act(() => { result.current.close(); });
      expect(result.current.warning).toBeNull();

      // The same lastEnd object re-rendered after close() must not reopen it.
      rerender({ run: endedRun });
      expect(result.current.warning).toBeNull();
    });

    it('also opens for a refused end carrying the same code', () => {
      const refusedRun: RunState = {
        phase: 'idle',
        lastEnd: { reason: 'refused', notice: { code: 'loopback_denied', message: 'm' } },
      };
      const { result } = renderHook(() => usePermissionWarning(refusedRun, []));
      expect(result.current.warning).toBe('screen-recording-denied');
    });
  });

  describe('silent_no_permission on the participant leg', () => {
    it("opens audio-capture-denied for a new notice while no tap has ever delivered audio", () => {
      useAudioStore.setState({ participantTapAudioSeen: false });
      const { result, rerender } = renderHook(
        ({ legs }: { legs: readonly Leg[] }) => usePermissionWarning({ phase: 'idle' }, legs),
        { initialProps: { legs: [participantLeg()] as readonly Leg[] } },
      );
      expect(result.current.warning).toBeNull();

      const withNotice = participantLeg({
        notices: [{ id: 'p:n1', at: 0, severity: 'warning', message: 'm', code: 'silent_no_permission' }],
      });
      rerender({ legs: [withNotice] });
      expect(result.current.warning).toBe('audio-capture-denied');
    });

    it('stays null once a tap has proven the permission works', () => {
      useAudioStore.setState({ participantTapAudioSeen: true });
      const withNotice = participantLeg({
        notices: [{ id: 'p:n1', at: 0, severity: 'warning', message: 'm', code: 'silent_no_permission' }],
      });
      const { result } = renderHook(() => usePermissionWarning({ phase: 'idle' }, [withNotice]));
      expect(result.current.warning).toBeNull();
    });

    it('never opens twice for the same notice id', () => {
      useAudioStore.setState({ participantTapAudioSeen: false });
      const withNotice = participantLeg({
        notices: [{ id: 'p:n1', at: 0, severity: 'warning', message: 'm', code: 'silent_no_permission' }],
      });
      const { result, rerender } = renderHook(
        ({ legs }: { legs: readonly Leg[] }) => usePermissionWarning({ phase: 'idle' }, legs),
        { initialProps: { legs: [withNotice] as readonly Leg[] } },
      );
      expect(result.current.warning).toBe('audio-capture-denied');

      act(() => { result.current.close(); });
      rerender({ legs: [withNotice] });
      expect(result.current.warning).toBeNull();
    });
  });

  it('opens a warning by hand', () => {
    const { result } = renderHook(() => usePermissionWarning({ phase: 'idle' }, []));
    act(() => { result.current.open('screen-recording-denied'); });
    expect(result.current.warning).toBe('screen-recording-denied');
  });

  it('keeps open and close identity across re-renders (the notice action caches by identity)', () => {
    const { result, rerender } = renderHook(
      ({ run }: { run: RunState }) => usePermissionWarning(run, []),
      { initialProps: { run: { phase: 'idle' } as RunState } },
    );
    const { open, close } = result.current;

    rerender({ run: { phase: 'idle' } });
    expect(result.current.open).toBe(open);
    expect(result.current.close).toBe(close);
  });
});

describe('echoSource', () => {
  it('forwards onEchoNotice to the watch and setEchoDiagnostics to setDiagnostics', () => {
    const onNotice = vi.fn();
    const setDiagnostics = vi.fn();
    const watch = { attach: vi.fn(), onNotice, setDiagnostics } as unknown as EchoWatch;

    const source = echoSource(watch);
    const listener = () => {};
    source.onEchoNotice(listener);
    expect(onNotice).toHaveBeenCalledWith(listener);

    source.setEchoDiagnostics(true);
    expect(setDiagnostics).toHaveBeenCalledWith(true);
  });
});
