// Single source of truth for renderer → main IPC channels reachable through the
// generic `window.electron.invoke(channel, data)` bridge.
//
// preload.js derives its invoke allowlist from INVOKE_CHANNELS instead of a
// hand-maintained copy, and ipc-channels.test.js guards both directions against
// drift: every allowlist entry must resolve to a real `ipcMain.handle(...)`
// (catching dead placeholders like the old 'invoke-channel'), and every handler
// must be reachable (allowlisted, externally registered, or a dedicated bridge).
//
// Adding an IPC channel the renderer invokes = add its name here. That's it —
// the allowlist and the guard follow automatically.

// Channels whose handlers are registered by a third-party library, not by our
// own `ipcMain.handle` — allowlisted so the renderer can call them, but they
// have no handler in electron/*.js for the guard to find.
export const EXTERNAL_INVOKE_CHANNELS = [
  // electron-audio-loopback registers these in its initMain().
  'enable-loopback-audio',
  'disable-loopback-audio',
];

// Channels that HAVE an `ipcMain.handle` but are reached through a dedicated
// preload bridge (the Better Auth cookieAPI), not the generic invoke — so the
// reverse guard exempts them from requiring a generic-allowlist entry.
export const BRIDGE_ONLY_CHANNELS = [
  'clear-cookies',
];

export const INVOKE_CHANNELS = [
  // Audio system / virtual devices
  'check-audio-system',
  'open-directory',
  'open-external',
  'create-virtual-speaker',
  'get-cookies',
  'set-cookie',
  'check-vbcable',
  'install-vbcable',
  'check-sokuji-audio',
  // System audio capture
  'supports-system-audio-capture',
  'list-system-audio-sources',
  'connect-system-audio-source',
  'disconnect-system-audio-source',
  // Screen recording permission (macOS)
  'check-screen-recording-permission',
  // Linux: fix PipeWire monitor source volume after loopback capture starts
  'fix-monitor-volume',
  // WebSocket header injection (renderer → main)
  'ws-headers-set',
  'ws-headers-clear',
  // Native local-inference sidecar lifecycle
  'native-host:start',
  'native-host:stop',
  'native-host:status',
  // Self-contained sidecar bundle install/status
  'sidecar-bundle:status',
  'sidecar-bundle:install',
  'sidecar-bundle:cancel',
  'sidecar-bundle:manifest',
  'sidecar-bundle:remove',
  // Auto-update
  'update-check',
  'update-download',
  'update-install',
  'get-app-version',
  'get-audio-status',
  // Window controls (custom title bar)
  'window:minimize',
  'window:maximize-toggle',
  'window:close',
  // Subtitle mode
  'subtitle:enter',
  'subtitle:exit',
  'subtitle:set-always-on-top',
  'subtitle:set-locked',
  'subtitle:set-fullscreen',
  'subtitle:get-screen-bounds',
  // Externally-registered (electron-audio-loopback)
  ...EXTERNAL_INVOKE_CHANNELS,
];
