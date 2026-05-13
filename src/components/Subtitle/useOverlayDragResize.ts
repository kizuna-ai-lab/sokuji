// src/components/Subtitle/useOverlayDragResize.ts
import { useCallback } from 'react';
import { useSubtitlePositionLocked } from '../../stores/subtitleStore';
import type { SubtitleSurfaceKind } from './SubtitleApp';

type DragKind = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';

interface UseOverlayDragResizeArgs {
  surface: SubtitleSurfaceKind;
}

/**
 * Wires drag (anywhere on the bar except buttons / resize handles) and
 * resize (4 corners) for the extension-overlay iframe.
 *
 * Strategy: the iframe ONLY signals "drag-start" to the parent (content
 * script) on mousedown. All subsequent mousemove / mouseup tracking
 * happens in the parent document, via a transparent full-viewport
 * overlay div that the content script installs for the duration of the
 * drag. Reasons:
 *
 * - When the cursor leaves the iframe's document bounds (but stays in
 *   the browser window), the iframe stops receiving mouse events. The
 *   content script's overlay covers the entire viewport, so the parent
 *   document keeps tracking. Without this, drag state in the iframe
 *   could get stuck mid-operation.
 * - Mouseup outside the iframe reliably terminates the drag because the
 *   overlay catches it.
 * - The content script reads `e.clientX/clientY` directly against the
 *   iframe's stored startRect, producing exact 1:1 cursor tracking with
 *   no accumulator double-counting bug.
 *
 * The iframe sends its mousedown clientX/clientY (iframe-doc viewport
 * coords); content script combines with iframe.getBoundingClientRect()
 * to recover the absolute starting mouse position in the parent
 * viewport, then computes deltas off that anchor.
 */
export function useOverlayDragResize({ surface }: UseOverlayDragResizeArgs) {
  const positionLocked = useSubtitlePositionLocked();
  const isActive = surface === 'extension-overlay';

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'button, input, select, textarea, a, [role="button"], .subtitle-bar__resize',
    );
  };

  const startDrag = useCallback(
    (kind: DragKind) => (e: React.MouseEvent) => {
      if (!isActive || positionLocked) return;
      if (kind === 'move' && isInteractiveTarget(e.target)) return;
      e.preventDefault();
      window.parent.postMessage(
        {
          type: 'sokuji-subtitle:drag-start',
          kind,
          iframeX: e.clientX,
          iframeY: e.clientY,
        },
        '*',
      );
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
