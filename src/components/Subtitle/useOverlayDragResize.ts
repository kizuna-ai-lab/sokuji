// src/components/Subtitle/useOverlayDragResize.ts
import { useEffect, useRef, useCallback } from 'react';
import { useSubtitlePositionLocked } from '../../stores/subtitleStore';
import type { SubtitleSurfaceKind } from './SubtitleApp';

interface UseOverlayDragResizeArgs {
  surface: SubtitleSurfaceKind;
}

/**
 * Wires drag (on a handle) and resize (on corners) for the extension-overlay
 * iframe. The iframe doesn't know its parent viewport dimensions, so it sends
 * mousemove deltas via window.parent.postMessage; the content script clamps
 * and applies the new position to iframe.style.
 *
 * Returns:
 *   dragHandleProps — spread on the SubtitleBar's drag area
 *   resizeHandleProps — array of 4 spread objects for the corner handles
 */
export function useOverlayDragResize({ surface }: UseOverlayDragResizeArgs) {
  const positionLocked = useSubtitlePositionLocked();
  const dragging = useRef<null | { kind: 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' }>(null);
  const accum = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const isActive = surface === 'extension-overlay';

  const postMove = useCallback((dx: number, dy: number) => {
    accum.current.x += dx;
    accum.current.y += dy;
    window.parent.postMessage(
      { type: 'sokuji-subtitle:move', dx: accum.current.x, dy: accum.current.y },
      '*',
    );
  }, []);

  const postResize = useCallback((dw: number, dh: number, anchor: 'nw' | 'ne' | 'sw' | 'se') => {
    accum.current.w += dw;
    accum.current.h += dh;
    window.parent.postMessage(
      { type: 'sokuji-subtitle:resize', dw: accum.current.w, dh: accum.current.h, anchor },
      '*',
    );
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      if (dragging.current.kind === 'move') {
        postMove(e.movementX, e.movementY);
      } else {
        const anchor = dragging.current.kind.slice('resize-'.length) as 'nw' | 'ne' | 'sw' | 'se';
        // For nw / sw we want to grow when mouse moves left/up; flip the sign.
        const dw = anchor === 'nw' || anchor === 'sw' ? -e.movementX : e.movementX;
        const dh = anchor === 'nw' || anchor === 'ne' ? -e.movementY : e.movementY;
        postResize(dw, dh, anchor);
      }
    };
    const onUp = () => {
      dragging.current = null;
      accum.current = { x: 0, y: 0, w: 0, h: 0 };
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isActive, postMove, postResize]);

  const startDrag = useCallback(
    (kind: 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se') =>
      (e: React.MouseEvent) => {
        if (!isActive || positionLocked) return;
        e.preventDefault();
        dragging.current = { kind };
        accum.current = { x: 0, y: 0, w: 0, h: 0 };
      },
    [isActive, positionLocked],
  );

  return {
    dragHandleProps: isActive && !positionLocked
      ? { onMouseDown: startDrag('move'), style: { cursor: 'move' as const } }
      : {},
    resizeHandleProps: {
      nw: isActive && !positionLocked ? { onMouseDown: startDrag('resize-nw') } : {},
      ne: isActive && !positionLocked ? { onMouseDown: startDrag('resize-ne') } : {},
      sw: isActive && !positionLocked ? { onMouseDown: startDrag('resize-sw') } : {},
      se: isActive && !positionLocked ? { onMouseDown: startDrag('resize-se') } : {},
    },
  };
}
