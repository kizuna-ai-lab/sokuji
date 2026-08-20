// src/components/Subtitle/ChildWindowPopover.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
 * window.open's feature string (main registers no setWindowOpenHandler), so
 * the renderer can open a frameless transparent always-on-top window without
 * main-process help. The children render into it through createPortal — they
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
  void (window as { electron?: { invoke: (c: string, p: unknown) => Promise<unknown> } })
    .electron?.invoke('popover-window:set-visible', { name, visible });
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

  // Create the hidden window once, for the component's lifetime.
  const nameRef = useRef('');
  useEffect(() => {
    const name = `${POPOVER_PREFIX}${++popoverSerial}`;
    nameRef.current = name;
    const features = [
      `width=${width}`, `height=${height}`,
      'frame=false', 'transparent=true', 'alwaysOnTop=true', 'skipTaskbar=true',
      'resizable=false', 'minimizable=false', 'maximizable=false', 'hasShadow=false',
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
    // footprint rather than the parked window's.
    root.style.width = 'fit-content';
    body.appendChild(root);
    setContainer(root);

    // Dismissal listeners live for the window's lifetime; they no-op while
    // hidden (a hidden window never has focus to lose).
    const handleBlur = () => { if (openRef.current) onCloseRef.current('blur'); };
    const handleKeydown = (e: unknown) => {
      if (openRef.current && (e as KeyboardEvent).key === 'Escape') onCloseRef.current('escape');
    };
    win.addEventListener('blur', handleBlur);
    win.addEventListener('keydown', handleKeydown as EventListener);

    return () => {
      win.removeEventListener('blur', handleBlur);
      win.removeEventListener('keydown', handleKeydown as EventListener);
      setContainer(null);
      winRef.current = null;
      if (!win.closed) win.close();
    };
    // The parked window is sized/positioned per open; creation params are
    // deliberately captured once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open: measure the already-rendered content, size and place the window
  // while it is still hidden, then have the main process show it (show also
  // focuses, and focus is what makes blur-dismiss work). Close: hide it.
  useEffect(() => {
    const win = winRef.current;
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
    // room above.
    const above = anchorTop - h - EDGE_PAD >= screenTop;
    const left = Math.max(screenLeft, Math.round(window.screenX + anchor.right - w));
    const top = above
      ? Math.round(anchorTop - h - EDGE_PAD)
      : Math.round(anchorBottom + EDGE_PAD);

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
  }, [open, anchorEl, container, width, height]);

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
