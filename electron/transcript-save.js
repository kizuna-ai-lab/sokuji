// electron/transcript-save.js
//
// Writes a session-end auto-save transcript into a directory — the user's
// Downloads folder in production. The renderer supplies only the text: the
// name is generated here, so a renderer cannot choose where a file lands.
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');

/** "YYYYMMDD-HHMMSS" in local time — the stamp the manual export uses too. */
function timestamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Enough for any burst of sessions ending within one second.
const MAX_SUFFIX = 99;

/**
 * Write `content` as sokuji-conversation-<stamp>.txt in `dir`, adding " (1)",
 * " (2)", … when that name is taken. Exclusive create, so it never overwrites.
 * Resolves { ok: true, path, dir } or { ok: false, error }; never rejects.
 */
async function saveTranscript({ dir, content, now = new Date() }) {
  if (typeof content !== 'string') {
    return { ok: false, error: 'Transcript content must be a string' };
  }
  const base = `sokuji-conversation-${timestamp(now)}`;
  for (let n = 0; n <= MAX_SUFFIX; n += 1) {
    const name = n === 0 ? `${base}.txt` : `${base} (${n}).txt`;
    const filePath = path.join(dir, name);
    try {
      await fs.promises.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
      return { ok: true, path: filePath, dir };
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }
  return { ok: false, error: `Too many transcripts named ${base}` };
}

/**
 * Register the renderer's `transcript:save` channel. Call once, at startup.
 * `isTrustedSender(webContents)` answers whether a call comes from the main
 * window's page: a popover child window shares its preload bridge, and must
 * not be able to write into Downloads.
 */
function setupTranscriptSaveHandler({ ipcMain, getDownloadsDir, isTrustedSender }) {
  ipcMain.handle('transcript:save', async (event, payload) => {
    if (!isTrustedSender(event.sender)) {
      return { ok: false, error: 'Transcript save refused: not the main window' };
    }
    return saveTranscript({ dir: getDownloadsDir(), content: payload && payload.content });
  });
}

module.exports = { saveTranscript, setupTranscriptSaveHandler };
