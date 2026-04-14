const { app, BrowserWindow, ipcMain, Menu, dialog, shell, session, systemPreferences, desktopCapturer } = require('electron');
const path = require('path');
const { betterAuthAdapter } = require('./better-auth-adapter');

// Handle Squirrel events for Windows
if (process.platform === 'win32') {
  const handleSquirrelEvent = require('./squirrel-events');
  if (handleSquirrelEvent()) {
    // Squirrel event handled and app will exit, don't do anything else
    process.exit(0);
  }
}

const { UpdateManager } = require('./update-manager');

// Config utility no longer needed - using localStorage in renderer process

// Platform-specific audio utilities
let audioUtils;
if (process.platform === 'linux') {
  audioUtils = require('./pulseaudio-utils');
} else if (process.platform === 'win32') {
  audioUtils = require('./windows-audio-utils');
} else if (process.platform === 'darwin') {
  audioUtils = require('./macos-audio-utils');
} else {
  // For other platforms, provide stub implementations
  audioUtils = {
    createVirtualAudioDevices: async () => {
      console.log('[Sokuji] [Main] Virtual audio devices not supported on this platform');
      return false;
    },
    removeVirtualAudioDevices: () => {
      console.log('[Sokuji] [Main] Virtual audio device cleanup not needed on this platform');
    },
    cleanupOrphanedDevices: async () => {
      console.log('[Sokuji] [Main] No orphaned devices to clean on this platform');
      return true;
    }
  };
}

const {
  createVirtualAudioDevices,
  removeVirtualAudioDevices,
  cleanupOrphanedDevices,
  // System audio capture functions (stubs on all platforms, capture uses electron-audio-loopback)
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource,
  supportsSystemAudioCapture
} = audioUtils;

// Initialize electron-audio-loopback for system audio capture on all platforms
// MUST be called before app is ready
// Supports Windows, macOS, and Linux (via PulseaudioLoopbackForScreenShare Chromium flag)
{
  const { initMain } = require('electron-audio-loopback');
  initMain();
  console.log('[Sokuji] [Main] electron-audio-loopback initialized for', process.platform);
}

// Set application name for PulseAudio
app.setName('sokuji');
app.commandLine.appendSwitch('application-name', 'sokuji');
app.commandLine.appendSwitch('jack-name', 'sokuji');

// Enable WebGPU for ONNX Runtime acceleration
app.commandLine.appendSwitch('enable-unsafe-webgpu');
// Enable required Chromium features as a single comma-separated list
// (multiple appendSwitch calls for the same flag would override each other)
app.commandLine.appendSwitch('enable-features', 'Vulkan,SharedArrayBuffer');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

// Create application menu
function createApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const menuTemplate = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        {
          label: `About ${app.getName()}`,
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: `About ${app.getName()}`,
              message: 'Sokuji - Real-time AI Translation',
              detail: `Version: ${app.getVersion()}\n\nAI-powered real-time translation application\n\n© 2026 Kizuna AI Lab`,
              buttons: ['OK'],
              icon: path.join(__dirname, '../assets/icon.png')
            });
          }
        },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' },
              { role: 'stopSpeaking' }
            ]
          }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [])
      ]
    },

    // Help menu
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [{
          label: `About ${app.getName()}`,
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: `About ${app.getName()}`,
              message: 'Sokuji - Real-time AI Translation',
              detail: `Version: ${app.getVersion()}\n\nAI-powered real-time translation application\n\n© 2026 Kizuna AI Lab`,
              buttons: ['OK'],
              icon: path.join(__dirname, '../assets/icon.png')
            });
          }
        },
        { type: 'separator' }]),
        {
          label: 'Check for Updates...',
          click: () => {
            if (global.updateManager) {
              global.updateManager.checkForUpdates();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Official Website',
          click: async () => {
            await shell.openExternal('https://sokuji.kizuna.ai/');
          }
        },
        {
          label: 'Source Code',
          click: async () => {
            await shell.openExternal('https://github.com/kizuna-ai-lab/sokuji');
          }
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/kizuna-ai-lab/sokuji/issues');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  // Determine the correct icon path based on platform
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '../assets/icon.ico')
    : path.join(__dirname, '../assets/icon.png');

  // Create the browser window
  const isDev = import.meta.env.MODE === 'development' || !app.isPackaged;

  // Build custom User Agent to identify Electron app
  // Use standard OS names so PostHog's regex-based $os detection works
  const electronVersion = process.versions.electron;
  const appVersion = app.getVersion();
  const osName = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform;
  const customUserAgent = `Sokuji/${appVersion} Electron/${electronVersion} (${osName})`;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Sokuji',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Disable web security in development to allow CORS requests
      webSecurity: !isDev
    }
  });

  // Set custom User Agent for the window
  mainWindow.webContents.setUserAgent(customUserAgent);
  console.log('[Sokuji] [Main] Custom User Agent set:', customUserAgent);

  // Load the app
  console.log('[Sokuji] [Main] Development mode:', isDev, 'MODE:', import.meta.env.MODE, 'isPackaged:', app.isPackaged);
  
  // Track window load time
  const loadStartTime = Date.now();
  
  // Add performance tracking for page load
  mainWindow.webContents.on('did-finish-load', () => {
    const loadEndTime = Date.now();
    console.log(`[Sokuji] [Main] Page loaded in ${loadEndTime - loadStartTime}ms`);
  });
  
  mainWindow.webContents.on('dom-ready', () => {
    const domReadyTime = Date.now();
    console.log(`[Sokuji] [Main] DOM ready in ${domReadyTime - loadStartTime}ms`);
  });
  
  if (isDev) {
    console.log(`[Sokuji] [Main] Loading from http://localhost:5173 at ${loadStartTime}`);
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(app.getAppPath(), 'build/index.html');
    console.log('[Sokuji] [Main] Loading from:', indexPath);
    mainWindow.loadFile(indexPath);
  }

  // Open DevTools in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed
  mainWindow.on('closed', function () {
    // Ensure audio devices are cleaned up when window is closed
    if (process.platform === 'darwin') {
      // On macOS, we only clean up devices if the app is actually quitting
      // This is because on macOS, closing all windows doesn't quit the app
      app.on('before-quit', cleanupAndExit);
    } else {
      // On other platforms, clean up when the window is closed
      cleanupAndExit();
    }
    mainWindow = null;
  });
}

// Create window when Electron is ready
app.whenReady().then(async () => {
  const isDev = import.meta.env.MODE === 'development' || !app.isPackaged;

  // Initialize Better Auth adapter
  try {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';
    const origin = isDev ? 'http://localhost:5173' : `file://${__dirname}`;

    console.log(`[Sokuji] [Main] Initializing Better Auth adapter with backend: ${backendUrl}, origin: ${origin}`);

    betterAuthAdapter({
      backendUrl,
      origin
    });
    console.log('[Sokuji] [Main] Better Auth adapter initialized');
  } catch (error) {
    console.error('[Sokuji] [Main] Error initializing Better Auth adapter:', error);
  }

  // Initialize WebSocket header injection (must be before any WebSocket connections)
  initWebSocketHeaderInjection();

  // Clean up any orphaned devices
  try {
    await cleanupOrphanedDevices();
    console.log('[Sokuji] [Main] Orphaned devices cleaned up successfully');
  } catch (error) {
    console.error('[Sokuji] [Main] Error cleaning up orphaned devices:', error);
  }

  // Start virtual audio devices before creating the window
  try {
    const devicesCreated = await createVirtualAudioDevices();
    if (devicesCreated) {
      console.log('[Sokuji] [Main] Virtual audio devices created successfully');
      
      // Connect the virtual speaker to the default output device
      // try {
      //   // Use default device info
      //   const defaultDeviceInfo = {
      //     deviceId: 'default',
      //     label: 'Default'
      //   };
      //
      //   // Connect virtual speaker to default output
      //   const connected = await connectVirtualSpeakerToOutput(defaultDeviceInfo);
      //   if (connected) {
      //     console.log('[Sokuji] [Main] Successfully connected virtual speaker to default output device');
      //   } else {
      //     console.error('[Sokuji] [Main] Failed to connect virtual speaker to default output device');
      //   }
      // } catch (connectionError) {
      //   console.error('[Sokuji] [Main] Error connecting virtual speaker to default output:', connectionError);
      // }
    } else {
      console.error('[Sokuji] [Main] Failed to create virtual audio devices');
    }
  } catch (error) {
    console.error('[Sokuji] [Main] Error creating virtual audio devices:', error);
  }

  // Create the application menu
  createApplicationMenu();

  // Request microphone permission on macOS before creating window
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log('[Sokuji] [Main] Microphone permission status:', micStatus);

    if (micStatus === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      console.log('[Sokuji] [Main] Microphone permission granted:', granted);
    } else if (micStatus === 'denied') {
      console.warn('[Sokuji] [Main] Microphone permission denied - please enable in System Preferences > Privacy & Security > Microphone');
    }
  }

  createWindow();

  // Initialize auto-update manager
  global.updateManager = new UpdateManager(mainWindow);
  global.updateManager.checkAfterDelay(5000);

  // electron-audio-loopback handles setDisplayMediaRequestHandler automatically via initMain()
});

// Ensure cleanup happens before app exits
const cleanupAndExit = () => {
  console.log('[Sokuji] [Main] Cleaning up virtual audio devices before exit...');
  removeVirtualAudioDevices();
  console.log('[Sokuji] [Main] Virtual audio devices cleaned up successfully');
};

// Create a more robust exit handler that ensures cleanup happens
const handleExit = (signal) => {
  console.log(`[Sokuji] [Main] Received ${signal} signal. Ensuring cleanup before exit...`);
  
  // Perform cleanup synchronously
  cleanupAndExit();
  
  // Exit with appropriate code
  const exitCode = signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1;
  process.exit(exitCode);
};

// Register cleanup function with app's before-quit event
app.on('before-quit', cleanupAndExit);

// Register our exit handler for various signals
process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('[Sokuji] [Main] Uncaught exception:', error);
  handleExit('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Sokuji] [Main] Unhandled rejection at:', promise, 'reason:', reason);
  handleExit('unhandledRejection');
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  // On macOS, recreate the window when the dock icon is clicked
  if (mainWindow === null) {
    createWindow();
    // Update the manager's window reference so IPC messages reach the new renderer
    if (global.updateManager) {
      global.updateManager.setMainWindow(mainWindow);
    }
  }
});

// Clean up loopback when app is about to quit
app.on('will-quit', cleanupAndExit);

// IPC handler for app version
ipcMain.handle('get-app-version', () => app.getVersion());

// IPC handlers for audio functionality
ipcMain.handle('check-audio-system', async () => {
  try {
    let audioSystemAvailable = false;
    let systemType = 'none';

    if (process.platform === 'linux') {
      const { isPulseAudioAvailable } = audioUtils;
      audioSystemAvailable = await isPulseAudioAvailable();
      systemType = audioSystemAvailable ? 'pulseaudio' : 'none';
    } else if (process.platform === 'win32') {
      const { isWindowsAudioAvailable } = audioUtils;
      audioSystemAvailable = await isWindowsAudioAvailable();
      // On Windows, VB-CABLE detection happens in the renderer process
      // We just report that Windows audio is available
      systemType = audioSystemAvailable ? 'windows' : 'none';
    } else if (process.platform === 'darwin') {
      const { isMacOSAudioAvailable } = audioUtils;
      audioSystemAvailable = await isMacOSAudioAvailable();
      // On macOS, Sokuji Virtual Audio driver is installed by PKG installer
      systemType = audioSystemAvailable ? 'coreaudio' : 'none';
    }

    return {
      audioSystemAvailable,
      systemType,
      platform: process.platform,
      note: process.platform === 'win32' ? 'VB-CABLE detection happens in renderer process' :
            process.platform === 'darwin' ? 'Sokuji Virtual Audio driver installed by PKG installer' : null
    };
  } catch (error) {
    console.error('[Sokuji] [Main] Error checking audio system status:', error);
    return {
      audioSystemAvailable: false,
      systemType: 'none',
      platform: process.platform,
      error: error.message
    };
  }
});

// Handler for VB-CABLE detection (called from renderer process)
ipcMain.handle('check-vbcable', async () => {
  try {
    // On Windows, actual VB-CABLE detection happens in the renderer process
    // This handler is here for consistency and future extensibility
    if (process.platform === 'win32') {
      return {
        platform: 'windows',
        detectionMethod: 'renderer',
        message: 'VB-CABLE detection should be done via MediaDevices API in renderer'
      };
    } else {
      return {
        platform: process.platform,
        detectionMethod: 'none',
        message: 'VB-CABLE is Windows-specific'
      };
    }
  } catch (error) {
    console.error('[Sokuji] [Main] Error in VB-CABLE check:', error);
    return {
      error: error.message
    };
  }
});

// Handler for VB-CABLE installation (called from renderer process)
ipcMain.handle('install-vbcable', async () => {
  try {
    if (process.platform === 'win32') {
      console.log('[Sokuji] [Main] VB-CABLE installation requested from renderer');
      const installer = require('./vb-cable-installer');
      const result = await installer.ensureVBCableInstalled();
      return {
        success: result,
        platform: 'windows'
      };
    } else {
      return {
        success: false,
        platform: process.platform,
        message: 'VB-CABLE is Windows-specific'
      };
    }
  } catch (error) {
    console.error('[Sokuji] [Main] Error installing VB-CABLE:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Handler for Sokuji Virtual Audio detection (called from renderer process)
ipcMain.handle('check-sokuji-audio', async () => {
  try {
    if (process.platform === 'darwin') {
      const { isSokujiVirtualAudioInstalled } = audioUtils;
      const installed = await isSokujiVirtualAudioInstalled();
      return {
        installed,
        platform: 'macos',
        driverName: 'Sokuji Virtual Audio'
      };
    } else {
      return {
        installed: false,
        platform: process.platform,
        message: 'Sokuji Virtual Audio is macOS-specific'
      };
    }
  } catch (error) {
    console.error('[Sokuji] [Main] Error in Sokuji Virtual Audio check:', error);
    return {
      installed: false,
      error: error.message
    };
  }
});

// Configuration now handled directly in renderer process via localStorage

// Handler to open a directory in the file explorer
ipcMain.handle('open-directory', (event, dirPath) => {
  try {
    // Open the directory using the default file explorer
    const { shell } = require('electron');
    shell.openPath(dirPath);
    return { success: true };
  } catch (error) {
    console.error('[Sokuji] [Main] Error opening directory:', error);
    return { success: false, error: error.message };
  }
});

// Handler to open external URL in system default browser
ipcMain.handle('open-external', async (event, url) => {
  try {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('[Sokuji] [Main] Error opening external URL:', error);
    return { success: false, error: error.message };
  }
});




// Handler to create virtual audio devices
ipcMain.handle('create-virtual-speaker', async () => {
  try {
    const result = await createVirtualAudioDevices();
    return {
      success: result,
      message: result ? 'Virtual audio devices created successfully' : 'Failed to create virtual audio devices'
    };
  } catch (error) {
    console.error('[Sokuji] [Main] Error creating virtual audio devices:', error);
    return {
      success: false,
      error: error.message || 'Failed to create virtual audio devices'
    };
  }
});

// System audio capture IPC handlers (Linux only)
ipcMain.handle('supports-system-audio-capture', async () => {
  if (supportsSystemAudioCapture) {
    return await supportsSystemAudioCapture();
  }
  return false;
});

ipcMain.handle('list-system-audio-sources', async () => {
  if (listSystemAudioSources) {
    return await listSystemAudioSources();
  }
  return [];
});

ipcMain.handle('connect-system-audio-source', async (event, sinkName) => {
  if (connectSystemAudioSource) {
    return await connectSystemAudioSource(sinkName);
  }
  return { success: false, error: 'System audio capture not supported on this platform' };
});

ipcMain.handle('disconnect-system-audio-source', async () => {
  if (disconnectSystemAudioSource) {
    return await disconnectSystemAudioSource();
  }
  return { success: false };
});

// Linux loopback audio: fix PipeWire monitor source volume
// PipeWire stores an independent monitorVolumes property per sink that can be very low.
// After getDisplayMedia() creates the loopback stream, we force the monitor source to 100%.
ipcMain.handle('fix-monitor-volume', async () => {
  if (process.platform !== 'linux') return { ok: true, skipped: true };

  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync('pactl', ['get-default-sink'], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const defaultSink = stdout.trim();
    const monitorName = defaultSink + '.monitor';
    await execFileAsync('pactl', ['set-source-volume', monitorName, '100%'], {
      timeout: 2000,
    });
    console.log(`[Sokuji] [Main] Fixed monitor volume for ${monitorName}`);
    return { ok: true, monitor: monitorName };
  } catch (err) {
    console.error('[Sokuji] [Main] Failed to fix monitor volume:', err.message);
    return { ok: false, error: err.message };
  }
});

// ── Combined Request Header Injection ─────────────────────────────────────────
// Electron only allows ONE onBeforeSendHeaders listener per session, so this
// single handler covers both:
//   1. Better Auth: cookie/origin injection for backend API requests
//   2. WebSocket: custom header injection for provider WebSocket upgrades
//
// The renderer registers host-specific WebSocket header rules via IPC before
// opening a WebSocket connection. This replaces the previous per-provider IPC
// bridges (Volcengine, Edge TTS) that proxied every frame through main process.

// Map<host, Map<headerName, headerValue>>
const wsHeaderRules = new Map();

function initWebSocketHeaderInjection() {
  // Retrieve Better Auth config (stored by better-auth-adapter.js)
  const authConfig = betterAuthAdapter._sendHeadersConfig;

  // Pre-parse auth URL matchers for safe origin+path comparison
  const authMatchers = authConfig
    ? authConfig.filterPatterns.map((pattern) => {
        const base = pattern.replace(/\/\*$/, '');
        const parsed = new URL(base);
        return { origin: parsed.origin, pathname: parsed.pathname.replace(/\/$/, '') || '' };
      })
    : [];

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const { requestHeaders } = details;

      // ── Better Auth: inject cookies and origin for backend requests ──
      if (authConfig && authMatchers.length > 0) {
        let isAuthRequest = false;
        try {
          const reqUrl = new URL(details.url);
          isAuthRequest = authMatchers.some(({ origin, pathname }) =>
            reqUrl.origin === origin &&
            (pathname === '' || reqUrl.pathname === pathname || reqUrl.pathname.startsWith(pathname + '/'))
          );
        } catch {
          // Malformed URL — not an auth request
        }
        if (isAuthRequest) {
          if (authConfig.origin) {
            const cleanOrigin = authConfig.origin.endsWith('/')
              ? authConfig.origin.slice(0, -1)
              : authConfig.origin;
            requestHeaders['Origin'] = cleanOrigin.toLowerCase();
            requestHeaders['Referer'] = cleanOrigin.toLowerCase();
          }
          const storedCookies = authConfig.getCookies();
          if (storedCookies && Object.keys(storedCookies).length > 0) {
            requestHeaders['Cookie'] = Object.entries(storedCookies)
              .map(([name, value]) => `${name}=${value}`)
              .join('; ');
          }
        }
      }

      // ── WebSocket: inject custom headers for provider connections ────
      // One-shot: headers are consumed on first use and removed from the map,
      // so they only apply to the intended upgrade handshake.
      if (details.resourceType === 'webSocket') {
        try {
          const url = new URL(details.url);
          const headers = wsHeaderRules.get(url.host);
          if (headers) {
            for (const [name, value] of headers.entries()) {
              requestHeaders[name] = value;
            }
            wsHeaderRules.delete(url.host);
          }
        } catch {
          // Invalid URL — pass through unchanged
        }
      }

      callback({ requestHeaders });
    }
  );

  console.log('[Sokuji] [Main] Combined header injection initialized');
}

// IPC: renderer registers headers for a host before opening a WebSocket
ipcMain.handle('ws-headers-set', (event, { host, headers }) => {
  if (!host || !headers || typeof headers !== 'object') {
    return { success: false, error: 'Invalid arguments: host and headers required' };
  }
  // Coerce all values to strings — Chromium silently drops headers with non-string values.
  // IPC serialization can turn numeric strings (e.g. App ID "1714584595") into numbers.
  const entries = Object.entries(headers)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, String(v)]);
  const headerMap = new Map(entries);
  wsHeaderRules.set(host, headerMap);
  console.log(`[Sokuji] [Main] WS headers registered for ${host}: ${[...headerMap.keys()].join(', ')}`);
  return { success: true };
});

// IPC: renderer clears headers for a host after disconnecting
ipcMain.handle('ws-headers-clear', (event, { host }) => {
  if (!host) {
    return { success: false, error: 'Invalid arguments: host required' };
  }
  wsHeaderRules.delete(host);
  console.log(`[Sokuji] [Main] WS headers cleared for ${host}`);
  return { success: true };
});

// Screen recording permission check for macOS system audio capture
// This only checks the permission status, does NOT trigger any permission dialogs
// The renderer should call getDisplayMedia() to trigger the system dialog when needed
ipcMain.handle('check-screen-recording-permission', async () => {
  if (process.platform !== 'darwin') {
    // Windows doesn't need screen recording permission for loopback audio
    return { status: 'granted', platform: process.platform };
  }

  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    console.log('[Sokuji] [Main] Screen recording permission status:', status);
    // Just return the raw status - don't try to trigger permission here
    // Calling desktopCapturer.getSources() would change 'not-determined' to 'denied'
    return { status, platform: 'darwin' };
  } catch (error) {
    console.error('[Sokuji] [Main] Error checking screen recording permission:', error);
    return { status: 'unknown', platform: 'darwin', error: error.message };
  }
});

