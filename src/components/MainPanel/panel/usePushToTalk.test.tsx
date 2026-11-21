import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, fireEvent } from '@testing-library/react';
import { usePushToTalk } from './usePushToTalk';
import { useLayoutStore } from '../../../stores/layoutStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';

describe('usePushToTalk', () => {
  it('presses on Space down and releases on Space up, ignoring repeats', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result } = renderHook(() => usePushToTalk({ enabled: true, press, release }));

    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(true);

    // A key-repeat while held presses no second time.
    act(() => { fireEvent.keyDown(window, { code: 'Space', repeat: true }); });
    expect(press).toHaveBeenCalledTimes(1);

    act(() => { fireEvent.keyUp(window, { code: 'Space' }); });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(false);
  });

  it('ignores Space while typing in an input', () => {
    const press = vi.fn();
    const release = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    renderHook(() => usePushToTalk({ enabled: true, press, release }));
    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    act(() => { fireEvent.keyUp(window, { code: 'Space' }); });
    expect(press).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('holds on the key the user picked instead of Space, and only on it', () => {
    useTurnModeStore.setState({ pushKey: 'ControlRight' });
    try {
      const press = vi.fn();
      const release = vi.fn();
      const { result } = renderHook(() => usePushToTalk({ enabled: true, press, release }));

      act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
      expect(press).not.toHaveBeenCalled();

      act(() => { fireEvent.keyDown(window, { code: 'ControlRight' }); });
      expect(press).toHaveBeenCalledTimes(1);
      expect(result.current.held).toBe(true);
      act(() => { fireEvent.keyUp(window, { code: 'ControlRight' }); });
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      useTurnModeStore.setState({ pushKey: 'Space' });
    }
  });

  it('follows a key changed while it is listening', () => {
    const press = vi.fn();
    const release = vi.fn();
    renderHook(() => usePushToTalk({ enabled: true, press, release }));
    act(() => { useTurnModeStore.setState({ pushKey: 'F8' }); });
    try {
      act(() => { fireEvent.keyDown(window, { code: 'F8' }); });
      expect(press).toHaveBeenCalledTimes(1);
    } finally {
      useTurnModeStore.setState({ pushKey: 'Space' });
    }
  });

  it('lets go of a hold when the key is changed under it', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result } = renderHook(() => usePushToTalk({ enabled: true, press, release }));
    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(result.current.held).toBe(true);
    act(() => { useTurnModeStore.setState({ pushKey: 'F8' }); });
    try {
      expect(release).toHaveBeenCalledTimes(1);
      expect(result.current.held).toBe(false);
    } finally {
      useTurnModeStore.setState({ pushKey: 'Space' });
    }
  });

  it('ignores the key pressed with Ctrl, Alt, Cmd or Shift, so shortcuts that share it hold no turn', () => {
    useTurnModeStore.setState({ pushKey: 'KeyT' });
    try {
      const press = vi.fn();
      const release = vi.fn();
      renderHook(() => usePushToTalk({ enabled: true, press, release }));
      for (const mod of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const) {
        act(() => { fireEvent.keyDown(window, { code: 'KeyT', [mod]: true }); });
      }
      expect(press).not.toHaveBeenCalled();
      act(() => { fireEvent.keyDown(window, { code: 'KeyT' }); });
      expect(press).toHaveBeenCalledTimes(1);
    } finally {
      useTurnModeStore.setState({ pushKey: 'Space' });
    }
  });

  it('a modifier chosen as the key holds whatever else is down', () => {
    useTurnModeStore.setState({ pushKey: 'ShiftRight' });
    try {
      const press = vi.fn();
      renderHook(() => usePushToTalk({ enabled: true, press, release: vi.fn() }));
      act(() => { fireEvent.keyDown(window, { code: 'ShiftRight', shiftKey: true }); });
      expect(press).toHaveBeenCalledTimes(1);
    } finally {
      useTurnModeStore.setState({ pushKey: 'Space' });
    }
  });

  it('lets go on key-up even if focus moved into a text field while held', () => {
    const press = vi.fn();
    const release = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      renderHook(() => usePushToTalk({ enabled: true, press, release }));
      act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
      input.focus();
      act(() => { fireEvent.keyUp(window, { code: 'Space' }); });
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(input);
    }
  });

  it('ignores any other key', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result } = renderHook(() => usePushToTalk({ enabled: true, press, release }));

    act(() => { fireEvent.keyDown(window, { code: 'KeyA' }); });
    expect(press).not.toHaveBeenCalled();
    expect(result.current.held).toBe(false);
  });

  it('releases on window blur while held', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result } = renderHook(() => usePushToTalk({ enabled: true, press, release }));

    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(result.current.held).toBe(true);

    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(false);
  });

  it('releases when enabled turns false while held, and ignores keys until re-enabled', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ enabled, press, release }),
      { initialProps: { enabled: true } },
    );

    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(result.current.held).toBe(true);

    rerender({ enabled: false });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(false);

    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    act(() => { fireEvent.keyUp(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(1); // only the earlier press
    expect(release).toHaveBeenCalledTimes(1); // no extra release while disabled
  });

  it('the returned press()/release() do what the key does, and are no-ops when disabled', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ enabled, press, release }),
      { initialProps: { enabled: true } },
    );

    act(() => { result.current.press(); });
    expect(press).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(true);

    act(() => { result.current.release(); });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(false);

    rerender({ enabled: false });
    act(() => {
      result.current.press();
      result.current.release();
    });
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('holds nothing while the History page covers the panel, and releases a hold when it opens', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result } = renderHook(() => usePushToTalk({ enabled: true, press, release }));

    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(1);
    act(() => { useLayoutStore.getState().setHistoryOpen(true); });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(false);

    // Space on a focused History button presses its button, not the microphone.
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    act(() => { fireEvent.keyUp(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    act(() => { useLayoutStore.getState().setHistoryOpen(false); });
    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(2);
    document.body.removeChild(button);
  });
  it('holds nothing while the desktop settings page covers the panel, and releases a hold when it opens', () => {
    const press = vi.fn();
    const release = vi.fn();
    const { result } = renderHook(() => usePushToTalk({ enabled: true, press, release }));

    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(1);
    act(() => { useLayoutStore.getState().setShowSettings(true); });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBe(false);

    // Space on a focused settings switch flips the switch, not the microphone.
    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    act(() => { fireEvent.keyUp(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(1);

    act(() => { useLayoutStore.getState().setShowSettings(false); });
    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(press).toHaveBeenCalledTimes(2);
    act(() => { fireEvent.keyUp(window, { code: 'Space' }); });
  });
});
