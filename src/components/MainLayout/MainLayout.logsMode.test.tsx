// A logs panel must not stay open once diagnostic logs are switched off: the
// button that closes it is gone, and the store it shows has just been emptied.
//
// The hook decides only WHEN to close. Closing itself — the state, the
// persisted flag, and the panel-view analytics — belongs to the caller, which
// already owns all three. An earlier version took a bare setState and so
// closed the panel without ever ending its tracked view, leaving the analytics
// convinced logs were still on screen and charging the next panel's duration
// to them.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCloseLogsWhenDisabled } from './useCloseLogsWhenDisabled';

describe('useCloseLogsWhenDisabled', () => {
  it('asks the caller to close when diagnostic logs are switched off', () => {
    const onClose = vi.fn();
    // Driven through the actual transition, not just asserted on the first
    // render: the hook exists for the moment the switch CHANGES, and a
    // mount-only assertion would still pass if the effect never re-ran.
    const { rerender } = renderHook(
      ({ enabled }) => useCloseLogsWhenDisabled(enabled, true, onClose),
      { initialProps: { enabled: true } },
    );
    expect(onClose).not.toHaveBeenCalled();

    rerender({ enabled: false });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a panel restored from a previous session while logs are off', () => {
    const onClose = vi.fn();
    renderHook(() => useCloseLogsWhenDisabled(false, true, onClose));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the panel alone while logs are on, in either UI mode', () => {
    const onClose = vi.fn();
    renderHook(() => useCloseLogsWhenDisabled(true, true, onClose));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does nothing when the panel is already closed', () => {
    const onClose = vi.fn();
    renderHook(() => useCloseLogsWhenDisabled(false, false, onClose));
    expect(onClose).not.toHaveBeenCalled();
  });
});
