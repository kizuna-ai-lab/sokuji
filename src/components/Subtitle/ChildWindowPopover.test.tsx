import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, renderHook } from '@testing-library/react';
import { ChildWindowPopover, useChildPopoverToggle } from './ChildWindowPopover';

// A stand-in for the frameless child window window.open() returns in Electron.
// jsdom's own window.open returns null, so the component under test gets this
// instead; the document is a real jsdom Document so React can portal into it.
function makeFakeChild() {
  const doc = document.implementation.createHTMLDocument('popover');
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const child = {
    closed: false,
    document: doc,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: unknown = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    close: vi.fn(function (this: { closed: boolean }) { child.closed = true; }),
    resizeTo: vi.fn(),
    moveTo: vi.fn(),
    focus: vi.fn(),
  };
  return child;
}


describe('ChildWindowPopover', () => {
  let child: ReturnType<typeof makeFakeChild>;
  let openSpy: ReturnType<typeof vi.spyOn>;
  let anchor: HTMLButtonElement;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    child = makeFakeChild();
    openSpy = vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window);
    invoke = vi.fn(async () => ({ ok: true }));
    (window as { electron?: unknown }).electron = { invoke };
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () =>
      ({ top: 700, bottom: 736, left: 900, right: 1200, width: 300, height: 36 } as DOMRect);
  });

  afterEach(() => {
    openSpy.mockRestore();
    anchor.remove();
    delete (window as { electron?: unknown }).electron;
  });

  const renderPopover = (open: boolean, onClose = vi.fn()) => {
    const utils = render(
      <ChildWindowPopover open={open} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div className="probe-content">hello</div>
      </ChildWindowPopover>,
    );
    return { ...utils, onClose };
  };

  it('creates the window on mount, named for the main-process hidden override', () => {
    // Created while CLOSED: the whole point of pre-creation is that the
    // click pays none of the native-window / stylesheet / first-paint cost.
    // The target name is what electron/popover-windows.js keys its
    // show:false override and the visibility IPC on.
    renderPopover(false);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][1])).toMatch(/^sokuji-popover:/);
    const features = String(openSpy.mock.calls[0][2]);
    for (const f of ['frame=false', 'transparent=true', 'alwaysOnTop=true', 'skipTaskbar=true']) {
      expect(features).toContain(f);
    }
  });

  it('carries the Linux toolbar type hint so GNOME skips its map animation', () => {
    // GNOME animates NORMAL windows on map (~200ms fade) and skips every
    // other type; type=toolbar is how the popover opts out. Linux-only —
    // macOS rejects the value and Windows has no fade to suppress.
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    try {
      renderPopover(false);
      expect(String(openSpy.mock.calls[0][2])).toContain('type=toolbar');
    } finally {
      delete (navigator as { platform?: string }).platform;
    }
  });

  it('omits the type hint off Linux', () => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    try {
      renderPopover(false);
      expect(String(openSpy.mock.calls[0][2])).not.toContain('type=');
    } finally {
      delete (navigator as { platform?: string }).platform;
    }
  });

  it('renders the children into the hidden window even while closed', () => {
    // Content lives in the child permanently, updating off-screen, so
    // opening has nothing left to build.
    renderPopover(false);
    expect(child.document.querySelector('.probe-content')?.textContent).toBe('hello');
  });

  it('copies the parent stylesheets into the child head', () => {
    const style = document.createElement('style');
    style.textContent = '.probe-content{color:red}';
    document.head.appendChild(style);
    try {
      renderPopover(false);
      const copied = Array.from(child.document.head.querySelectorAll('style'))
        .some((s) => s.textContent?.includes('.probe-content'));
      expect(copied).toBe(true);
    } finally {
      style.remove();
    }
  });

  it('opening places the window then shows it over IPC; closing hides it', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ChildWindowPopover open={false} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div>x</div>
      </ChildWindowPopover>,
    );
    const name = String(openSpy.mock.calls[0][1]);
    invoke.mockClear();

    rerender(
      <ChildWindowPopover open={true} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div>x</div>
      </ChildWindowPopover>,
    );
    // Sized and positioned while still hidden, then shown by the main
    // process (show also focuses; focus is what makes blur-dismiss work).
    expect(child.resizeTo).toHaveBeenCalled();
    expect(child.moveTo).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('popover-window:set-visible', { name, visible: true });
    expect(child.focus).toHaveBeenCalled();

    invoke.mockClear();
    rerender(
      <ChildWindowPopover open={false} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div>x</div>
      </ChildWindowPopover>,
    );
    expect(invoke).toHaveBeenCalledWith('popover-window:set-visible', { name, visible: false });
    // Hidden, NOT closed — the next open must not pay creation again.
    expect(child.close).not.toHaveBeenCalled();
  });

  it('closes with reason "blur" when the OPEN child loses focus', () => {
    const { onClose } = renderPopover(true);
    act(() => { child.dispatch('blur'); });
    expect(onClose).toHaveBeenCalledWith('blur');
  });

  it('ignores blur while hidden', () => {
    // Hidden windows can emit stray blurs (e.g. during creation); those must
    // not count as dismissals.
    const { onClose } = renderPopover(false);
    act(() => { child.dispatch('blur'); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes with reason "escape" on Escape in the open child', () => {
    const { onClose } = renderPopover(true);
    act(() => { child.dispatch('keydown', { key: 'Escape' }); });
    expect(onClose).toHaveBeenCalledWith('escape');
  });

  it('recreates the window when the native one was closed externally', () => {
    // Alt+F4 / a WM close command destroys the native window without React
    // knowing. The next open must rebuild it instead of toggling a corpse.
    const onClose = vi.fn();
    const { rerender } = render(
      <ChildWindowPopover open={false} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div className="probe-content">x</div>
      </ChildWindowPopover>,
    );
    expect(openSpy).toHaveBeenCalledTimes(1);

    child.closed = true; // the WM killed it
    const child2 = makeFakeChild();
    openSpy.mockReturnValue(child2 as unknown as Window);

    rerender(
      <ChildWindowPopover open={true} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div className="probe-content">x</div>
      </ChildWindowPopover>,
    );
    expect(openSpy).toHaveBeenCalledTimes(2);
    // The rebuilt window carries the content and gets shown.
    expect(child2.document.querySelector('.probe-content')).not.toBeNull();
    const name2 = String(openSpy.mock.calls[1][1]);
    expect(invoke).toHaveBeenCalledWith('popover-window:set-visible', { name: name2, visible: true });
    expect(child2.focus).toHaveBeenCalled();
  });

  it('does not dismiss on the blur a native picker (color input) causes', () => {
    // Opening <input type="color"> hands focus to the OS chooser; that blur
    // must not close the settings popover mid-interaction. Focus returning
    // to the child re-arms normal blur dismissal.
    const { onClose } = renderPopover(true);
    const colorInput = child.document.createElement('input');
    colorInput.type = 'color';
    child.document.body.appendChild(colorInput);

    act(() => { child.dispatch('mousedown', { target: colorInput }); });
    act(() => { child.dispatch('blur'); });
    expect(onClose).not.toHaveBeenCalled();

    act(() => { child.dispatch('focus'); });
    act(() => { child.dispatch('blur'); });
    expect(onClose).toHaveBeenCalledWith('blur');
  });

  it('suppresses the blur for a KEYBOARD-activated picker (no mousedown at all)', () => {
    // Space/Enter on a focused color input runs the activation behavior,
    // which dispatches click directly — mousedown never happens, so arming
    // on mousedown alone would let the picker's focus grab close the popover.
    const { onClose } = renderPopover(true);
    const colorInput = child.document.createElement('input');
    colorInput.type = 'color';
    child.document.body.appendChild(colorInput);

    act(() => { child.dispatch('click', { target: colorInput }); });
    act(() => { child.dispatch('blur'); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('suppresses the blur when the picker is reached through its wrapping label', () => {
    // DisplaySettingsPopover wraps its color input in a <label> holding an
    // icon. A mouse press lands on the label/icon, whose closest() finds no
    // input — the matching target only appears on the click the label
    // forwards to the control.
    const { onClose } = renderPopover(true);
    const label = child.document.createElement('label');
    const icon = child.document.createElement('span');
    const colorInput = child.document.createElement('input');
    colorInput.type = 'color';
    label.append(icon, colorInput);
    child.document.body.appendChild(label);

    act(() => { child.dispatch('mousedown', { target: icon }); });   // no match
    act(() => { child.dispatch('click', { target: colorInput }); }); // forwarded
    act(() => { child.dispatch('blur'); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the OS window only on unmount', () => {
    const { unmount } = renderPopover(true);
    expect(child.close).not.toHaveBeenCalled();
    unmount();
    expect(child.close).toHaveBeenCalled();
  });

  it('survives window.open being refused', () => {
    openSpy.mockReturnValue(null as unknown as Window);
    // No crash on mount, open, or unmount; the popover is simply unavailable.
    const onClose = vi.fn();
    const { rerender, unmount } = render(
      <ChildWindowPopover open={false} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div>x</div>
      </ChildWindowPopover>,
    );
    rerender(
      <ChildWindowPopover open={true} onClose={onClose} anchorEl={anchor} width={320} height={400}>
        <div>x</div>
      </ChildWindowPopover>,
    );
    unmount();
  });
});

describe('useChildPopoverToggle', () => {
  it('toggles open and closed', () => {
    const { result } = renderHook(() => useChildPopoverToggle());
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it('swallows the toggle that immediately follows a blur-close', () => {
    // Clicking the trigger while the popover is open steals focus from the
    // child FIRST: blur fires, the popover closes, and then the trigger's own
    // click would reopen it — the button would never close anything. The
    // window after a blur-close absorbs that click.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useChildPopoverToggle());
      act(() => result.current.toggle());
      act(() => result.current.onClose('blur'));
      expect(result.current.open).toBe(false);

      act(() => result.current.toggle());       // the same click that caused the blur
      expect(result.current.open).toBe(false);  // swallowed

      act(() => { vi.advanceTimersByTime(400); });
      act(() => result.current.toggle());       // a genuine later click
      expect(result.current.open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not swallow after a non-blur close', () => {
    const { result } = renderHook(() => useChildPopoverToggle());
    act(() => result.current.toggle());
    act(() => result.current.onClose('escape'));
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
  });
});
