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
}

const STEP = 16;

const PanelResizer: React.FC<PanelResizerProps> = ({ width, min, max, onResize, onCommit }) => {
  const { t } = useTranslation();
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  // Holds the teardown for an in-progress drag so we can run it on unmount.
  const cleanupRef = useRef<(() => void) | null>(null);

  // Abort any in-progress drag if the component unmounts mid-gesture, so the
  // window listeners and the body class can never leak.
  useEffect(() => () => cleanupRef.current?.(), []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (drag.current) return; // ignore re-entrant pointerdowns (e.g. multi-touch)
    e.preventDefault();
    const start = { startX: e.clientX, startWidth: width };
    drag.current = start;
    // Panel is docked on the right: dragging left (smaller clientX) widens it.
    const widthFrom = (clientX: number) => start.startWidth + (start.startX - clientX);

    const onMove = (ev: PointerEvent) => { if (drag.current) onResize(widthFrom(ev.clientX)); };
    // Hoisted so onUp/onCancel below can reference it; only invoked on release.
    function teardown() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.classList.remove('is-resizing-panel');
      drag.current = null;
      cleanupRef.current = null;
    }
    const onUp = (ev: PointerEvent) => { onCommit(widthFrom(ev.clientX)); teardown(); };
    const onCancel = () => teardown();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    document.body.classList.add('is-resizing-panel');
    cleanupRef.current = teardown;
  }, [width, onResize, onCommit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = width + STEP;       // wider
    else if (e.key === 'ArrowRight') next = width - STEP; // narrower
    if (next !== null) {
      e.preventDefault();
      onResize(next);
      onCommit(next);
    }
  }, [width, onResize, onCommit]);

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('common.resizePanel', 'Resize panel')}
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
