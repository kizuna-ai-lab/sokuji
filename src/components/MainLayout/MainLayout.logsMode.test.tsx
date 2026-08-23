// A logs panel opened in advanced mode must not survive a switch to basic:
// the button that closes it is gone, stranding the panel open.
//
// The hook decides only WHEN to close. Closing itself — the state, the
// persisted flag, and the panel-view analytics — belongs to the caller, which
// already owns all three. An earlier version took a bare setState and so
// closed the panel without ever ending its tracked view, leaving the analytics
// convinced logs were still on screen and charging the next panel's duration
// to them.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCloseLogsOutsideAdvanced } from './useCloseLogsOutsideAdvanced';

describe('useCloseLogsOutsideAdvanced', () => {
  it('asks the caller to close when the mode becomes basic', () => {
    const onClose = vi.fn();
    // Driven through the actual transition, not just asserted on the first
    // render: the hook exists for the moment the mode CHANGES, and a
    // mount-only assertion would still pass if the effect never re-ran.
    const { rerender } = renderHook(
      ({ mode }) => useCloseLogsOutsideAdvanced(mode, true, onClose),
      { initialProps: { mode: 'advanced' } },
    );
    expect(onClose).not.toHaveBeenCalled();

    rerender({ mode: 'basic' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a panel restored from a previous session while already in basic mode', () => {
    const onClose = vi.fn();
    renderHook(({ mode }) => useCloseLogsOutsideAdvanced(mode, true, onClose), {
      initialProps: { mode: 'basic' as const },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the panel alone in advanced mode', () => {
    const onClose = vi.fn();
    renderHook(() => useCloseLogsOutsideAdvanced('advanced', true, onClose));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does nothing when the panel is already closed', () => {
    const onClose = vi.fn();
    renderHook(() => useCloseLogsOutsideAdvanced('basic', false, onClose));
    expect(onClose).not.toHaveBeenCalled();
  });
});
