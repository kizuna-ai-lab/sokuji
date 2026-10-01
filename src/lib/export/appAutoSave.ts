/**
 * The session-end auto-save over the new conversation (plan 1d-3): the
 * runner's `onRunEnded` hands over the legs, and the whole conversation —
 * both sides, every leg, header first — goes through today's saving branch.
 * The Export menu's scope never applies here, as today.
 */
import useSettingsStore from '../../stores/settingsStore';
import i18n from '../../locales';
import { exportFilename, getAppVersion } from '../../utils/conversationExport';
import type { Leg } from '../conversation/types';
import { createProjector, DEFAULT_PROJECTION } from '../projection/project';
import type { ConversationInfo } from '../session/conversationSet';
import { saveFailed, saveTranscriptText, type AutoSaveNotifier, type AutoSaveOutcome } from '../transcript/autoSave';
import { conversationExporter, exportWords } from './exporter';
import { FULL_SCOPE } from './transcript';

export async function autoSaveConversation(
  legs: readonly Leg[],
  info: ConversationInfo | null,
  notify: AutoSaveNotifier,
  now: () => number = Date.now,
): Promise<AutoSaveOutcome> {
  let content: string;
  try {
    if (!useSettingsStore.getState().autoSaveOnStop) return 'disabled';
    const exporter = conversationExporter({
      // The export writes each segment whole, so the stored cut never reaches
      // it: the default projection groups exactly as the app's does.
      entries: createProjector().project(legs, DEFAULT_PROJECTION),
      legs,
      info,
      words: exportWords((key, defaultValue) => i18n.t(key, { defaultValue })),
      appVersion: getAppVersion(),
      now,
    });
    if (!exporter.hasContent) return 'empty';
    content = exporter.text(FULL_SCOPE, true);
  } catch (error) {
    return saveFailed(error, notify);
  }
  return saveTranscriptText(content, exportFilename('txt', now()), notify);
}
