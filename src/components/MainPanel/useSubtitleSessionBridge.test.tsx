import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSessionStore from '../../stores/sessionStore';
import { useSubtitleSessionBridge } from './useSubtitleSessionBridge';
import type { StartGate } from './sessionStartGate';

const readyGate: StartGate = { canStart: true, reason: null };

beforeEach(() => {
  useSessionStore.setState({
    startSessionVersion: 0,
    stopSessionVersion: 0,
    startGate: { canStart: false, reason: null },
    isInitializing: false,
    initProgress: null,
  });
});

describe('useSubtitleSessionBridge mirroring', () => {
  it('publishes the gate to the store on mount', () => {
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: { canStart: false, reason: 'missing-device', deviceScope: 'speaker' },
        isInitializing: false,
        initPhase: null,
        onStart: vi.fn(),
        onStop: vi.fn(),
      }),
    );
    expect(useSessionStore.getState().startGate).toEqual({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'speaker',
    });
  });

  it('republishes when the reason changes', () => {
    const { rerender } = renderHook(
      (props: { startGate: StartGate }) =>
        useSubtitleSessionBridge({
          startGate: props.startGate,
          isInitializing: false,
          initPhase: null,
          onStart: vi.fn(),
          onStop: vi.fn(),
        }),
      { initialProps: { startGate: { canStart: false, reason: 'api-key-invalid' } as StartGate } },
    );
    rerender({ startGate: readyGate });
    expect(useSessionStore.getState().startGate).toEqual({ canStart: true, reason: null });
  });

  it('mirrors initialization state and progress', () => {
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate,
        isInitializing: true,
        initPhase: { phase: 'loading-models', completed: 2, total: 5 },
        onStart: vi.fn(),
        onStop: vi.fn(),
      }),
    );
    expect(useSessionStore.getState().isInitializing).toBe(true);
    expect(useSessionStore.getState().initProgress).toEqual({ completed: 2, total: 5 });
  });
});

describe('useSubtitleSessionBridge request watching', () => {
  it('does not fire on mount even when the counters are non-zero', () => {
    useSessionStore.setState({ startSessionVersion: 7, stopSessionVersion: 4 });
    const onStart = vi.fn();
    const onStop = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initPhase: null, onStart, onStop,
      }),
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('calls onStart when the start counter bumps', () => {
    const onStart = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initPhase: null,
        onStart, onStop: vi.fn(),
      }),
    );
    act(() => { useSessionStore.getState().requestSessionStart(); });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('calls onStop when the stop counter bumps, and not onStart', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initPhase: null, onStart, onStop,
      }),
    );
    act(() => { useSessionStore.getState().requestSessionStop(); });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('fires once per bump', () => {
    const onStart = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initPhase: null,
        onStart, onStop: vi.fn(),
      }),
    );
    act(() => { useSessionStore.getState().requestSessionStart(); });
    act(() => { useSessionStore.getState().requestSessionStart(); });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  // The callbacks close over MainPanel state that changes every render;
  // re-arming the effect on every new closure would replay stale requests.
  it('invokes the latest callback without refiring on callback identity change', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      (props: { onStart: () => void }) =>
        useSubtitleSessionBridge({
          startGate: readyGate, isInitializing: false, initPhase: null,
          onStart: props.onStart, onStop: vi.fn(),
        }),
      { initialProps: { onStart: first } },
    );
    rerender({ onStart: second });
    expect(first).not.toHaveBeenCalled();
    act(() => { useSessionStore.getState().requestSessionStart(); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
