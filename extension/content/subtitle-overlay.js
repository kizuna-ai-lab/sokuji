/* global chrome */
/*
 * Sokuji subtitle overlay — content-script side.
 *
 * Listens for subtitle:enter / subtitle:exit messages from the sidepanel.
 * Mounts / unmounts a host div + closed Shadow DOM + iframe pointing at
 * the extension page subtitle-overlay.html. Also receives drag/resize
 * postMessages from the iframe and updates the iframe element's inline
 * style (with viewport clamping). No persistence.
 */

(function () {
  if (window.__sokujiSubtitleOverlayLoaded__) return;
  window.__sokujiSubtitleOverlayLoaded__ = true;

  const HOST_ID = 'sokuji-subtitle-host';
  const MIN_W = 320;
  const MIN_H = 60;
  let host = null;
  let iframeEl = null;

  // Default geometry (centered bottom)
  const defaultGeom = () => ({
    width: Math.min(window.innerWidth * 0.7, 1200),
    height: 80,
    left: null, // null → use transform: translateX(-50%) + left:50%
    bottom: 80,
  });
  let geom = defaultGeom();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'subtitle:enter') mountHost();
    else if (msg?.type === 'subtitle:exit') unmountHost();
  });

  window.addEventListener('message', (event) => {
    if (!iframeEl || event.source !== iframeEl.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'sokuji-subtitle:move') {
      // dx, dy are accumulated deltas in viewport coordinates
      const cur = currentLeftTop();
      const next = clampLT(cur.left + data.dx, cur.top + data.dy, geom.width, geom.height);
      applyLT(next.left, next.top);
    } else if (data.type === 'sokuji-subtitle:resize') {
      const cur = currentLeftTop();
      const newW = Math.max(MIN_W, Math.min(window.innerWidth, geom.width + data.dw));
      const newH = Math.max(MIN_H, Math.min(window.innerHeight, geom.height + data.dh));
      // Anchor logic: for nw/sw the left edge moves; for nw/ne the top edge moves.
      const dxLeft = data.anchor.startsWith('nw') || data.anchor.startsWith('sw') ? geom.width - newW : 0;
      const dyTop = data.anchor.startsWith('nw') || data.anchor.startsWith('ne') ? geom.height - newH : 0;
      geom.width = newW;
      geom.height = newH;
      const lt = clampLT(cur.left + dxLeft, cur.top + dyTop, newW, newH);
      applySize(newW, newH);
      applyLT(lt.left, lt.top);
    }
  });

  window.addEventListener('resize', () => {
    if (!iframeEl) return;
    // Re-clamp on viewport change.
    const cur = currentLeftTop();
    const lt = clampLT(cur.left, cur.top, geom.width, geom.height);
    applyLT(lt.left, lt.top);
  });

  function mountHost() {
    if (host) return;
    geom = defaultGeom();

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    iframeEl = document.createElement('iframe');
    iframeEl.src = chrome.runtime.getURL('subtitle-overlay.html');
    iframeEl.allow = 'clipboard-read; clipboard-write';
    iframeEl.style.cssText = [
      'position: fixed',
      'left: 50%',
      'transform: translateX(-50%)',
      'bottom: 80px',
      `width: ${geom.width}px`,
      `height: ${geom.height}px`,
      'border: none',
      'background: transparent',
      'pointer-events: auto',
      'color-scheme: dark',
    ].join(';');
    shadow.appendChild(iframeEl);
    document.body.appendChild(host);
  }

  function unmountHost() {
    if (!host) return;
    host.remove();
    host = null;
    iframeEl = null;
  }

  // Returns left/top in viewport coords. First time, derives from the centered-default.
  function currentLeftTop() {
    if (!iframeEl) return { left: 0, top: 0 };
    const rect = iframeEl.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
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
