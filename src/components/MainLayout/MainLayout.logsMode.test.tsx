// A logs panel opened in advanced mode must not survive a switch to basic:
// the button that closes it is gone, stranding the panel open.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCloseLogsOutsideAdvanced } from './useCloseLogsOutsideAdvanced';

beforeEach(() => { sessionStorage.clear(); });

describe('useCloseLogsOutsideAdvanced', () => {
  it('closes an open logs panel when the mode becomes basic', () => {
    const setShowLogs = vi.fn();
    sessionStorage.setItem('panelState.showLogs', 'true');
    // Driven through the actual transition, not just asserted on the first
    // render: the hook exists for the moment the mode CHANGES, and a
    // mount-only assertion would still pass if the effect never re-ran.
    const { rerender } = renderHook(
      ({ mode }) => useCloseLogsOutsideAdvanced(mode, true, setShowLogs),
      { initialProps: { mode: 'advanced' } },
    );
    expect(setShowLogs).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('panelState.showLogs')).toBe('true');

    rerender({ mode: 'basic' });

    expect(setShowLogs).toHaveBeenCalledWith(false);
    expect(sessionStorage.getItem('panelState.showLogs')).toBe('false');
  });

  it('closes a logs panel restored from sessionStorage while already in basic mode', () => {
    const setShowLogs = vi.fn();
    sessionStorage.setItem('panelState.showLogs', 'true');
    renderHook(({ mode }) => useCloseLogsOutsideAdvanced(mode, true, setShowLogs), {
      initialProps: { mode: 'basic' as const },
    });
    expect(setShowLogs).toHaveBeenCalledWith(false);
    expect(sessionStorage.getItem('panelState.showLogs')).toBe('false');
  });

  it('leaves the panel alone in advanced mode', () => {
    const setShowLogs = vi.fn();
    renderHook(() => useCloseLogsOutsideAdvanced('advanced', true, setShowLogs));
    expect(setShowLogs).not.toHaveBeenCalled();
  });

  it('does nothing when the panel is already closed', () => {
    const setShowLogs = vi.fn();
    renderHook(() => useCloseLogsOutsideAdvanced('basic', false, setShowLogs));
    expect(setShowLogs).not.toHaveBeenCalled();
  });
});
