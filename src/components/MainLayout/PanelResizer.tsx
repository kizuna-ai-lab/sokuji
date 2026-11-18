import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './PanelResizer.scss';

interface PanelResizerProps {
  width: number;
  min: number;
  max: number;
  /** Live updates during drag / keypress. Caller clamps. */
  onResize: (next: number) => void;
  /** On pointerup / keypress. Caller clamps + persists. */
  onCommit: (next: number) => void;
  /** Which side of the seam the panel is on: 'right' (the default) widens when dragged left, 'left' when dragged right. */
  side?: 'left' | 'right';
  /** The divider's name, saying which panel it resizes; "Resize panel" when not given. */
  label?: string;
  /** A drag that ended without a release (`pointercancel`): nothing is committed, the caller drops what it previewed. */
  onCancel?: () => void;
}

const STEP = 16;

const PanelResizer: React.FC<PanelResizerProps> = ({ width, min, max, onResize, onCommit, side = 'right', label, onCancel }) => {
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
    const start = { startX: e.clientX, startWidth: width };
    drag.current = start;
    // Docked on the right, dragging left (smaller clientX) widens the panel; docked on the left, dragging right does.
    const widthFrom = (clientX: number) => start.startWidth + (side === 'left' ? clientX - start.startX : start.startX - clientX);

    const onMove = (ev: PointerEvent) => { if (drag.current) onResize(widthFrom(ev.clientX)); };
    // Hoisted so onUp/onCancelled below can reference it; only invoked on release or cancel.
    function teardown() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancelled);
      document.body.classList.remove('is-resizing-panel');
      drag.current = null;
      cleanupRef.current = null;
    }
    const onUp = (ev: PointerEvent) => { onCommit(widthFrom(ev.clientX)); teardown(); };
    const onCancelled = () => { teardown(); onCancel?.(); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelled);
    document.body.classList.add('is-resizing-panel');
    cleanupRef.current = teardown;
  }, [width, onResize, onCommit, side, onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let next: number | null = null;
    // The arrow pointing away from the panel widens it.
    const wider = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const narrower = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === wider) next = width + STEP;
    else if (e.key === narrower) next = width - STEP;
    if (next !== null) {
      e.preventDefault();
      onResize(next);
      onCommit(next);
    }
  }, [width, onResize, onCommit, side]);

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
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
