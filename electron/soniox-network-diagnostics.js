// Opt-in transport facts only. Never retain a webRequest details object: it
// can contain credentials, upload data and arbitrary URLs.
function createSonioxNetworkDiagnostics({ backendUrl, now = () => performance.now(), timestamp = () => Date.now() }) {
  const root = new URL(backendUrl);
  const apiPath = `${root.pathname.replace(/\/$/, '')}/api/soniox/session-key`;
  const pending = new Map();
  let owner = null;
  let detach = () => {};

  const stageOf = (details) => {
    if (!owner || details.webContentsId !== owner.id || details.method !== 'POST') return null;
    try {
      const url = new URL(details.url);
      if (url.origin !== root.origin || url.username || url.password) return null;
      if (url.pathname === apiPath) return 'initial';
      if (url.pathname === `${apiPath}/reissue`) return 'reissue';
    } catch { /* An invalid URL is never diagnostic data. */ }
    return null;
  };
  const emit = (data) => {
    if (!owner) return;
    try {
      if (!owner.isDestroyed()) owner.send('soniox-network:event', data);
    } catch {
      // A renderer going away must never prevent Better Auth's callback.
      setEnabled(null, false);
    }
  };
  const setEnabled = (sender, enabled) => {
    detach();
    pending.clear();
    owner = enabled === true ? sender : null;
    detach = () => {};
    if (owner) {
      const clear = () => setEnabled(sender, false);
      sender.once('destroyed', clear);
      sender.once('render-process-gone', clear);
      const navigating = (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) clear();
      };
      sender.on('did-start-navigation', navigating);
      detach = () => {
        sender.removeListener('destroyed', clear);
        sender.removeListener('render-process-gone', clear);
        sender.removeListener('did-start-navigation', navigating);
      };
    }
  };
  const beforeRequest = (details) => {
    const stage = stageOf(details);
    if (!stage || !Number.isSafeInteger(details.id)) {
      // Redirects reuse the request id. Stop tracking before following a URL
      // outside the session service, without keeping that destination.
      pending.delete(details.id);
      return;
    }
    const started = now();
    // A stalled request or a renderer crash must never grow this map forever.
    for (const [id, record] of pending) if (started - record.started > 60_000) pending.delete(id);
    if (pending.size >= 128) pending.delete(pending.keys().next().value);
    const data = {
      requestId: details.id, stage,
      path: stage === 'initial' ? '/api/soniox/session-key' : '/api/soniox/session-key/reissue',
      timestamp: timestamp(),
    };
    pending.set(details.id, { started, data });
    emit({ ...data, phase: 'started', durationMs: 0 });
  };
  const headersReceived = (details) => {
    const record = pending.get(details.id);
    if (!record || !stageOf(details)) return;
    if (Number.isInteger(details.statusCode) && details.statusCode >= 100 && details.statusCode <= 599) {
      record.data.status = details.statusCode;
    }
    const headers = details.responseHeaders ?? {};
    const key = Object.keys(headers).find((name) => name.toLowerCase() === 'cf-ray');
    const value = key && headers[key];
    const ray = Array.isArray(value) ? value[0] : value;
    if (typeof ray === 'string' && /^[a-f0-9]{16,32}-[a-z]{3}$/i.test(ray)) record.data.cfRay = ray;
  };
  const finish = (details, phase) => {
    const record = pending.get(details.id);
    if (!record) return;
    if (!stageOf(details)) {
      pending.delete(details.id);
      return;
    }
    // Some Chromium paths put response headers only on the terminal event.
    headersReceived(details);
    pending.delete(details.id);
    const error = typeof details.error === 'string' && /^net::ERR_[A-Z0-9_]{1,80}$/.test(details.error)
      ? details.error : undefined;
    emit({ ...record.data, phase, durationMs: Math.max(0, Math.round(now() - record.started)), ...(error ? { chromiumError: error } : {}) });
  };
  return { setEnabled, beforeRequest, headersReceived, completed: (details) => finish(details, 'completed'), errorOccurred: (details) => finish(details, 'error') };
}

function registerSonioxNetworkDiagnostics({ ipcMain, webRequest, backendUrl, getMainWindow }) {
  const diagnostics = createSonioxNetworkDiagnostics({ backendUrl });
  ipcMain.handle('soniox-network:set-enabled', (event, enabled) => {
    if (event.sender !== getMainWindow()?.webContents) return;
    diagnostics.setEnabled(event.sender, enabled);
  });
  // beforeRequest and headersReceived are called by Better Auth's existing
  // listeners. Electron permits only one listener for each webRequest event.
  const filter = { urls: [`${backendUrl.replace(/\/$/, '')}/*`] };
  webRequest.onCompleted(filter, diagnostics.completed);
  webRequest.onErrorOccurred(filter, diagnostics.errorOccurred);
  return diagnostics;
}

module.exports = { createSonioxNetworkDiagnostics, registerSonioxNetworkDiagnostics };
