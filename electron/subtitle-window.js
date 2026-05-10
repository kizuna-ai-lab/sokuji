// electron/subtitle-window.js
const { ipcMain, screen } = require('electron');

function clampToScreen(bounds, work) {
  const width = Math.min(bounds.width, work.width);
  const height = Math.min(bounds.height, work.height);
  const x = Math.max(work.x, Math.min(bounds.x, work.x + work.width - width));
  const y = Math.max(work.y, Math.min(bounds.y, work.y + work.height - height));
  return { x, y, width, height };
}

function defaultSubtitleBounds(work) {
  const width = Math.round(work.width * 0.8);
  const height = 200;
  return {
    x: work.x + Math.round((work.width - width) / 2),
    y: work.y + work.height - height - 80,
    width,
    height,
  };
}

function setupSubtitleHandlers(mainWindow) {
  let normalBoundsSnapshot = null;

  ipcMain.handle('subtitle:get-screen-bounds', () => {
    const display = screen.getPrimaryDisplay();
    return display.workArea;
  });

  ipcMain.handle('subtitle:enter', (_event, payload) => {
    if (mainWindow.isDestroyed()) return { ok: false };
    const work = screen.getPrimaryDisplay().workArea;
    const requested = payload?.bounds ?? defaultSubtitleBounds(work);
    const clamped = clampToScreen(requested, work);

    normalBoundsSnapshot = mainWindow.getBounds();
    mainWindow.setBounds(clamped);
    mainWindow.setAlwaysOnTop(Boolean(payload?.alwaysOnTop), 'floating');
    mainWindow.setResizable(!payload?.locked);
    return { ok: true, bounds: clamped };
  });

  ipcMain.handle('subtitle:exit', (_event, payload) => {
    if (mainWindow.isDestroyed()) return { ok: false };
    const restore = payload?.restoreBounds ?? normalBoundsSnapshot ?? { width: 1200, height: 800 };
    if (restore.x !== undefined && restore.y !== undefined) {
      mainWindow.setBounds(restore);
    } else {
      const display = screen.getPrimaryDisplay().workArea;
      mainWindow.setBounds({
        x: display.x + Math.round((display.width - 1200) / 2),
        y: display.y + Math.round((display.height - 800) / 2),
        width: 1200,
        height: 800,
      });
    }
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    normalBoundsSnapshot = null;
    return { ok: true };
  });

  ipcMain.handle('subtitle:set-always-on-top', (_event, flag) => {
    if (mainWindow.isDestroyed()) return { ok: false };
    mainWindow.setAlwaysOnTop(Boolean(flag), 'floating');
    return { ok: true };
  });

  ipcMain.handle('subtitle:set-locked', (_event, locked) => {
    if (mainWindow.isDestroyed()) return { ok: false };
    mainWindow.setResizable(!locked);
    return { ok: true };
  });

  // Debounced bounds-changed broadcaster
  let debounceTimer = null;
  const onChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('subtitle:window-bounds-changed', mainWindow.getBounds());
      }
    }, 200);
  };
  mainWindow.on('resize', onChange);
  mainWindow.on('move', onChange);
  mainWindow.on('closed', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  });
}

module.exports = { setupSubtitleHandlers };
