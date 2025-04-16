const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
require('dotenv').config();
const { 
  createVirtualAudioDevices, 
  removeVirtualAudioDevices, 
  isPulseAudioAvailable 
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
    mainWindow = null;
  });
}

// Create window when Electron is ready
app.whenReady().then(async () => {
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

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  // On macOS, recreate the window when the dock icon is clicked
  if (mainWindow === null) createWindow();
});

// Clean up loopback when app is about to quit
app.on('will-quit', function() {
  // Remove virtual audio devices
  removeVirtualAudioDevices();
});

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
