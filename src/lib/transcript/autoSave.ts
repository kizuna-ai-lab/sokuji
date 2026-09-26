import i18n from '../../locales';
import { isElectron } from '../../utils/environment';
import { reportError, describeCause } from '../diagnostics/report';
import { downloadFile } from '../../utils/conversationExport';

/** The slice of the toast API this needs; `useToast().showToast` fits it. */
export interface AutoSaveNotifier {
  showToast: (
    text: string,
    opts?: {
      variant?: 'success' | 'error';
      durationMs?: number;
      action?: { label: string; onClick: () => void };
    },
  ) => void;
}

/** What happened. The user has already been told whatever they need to know. */
export type AutoSaveOutcome = 'disabled' | 'empty' | 'saved' | 'failed';

const SAVED_TOAST_MS = 6000;
const FAILED_TOAST_MS = 8000;

/** A failed save, reported and told to the user with the way to save by hand. */
export function saveFailed(error: unknown, notify: AutoSaveNotifier): 'failed' {
  reportError('AutoSave', `Failed to auto-save the conversation: ${describeCause(error)}`, { cause: error });
  notify.showToast(
    i18n.t('mainPanel.export.autoSave.failed', {
      defaultValue: "Couldn't auto-save the conversation. You can still save it with “{{action}}” in the export menu.",
      action: i18n.t('mainPanel.export.downloadTxt', { defaultValue: 'Download as .txt' }),
    }),
    { variant: 'error', durationMs: FAILED_TOAST_MS },
  );
  return 'failed';
}

/**
 * Saves a finished conversation's text: on Electron through the main process
 * into Downloads, with a toast that can show the folder; in a browser as a
 * download, whose own UI is the confirmation. Never rejects.
 */
export async function saveTranscriptText(content: string, filename: string, notify: AutoSaveNotifier): Promise<'saved' | 'failed'> {
  try {
    if (!isElectron()) {
      // The browser's own download UI is the confirmation. The page cannot
      // tell whether Chrome's download limiter let the file through, so a
      // "saved" toast here could be false.
      downloadFile(content, filename, 'text/plain;charset=utf-8');
      return 'saved';
    }

    const result = await window.electron.invoke('transcript:save', { content });
    if (!result?.ok) {
      throw new Error(result?.error ?? 'The main process did not save the transcript');
    }
    const savedName: string = String(result.path).split(/[\\/]/).pop() ?? String(result.path);
    notify.showToast(
      i18n.t('mainPanel.export.autoSave.saved', {
        defaultValue: 'Conversation saved: {{filename}}',
        filename: savedName,
      }),
      {
        variant: 'success',
        durationMs: SAVED_TOAST_MS,
        action: {
          label: i18n.t('mainPanel.export.autoSave.showInFolder', { defaultValue: 'Show in folder' }),
          onClick: () => { void window.electron.invoke('open-directory', result.dir); },
        },
      },
    );
    return 'saved';
  } catch (error) {
    return saveFailed(error, notify);
  }
}
