const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
require('dotenv').config();
const { 
  createVirtualAudioDevices, 
  removeVirtualAudioDevices, 
  isPulseAudioAvailable,
  cleanupOrphanedDevices
} = require('./pulseaudio-utils');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  const startUrl = process.env.ELECTRON_START_URL || url.format({
    pathname: path.join(__dirname, '../build/index.html'),
    protocol: 'file:',
    slashes: true
  });
  
  mainWindow.loadURL(startUrl);

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
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
  // Clean up any orphaned devices
  try {
    await cleanupOrphanedDevices();
    console.log('Orphaned devices cleaned up successfully');
  } catch (error) {
    console.error('Error cleaning up orphaned devices:', error);
  }

  // Start virtual audio devices before creating the window
  try {
    const devicesCreated = await createVirtualAudioDevices();
    if (devicesCreated) {
      console.log('Virtual audio devices created successfully');
    } else {
      console.error('Failed to create virtual audio devices');
    }
  } catch (error) {
    console.error('Error creating virtual audio devices:', error);
  }
  
  createWindow();
});

// Ensure cleanup happens before app exits
const cleanupAndExit = () => {
  console.log('Cleaning up virtual audio devices before exit...');
  removeVirtualAudioDevices();
  console.log('Virtual audio devices cleaned up successfully');
};

// Create a more robust exit handler that ensures cleanup happens
const handleExit = (signal) => {
  console.log(`Received ${signal} signal. Ensuring cleanup before exit...`);
  
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
  console.error('Uncaught exception:', error);
  handleExit('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
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
    console.error('Error checking audio system status:', error);
    return {
      pulseAudioAvailable: false,
      error: error.message
    };
  }
});

ipcMain.handle('start-loopback', async () => {
  try {
    const result = await createVirtualAudioDevices();
    return { success: result };
  } catch (error) {
    console.error('Error creating virtual audio devices:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-loopback', () => {
  try {
    removeVirtualAudioDevices();
    return { success: true };
  } catch (error) {
    console.error('Error removing virtual audio devices:', error);
    return { success: false, error: error.message };
  }
});
