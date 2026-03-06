const { app, BrowserWindow, ipcMain, Menu, dialog, shell, session, systemPreferences, desktopCapturer } = require('electron');
const path = require('path');

// Handle Squirrel events for Windows
if (process.platform === 'win32') {
  const handleSquirrelEvent = require('./squirrel-events');
  if (handleSquirrelEvent()) {
    // Squirrel event handled and app will exit, don't do anything else
    process.exit(0);
  }
}

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
      console.log('[Eburon] [Main] Virtual audio devices not supported on this platform');
      return false;
    },
    removeVirtualAudioDevices: () => {
      console.log('[Eburon] [Main] Virtual audio device cleanup not needed on this platform');
    },
    cleanupOrphanedDevices: async () => {
      console.log('[Eburon] [Main] No orphaned devices to clean on this platform');
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
  console.log('[Eburon] [Main] electron-audio-loopback initialized for', process.platform);
}

// Set application name for PulseAudio
app.setName('Eburon');
app.commandLine.appendSwitch('application-name', 'Eburon');
app.commandLine.appendSwitch('jack-name', 'Eburon');

// Enable WebGPU for ONNX Runtime acceleration
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan');

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
              message: 'Eburon - Real-time AI Translation',
              detail: `Version: ${app.getVersion()}\n\nAI-powered real-time translation application\n\n© 2024 Kizuna AI Lab`,
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
              message: 'Eburon - Real-time AI Translation',
              detail: `Version: ${app.getVersion()}\n\nAI-powered real-time translation application\n\n© 2024 Kizuna AI Lab`,
              buttons: ['OK'],
              icon: path.join(__dirname, '../assets/icon.png')
            });
          }
        },
        { type: 'separator' }]),
        {
          label: 'Official Website',
          click: async () => {
            await shell.openExternal('https://Eburon.kizuna.ai/');
          }
        },
        {
          label: 'Source Code',
          click: async () => {
            await shell.openExternal('https://github.com/kizuna-ai-lab/Eburon');
          }
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/kizuna-ai-lab/Eburon/issues');
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
  const electronVersion = process.versions.electron;
  const appVersion = app.getVersion();
  const customUserAgent = `Eburon/${appVersion} Electron/${electronVersion} (${process.platform})`;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Eburon',
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
  console.log('[Eburon] [Main] Custom User Agent set:', customUserAgent);

  // Load the app
  console.log('[Eburon] [Main] Development mode:', isDev, 'MODE:', import.meta.env.MODE, 'isPackaged:', app.isPackaged);
  
  // Track window load time
  const loadStartTime = Date.now();
  
  // Add performance tracking for page load
  mainWindow.webContents.on('did-finish-load', () => {
    const loadEndTime = Date.now();
    console.log(`[Eburon] [Main] Page loaded in ${loadEndTime - loadStartTime}ms`);
  });
  
  mainWindow.webContents.on('dom-ready', () => {
    const domReadyTime = Date.now();
    console.log(`[Eburon] [Main] DOM ready in ${domReadyTime - loadStartTime}ms`);
  });
  
  if (isDev) {
    console.log(`[Eburon] [Main] Loading from http://localhost:5173 at ${loadStartTime}`);
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Try multiple approaches to find the correct path
    let indexPath;
    
    // Approach 1: Standard path relative to __dirname
    const relativePath = path.join(__dirname, '../build/index.html');
    
    // Approach 2: Using app.getAppPath()
    const appPathBased = path.join(app.getAppPath(), 'build/index.html');
    
    // Approach 3: Absolute path based on the installation location
    const absolutePath = path.join(path.dirname(app.getPath('exe')), 'resources/app/build/index.html');
    
    // Approach 4: For asar packaged apps
    const asarPath = path.join(path.dirname(app.getPath('exe')), 'resources/app.asar/build/index.html');
    
    // Log all potential paths for debugging
    console.log('[Eburon] [Main] Potential paths:');
    console.log('[Eburon] [Main] - Relative path:', relativePath);
    console.log('[Eburon] [Main] - App path based:', appPathBased);
    console.log('[Eburon] [Main] - Absolute path:', absolutePath);
    console.log('[Eburon] [Main] - Asar path:', asarPath);
    
    // Check which path exists and use it
    if (require('fs').existsSync(relativePath)) {
      indexPath = relativePath;
      console.log('[Eburon] [Main] Using relative path');
    } else if (require('fs').existsSync(appPathBased)) {
      indexPath = appPathBased;
      console.log('[Eburon] [Main] Using app path based');
    } else if (require('fs').existsSync(absolutePath)) {
      indexPath = absolutePath;
      console.log('[Eburon] [Main] Using absolute path');
    } else if (require('fs').existsSync(asarPath)) {
      indexPath = asarPath;
      console.log('[Eburon] [Main] Using asar path');
    } else {
      // Fallback to the most likely path
      indexPath = asarPath;
      console.log('[Eburon] [Main] No path found, using fallback asar path');
    }
    
    // Use loadFile which is recommended for local files
    console.log('[Eburon] [Main] Final path used:', indexPath);
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
  // Clean up any orphaned devices
  try {
    await cleanupOrphanedDevices();
    console.log('[Eburon] [Main] Orphaned devices cleaned up successfully');
  } catch (error) {
    console.error('[Eburon] [Main] Error cleaning up orphaned devices:', error);
  }

  // Start virtual audio devices before creating the window
  try {
    const devicesCreated = await createVirtualAudioDevices();
    if (devicesCreated) {
      console.log('[Eburon] [Main] Virtual audio devices created successfully');
      
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
      //     console.log('[Eburon] [Main] Successfully connected virtual speaker to default output device');
      //   } else {
      //     console.error('[Eburon] [Main] Failed to connect virtual speaker to default output device');
      //   }
      // } catch (connectionError) {
      //   console.error('[Eburon] [Main] Error connecting virtual speaker to default output:', connectionError);
      // }
    } else {
      console.error('[Eburon] [Main] Failed to create virtual audio devices');
    }
  } catch (error) {
    console.error('[Eburon] [Main] Error creating virtual audio devices:', error);
  }

  // Create the application menu
  createApplicationMenu();

  // Request microphone permission on macOS before creating window
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log('[Eburon] [Main] Microphone permission status:', micStatus);

    if (micStatus === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      console.log('[Eburon] [Main] Microphone permission granted:', granted);
    } else if (micStatus === 'denied') {
      console.warn('[Eburon] [Main] Microphone permission denied - please enable in System Preferences > Privacy & Security > Microphone');
    }
  }

  createWindow();

  // electron-audio-loopback handles setDisplayMediaRequestHandler automatically via initMain()
});

// Ensure cleanup happens before app exits
const cleanupAndExit = () => {
  console.log('[Eburon] [Main] Cleaning up virtual audio devices before exit...');
  removeVirtualAudioDevices();
  console.log('[Eburon] [Main] Virtual audio devices cleaned up successfully');
};

// Create a more robust exit handler that ensures cleanup happens
const handleExit = (signal) => {
  console.log(`[Eburon] [Main] Received ${signal} signal. Ensuring cleanup before exit...`);
  
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
  console.error('[Eburon] [Main] Uncaught exception:', error);
  handleExit('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Eburon] [Main] Unhandled rejection at:', promise, 'reason:', reason);
  handleExit('unhandledRejection');
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  // On macOS, recreate the window when the dock icon is clicked
  if (mainWindow === null) createWindow();
});

// Clean up loopback when app is about to quit
app.on('will-quit', cleanupAndExit);

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
      // On macOS, Eburon Virtual Audio driver is installed by PKG installer
      systemType = audioSystemAvailable ? 'coreaudio' : 'none';
    }

    return {
      audioSystemAvailable,
      systemType,
      platform: process.platform,
      note: process.platform === 'win32' ? 'VB-CABLE detection happens in renderer process' :
            process.platform === 'darwin' ? 'Eburon Virtual Audio driver installed by PKG installer' : null
    };
  } catch (error) {
    console.error('[Eburon] [Main] Error checking audio system status:', error);
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
    console.error('[Eburon] [Main] Error in VB-CABLE check:', error);
    return {
      error: error.message
    };
  }
});

// Handler for VB-CABLE installation (called from renderer process)
ipcMain.handle('install-vbcable', async () => {
  try {
    if (process.platform === 'win32') {
      console.log('[Eburon] [Main] VB-CABLE installation requested from renderer');
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
    console.error('[Eburon] [Main] Error installing VB-CABLE:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Handler for Eburon Virtual Audio detection (called from renderer process)
ipcMain.handle('check-Eburon-audio', async () => {
  try {
    if (process.platform === 'darwin') {
      const { isEburonVirtualAudioInstalled } = audioUtils;
      const installed = await isEburonVirtualAudioInstalled();
      return {
        installed,
        platform: 'macos',
        driverName: 'Eburon Virtual Audio'
      };
    } else {
      return {
        installed: false,
        platform: process.platform,
        message: 'Eburon Virtual Audio is macOS-specific'
      };
    }
  } catch (error) {
    console.error('[Eburon] [Main] Error in Eburon Virtual Audio check:', error);
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
    console.error('[Eburon] [Main] Error opening directory:', error);
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
    console.error('[Eburon] [Main] Error opening external URL:', error);
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
    console.error('[Eburon] [Main] Error creating virtual audio devices:', error);
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
  console.log(`[Eburon] [Main] Volcengine AST2 [${connectionId}]: connecting to`, endpoint);

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
      console.log(`[Eburon] [Main] Volcengine AST2 [${connectionId}]: WebSocket connected`);
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
      console.error(`[Eburon] [Main] Volcengine AST2 [${connectionId}]: WebSocket error:`, err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('volcengine-ast2-error', { connectionId, error: err.message });
      }
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: err.message });
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[Eburon] [Main] Volcengine AST2 [${connectionId}]: WebSocket closed: ${code} ${reason.toString()}`);
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
    console.error(`[Eburon] [Main] Volcengine AST2 [${connectionId}]: send error:`, err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('volcengine-ast2-disconnect', (event, { connectionId } = {}) => {
  console.log(`[Eburon] [Main] Volcengine AST2 [${connectionId}]: disconnecting`);
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
  console.log('[Eburon] [Main] Volcengine AST2: validating credentials');

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
      console.log('[Eburon] [Main] Volcengine AST2: validation succeeded (WebSocket accepted)');
      finish({ success: true });
    });

    ws.on('error', (err) => {
      console.error('[Eburon] [Main] Volcengine AST2: validation failed:', err.message);
      finish({ success: false, error: err.message });
    });

    ws.on('close', (code, reason) => {
      finish({ success: false, error: `Connection rejected (code ${code}: ${reason.toString()})` });
    });

    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.error(`[Eburon] [Main] Volcengine AST2: validation rejected: HTTP ${res.statusCode} — ${body.substring(0, 200)}`);
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
    console.log('[Eburon] [Main] Screen recording permission status:', status);
    // Just return the raw status - don't try to trigger permission here
    // Calling desktopCapturer.getSources() would change 'not-determined' to 'denied'
    return { status, platform: 'darwin' };
  } catch (error) {
    console.error('[Eburon] [Main] Error checking screen recording permission:', error);
    return { status: 'unknown', platform: 'darwin', error: error.message };
  }
});

