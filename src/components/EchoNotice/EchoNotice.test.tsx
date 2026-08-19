import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import EchoNotice from './EchoNotice';
import { useEchoNotice } from './useEchoNotice';
import type { EchoNoticeState } from '../../lib/modern-audio/EchoMonitor';
import type { IAudioService } from '../../services/interfaces/IAudioService';

const state = (cause: EchoNoticeState['cause']): EchoNoticeState => ({ cause, lagMs: 120, rho: 0.8 });

describe('EchoNotice', () => {
  it('renders nothing when clear', () => {
    const { container } = render(<EchoNotice state={null} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    ['tts-echo', /translated speech back/i],
    ['meeting-echo', /Meeting audio/i],
    ['far-end-echo', /echoing your translation/i],
    ['self-capture', /Sokuji's own audio/i],
    ['routing-loop', /playback directly/i],
  ] as const)('renders a specific message for %s', (cause, pattern) => {
    render(<EchoNotice state={state(cause)} onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(pattern);
  });

  it('invokes onDismiss', () => {
    const onDismiss = vi.fn();
    render(<EchoNotice state={state('tts-echo')} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('useEchoNotice', () => {
  function fakeService() {
    let cb: ((s: EchoNoticeState | null) => void) | null = null;
    const service = {
      onEchoNotice: (c: typeof cb) => { cb = c; },
      setEchoDiagnostics: vi.fn(),
    } as unknown as IAudioService;
    return { service, emit: (s: EchoNoticeState | null) => act(() => cb?.(s)) };
  }

  it('surfaces notices and resets dismissal on all-clear', () => {
    const { service, emit } = fakeService();
    const { result } = renderHook(() => useEchoNotice(service));

    expect(result.current.notice).toBeNull();
    emit(state('tts-echo'));
    expect(result.current.notice?.cause).toBe('tts-echo');

    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();

    // Same cause stays hidden while it persists...
    emit(state('tts-echo'));
    expect(result.current.notice).toBeNull();

    // ...a different cause is a different problem and shows through.
    emit(state('routing-loop'));
    expect(result.current.notice?.cause).toBe('routing-loop');

    // All-clear re-arms the dismissed cause.
    emit(null);
    emit(state('tts-echo'));
    expect(result.current.notice?.cause).toBe('tts-echo');
  });

  it('reports detections to onDetected', () => {
    const { service, emit } = fakeService();
    const onDetected = vi.fn();
    renderHook(() => useEchoNotice(service, onDetected));
    emit(state('self-capture'));
    emit(null);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected.mock.calls[0][0].cause).toBe('self-capture');
  });
});
