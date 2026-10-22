// The first paint's scheme (spec 2026-10-22 §1).
//
// Settings arrive over async IPC in Electron and from chrome.storage in the
// extension, so the stylesheets would apply before the appearance setting is
// known and a light user would see a dark frame first: the window is
// transparent and the layout paints opaque, so that frame is visible. The
// theme module (src/lib/theme/theme.ts) caches the resolved scheme under
// `sokuji.theme` on every apply; this script, loaded before any stylesheet,
// reads it back. The stored setting stays authoritative: once the store has
// loaded, the module corrects the attribute if this cache was stale.
//
// A file, never inline: the extension's page CSP is `script-src 'self'`.
(function () {
  try {
    if (localStorage.getItem('sokuji.theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) {
    // A private window or blocked site data: dark, which is the default.
  }
})();
