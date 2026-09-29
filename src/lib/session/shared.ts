import type { LanguagePair, SharedSettings } from '../provider/types';

/**
 * What every builder may read beyond its own settings, resolved once per
 * run: the segmentation pauses, which direction is the participant's, and
 * the display segmentation. The participant's direction is the pair's
 * reverse as the provider states it (`reversedPair`; Stage 2 Palabra,
 * ruling 9), null when the pair has none. The system instructions are each
 * provider's own setting (Stage 2 Gemini, ruling 4;
 * `src/lib/provider/instructions.ts`).
 */
export function buildSharedSettings(
  participant: LanguagePair | null,
  pauses: SharedSettings['pauses'],
  segmentation: SharedSettings['segmentation'],
): Omit<SharedSettings, 'models'> {
  return {
    pauses,
    segmentation,
    reversed: (direction) => participant !== null && direction.source === participant.source && direction.target === participant.target,
  };
}
