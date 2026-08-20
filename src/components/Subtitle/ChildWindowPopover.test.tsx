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
  // jsdom has no ResizeObserver. Capture the callbacks so a test can play the
  // part of the browser noticing the hosted content changed height.
  let observers: Array<{ cb: () => void; live: boolean; targets: Element[] }>;
  // Only observers that have not been disconnected, mirroring the browser.
  const fireResizeObservers = () => {
    observers.filter((o) => o.live).forEach((o) => o.cb());
  };

  beforeEach(() => {
    observers = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      private entry: { cb: () => void; live: boolean; targets: Element[] };
      constructor(cb: () => void) {
        this.entry = { cb, live: true, targets: [] };
        observers.push(this.entry);
      }
      observe(el: Element) { this.entry.targets.push(el); }
      unobserve() {}
      disconnect() { this.entry.live = false; }
    };
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

  // The hosted popover is not a fixed-size thing: DisplaySettingsPopover grows
  // by ~190px when a color picker is expanded. A window measured once at open
  // would leave that content behind an internal scrollbar forever.
  describe('following the hosted content height', () => {
    // One test overrides screen.availHeight; drop the own property again so
    // the prototype getter is back for everyone else.
    afterEach(() => {
      delete (window.screen as unknown as Record<string, unknown>).availHeight;
    });

    // createWindow appends a fresh root on every (re)creation, so always take
    // the newest one rather than the first.
    const rootOf = () => {
      const all = child.document.querySelectorAll('.child-popover-root');
      return all[all.length - 1] as HTMLElement;
    };

    // Array.prototype.at is outside the project's ES2020 lib target.
    const lastResizeHeight = () => {
      const calls = child.resizeTo.mock.calls;
      return calls.length ? (calls[calls.length - 1][1] as number) : undefined;
    };

    const lastMoveTop = () => {
      const calls = child.moveTo.mock.calls;
      return calls.length ? (calls[calls.length - 1][1] as number) : undefined;
    };

    const contentOf = () => {
      const all = child.document.querySelectorAll('.child-popover-content');
      return all[all.length - 1] as HTMLElement;
    };

    // Height is taken from the content wrapper, so that is what a test must
    // stub. Stubbing the root would prove nothing: the root is the capped
    // element and is deliberately not what drives the size.
    const stubHeight = (h: number) => {
      const content = contentOf();
      content.getBoundingClientRect = () =>
        ({ width: 280, height: h, top: 0, left: 0, right: 280, bottom: h } as DOMRect);
    };

    const openPopover = (onClose = vi.fn()) => {
      const utils = render(
        <ChildWindowPopover open={false} onClose={onClose} anchorEl={anchor} width={320} height={400}>
          <div className="probe-content">hello</div>
        </ChildWindowPopover>,
      );
      const setOpen = (open: boolean) =>
        utils.rerender(
          <ChildWindowPopover open={open} onClose={onClose} anchorEl={anchor} width={320} height={400}>
            <div className="probe-content">hello</div>
          </ChildWindowPopover>,
        );
      return { ...utils, setOpen };
    };

    // The bug this guards against is invisible to a test that fires the
    // observer by hand: if the observed element is the one carrying the height
    // cap, expanding content only grows its scroll height, the border box
    // never changes, and the browser never calls the callback at all. Verified
    // in a real browser before this assertion existed — four expand/collapse
    // cycles produced exactly zero callbacks.
    it('observes an element that is free to grow, not the one it caps', () => {
      const { setOpen } = openPopover();
      stubHeight(280);
      act(() => { setOpen(true); });

      const targets = observers.filter((o) => o.live).flatMap((o) => o.targets);
      expect(targets.length).toBeGreaterThan(0);

      for (const el of targets) {
        const style = (el as HTMLElement).style;
        expect(style.maxHeight).toBe('');
        expect(style.getPropertyValue('--popover-max-height')).toBe('');
      }

      // ...and something else is in fact carrying the cap, so the popover is
      // still constrained to the window.
      const root = rootOf();
      expect(root.style.maxHeight).not.toBe('');
      expect(targets).not.toContain(root);
    });

    it('sizes the window from the content wrapper, never from the capped port', () => {
      const { setOpen } = openPopover();
      stubHeight(468);
      // Give the capped port a deliberately wrong height. If the host reads it
      // — as it would if the cap and the measurement sat on the same element —
      // the window comes out at 999 instead of the content's 468.
      const root = rootOf();
      root.getBoundingClientRect = () =>
        ({ width: 280, height: 999, top: 0, left: 0, right: 280, bottom: 999 } as DOMRect);

      act(() => { setOpen(true); });
      expect(lastResizeHeight()).toBe(468);
    });

    it('tells the popover not to cap itself; the port does the clipping', () => {
      openPopover();
      const root = rootOf();
      expect(root.style.getPropertyValue('--popover-max-height')).toBe('none');
      expect(root.style.overflowY).toBe('auto');
    });

    it('resizes the window when the content grows while open', () => {
      const { setOpen } = openPopover();
      stubHeight(280);
      act(() => { setOpen(true); });
      expect(lastResizeHeight()).toBe(280);

      // A color picker expands.
      stubHeight(468);
      act(() => { fireResizeObservers(); });
      expect(lastResizeHeight()).toBe(468);
    });

    it('caps the window at the usable screen height and lets the popover scroll', () => {
      // jsdom reports 0 for every screen metric; give it a real one, since
      // this is the assertion that depends on it.
      const avail = 600;
      Object.defineProperty(window.screen, 'availHeight', {
        value: avail, configurable: true,
      });
      const { setOpen } = openPopover();
      stubHeight(avail + 500);
      act(() => { setOpen(true); });

      const asked = lastResizeHeight() as number;
      expect(asked).toBeLessThanOrEqual(avail);
      expect(asked).toBeGreaterThan(0);
      // ...and the scroll port gets the same cap, so the overflow scrolls
      // instead of being cut off at the window edge.
      expect(rootOf().style.maxHeight).toBe(`${asked}px`);
    });

    // Which side of the anchor the window opens on depends on the height, so
    // recomputing it on every resize made the window jump across the bar the
    // moment a color picker expanded past the room above the anchor. The side
    // is chosen once per open and held.
    it('does not flip to the other side of the anchor when the content grows', () => {
      // A real screen, or the clamp below collapses both branches onto 0 and
      // the assertion cannot tell them apart.
      Object.defineProperty(window.screen, 'availHeight', {
        value: 1000, configurable: true,
      });
      const { setOpen } = openPopover();

      // anchor sits at top 700 / bottom 736, so 280 fits above it.
      stubHeight(280);
      act(() => { setOpen(true); });
      const openedAt = lastMoveTop();
      expect(openedAt).toBe(700 - 280 - 8);

      // 800 no longer fits above. Holding the side pins it to the screen top;
      // flipping would drop it to the clamped below-anchor position instead.
      stubHeight(800);
      act(() => { fireResizeObservers(); });
      expect(lastMoveTop()).toBe(0);
      expect(lastMoveTop()).not.toBe(200);
    });

    it('re-decides the side on the next open', () => {
      Object.defineProperty(window.screen, 'availHeight', {
        value: 1000, configurable: true,
      });
      const { setOpen } = openPopover();
      stubHeight(280);
      act(() => { setOpen(true); });
      expect(lastMoveTop()).toBe(412);

      act(() => { setOpen(false); });
      // Too tall to sit above the anchor: this open must land below it.
      stubHeight(800);
      act(() => { setOpen(true); });
      expect(lastMoveTop()).toBe(200);
    });

    it('stops observing once closed', () => {
      const { setOpen } = openPopover();
      stubHeight(280);
      act(() => { setOpen(true); });
      act(() => { setOpen(false); });

      child.resizeTo.mockClear();
      stubHeight(468);
      act(() => { fireResizeObservers(); });
      expect(child.resizeTo).not.toHaveBeenCalled();
    });
  });

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
