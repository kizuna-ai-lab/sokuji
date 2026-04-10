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
  // System audio capture functions (Linux only)
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource,
  supportsSystemAudioCapture
} = audioUtils;

// Initialize electron-audio-loopback for Windows and macOS system audio capture
// MUST be called before app is ready
// Note: Linux is not supported by electron-audio-loopback, uses LinuxLoopbackRecorder instead
if (process.platform === 'win32' || process.platform === 'darwin') {
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
    // Close all Volcengine AST2 WebSocket connections
    for (const [id, ws] of volcengineConnections) {
      try { ws.close(); } catch (e) { /* ignore */ }
    }
    volcengineConnections.clear();

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

// Volcengine AST 2.0: WebSocket proxy via main process
// Browser WebSocket API doesn't support custom headers, so we run the WebSocket
// in the main process (Node.js `ws` library supports headers) and bridge via IPC.
const WebSocket = require('ws');

// Multiple concurrent WebSocket connections keyed by connectionId.
// Each VolcengineAST2Client instance (speaker, participant) gets its own entry.
const volcengineConnections = new Map(); // connectionId → WebSocket

ipcMain.handle('volcengine-ast2-connect', async (event, { appId, accessToken, resourceId, connectionId }) => {
  const endpoint = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate';
  console.log(`[Sokuji] [Main] Volcengine AST2 [${connectionId}]: connecting to`, endpoint);

  return new Promise((resolve) => {
    let resolved = false;

    const ws = new WebSocket(endpoint, {
      headers: {
        'X-Api-App-Key': appId,
        'X-Api-Access-Key': accessToken,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Connect-Id': connectionId,
      },
    });

    ws.on('open', () => {
      console.log(`[Sokuji] [Main] Volcengine AST2 [${connectionId}]: WebSocket connected`);
      volcengineConnections.set(connectionId, ws);
      resolved = true;
      resolve({ success: true });
    });

    ws.on('message', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const buffer = data instanceof Buffer ? data : Buffer.from(data);
        mainWindow.webContents.send('volcengine-ast2-message', { connectionId, data: buffer });
      }
    });

    ws.on('error', (err) => {
      console.error(`[Sokuji] [Main] Volcengine AST2 [${connectionId}]: WebSocket error:`, err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('volcengine-ast2-error', { connectionId, error: err.message });
      }
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: err.message });
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[Sokuji] [Main] Volcengine AST2 [${connectionId}]: WebSocket closed: ${code} ${reason.toString()}`);
      volcengineConnections.delete(connectionId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('volcengine-ast2-close', { connectionId, code, reason: reason.toString() });
      }
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: `WebSocket closed: ${code} ${reason.toString()}` });
      }
    });
  });
});

ipcMain.handle('volcengine-ast2-send', (event, { connectionId, data }) => {
  const ws = volcengineConnections.get(connectionId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { success: false, error: 'WebSocket not connected' };
  }
  try {
    const buffer = Buffer.from(data);
    ws.send(buffer);
    return { success: true };
  } catch (err) {
    console.error(`[Sokuji] [Main] Volcengine AST2 [${connectionId}]: send error:`, err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('volcengine-ast2-disconnect', (event, { connectionId } = {}) => {
  console.log(`[Sokuji] [Main] Volcengine AST2 [${connectionId}]: disconnecting`);
  const ws = volcengineConnections.get(connectionId);
  if (ws) {
    try { ws.close(); } catch (e) { /* ignore */ }
    volcengineConnections.delete(connectionId);
  }
  return { success: true };
});

// Volcengine AST 2.0: Lightweight credential validation via WebSocket connect-disconnect
// Opens a WebSocket with auth headers, checks if it's accepted, then closes immediately.
// Uses a separate variable so it doesn't interfere with an active session.
let volcengineValidateWs = null;

ipcMain.handle('volcengine-ast2-validate', async (event, { appId, accessToken, resourceId }) => {
  // Clean up any lingering validation socket
  if (volcengineValidateWs) {
    try { volcengineValidateWs.close(); } catch (e) { /* ignore */ }
    volcengineValidateWs = null;
  }

  const endpoint = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate';
  const connectionId = require('crypto').randomUUID();
  console.log('[Sokuji] [Main] Volcengine AST2: validating credentials');

  return new Promise((resolve) => {
    let resolved = false;

    const ws = new WebSocket(endpoint, {
      headers: {
        'X-Api-App-Key': appId,
        'X-Api-Access-Key': accessToken,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Connect-Id': connectionId,
      },
    });
    volcengineValidateWs = ws;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) { /* ignore */ }
      if (volcengineValidateWs === ws) {
        volcengineValidateWs = null;
      }
      resolve(result);
    };

    // 5-second timeout
    const timer = setTimeout(() => {
      finish({ success: false, error: 'Connection timed out — credentials could not be verified' });
    }, 5000);

    ws.on('open', () => {
      console.log('[Sokuji] [Main] Volcengine AST2: validation succeeded (WebSocket accepted)');
      finish({ success: true });
    });

    ws.on('error', (err) => {
      console.error('[Sokuji] [Main] Volcengine AST2: validation failed:', err.message);
      finish({ success: false, error: err.message });
    });

    ws.on('close', (code, reason) => {
      finish({ success: false, error: `Connection rejected (code ${code}: ${reason.toString()})` });
    });

    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.error(`[Sokuji] [Main] Volcengine AST2: validation rejected: HTTP ${res.statusCode} — ${body.substring(0, 200)}`);
        finish({ success: false, error: `Server rejected connection: HTTP ${res.statusCode} ${res.statusMessage}` });
      });
    });
  });
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

// ── Edge TTS: WebSocket proxy via main process ───────────────────────────────
// Browser WebSocket API cannot set custom headers. Bing's TTS endpoint
// requires User-Agent + Origin headers. We run the WebSocket in the main
// process and stream parsed MP3 audio chunks back to the renderer via IPC.

const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_CHROMIUM_VERSION = '143.0.3650.75';
const EDGE_TTS_CHROMIUM_MAJOR = EDGE_TTS_CHROMIUM_VERSION.split('.')[0];
const EDGE_TTS_GEC_VERSION = `1-${EDGE_TTS_CHROMIUM_VERSION}`;

function edgeTtsTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
}

function edgeTtsMakeConnectionId() {
  return require('crypto').randomUUID().replace(/-/g, '');
}

function edgeTtsMakeMuid() {
  return require('crypto').randomBytes(16).toString('hex').toUpperCase();
}

async function edgeTtsMakeSecMsGec() {
  const crypto = require('crypto');
  const winEpoch = 11644473600;
  const secondsToNs = 1e9;
  let ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= secondsToNs / 100;
  const payload = `${ticks.toFixed(0)}${EDGE_TTS_TOKEN}`;
  return crypto.createHash('sha256').update(payload).digest('hex').toUpperCase();
}

function edgeTtsEscapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function edgeTtsRemoveInvalidXmlChars(text) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
}

function edgeTtsNormalizeVoiceName(voice) {
  const trimmed = voice.trim();
  const providerMatch = /^([a-z]{2,}-[A-Z]{2,})-([^:]+):.+Neural$/.exec(trimmed);
  if (providerMatch) {
    return edgeTtsNormalizeVoiceName(`${providerMatch[1]}-${providerMatch[2]}Neural`);
  }
  const shortMatch = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!shortMatch) return trimmed;
  const [, lang] = shortMatch;
  let [, , region, name] = shortMatch;
  if (name.includes('-')) {
    const [regionSuffix, ...nameParts] = name.split('-');
    region += `-${regionSuffix}`;
    name = nameParts.join('-');
  }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
}

function edgeTtsParseBinaryFrame(data) {
  if (data.length < 2) throw new Error('binary frame too short');
  const headerLength = (data[0] << 8) | data[1];
  if (data.length < 2 + headerLength) throw new Error('binary frame truncated');
  const headerText = data.slice(2, 2 + headerLength).toString('utf8');
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return { headers, body: data.slice(2 + headerLength) };
}

let edgeTtsWs = null;

ipcMain.handle('edge-tts-generate', async (event, { text, voice, speed }) => {
  if (edgeTtsWs) {
    try { edgeTtsWs.close(); } catch (e) { /* ignore */ }
    edgeTtsWs = null;
  }

  const voiceName = voice || 'en-US-AvaMultilingualNeural';
  const speedPercent = Math.round(((speed || 1.0) - 1.0) * 100);

  try {
    const secMsGec = await edgeTtsMakeSecMsGec();
    const connectionId = edgeTtsMakeConnectionId();
    const requestId = edgeTtsMakeConnectionId();

    const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TTS_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${encodeURIComponent(EDGE_TTS_GEC_VERSION)}&ConnectionId=${connectionId}`;

    console.log('[Sokuji] [Main] Edge TTS: connecting for voice:', voiceName);

    const rateStr = speedPercent >= 0 ? `+${speedPercent}%` : `${speedPercent}%`;
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${edgeTtsNormalizeVoiceName(voiceName)}'><prosody pitch='+0Hz' rate='${rateStr}' volume='+0%'>${edgeTtsEscapeXml(edgeTtsRemoveInvalidXmlChars(text))}</prosody></voice></speak>`;
    const speechConfig = `X-Timestamp:${edgeTtsTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
    const ssmlMessage = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${edgeTtsTimestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`;

    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0`,
          'Accept-Language': 'en-US,en;q=0.9',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Origin': 'https://www.bing.com',
          'Cookie': `muid=${edgeTtsMakeMuid()};`,
        },
      });
      edgeTtsWs = ws;

      ws.on('open', () => {
        console.log('[Sokuji] [Main] Edge TTS: connected, sending SSML');
        ws.send(speechConfig);
        ws.send(ssmlMessage);
      });

      ws.on('message', (data, isBinary) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        if (!isBinary) {
          // Text frame — check for turn.end
          const text = data.toString('utf8');
          const separator = text.indexOf('\r\n\r\n');
          const headerText = separator >= 0 ? text.slice(0, separator) : text;
          if (headerText.includes('Path:turn.end')) {
            ws.close();
          }
          return;
        }

        // Binary frame — parse and extract MP3 body
        try {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const { headers, body } = edgeTtsParseBinaryFrame(buf);
          if (headers.Path === 'audio' && body.length > 0) {
            mainWindow.webContents.send('edge-tts-audio-chunk', { mp3Data: body });
          }
        } catch (err) {
          console.warn('[Sokuji] [Main] Edge TTS: frame parse error:', err.message);
        }
      });

      ws.on('close', () => {
        edgeTtsWs = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('edge-tts-done');
        }
        resolve({ success: true });
      });

      ws.on('error', (err) => {
        console.error('[Sokuji] [Main] Edge TTS: error:', err.message);
        edgeTtsWs = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('edge-tts-error', { error: err.message });
        }
        resolve({ success: false, error: err.message });
      });
    });
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('edge-tts-cancel', () => {
  if (edgeTtsWs) {
    try { edgeTtsWs.close(); } catch (e) { /* ignore */ }
    edgeTtsWs = null;
  }
  return { success: true };
});

