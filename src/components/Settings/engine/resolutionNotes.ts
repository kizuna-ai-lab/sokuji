import type { TFunction } from 'i18next';
import type { ResolutionNote, Stage } from '../../../lib/local-inference/selection/types';

/** Stage nouns reuse the chip vocabulary so the copy cannot drift per surface. */
const stageKey: Record<Stage, [string, string]> = {
  asr: ['notes.stageAsr', 'speech recognition'],
  translation: ['notes.stageTranslation', 'translation'],
  tts: ['notes.stageTts', 'speech output'],
};

/**
 * One ResolutionNote → one user-facing sentence. Pure: the caller supplies
 * t() and a displayName lookup (WASM manifest names vs native catalog names
 * differ, so the mapping cannot live here).
 */
export function describeResolutionNote(
  note: ResolutionNote,
  t: TFunction,
  displayName: (id: string) => string,
): string {
  const from = note.from ? displayName(note.from) : '';
  const to = note.to ? displayName(note.to) : '';
  const stage = t(stageKey[note.stage][0], stageKey[note.stage][1]);

  switch (note.reason) {
    case 'not-downloaded':
      return note.to
        ? t('notes.notDownloadedWithSub', '{{from}} is not downloaded — using {{to}} instead. Download it again to use it.', { from, to })
        : t('notes.notDownloaded', '{{from}} is not downloaded. Download it again to use it.', { from });
    case 'lang-incompatible':
      return note.to
        ? t('notes.langIncompatibleWithSub', '{{from}} does not support this direction — using {{to}} instead. It returns when the direction does.', { from, to })
        : t('notes.langIncompatible', '{{from}} does not support this direction. It returns when the direction does.', { from });
    case 'hardware-gated':
      return note.to
        ? t('notes.hardwareGatedWithSub', '{{from}} cannot run on this device — using {{to}} instead.', { from, to })
        : t('notes.hardwareGated', '{{from}} cannot run on this device.', { from });
    case 'needs-key':
      return t('notes.needsKey', '{{from}} needs a signed-in account to use.', { from });
    case 'not-in-catalog':
      return t('notes.notInCatalog', '{{from}} is no longer available in this version.', { from });
    case 'no-candidate':
      return t('notes.noCandidate', 'No {{stage}} model is available for this direction.', { stage });
  }
}
