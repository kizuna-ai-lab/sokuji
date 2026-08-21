// electron/topmost-level.js
//
// The always-on-top level every window of ours that must float above other
// applications is pinned with. Shared so the pinned subtitle bar and the
// popover child windows that hang off it land in the SAME z-order band —
// if they disagree, the bar permanently covers its own popovers.
//
// On Windows, every setAlwaysOnTop with a level in Electron's "behind task
// bar" set — which includes the 'floating' default — ends with a second
// SetWindowPos tucking the window just BELOW the taskbar in the topmost
// band. A window pinned at 'screen-saver' skips that demotion and sits at
// the very top of the band, so it covers anything pinned at 'floating'
// regardless of which window was raised last. 'screen-saver' is also what
// lets the bar beat a PowerPoint slideshow (see subtitle-window.js).
//
// On macOS the level is a real NSWindow level honored by the WM; 'floating'
// is the right neighborhood there and windows raised later win within it.
function topmostLevel() {
  return process.platform === 'win32' ? 'screen-saver' : 'floating';
}

module.exports = { topmostLevel };
