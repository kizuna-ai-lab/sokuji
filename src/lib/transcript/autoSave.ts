import i18n from '../../locales';
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
 * Saves a finished conversation's text as a download (the browser extension's
 * session-end auto-save), whose own UI is the confirmation. Never rejects.
 */
export async function saveTranscriptText(content: string, filename: string, notify: AutoSaveNotifier): Promise<'saved' | 'failed'> {
  try {
    // The page cannot tell whether Chrome's download limiter let the file
    // through, so a "saved" note here could be false.
    downloadFile(content, filename, 'text/plain;charset=utf-8');
    return 'saved';
  } catch (error) {
    return saveFailed(error, notify);
  }
}
