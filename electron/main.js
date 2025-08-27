const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { clerkAdapter } = require('./clerk-adapter');

// Handle Squirrel events for Windows - only use on Windows platform
if (process.platform === 'win32') {
  try {
    if (require('electron-squirrel-startup')) app.quit();
  } catch (error) {
    console.error('[Sokuji] [Main] Error with electron-squirrel-startup:', error);
    // Continue execution even if there's an error with squirrel startup
  }
}

// Config utility no longer needed - using localStorage in renderer process
const { 
  createVirtualAudioDevices, 
  removeVirtualAudioDevices, 
  isPulseAudioAvailable,
  cleanupOrphanedDevices
} = require('./pulseaudio-utils');

// Set application name for PulseAudio
app.setName('sokuji');
app.commandLine.appendSwitch('application-name', 'sokuji');
app.commandLine.appendSwitch('jack-name', 'sokuji');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Sokuji',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  const isDev = import.meta.env.MODE === 'development' || !app.isPackaged;
  console.log('[Sokuji] [Main] Development mode:', isDev, 'MODE:', import.meta.env.MODE, 'isPackaged:', app.isPackaged);
  
  if (isDev) {
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
    const pulseAudioAvailable = await isPulseAudioAvailable();
    return {
      pulseAudioAvailable
    };
  } catch (error) {
    console.error('[Sokuji] [Main] Error checking audio system status:', error);
    return {
      pulseAudioAvailable: false,
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
