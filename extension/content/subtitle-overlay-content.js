/* global chrome */
/*
 * Sokuji subtitle overlay — content-script side.
 *
 * Responsibilities:
 *   1. Listen for subtitle:enter / subtitle:exit messages from the
 *      sidepanel; mount / unmount a host <div> + closed Shadow DOM +
 *      <iframe> pointing at the extension page subtitle-overlay.html.
 *   2. Receive a single "drag-start" postMessage from the iframe when
 *      the user presses mouse on the bar / a resize corner; install a
 *      transparent full-viewport overlay <div> in this document that
 *      captures all subsequent mousemove / mouseup, applies the new
 *      geometry to iframe.style live, and removes itself on release.
 *
 * Why the overlay pattern (vs. tracking events inside the iframe):
 *   - Mouse events that leave the iframe's bounds don't reach the
 *     iframe's document. The overlay covers the whole parent viewport,
 *     so the cursor is always trackable while dragging.
 *   - Mouseup outside the iframe still terminates the drag reliably.
 *   - Direct e.clientX/clientY against a captured startRect gives 1:1
 *     cursor tracking with no accumulator double-counting bug.
 *
 * No persistence: position resets to default on every fresh
 * subtitle:enter (by design — see spec).
 */

(function () {
  if (window.__sokujiSubtitleOverlayLoaded__) return;
  window.__sokujiSubtitleOverlayLoaded__ = true;

  const HOST_ID = 'sokuji-subtitle-host';
  const MIN_W = 320;
  const MIN_H = 60;
  const CURSORS = {
    move: 'move',
    'resize-nw': 'nwse-resize',
    'resize-ne': 'nesw-resize',
    'resize-sw': 'nesw-resize',
    'resize-se': 'nwse-resize',
  };

  let host = null;
  let iframeEl = null;
  let dragOverlay = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'subtitle:enter') mountHost();
    else if (msg?.type === 'subtitle:exit') unmountHost();
  });

  window.addEventListener('message', (event) => {
    if (!iframeEl || event.source !== iframeEl.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'sokuji-subtitle:drag-start') {
      startDrag(data.kind, data.iframeX, data.iframeY);
    }
  });

  window.addEventListener('resize', () => {
    if (!iframeEl || dragOverlay) return;
    // Re-clamp on viewport change (e.g., user resized the browser window).
    const rect = iframeEl.getBoundingClientRect();
    const lt = clampLT(rect.left, rect.top, rect.width, rect.height);
    applyLT(lt.left, lt.top);
  });

  function mountHost() {
    if (host) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    // `all: initial` resets every inherited CSS property in case the host
    // page has a wildcard selector. `pointer-events: none` lets clicks
    // pass through to the meeting UI everywhere except inside the iframe.
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'inset: 0',
      'z-index: 2147483647',
      'pointer-events: none',
    ].join(';');
    const shadow = host.attachShadow({ mode: 'closed' });

    const defaultW = Math.min(window.innerWidth * 0.7, 1200);
    const defaultH = 80;

    iframeEl = document.createElement('iframe');
    iframeEl.src = chrome.runtime.getURL('subtitle-overlay.html');
    iframeEl.allow = 'clipboard-read; clipboard-write';
    iframeEl.style.cssText = [
      'position: fixed',
      'left: 50%',
      'transform: translateX(-50%)',
      'bottom: 80px',
      `width: ${defaultW}px`,
      `height: ${defaultH}px`,
      'border: none',
      'background: transparent',
      'pointer-events: auto',
      'color-scheme: dark',
    ].join(';');
    shadow.appendChild(iframeEl);
    document.body.appendChild(host);
  }

  function unmountHost() {
    cleanupDragOverlay();
    if (!host) return;
    host.remove();
    host = null;
    iframeEl = null;
  }

  function startDrag(kind, iframeStartX, iframeStartY) {
    if (!iframeEl || dragOverlay) return;
    if (!Object.prototype.hasOwnProperty.call(CURSORS, kind)) return;

    // Capture the iframe's geometry at drag start. Subsequent cursor
    // deltas are computed against this anchor so cursor tracking stays
    // 1:1 regardless of how the iframe moves during the drag.
    const startRect = iframeEl.getBoundingClientRect();
    const startMouseX = startRect.left + iframeStartX;
    const startMouseY = startRect.top + iframeStartY;

    dragOverlay = document.createElement('div');
    dragOverlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 2147483647',
      `cursor: ${CURSORS[kind]}`,
      'background: transparent',
      'pointer-events: auto',
    ].join(';');

    const onMove = (e) => {
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      if (kind === 'move') {
        const lt = clampLT(
          startRect.left + dx,
          startRect.top + dy,
          startRect.width,
          startRect.height,
        );
        applyLT(lt.left, lt.top);
      } else {
        applyResize(kind, startRect, dx, dy);
      }
    };

    const cleanup = () => cleanupDragOverlay();

    const onKey = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    dragOverlay._cleanup = () => {
      dragOverlay.removeEventListener('mousemove', onMove);
      dragOverlay.removeEventListener('mouseup', cleanup);
      dragOverlay.removeEventListener('mouseleave', cleanup);
      document.removeEventListener('keydown', onKey, true);
    };

    dragOverlay.addEventListener('mousemove', onMove);
    dragOverlay.addEventListener('mouseup', cleanup);
    dragOverlay.addEventListener('mouseleave', cleanup);
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(dragOverlay);
  }

  function cleanupDragOverlay() {
    if (!dragOverlay) return;
    if (typeof dragOverlay._cleanup === 'function') dragOverlay._cleanup();
    dragOverlay.remove();
    dragOverlay = null;
  }

  function applyResize(kind, startRect, dx, dy) {
    const anchor = kind.slice('resize-'.length); // 'nw' | 'ne' | 'sw' | 'se'
    let newW = startRect.width;
    let newH = startRect.height;
    let newLeft = startRect.left;
    let newTop = startRect.top;

    // West / east horizontal handling
    if (anchor === 'nw' || anchor === 'sw') {
      newW = startRect.width - dx;
      newLeft = startRect.left + dx;
    } else {
      newW = startRect.width + dx;
    }
    // North / south vertical handling
    if (anchor === 'nw' || anchor === 'ne') {
      newH = startRect.height - dy;
      newTop = startRect.top + dy;
    } else {
      newH = startRect.height + dy;
    }

    // Min size: if shrinking past minimum, also clamp the moving edge so
    // the bar doesn't slide.
    if (newW < MIN_W) {
      if (anchor === 'nw' || anchor === 'sw') {
        newLeft = startRect.right - MIN_W;
      }
      newW = MIN_W;
    }
    if (newH < MIN_H) {
      if (anchor === 'nw' || anchor === 'ne') {
        newTop = startRect.bottom - MIN_H;
      }
      newH = MIN_H;
    }

    // Max size: clip to viewport.
    newW = Math.min(newW, window.innerWidth);
    newH = Math.min(newH, window.innerHeight);

    const lt = clampLT(newLeft, newTop, newW, newH);
    applyLT(lt.left, lt.top);
    applySize(newW, newH);
  }

  function clampLT(left, top, w, h) {
    return {
      left: Math.max(0, Math.min(window.innerWidth - w, left)),
      top: Math.max(0, Math.min(window.innerHeight - h, top)),
    };
  }

  function applyLT(left, top) {
    if (!iframeEl) return;
    iframeEl.style.left = `${left}px`;
    iframeEl.style.top = `${top}px`;
    iframeEl.style.right = '';
    iframeEl.style.bottom = '';
    iframeEl.style.transform = '';
  }

  function applySize(w, h) {
    if (!iframeEl) return;
    iframeEl.style.width = `${w}px`;
    iframeEl.style.height = `${h}px`;
  }
})();
