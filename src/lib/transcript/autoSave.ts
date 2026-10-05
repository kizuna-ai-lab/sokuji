import i18n from '../../locales';
import { isElectron } from '../../utils/environment';
import { reportError, describeCause } from '../diagnostics/report';
import { downloadFile } from '../../utils/conversationExport';
import { PANEL_NOTE_CODES, type PanelNoteInput } from '../../stores/panelNotesStore';

/** Where the save's result goes: a panel note, drawn after the conversation (spec 2026-10-05 §5). */
export interface AutoSaveNotifier {
  note(input: PanelNoteInput): void;
}

/** What happened. The user has already been told whatever they need to know. */
export type AutoSaveOutcome = 'disabled' | 'empty' | 'saved' | 'failed';

/** A failed save, reported and told to the user with the way to save by hand. */
export function saveFailed(error: unknown, notify: AutoSaveNotifier): 'failed' {
  reportError('AutoSave', `Failed to auto-save the conversation: ${describeCause(error)}`, { cause: error });
  notify.note({
    severity: 'warning',
    code: PANEL_NOTE_CODES.autoSaveFailed,
    message: "Couldn't auto-save the conversation.",
    // The way out is the export menu's own item, named as that locale names it.
    params: { action: i18n.t('mainPanel.export.downloadTxt', { defaultValue: 'Download as .txt' }) },
  });
  return 'failed';
}

/**
 * Saves a finished conversation's text: on Electron through the main process
 * into Downloads, with a note that can show the folder; in a browser as a
 * download, whose own UI is the confirmation. Never rejects.
 */
export async function saveTranscriptText(content: string, filename: string, notify: AutoSaveNotifier): Promise<'saved' | 'failed'> {
  try {
    if (!isElectron()) {
      // The browser's own download UI is the confirmation. The page cannot
      // tell whether Chrome's download limiter let the file through, so a
      // "saved" note here could be false.
      downloadFile(content, filename, 'text/plain;charset=utf-8');
      return 'saved';
    }

    const result = await window.electron.invoke('transcript:save', { content });
    if (!result?.ok) {
      throw new Error(result?.error ?? 'The main process did not save the transcript');
    }
    const savedName: string = String(result.path).split(/[\\/]/).pop() ?? String(result.path);
    // Not transient: the file's name is the one thing the user may want to find again.
    notify.note({
      severity: 'info',
      code: PANEL_NOTE_CODES.autoSaveSaved,
      message: `Conversation saved: ${savedName}`,
      params: { filename: savedName },
      action: { kind: 'show-in-folder', dir: String(result.dir) },
    });
    return 'saved';
  } catch (error) {
    return saveFailed(error, notify);
  }
}
