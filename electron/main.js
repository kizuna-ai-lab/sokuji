const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
require('dotenv').config();
const { 
  startPipeWireLoopback, 
  stopPipeWireLoopback, 
  isPipeWireEnabled, 
  isPwLoopbackAvailable 
} = require('./pipewire-utils');

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
  // Start PipeWire loopback before creating the window
  try {
    const loopbackStarted = await startPipeWireLoopback();
    if (loopbackStarted) {
      console.log('PipeWire loopback started successfully');
    } else {
      console.error('Failed to start PipeWire loopback');
    }
  } catch (error) {
    console.error('Error starting PipeWire loopback:', error);
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
  // Stop PipeWire loopback
  stopPipeWireLoopback();
});

// IPC handlers for PipeWire functionality
ipcMain.handle('check-pipewire', async () => {
  try {
    const pipeWireEnabled = await isPipeWireEnabled();
    const loopbackAvailable = await isPwLoopbackAvailable();
    return {
      pipeWireEnabled,
      loopbackAvailable
    };
  } catch (error) {
    console.error('Error checking PipeWire status:', error);
    return {
      pipeWireEnabled: false,
      loopbackAvailable: false,
      error: error.message
    };
  }
});

ipcMain.handle('start-loopback', async () => {
  try {
    const result = await startPipeWireLoopback();
    return { success: result };
  } catch (error) {
    console.error('Error starting loopback:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-loopback', () => {
  try {
    stopPipeWireLoopback();
    return { success: true };
  } catch (error) {
    console.error('Error stopping loopback:', error);
    return { success: false, error: error.message };
  }
});
