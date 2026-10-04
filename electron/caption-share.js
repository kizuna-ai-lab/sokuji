// electron/caption-share.js
//
// The LAN caption-share feature's main-process side (spec 2026-10-04 §3.2,
// §7.3, §8): IPC from the host's window, the status pushed back, the present
// window, the network watch, and ending the share when the host's page goes
// away. Handlers are registered once, when this is set up at module load;
// `attachWindow` follows the main window when macOS recreates it.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { createCaptionShareServer } = require('./caption-share-server.js');
const { rankAddresses, parseHardwarePorts } = require('./caption-share-net.js');
const { viewerAssets } = require('./caption-share-core.js');

const NETWORK_POLL_MS = 10_000;

function buildDirAssets(buildDir) {
  let allowed = null;
  return {
    async allowed() {
      if (!allowed) {
        try {
          const manifest = JSON.parse(await fs.promises.readFile(path.join(buildDir, 'asset-manifest.json'), 'utf8'));
          allowed = viewerAssets(manifest, 'viewer.html');
        } catch {
          allowed = new Set();
        }
      }
      return allowed;
    },
    read: (rel) => fs.promises.readFile(path.join(buildDir, rel)).catch(() => null),
  };
}

function readHardwarePorts() {
  if (process.platform !== 'darwin') return Promise.resolve(new Map());
  return new Promise((resolve) => {
    execFile('networksetup', ['-listallhardwareports'], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? new Map() : parseHardwarePorts(stdout));
    });
  });
}

function validState(s) {
  if (!s || (s.phase !== 'live' && s.phase !== 'idle')) return null;
  if (!s.pair || typeof s.pair.source !== 'string' || typeof s.pair.target !== 'string') return null;
  return { phase: s.phase, pair: { source: s.pair.source, target: s.pair.target }, allowSave: s.allowSave === true };
}

function setupCaptionShare({
  ipcMain,
  BrowserWindow,
  app,
  isTrustedSender,
  getMainWindow,
  isDev,
  buildDir = path.join(app.getAppPath(), 'build'),
  devServerUrl = 'http://localhost:5173',
  networkInterfaces = () => os.networkInterfaces(),
  hardwarePorts = readHardwarePorts,
  createServer = createCaptionShareServer,
  timers = { setInterval, clearInterval },
}) {
  const server = createServer({ assets: isDev ? null : buildDirAssets(buildDir), devServerUrl: isDev ? devServerUrl : null });
  let hardware = new Map();
  let addresses = [];
  let selected = null;
  let addressChanged = false;
  let state = null;
  let wifi = null;
  let poll = null;
  let presentWindow = null;
  let presentUrl = null;
  // Bumped whenever the host window closes, crashes or navigates away.
  let windowGeneration = 0;
  let viewers = 0;

  const status = () => ({ running: server.running(), port: server.port(), addresses, selected, viewers, addressChanged });
  const push = () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('caption-share:status', status());
  };
  const presentInfo = () => ({
    url: selected && server.port() ? `http://${selected}:${server.port()}/` : '',
    pair: state ? state.pair : { source: '', target: '' },
    phase: state ? state.phase : 'idle',
    viewers,
    wifi,
  });
  const pushPresent = () => {
    if (server.running()) server.setPresent(presentInfo());
  };

  const refreshAddresses = () => {
    addresses = rankAddresses(networkInterfaces(), hardware);
    if (!addresses.some((a) => a.address === selected)) {
      const had = selected !== null;
      selected = addresses.length > 0 ? addresses[0].address : null;
      if (had) addressChanged = true;
    }
  };

  server.onViewersChange((n) => {
    viewers = n;
    push();
    pushPresent();
  });

  const stop = async () => {
    if (poll) {
      timers.clearInterval(poll);
      poll = null;
    }
    if (presentWindow && !presentWindow.isDestroyed()) presentWindow.close();
    presentWindow = null;
    await server.stop();
    addressChanged = false;
    viewers = 0;
    push();
  };

  /** `askedIn`: the window generation when the request came, before it waited its turn. */
  const start = async (next, askedIn) => {
    // Already sharing: the status as it is, and no second network poll.
    if (server.running()) return status();
    state = next;
    try {
      hardware = await hardwarePorts();
      await server.start(state);
    } catch (error) {
      return { error: error && error.code === 'ports-busy' ? 'ports-busy' : 'listen-failed', reason: String((error && error.message) || error) };
    }
    // The window that asked closed, crashed or navigated while this started
    // (the port lookup can take seconds on macOS): end rather than serve a
    // network no window shows.
    if (askedIn !== windowGeneration) {
      await stop();
      return { error: 'listen-failed', reason: 'the window closed while sharing started' };
    }
    selected = null;
    addressChanged = false;
    refreshAddresses();
    poll = timers.setInterval(() => {
      const before = JSON.stringify([addresses, selected]);
      refreshAddresses();
      if (JSON.stringify([addresses, selected]) !== before) {
        push();
        pushPresent();
      }
    }, NETWORK_POLL_MS);
    pushPresent();
    return status();
  };

  // One start at a time: a start the old window left finishes its cleanup
  // before one from a recreated window begins, or it would stop that share.
  let startQueue = Promise.resolve();
  ipcMain.handle('caption-share:start', (event, payload) => {
    if (!isTrustedSender(event.sender)) return { error: 'listen-failed', reason: 'not the main window' };
    const next = validState(payload);
    if (!next) return { error: 'listen-failed', reason: 'bad state' };
    const askedIn = windowGeneration;
    const run = startQueue.then(() => start(next, askedIn));
    startQueue = run.catch(() => {});
    return run;
  });

  ipcMain.handle('caption-share:stop', async (event) => {
    if (!isTrustedSender(event.sender)) return null;
    await stop();
    return status();
  });

  ipcMain.handle('caption-share:patch', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    server.patch({
      upsert: Array.isArray(payload && payload.upsert) ? payload.upsert : [],
      remove: Array.isArray(payload && payload.remove) ? payload.remove.filter((id) => typeof id === 'string') : [],
    });
  });

  ipcMain.handle('caption-share:clear', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    server.clear(payload && payload.reason === 'restart' ? 'restart' : 'clear');
  });

  ipcMain.handle('caption-share:state', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    const next = validState(payload);
    if (!next) return;
    state = next;
    server.setState(state);
    pushPresent();
  });

  ipcMain.handle('caption-share:select-address', (event, payload) => {
    if (!isTrustedSender(event.sender)) return status();
    if (addresses.some((a) => a.address === (payload && payload.address))) {
      selected = payload.address;
      addressChanged = false;
      pushPresent();
    }
    return status();
  });

  ipcMain.handle('caption-share:set-wifi', (event, payload) => {
    if (!isTrustedSender(event.sender)) return;
    const w = payload && payload.wifi;
    wifi = w && typeof w.ssid === 'string' && w.ssid.trim() !== ''
      ? { ssid: w.ssid.trim(), password: typeof w.password === 'string' ? w.password : '' }
      : null;
    pushPresent();
  });

  ipcMain.handle('caption-share:present', (event, payload) => {
    if (!isTrustedSender(event.sender) || !server.running()) return;
    // Sokuji's UI language, for the page's words: this window's navigator.languages
    // is the OS locale. Only a catalog-shaped id (`ja`, `zh_CN`, `pt-BR`) goes into the URL.
    const lang = typeof payload?.lang === 'string' && /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?$/.test(payload.lang) ? payload.lang : null;
    const url = `http://127.0.0.1:${server.port()}/present${lang ? `?lang=${lang}` : ''}`;
    if (presentWindow && !presentWindow.isDestroyed()) {
      if (presentUrl !== url) { presentUrl = url; presentWindow.loadURL(url); }
      presentWindow.show();
      presentWindow.focus();
      return;
    }
    presentWindow = new BrowserWindow({
      width: 1100,
      height: 700,
      title: 'Sokuji',
      backgroundColor: '#111111',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    presentWindow.on('closed', () => { presentWindow = null; });
    presentUrl = url;
    presentWindow.loadURL(url);
  });

  app.on('will-quit', () => { void stop(); });

  const attachWindow = (win) => {
    const end = () => {
      // Also cancels a start still in flight: it checks the generation when it lands.
      windowGeneration += 1;
      if (server.running()) void stop();
    };
    win.webContents.on('render-process-gone', end);
    // Electron passes a details object first; older versions also pass
    // (url, isInPlace, isMainFrame) positionally.
    win.webContents.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
      const main = details && typeof details.isMainFrame === 'boolean' ? details.isMainFrame : isMainFrame;
      const same = details && typeof details.isSameDocument === 'boolean' ? details.isSameDocument : isInPlace;
      if (main && !same) end();
    });
    win.on('closed', end);
  };

  return { attachWindow, stop, status };
}

module.exports = { setupCaptionShare, NETWORK_POLL_MS };
