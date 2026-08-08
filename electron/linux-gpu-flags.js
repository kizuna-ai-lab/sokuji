// Chromium GPU flag selection for Linux (issue #389).
//
// Chromium's Ozone/Wayland backend refuses to create a Vulkan implementation
// ("'--ozone-platform=wayland' is not compatible with Vulkan", from
// ui/ozone/platform/wayland/gpu/wayland_surface_factory.cc). Force-enabling
// Vulkan anyway does not degrade gracefully: the GPU process fails to create a
// Skia GrContext ("Failed to initialize Skia for SharedContextState"), never
// produces a frame, and therefore never attaches a buffer to its wl_surface.
// In xdg-shell a toplevel is only *mapped* once a buffer is attached and
// committed, so the window never appears at all — no crash, no error dialog,
// just a running process with no UI, invisible even to window-list tools.
// Under X11 the window is mapped by XMapWindow regardless of whether anything
// was ever drawn, which is why --ozone-platform=x11 papers over the bug.
//
// Vulkan is still load-bearing: it is what gates Dawn's hardware backend on
// Linux. Without it WebGPU silently falls back to the SwiftShader software
// adapter, which slows local inference down. So it is dropped only on Wayland,
// where the alternative is having no window at all:
//
//   X11 / XWayland  -> keep Vulkan (unchanged behaviour)
//   Wayland         -> drop Vulkan; a slow window beats an absent one
//
// Moving the app to XWayland ourselves would keep the hardware adapter, but it
// cannot be done from here: Electron selects and initialises the Ozone platform
// *before* the main script runs, so a late
// app.commandLine.appendSwitch('ozone-platform', 'x11') is silently ignored --
// measured on 40.8.5, the app stays on Wayland and its toplevels are still
// never mapped. Users who want the hardware adapter on a Wayland session have
// to pass --ozone-platform=x11 on the real command line, which this resolver
// then sees and honours. (--enable-features is read later, by GPU/compositor
// init, and *is* honoured from here -- which is precisely why forcing Vulkan
// from this file could break the window in the first place.)
//
// Which platform we are actually on is read back from Electron rather than
// re-derived from argv: by the time the main script runs, Electron has already
// resolved --ozone-platform, --ozone-platform-hint and its own session
// auto-detection into a concrete value on the command line (measured on 40.8.5:
// a Wayland session reports "wayland" whether or not XWayland is up, an X11
// session reports "x11"). Reading that value inherits Chromium's parsing rules
// for free -- notably that a repeated switch keeps its *last* occurrence, and
// that only the --switch=value form carries a value at all (a bare
// --ozone-platform aborts startup with "Invalid ozone platform" long before
// any of this runs).

// SharedArrayBuffer backs the audio ring buffer (#174) and must survive in
// every branch below.
const VULKAN_FEATURES = 'Vulkan,SharedArrayBuffer';
const NO_VULKAN_FEATURES = 'SharedArrayBuffer';

/**
 * Is this run going to render through Ozone/Wayland?
 *
 * @param {string} platform  process.platform
 * @param {string} effectivePlatform  the ozone platform Electron resolved for
 *   this run. Empty/unknown falls back to sniffing the session env, a safety
 *   net for a future Electron that stops publishing it.
 * @param {Record<string, string | undefined>} env  process.env
 */
function isOnWayland(platform, effectivePlatform, env) {
  if (platform !== 'linux') return false;
  if (effectivePlatform) return effectivePlatform === 'wayland';
  return env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY);
}

/**
 * Decide which Chromium features are safe to enable for this session.
 *
 * @param {object} o
 * @param {string} o.platform  process.platform
 * @param {string} [o.effectivePlatform]  ozone platform Electron resolved
 * @param {Record<string, string | undefined>} [o.env]  process.env
 * @returns {string} value for --enable-features
 */
function resolveLinuxGpuFeatures({ platform, effectivePlatform = '', env = {} }) {
  return isOnWayland(platform, effectivePlatform, env) ? NO_VULKAN_FEATURES : VULKAN_FEATURES;
}

/**
 * Apply the resolved features to Electron's command line. Must run before app
 * is ready.
 * @returns {{ features: string, effectivePlatform: string }} what was applied
 */
function applyLinuxGpuFlags(app, {
  platform = process.platform,
  env = process.env,
  effectivePlatform = app.commandLine.getSwitchValue('ozone-platform'),
} = {}) {
  const features = resolveLinuxGpuFeatures({ platform, effectivePlatform, env });
  // A single comma-separated list: repeated --enable-features switches override
  // each other rather than merging.
  app.commandLine.appendSwitch('enable-features', features);
  return { features, effectivePlatform };
}

module.exports = {
  resolveLinuxGpuFeatures,
  applyLinuxGpuFlags,
  VULKAN_FEATURES,
  NO_VULKAN_FEATURES,
};
