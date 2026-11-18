import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './PanelResizer.scss';

interface PanelResizerProps {
  width: number;
  min: number;
  max: number;
  /** Live updates during drag / keypress. Caller clamps. */
  onResize: (next: number) => void;
  /**
   * On pointerup / keypress. Caller clamps + persists. `from` is the size the gesture started from (the `width` at
   * pointerdown, or at the key), so a release where it began (a click) can be told from a change.
   */
  onCommit: (next: number, from: number) => void;
  /** Which side of the seam the panel is on: 'right' (the default) widens when dragged left, 'left' when dragged right. */
  side?: 'left' | 'right';
  /**
   * Which way the seam drags: 'x' (the default) a seam between columns, sizing the panel's width; 'y' a seam between
   * rows, sizing its height (owner, 2026-11-19: the live notes above the conversation). With 'y', `width` is the
   * panel's height and `side` reads 'left' as above the seam, 'right' as below it.
   */
  axis?: 'x' | 'y';
  /** The divider's name, saying which panel it resizes; "Resize panel" when not given. */
  label?: string;
  /** A drag that ended without a release (`pointercancel`): nothing is committed, the caller drops what it previewed. */
  onCancel?: () => void;
}

const STEP = 16;

const PanelResizer: React.FC<PanelResizerProps> = ({ width, min, max, onResize, onCommit, side = 'right', axis = 'x', label, onCancel }) => {
  const { t } = useTranslation();
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  // Holds the teardown for an in-progress drag so we can run it on unmount.
  const cleanupRef = useRef<(() => void) | null>(null);

  // Abort any in-progress drag if the component unmounts mid-gesture, so the
  // window listeners and the body class can never leak.
  useEffect(() => () => cleanupRef.current?.(), []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // primary button only
    if (drag.current) return; // ignore re-entrant pointerdowns (e.g. multi-touch)
    e.preventDefault();
    const at = (ev: { clientX: number; clientY: number }) => (axis === 'y' ? ev.clientY : ev.clientX);
    const start = { startX: at(e), startWidth: width };
    drag.current = start;
    // Docked on the right, dragging left (smaller clientX) widens the panel; docked on the left, dragging right does.
    // Across rows the same: above the seam, dragging down grows it; below, dragging up does.
    const widthFrom = (pos: number) => start.startWidth + (side === 'left' ? pos - start.startX : start.startX - pos);

    const onMove = (ev: PointerEvent) => { if (drag.current) onResize(widthFrom(at(ev))); };
    // Hoisted so onUp/onCancelled below can reference it; only invoked on release or cancel.
    function teardown() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancelled);
      document.body.classList.remove('is-resizing-panel', 'is-resizing-rows');
      drag.current = null;
      cleanupRef.current = null;
    }
    const onUp = (ev: PointerEvent) => { onCommit(widthFrom(at(ev)), start.startWidth); teardown(); };
    const onCancelled = () => { teardown(); onCancel?.(); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelled);
    document.body.classList.add('is-resizing-panel');
    if (axis === 'y') document.body.classList.add('is-resizing-rows');
    cleanupRef.current = teardown;
  }, [width, onResize, onCommit, side, axis, onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let next: number | null = null;
    // The arrow pointing away from the panel widens it (across rows: makes it taller).
    const [before, after] = axis === 'y' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    const wider = side === 'left' ? after : before;
    const narrower = side === 'left' ? before : after;
    if (e.key === wider) next = width + STEP;
    else if (e.key === narrower) next = width - STEP;
    if (next !== null) {
      e.preventDefault();
      onResize(next);
      onCommit(next, width);
    }
  }, [width, onResize, onCommit, side, axis]);

  return (
    <div
      className={axis === 'y' ? 'panel-resizer panel-resizer--y' : 'panel-resizer'}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={label ?? t('common.resizePanel', 'Resize panel')}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
};

export default PanelResizer;
