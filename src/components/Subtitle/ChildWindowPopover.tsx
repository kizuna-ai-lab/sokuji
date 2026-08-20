// src/components/Subtitle/ChildWindowPopover.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useLogStore from '../../stores/logStore';

/**
 * Hosts a popover in its own frameless, transparent OS window instead of
 * inside the parent window's DOM.
 *
 * Why: subtitle mode shrinks the main window to a ~200px bar, and any
 * in-window popover is clipped at its edge. The earlier fix grew the window
 * for the popover's lifetime, but resizing a transparent window flashes at
 * the compositor level (frame-sampled: the DOM stays continuous, the flash
 * is below it — un-fixable from the renderer). A child window sidesteps the
 * whole class: the subtitle window is never touched, the popover paints in
 * its own surface above everything, and it remains ordinary, fully-styleable
 * React DOM.
 *
 * Mechanics: Electron parses BrowserWindow options straight out of
 * window.open's feature string, so the renderer picks the frameless,
 * transparent, always-on-top shape itself; the main process only overrides
 * `show` and owns visibility (electron/popover-windows.js). The children
 * render into it through createPortal — they
 * stay part of THIS React tree, so handlers and context work unchanged — and
 * the parent's stylesheets are cloned into the child head so the same
 * component styles apply (the react-new-window copyStyles pattern).
 *
 * The window is created ONCE — hidden, via a main-process
 * setWindowOpenHandler override keyed on the window.open target name (see
 * electron/popover-windows.js) — and kept for the component's lifetime.
 * Opening is resize + move + a show over IPC. Creating on demand paid the
 * whole native-window + stylesheet-parse + first-composite bill inside the
 * click (a perceptible 100–250ms lag); creating hidden up front pays it on
 * subtitle-mode entry, where nobody is waiting on it.
 *
 * Electron-only by design: the extension overlay lives in an iframe with no
 * OS window to open, and keeps its in-window floating-ui popover.
 */

export type ChildPopoverCloseReason = 'blur' | 'escape' | 'moved' | 'failed' | 'action';

interface ChildWindowPopoverProps {
  open: boolean;
  onClose: (reason: ChildPopoverCloseReason) => void;
  /** The toolbar button the popover hangs off. */
  anchorEl: HTMLElement | null;
  /** Size the parked window is created at; the real size is measured from
   *  the rendered content on every open. */
  width: number;
  height: number;
  children: React.ReactNode;
}

const EDGE_PAD = 8;

// window.open target prefix the main process recognizes (popover-windows.js):
// windows named this way are created hidden and shown/hidden over IPC.
// Off-screen "parking" is not an option — mutter clamps both the initial
// position and runtime moveTo back onto the screen (measured: a window
// parked at (-10000, 0) sat at (0, 32), fully visible).
const POPOVER_PREFIX = 'sokuji-popover:';
let popoverSerial = 0;

function setNativeVisibility(name: string, visible: boolean): void {
  void (async () => {
    try {
      await (window as { electron?: { invoke: (c: string, p: unknown) => Promise<unknown> } })
        .electron?.invoke('popover-window:set-visible', { name, visible });
    } catch (error) {
      // A rejection leaves the popover in the wrong visibility state; there
      // is no recovery beyond the user toggling again, but it must not be
      // silent (and never an unhandled rejection).
      useLogStore.getState().addLog(
        `[ChildWindowPopover] set-visible(${visible}) failed for ${name}: ${String(error)}`,
        'error',
      );
    }
  })();
}

/**
 * GNOME's compositor plays a ~200ms fade/zoom "map" animation for NORMAL
 * windows, which reads as an unwanted popover-open animation. It skips the
 * animation entirely for non-NORMAL types, and Electron accepts
 * `type: 'toolbar'` (_NET_WM_WINDOW_TYPE_TOOLBAR) on Linux — verified with
 * xprop on a live window. Linux-only: macOS uses a different value set for
 * `type` and would reject it, and Windows shows new windows instantly with
 * no system fade to suppress in the first place. navigator.platform rather
 * than the UA string — the app ships a custom user agent.
 */
function platformWindowTypeFeature(): string[] {
  return /linux/i.test(navigator.platform) ? ['type=toolbar'] : [];
}

/** Clone parent stylesheets the child doesn't have yet. Runs on every open,
 *  not just at creation, so styles added later (dev HMR, lazy chunks) reach
 *  the parked window too. */
function syncStyles(from: Document, to: Document, cloned: WeakSet<Node>) {
  from.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    if (cloned.has(node)) return;
    cloned.add(node);
    to.head.appendChild(to.importNode(node, true));
  });
}

export const ChildWindowPopover: React.FC<ChildWindowPopoverProps> = ({
  open, onClose, anchorEl, width, height, children,
}) => {
  const winRef = useRef<Window | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const clonedStylesRef = useRef(new WeakSet<Node>());
  // The latest values without re-running effects that must not churn.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;

  // Create the hidden window. Callable more than once: the native window can
  // be destroyed under React by a WM close command (Alt+F4 and friends), and
  // the next open rebuilds it instead of toggling a corpse.
  const nameRef = useRef('');
  const teardownRef = useRef<(() => void) | null>(null);
  const createWindow = useCallback(() => {
    teardownRef.current?.();
    teardownRef.current = null;

    const name = `${POPOVER_PREFIX}${++popoverSerial}`;
    nameRef.current = name;
    const features = [
      `width=${width}`, `height=${height}`,
      'frame=false', 'transparent=true', 'alwaysOnTop=true', 'skipTaskbar=true',
      'resizable=false', 'minimizable=false', 'maximizable=false', 'hasShadow=false',
      // Best-effort shield against WM close commands; the rebuild path above
      // still covers whatever gets through.
      'closable=false',
      'focusable=true',
      ...platformWindowTypeFeature(),
    ].join(',');
    const win = window.open('', name, features);
    if (!win) {
      // Outside Electron (or blocked) — nothing to host the popover in.
      console.warn('[ChildWindowPopover] window.open refused; popover unavailable');
      return;
    }
    winRef.current = win;

    clonedStylesRef.current = new WeakSet();
    syncStyles(document, win.document, clonedStylesRef.current);
    const body = win.document.body;
    body.style.margin = '0';
    body.style.background = 'transparent';
    body.style.overflow = 'hidden';
    const root = win.document.createElement('div');
    root.className = 'child-popover-root';
    // Shrink-wrap so the open-time measurement reads the popover's own
    // footprint rather than the hidden window's.
    root.style.width = 'fit-content';
    body.appendChild(root);
    setContainer(root);

    // Dismissal listeners live for the window's lifetime; they no-op while
    // hidden (a hidden window never has focus to lose).
    //
    // suppressBlur: opening a native picker owned by this window (the color
    // chooser behind <input type="color">, a file dialog) steals focus and
    // fires blur — closing then would tear the popover away mid-interaction.
    // Activating such an input arms the suppression; focus returning to the
    // window re-arms normal blur dismissal.
    //
    // Both mousedown AND a capturing click are needed, and click is the one
    // that does the real work: keyboard activation (Space/Enter) dispatches
    // click with no mousedown at all, and DisplaySettingsPopover wraps its
    // colour input in a <label> — a mouse press there targets the label or
    // its icon, where closest() finds no input; the input only becomes the
    // target on the click the label forwards to it. mousedown stays as the
    // earliest possible arming point for a direct press on the control.
    //
    // Residual edge, accepted: if the user abandons the picker by focusing a
    // different application entirely, suppression stays armed until focus
    // returns here. The trigger button still closes the popover.
    let suppressBlur = false;
    const handlePickerActivation = (e: unknown) => {
      const target = (e as { target?: Element | null }).target;
      if (target && typeof target.closest === 'function'
          && target.closest('input[type="color"], input[type="file"]')) {
        suppressBlur = true;
      }
    };
    const handleFocus = () => { suppressBlur = false; };
    const handleBlur = () => {
      if (suppressBlur) return;
      if (openRef.current) onCloseRef.current('blur');
    };
    const handleKeydown = (e: unknown) => {
      if (openRef.current && (e as KeyboardEvent).key === 'Escape') onCloseRef.current('escape');
    };
    win.addEventListener('mousedown', handlePickerActivation as EventListener, true);
    win.addEventListener('click', handlePickerActivation as EventListener, true);
    win.addEventListener('focus', handleFocus);
    win.addEventListener('blur', handleBlur);
    win.addEventListener('keydown', handleKeydown as EventListener);

    teardownRef.current = () => {
      win.removeEventListener('mousedown', handlePickerActivation as EventListener, true);
      win.removeEventListener('click', handlePickerActivation as EventListener, true);
      win.removeEventListener('focus', handleFocus);
      win.removeEventListener('blur', handleBlur);
      win.removeEventListener('keydown', handleKeydown as EventListener);
      setContainer(null);
      winRef.current = null;
      if (!win.closed) win.close();
    };
  }, [width, height]);

  useEffect(() => {
    createWindow();
    return () => {
      teardownRef.current?.();
      teardownRef.current = null;
    };
  }, [createWindow]);

  // Open: measure the already-rendered content, size and place the window
  // while it is still hidden, then have the main process show it (show also
  // focuses, and focus is what makes blur-dismiss work). Close: hide it.
  useEffect(() => {
    const win = winRef.current;
    if (open && anchorEl && (!win || win.closed)) {
      // Destroyed externally (WM close). Rebuild; the container state change
      // reruns this effect, which then places and shows the new window.
      createWindow();
      return;
    }
    if (!win || win.closed || !container) return;

    if (!open || !anchorEl) {
      setNativeVisibility(nameRef.current, false);
      return;
    }

    // Styles that appeared since creation (dev HMR, late chunks).
    syncStyles(document, win.document, clonedStylesRef.current);

    const rect = container.getBoundingClientRect();
    const w = Math.ceil(rect.width) || width;
    const h = Math.ceil(rect.height) || height;

    const anchor = anchorEl.getBoundingClientRect();
    const screenTop = (window.screen as { availTop?: number }).availTop ?? 0;
    const screenLeft = (window.screen as { availLeft?: number }).availLeft ?? 0;
    const anchorTop = window.screenY + anchor.top;
    const anchorBottom = window.screenY + anchor.bottom;
    // Above the anchor, right edges aligned; below when the screen has no
    // room above. Clamped on ALL edges — a partially off-screen request gets
    // re-placed by mutter to an arbitrary position, which is worse than a
    // slightly shifted popover.
    const above = anchorTop - h - EDGE_PAD >= screenTop;
    const left = Math.min(
      Math.max(screenLeft, Math.round(window.screenX + anchor.right - w)),
      screenLeft + Math.max(0, window.screen.availWidth - w),
    );
    const rawTop = above
      ? Math.round(anchorTop - h - EDGE_PAD)
      : Math.round(anchorBottom + EDGE_PAD);
    const top = Math.min(
      Math.max(screenTop, rawTop),
      screenTop + Math.max(0, window.screen.availHeight - h),
    );

    win.resizeTo(w, h);
    win.moveTo(left, top);
    setNativeVisibility(nameRef.current, true);
    win.focus();

    // The bar window can move under the popover (its whole surface is a drag
    // region). There is no DOM event for a window move; poll and close —
    // repositioning live would fight the WM mid-drag.
    const startX = window.screenX;
    const startY = window.screenY;
    const movePoll = setInterval(() => {
      if (window.screenX !== startX || window.screenY !== startY) {
        onCloseRef.current('moved');
      }
    }, 300);
    return () => clearInterval(movePoll);
  }, [open, anchorEl, container, width, height, createWindow]);

  // Children render into the hidden window permanently — store-driven updates
  // keep flowing while it is invisible, so opening has nothing to build.
  if (!container) return null;
  return createPortal(children, container);
};

/**
 * Open/close state for a ChildWindowPopover driven by a toggle button.
 *
 * Owns the one interaction quirk of window-hosted popovers: clicking the
 * trigger while the popover is open steals focus from the child FIRST, so
 * blur closes it before the trigger's click lands — and the click would
 * immediately reopen it, making the button unable to ever close. A short
 * window after a blur-close absorbs that click.
 */
export function useChildPopoverToggle() {
  const [open, setOpen] = useState(false);
  const blockUntilRef = useRef(0);

  const onClose = useCallback((reason: ChildPopoverCloseReason) => {
    setOpen(false);
    if (reason === 'blur') blockUntilRef.current = Date.now() + 250;
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o && Date.now() < blockUntilRef.current) return o;
      return !o;
    });
  }, []);

  return { open, toggle, onClose };
}
