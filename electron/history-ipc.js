// electron/history-ipc.js
//
// History's channels for the main window: one `history:*` channel per store method, plus `history:status`,
// `history:save-track` (the system's Save dialog, then a copy of the recording; see history-audio.js) and the file
// recognition of a kept track (`history:recognize`, `-cancel`, `-status`; see file-recognition.js).
// Each answers `{ ok: true, value }` or `{ ok: false, error, code? }` and never throws to the page. A caller that
// is not the main window is refused; a store that could not be opened answers UNAVAILABLE.
//
// Every channel is registered by its own line with its name written out: the IPC registry guard
// (electron/ipc-channels.test.js) finds handlers by that literal text.
'use strict';

const { HistoryError, openHistory } = require('./history-store.js');
const { saveTrackAs } = require('./history-audio.js');
const { createFileRecognizer } = require('./file-recognition.js');

/** Channel → store method. `history:status` is answered here, without the store. */
const HISTORY_CHANNELS = Object.freeze({
  'history:open-record': 'openRecord',
  'history:close-record': 'closeRecord',
  'history:get-record': 'getRecord',
  'history:list-records': 'listRecords',
  'history:rename-record': 'renameRecord',
  'history:put-leg': 'putLeg',
  'history:put-segments': 'putSegments',
  'history:put-notices': 'putNotices',
  'history:get-legs': 'getLegs',
  'history:create-transcript': 'createTranscript',
  'history:delete-transcript': 'deleteTranscript',
  'history:append-sentences': 'appendSentences',
  'history:revise-sentences': 'reviseSentences',
  'history:get-sentences': 'getSentences',
  'history:rename-speaker': 'renameSpeaker',
  'history:reassign-sentence': 'reassignSentence',
  'history:get-speakers': 'getSpeakers',
  'history:save-notes': 'saveNotes',
  'history:list-notes': 'listNotes',
  'history:get-notes': 'getNotes',
  'history:update-notes-names': 'updateNotesNames',
  'history:search': 'search',
  'history:bin-records': 'binRecords',
  'history:restore-records': 'restoreRecords',
  'history:purge-records': 'purgeRecords',
  'history:drop-track': 'dropTrack',
  'history:usage': 'usage',
  'history:append-track': 'appendTrack',
});

/** The methods that take a record id rather than an object: the page sends `{ id }`. */
const BY_ID = new Set(['getRecord', 'getLegs']);

const REFUSED = Object.freeze({ ok: false, error: 'History refused: not the main window' });
const UNAVAILABLE = Object.freeze({ ok: false, error: 'History is not available', code: 'UNAVAILABLE' });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Registers the channels. `getStore()` returns the store or null; `getUnavailableReason()` says why it is null
 * ('newer' for a file from a newer app, 'error' otherwise). `showSaveDialog(options)` is the system's Save dialog
 * over the main window; `getDownloadsDir()` where it opens.
 */
function setupHistoryHandlers({
  ipcMain, getStore, isTrustedSender, dir, getUnavailableReason = () => null, showSaveDialog, getDownloadsDir,
  recognizer = createFileRecognizer(),
}) {
  /** Runs `fn(store, payload)` for the main window and answers with its value or its error. */
  const answer = (fn) => async (event, payload) => {
    if (!isTrustedSender(event.sender)) return REFUSED;
    const store = getStore();
    if (!store) return UNAVAILABLE;
    if (!isPlainObject(payload)) return { ok: false, error: 'History expects an object', code: 'BAD_PAYLOAD' };
    try {
      return { ok: true, value: await fn(store, payload) };
    } catch (error) {
      if (error instanceof HistoryError) return { ok: false, error: error.message, code: error.code };
      return { ok: false, error: error && error.message ? String(error.message) : String(error) };
    }
  };
  const handle = (method) => answer((store, payload) => (BY_ID.has(method) ? store[method](payload.id) : store[method](payload)));

  ipcMain.handle('history:status', async (event) => {
    if (!isTrustedSender(event.sender)) return REFUSED;
    if (getStore()) return { ok: true, value: { available: true, dir } };
    return { ok: true, value: { available: false, reason: getUnavailableReason() || 'error', dir } };
  });
  ipcMain.handle('history:open-record', handle('openRecord'));
  ipcMain.handle('history:close-record', handle('closeRecord'));
  ipcMain.handle('history:get-record', handle('getRecord'));
  ipcMain.handle('history:list-records', handle('listRecords'));
  ipcMain.handle('history:rename-record', handle('renameRecord'));
  ipcMain.handle('history:put-leg', handle('putLeg'));
  ipcMain.handle('history:put-segments', handle('putSegments'));
  ipcMain.handle('history:put-notices', handle('putNotices'));
  ipcMain.handle('history:get-legs', handle('getLegs'));
  ipcMain.handle('history:create-transcript', handle('createTranscript'));
  ipcMain.handle('history:delete-transcript', handle('deleteTranscript'));
  ipcMain.handle('history:append-sentences', handle('appendSentences'));
  ipcMain.handle('history:revise-sentences', handle('reviseSentences'));
  ipcMain.handle('history:get-sentences', handle('getSentences'));
  ipcMain.handle('history:rename-speaker', handle('renameSpeaker'));
  ipcMain.handle('history:reassign-sentence', handle('reassignSentence'));
  ipcMain.handle('history:get-speakers', handle('getSpeakers'));
  ipcMain.handle('history:save-notes', handle('saveNotes'));
  ipcMain.handle('history:list-notes', handle('listNotes'));
  ipcMain.handle('history:get-notes', handle('getNotes'));
  ipcMain.handle('history:update-notes-names', handle('updateNotesNames'));
  ipcMain.handle('history:search', handle('search'));
  ipcMain.handle('history:bin-records', handle('binRecords'));
  ipcMain.handle('history:restore-records', handle('restoreRecords'));
  ipcMain.handle('history:purge-records', handle('purgeRecords'));
  ipcMain.handle('history:drop-track', handle('dropTrack'));
  ipcMain.handle('history:usage', handle('usage'));
  ipcMain.handle('history:append-track', handle('appendTrack'));
  ipcMain.handle('history:save-track', answer((store, payload) => saveTrackAs({
    store,
    showSaveDialog,
    defaultDir: getDownloadsDir(),
    recordId: payload.recordId,
    source: payload.source,
    title: payload.title,
    defaultName: payload.defaultName,
  })));
  // A kept track sent to Soniox's file recognition, with the user's own key or through the Kizuna AI service (its
  // address, the sign-in token, the payer and the length of the record's tracks still to come); the page asks for its
  // phase while it waits.
  ipcMain.handle('history:recognize', answer((store, payload) => recognizer.recognize({
    store,
    recordId: payload.recordId,
    service: payload.service,
    source: payload.source,
    apiKey: payload.apiKey,
    region: payload.region,
    languageHints: payload.languageHints,
    translateTo: payload.translateTo,
    context: payload.context,
    jobId: payload.jobId,
    apiUrl: payload.apiUrl,
    token: payload.token,
    payer: payload.payer,
    laterAudioMs: payload.laterAudioMs,
  })));
  ipcMain.handle('history:recognize-cancel', answer((_store, payload) => recognizer.cancel(payload.jobId)));
  ipcMain.handle('history:recognize-status', answer((_store, payload) => recognizer.status(payload.jobId)));
}

/**
 * Opens the store in `dir` at launch and tidies it: a session the app died during is closed with what it has (or
 * removed when it has nothing), stray folders are reconciled, the bin is emptied of what expired. Only opening can
 * make History unavailable (`unavailable`: 'newer' for a file from a newer app, 'error' otherwise); a clean-up step
 * that fails is logged and the next one still runs.
 */
function openHistoryAtLaunch({ dir, open = openHistory, logger = console }) {
  let store;
  try {
    store = open({ dir });
  } catch (error) {
    logger.error('[Sokuji] [History] Not available:', error);
    return { store: null, unavailable: error && error.code === 'HISTORY_NEWER' ? 'newer' : 'error' };
  }
  const step = (name, fn) => {
    try {
      return fn();
    } catch (error) {
      logger.error(`[Sokuji] [History] At launch, ${name} failed:`, error);
      return null;
    }
  };
  const recovered = step('recovery', () => store.recoverOpenRecords());
  const reconciled = step('reconcile', () => store.reconcile());
  const purged = step('the bin purge', () => store.purgeExpired());
  const counts = [
    recovered && `closed ${recovered.closed.length}, dropped ${recovered.dropped.length}`,
    reconciled && `empty folders removed ${reconciled.removedEmpty.length}, tracks gone ${reconciled.tracksGone}`,
    purged && `purged from the bin ${purged.purged.length}, left ${purged.failed.length}`,
  ].filter(Boolean);
  if (counts.length) logger.log('[Sokuji] [History] At launch:', counts.join('; '));
  if (reconciled && reconciled.strays.length) logger.warn('[Sokuji] [History] Folders without a record, left in place:', reconciled.strays.join(', '));
  return { store, unavailable: null };
}

module.exports = { setupHistoryHandlers, HISTORY_CHANNELS, openHistoryAtLaunch };
