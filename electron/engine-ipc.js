/**
 * The main process's side of the local engine: the EngineHost, and the IPC the renderer already uses. The renderer
 * does not change, so `sidecar-bundle:*` keeps answering in its old shapes; the native files ship inside the app, so
 * the engine is simply "ready" where the platform is supported.
 */
const path = require('path');
const { EngineHost } = require('./engine-host');
const { resolveNativeDir } = require('./native-dir');

const DEV_ORIGIN = 'http://localhost:5173';
// What a packaged page's WebSocket really sends: Electron's loadFile() page has the origin `file://` (measured on
// Electron 44.11.5). Not Better Auth's `file://sokuji` marker, and never `null`.
const PACKAGED_PAGE_ORIGIN = 'file://';

function engineEnv({ env, userData, nativeDir, origins }) {
  return {
    ...env,
    SOKUJI_NATIVE_DIR: nativeDir,
    SOKUJI_ENGINE_ORIGINS: origins.join(','),
    // A pre-set HF_HOME is respected (a shared model cache for manual testing); otherwise the cache lives in userData.
    HF_HOME: env.HF_HOME || path.join(userData, 'hf-cache'),
  };
}

function registerEngineIpc({ ipcMain, app, detectSku, nativeVersion, repoRoot, enginePath, env = process.env, resourcesPath = process.resourcesPath, platform = process.platform, arch = process.arch, log = () => {}, fork }) {
  const sku = detectSku(platform, { arch });
  const nativeDir = resolveNativeDir({ isPackaged: app.isPackaged, resourcesPath, env, repoRoot });
  const host = new EngineHost({
    fork,
    enginePath,
    log,
    env: engineEnv({ env, userData: app.getPath('userData'), nativeDir, origins: app.isPackaged ? [PACKAGED_PAGE_ORIGIN] : [DEV_ORIGIN, PACKAGED_PAGE_ORIGIN] }),
  });

  ipcMain.handle('native-host:start', async () => {
    if (sku === null) return { ok: false, error: 'The local engine is not available on this platform' };
    try { return { ok: true, ...(await host.start()) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('native-host:stop', async () => { await host.stop(); return { ok: true }; });
  ipcMain.handle('native-host:status', () => ({ ok: true, ...host.status() }));

  ipcMain.handle('sidecar-bundle:status', () => {
    if (sku === null) {
      return { ok: true, sku: null, state: 'unsupported', installed: false, installedVersion: null, requiredVersion: null, stagedBytes: 0, devVenvPresent: false };
    }
    return { ok: true, sku, state: 'ready', installed: true, installedVersion: nativeVersion, requiredVersion: nativeVersion, stagedBytes: 0, devVenvPresent: false };
  });
  ipcMain.handle('sidecar-bundle:manifest', () => ({ ok: true, manifest: null }));
  ipcMain.handle('sidecar-bundle:install', () => ({ ok: true, sku }));
  ipcMain.handle('sidecar-bundle:cancel', () => ({ ok: true }));
  ipcMain.handle('sidecar-bundle:usage', () => ({ ok: true, bytes: 0 }));
  ipcMain.handle('sidecar-bundle:remove', () => ({ ok: true }));
  return host;
}

module.exports = { registerEngineIpc, engineEnv, DEV_ORIGIN };
