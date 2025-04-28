const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
// Handle Squirrel events for Windows
if (require('electron-squirrel-startup')) app.quit();

// Use our custom config utility
const { getConfig, setConfig, createDefaultConfig, CONFIG_DIR, CONFIG_FILE } = require('./config-utils');
// Initialize config
createDefaultConfig();
const { 
  createVirtualAudioDevices, 
  removeVirtualAudioDevices, 
  isPulseAudioAvailable,
  cleanupOrphanedDevices,
  connectVirtualSpeakerToOutput,
  disconnectVirtualSpeakerFromOutputs
} = require('./pulseaudio-utils');
// Import API handlers
const { validateApiKey } = require('./api-handlers');

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
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
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
      //     console.log('Successfully connected virtual speaker to default output device');
      //   } else {
      //     console.error('Failed to connect virtual speaker to default output device');
      //   }
      // } catch (connectionError) {
      //   console.error('Error connecting virtual speaker to default output:', connectionError);
      // }
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

// Configuration IPC handlers
ipcMain.handle('get-config', (event, key, defaultValue) => {
  try {
    return getConfig(key, defaultValue);
  } catch (error) {
    console.error('Error getting config:', error);
    return defaultValue;
  }
});

ipcMain.handle('set-config', (event, key, value) => {
  try {
    return { success: setConfig(key, value) };
  } catch (error) {
    console.error('Error setting config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-config-path', () => {
  return { configDir: CONFIG_DIR, configFile: CONFIG_FILE };
});

// Handler to open a directory in the file explorer
ipcMain.handle('open-directory', (event, dirPath) => {
  try {
    // Open the directory using the default file explorer
    const { shell } = require('electron');
    shell.openPath(dirPath);
    return { success: true };
  } catch (error) {
    console.error('Error opening directory:', error);
    return { success: false, error: error.message };
  }
});

// Handler for validating OpenAI API key
ipcMain.handle('validate-api-key', async (event, apiKey) => {
  try {
    const validationResult = await validateApiKey(apiKey);
    return { 
      success: true, 
      ...validationResult 
    };
  } catch (error) {
    console.error('Error validating API key:', error);
    return { 
      success: false, 
      valid: false,
      error: error.message || 'Failed to validate API key' 
    };
  }
});

// Handler to connect virtual speaker to a specific output device
ipcMain.handle('connect-virtual-speaker-to-output', async (event, deviceInfo) => {
  try {
    // First disconnect any existing connections
    await disconnectVirtualSpeakerFromOutputs();
    
    // Then connect to the new output device
    // Pass both deviceId and label to help with PipeWire node identification
    const result = await connectVirtualSpeakerToOutput(deviceInfo);
    return { 
      success: result,
      message: result ? 'Connected virtual speaker to output device' : 'Failed to connect'
    };
  } catch (error) {
    console.error('Error connecting virtual speaker to output:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to connect virtual speaker to output device' 
    };
  }
});

// Handler to disconnect virtual speaker from all outputs
ipcMain.handle('disconnect-virtual-speaker-outputs', async () => {
  try {
    const result = await disconnectVirtualSpeakerFromOutputs();
    return { 
      success: result,
      message: result ? 'Disconnected virtual speaker from all outputs' : 'Failed to disconnect'
    };
  } catch (error) {
    console.error('Error disconnecting virtual speaker:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to disconnect virtual speaker from outputs' 
    };
  }
});
