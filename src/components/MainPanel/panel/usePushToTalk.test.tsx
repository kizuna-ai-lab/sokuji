import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, fireEvent } from '@testing-library/react';
import { usePushToTalk } from './usePushToTalk';

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
});
