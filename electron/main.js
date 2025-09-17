const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { clerkAdapter } = require('./clerk-adapter');

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
  cleanupOrphanedDevices
} = audioUtils;

// Set application name for PulseAudio
app.setName('sokuji');
app.commandLine.appendSwitch('application-name', 'sokuji');
app.commandLine.appendSwitch('jack-name', 'sokuji');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

function createWindow() {
  // Determine the correct icon path based on platform
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '../assets/icon.ico')
    : path.join(__dirname, '../assets/icon.png');

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Sokuji',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  const isDev = import.meta.env.MODE === 'development' || !app.isPackaged;
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
    console.log('[Sokuji] [Main] Potential paths:');
    console.log('[Sokuji] [Main] - Relative path:', relativePath);
    console.log('[Sokuji] [Main] - App path based:', appPathBased);
    console.log('[Sokuji] [Main] - Absolute path:', absolutePath);
    console.log('[Sokuji] [Main] - Asar path:', asarPath);
    
    // Check which path exists and use it
    if (require('fs').existsSync(relativePath)) {
      indexPath = relativePath;
      console.log('[Sokuji] [Main] Using relative path');
    } else if (require('fs').existsSync(appPathBased)) {
      indexPath = appPathBased;
      console.log('[Sokuji] [Main] Using app path based');
    } else if (require('fs').existsSync(absolutePath)) {
      indexPath = absolutePath;
      console.log('[Sokuji] [Main] Using absolute path');
    } else if (require('fs').existsSync(asarPath)) {
      indexPath = asarPath;
      console.log('[Sokuji] [Main] Using asar path');
    } else {
      // Fallback to the most likely path
      indexPath = asarPath;
      console.log('[Sokuji] [Main] No path found, using fallback asar path');
    }
    
    // Use loadFile which is recommended for local files
    console.log('[Sokuji] [Main] Final path used:', indexPath);
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
  // Initialize Clerk adapter
  try {
    const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
    const origin = import.meta.env.VITE_CLERK_ORIGIN || (import.meta.env.MODE === 'development' ? 'http://localhost:5173' : `file://${__dirname}`);

    console.log(`[Sokuji] [Main] Initializing Clerk adapter with origin: ${origin}, publishableKey: ${publishableKey}`);
    
    if (publishableKey) {
      clerkAdapter({
        publishableKey,
        origin
      });
      console.log('[Sokuji] [Main] Clerk adapter initialized');
    } else {
      console.warn('[Sokuji] [Main] VITE_CLERK_PUBLISHABLE_KEY not found, Clerk adapter not initialized');
    }
  } catch (error) {
    console.error('[Sokuji] [Main] Error initializing Clerk adapter:', error);
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
  
  createWindow();
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
