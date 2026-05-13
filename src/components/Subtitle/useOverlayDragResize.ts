// src/components/Subtitle/useOverlayDragResize.ts
import { useEffect, useRef, useCallback } from 'react';
import { useSubtitlePositionLocked } from '../../stores/subtitleStore';
import type { SubtitleSurfaceKind } from './SubtitleApp';

interface UseOverlayDragResizeArgs {
  surface: SubtitleSurfaceKind;
}

/**
 * Wires drag (anywhere on the bar except buttons / resize handles) and resize
 * (on 4 corners) for the extension-overlay iframe. Sends per-event mouse
 * deltas via window.parent.postMessage; the content script applies them
 * relative to the iframe's current position/size with viewport clamping.
 */
export function useOverlayDragResize({ surface }: UseOverlayDragResizeArgs) {
  const positionLocked = useSubtitlePositionLocked();
  const dragging = useRef<null | {
    kind: 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';
  }>(null);

  const isActive = surface === 'extension-overlay';

  const postMove = useCallback((dx: number, dy: number) => {
    window.parent.postMessage({ type: 'sokuji-subtitle:move', dx, dy }, '*');
  }, []);

  const postResize = useCallback(
    (dw: number, dh: number, anchor: 'nw' | 'ne' | 'sw' | 'se') => {
      window.parent.postMessage(
        { type: 'sokuji-subtitle:resize', dw, dh, anchor },
        '*',
      );
    },
    [],
  );

  useEffect(() => {
    if (!isActive) return;

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      if (dragging.current.kind === 'move') {
        postMove(e.movementX, e.movementY);
      } else {
        const anchor = dragging.current.kind.slice('resize-'.length) as
          | 'nw'
          | 'ne'
          | 'sw'
          | 'se';
        // For nw / sw we want to grow when mouse moves left/up; flip the sign.
        const dw = anchor === 'nw' || anchor === 'sw' ? -e.movementX : e.movementX;
        const dh = anchor === 'nw' || anchor === 'ne' ? -e.movementY : e.movementY;
        postResize(dw, dh, anchor);
      }
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isActive, postMove, postResize]);

  // Skip drag start if the mousedown landed on something interactive
  // (button, input, link, resize-handle).
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'button, input, select, textarea, a, [role="button"], .subtitle-bar__resize',
    );
  };

  const startDrag = useCallback(
    (kind: 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se') =>
      (e: React.MouseEvent) => {
        if (!isActive || positionLocked) return;
        if (kind === 'move' && isInteractiveTarget(e.target)) return;
        e.preventDefault();
        dragging.current = { kind };
      },
    [isActive, positionLocked],
  );

  return {
    dragHandleProps:
      isActive && !positionLocked
        ? { onMouseDown: startDrag('move'), style: { cursor: 'move' as const } }
        : {},
    resizeHandleProps: {
      nw:
        isActive && !positionLocked
          ? { onMouseDown: startDrag('resize-nw') }
          : {},
      ne:
        isActive && !positionLocked
          ? { onMouseDown: startDrag('resize-ne') }
          : {},
      sw:
        isActive && !positionLocked
          ? { onMouseDown: startDrag('resize-sw') }
          : {},
      se:
        isActive && !positionLocked
          ? { onMouseDown: startDrag('resize-se') }
          : {},
    },
  };
}
