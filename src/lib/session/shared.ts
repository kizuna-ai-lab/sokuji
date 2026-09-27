import type { LanguagePair, SharedSettings } from '../provider/types';

/**
 * What every builder may read beyond its own settings, resolved once per
 * run: the segmentation pauses, which direction is the participant's, and
 * the display segmentation. The system instructions are each provider's
 * own setting (Stage 2 Gemini, ruling 4; `src/lib/provider/instructions.ts`).
 */
export function buildSharedSettings(
  pair: LanguagePair,
  pauses: SharedSettings['pauses'],
  segmentation: SharedSettings['segmentation'],
): Omit<SharedSettings, 'models'> {
  return {
    pauses,
    segmentation,
    reversed: (direction) => direction.source === pair.target && direction.target === pair.source,
  };
}
