// src/components/Subtitle/useOverlayDragResize.ts
import { useCallback } from 'react';
import { useSubtitlePositionLocked } from '../../stores/subtitleStore';
import type { SubtitleSurfaceKind } from './SubtitleApp';

type DragKind =
  | 'move'
  | 'resize-n'
  | 'resize-e'
  | 'resize-s'
  | 'resize-w'
  | 'resize-nw'
  | 'resize-ne'
  | 'resize-sw'
  | 'resize-se';

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
      'button, input, select, textarea, a, [role="button"], [role="switch"], [role="slider"], label, .subtitle-app__resize',
    );
  };

  const startDrag = useCallback(
    (kind: DragKind) => (e: React.MouseEvent) => {
      if (!isActive || positionLocked) return;
      if (kind === 'move') {
        // React portals (e.g. the settings popover via FloatingPortal) bubble
        // mousedown through the React tree, but the portaled DOM lives outside
        // the bar's DOM subtree. Treat those events as "not on the bar" so
        // clicks inside the popover (toggle, color picker, slider) don't get
        // hijacked into a drag — which silently swallows the subsequent click
        // because the content script installs a viewport-wide drag overlay
        // that captures mouseup.
        const currentTarget = e.currentTarget as Node;
        const target = e.target as Node | null;
        if (!target || !currentTarget.contains(target)) return;
        if (isInteractiveTarget(e.target)) return;
      }
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

  const handleFor = (kind: DragKind) =>
    isActive && !positionLocked ? { onMouseDown: startDrag(kind) } : {};

  return {
    dragHandleProps:
      isActive && !positionLocked
        ? { onMouseDown: startDrag('move'), style: { cursor: 'move' as const } }
        : {},
    resizeHandleProps: {
      n: handleFor('resize-n'),
      e: handleFor('resize-e'),
      s: handleFor('resize-s'),
      w: handleFor('resize-w'),
      nw: handleFor('resize-nw'),
      ne: handleFor('resize-ne'),
      sw: handleFor('resize-sw'),
      se: handleFor('resize-se'),
    },
  };
}
