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
// adapter, which would slow local inference down. So keep Vulkan everywhere it
// actually works, and give it up only where the alternative is no window:
//
//   X11 session             -> keep Vulkan, leave the platform alone
//   Wayland session + X     -> run on XWayland, keep Vulkan (hardware WebGPU)
//   Wayland session, no X   -> drop Vulkan; a slow window beats an absent one
//
// An explicit --ozone-platform / --ozone-platform-hint from the user always
// wins; we only choose the feature set to match whatever they picked.

// SharedArrayBuffer backs the audio ring buffer (#174) and must survive in
// every branch below.
const VULKAN_FEATURES = 'Vulkan,SharedArrayBuffer';
const NO_VULKAN_FEATURES = 'SharedArrayBuffer';

/**
 * Read a Chromium-style switch value from argv, accepting both `--sw=value`
 * and `--sw value`.
 * @returns {string | null}
 */
function readSwitchValue(argv, name) {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}` && i + 1 < argv.length) return argv[i + 1];
  }
  return null;
}

/**
 * Decide which GPU-related Chromium flags are safe for this session.
 *
 * @param {object} o
 * @param {string} o.platform  process.platform
 * @param {Record<string, string | undefined>} [o.env]  process.env
 * @param {string[]} [o.argv]  process.argv
 * @returns {{ ozonePlatform: 'x11' | null, features: string }}
 *   ozonePlatform is the platform to pin, or null to leave Electron's own
 *   auto-detection untouched.
 */
function resolveLinuxGpuFlags({ platform, env = {}, argv = [] }) {
  if (platform !== 'linux') return { ozonePlatform: null, features: VULKAN_FEATURES };

  const sessionIsWayland = env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY);

  // The user's own choice is authoritative — never override it, just match the
  // feature set to the platform they asked for.
  const explicit = readSwitchValue(argv, 'ozone-platform');
  if (explicit) {
    return {
      ozonePlatform: null,
      features: explicit === 'wayland' ? NO_VULKAN_FEATURES : VULKAN_FEATURES,
    };
  }
  const hint = readSwitchValue(argv, 'ozone-platform-hint');
  if (hint) {
    const resolvesToWayland = hint === 'auto' ? sessionIsWayland : hint === 'wayland';
    return {
      ozonePlatform: null,
      features: resolvesToWayland ? NO_VULKAN_FEATURES : VULKAN_FEATURES,
    };
  }

  if (!sessionIsWayland) return { ozonePlatform: null, features: VULKAN_FEATURES };

  // Wayland session. DISPLAY means XWayland is up, so we can have both a
  // visible window and a hardware WebGPU adapter.
  if (env.DISPLAY) return { ozonePlatform: 'x11', features: VULKAN_FEATURES };

  // Native Wayland with no X server to fall back to: Vulkan would cost us the
  // window entirely.
  return { ozonePlatform: null, features: NO_VULKAN_FEATURES };
}

/**
 * Apply the resolved flags to Electron's command line. Must run before app is
 * ready.
 * @returns {{ ozonePlatform: 'x11' | null, features: string }} what was applied
 */
function applyLinuxGpuFlags(app, { platform = process.platform, env = process.env, argv = process.argv } = {}) {
  const resolved = resolveLinuxGpuFlags({ platform, env, argv });
  if (resolved.ozonePlatform) {
    app.commandLine.appendSwitch('ozone-platform', resolved.ozonePlatform);
  }
  // A single comma-separated list: repeated --enable-features switches override
  // each other rather than merging.
  app.commandLine.appendSwitch('enable-features', resolved.features);
  return resolved;
}

module.exports = {
  resolveLinuxGpuFlags,
  applyLinuxGpuFlags,
  VULKAN_FEATURES,
  NO_VULKAN_FEATURES,
};
