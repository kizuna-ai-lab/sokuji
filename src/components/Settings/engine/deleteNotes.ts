import type { useTranslation } from 'react-i18next';
import type { DirectionResult, Stage } from '../../../lib/local-inference/selection/types';

/** Stage nouns reuse the same chip vocabulary resolutionNotes.ts uses — the
 *  copy cannot drift between "why this note" and "what changes on delete". */
const STAGE_NOUN_KEY: Record<Stage, [string, string]> = {
  asr: ['notes.stageAsr', 'speech recognition'],
  translation: ['notes.stageTranslation', 'translation'],
  tts: ['notes.stageTts', 'speech output'],
};
const STAGES: Stage[] = ['asr', 'translation', 'tts'];

/** One row's delete-preview: which (direction, stage) resolutions the delete
 *  would change, already rendered to a sentence each. */
export function computeDeleteNotes(
  id: string,
  displayName: (id: string) => string,
  directions: Array<{ dir: string }>,
  before: (dir: string) => DirectionResult,
  after: (dir: string) => DirectionResult,
  t: ReturnType<typeof useTranslation>['t'],
): string[] {
  const out: string[] = [];
  for (const { dir } of directions) {
    const beforeResult = before(dir);
    const afterResult = after(dir);
    for (const stage of STAGES) {
      const beforeId = beforeResult[stage]?.modelId ?? null;
      if (beforeId !== id) continue; // this delete doesn't touch this slot
      const afterId = afterResult[stage]?.modelId ?? null;
      const stageNoun = t(STAGE_NOUN_KEY[stage][0], STAGE_NOUN_KEY[stage][1]);
      if (afterId) {
        out.push(t('engineUi.deleteFallsBack', 'Deleting {{name}}: {{stage}} falls back to {{to}}.', {
          name: displayName(id), stage: stageNoun, to: displayName(afterId),
        }));
      } else if (stage !== 'tts') {
        // "sessions cannot start" is only true for the gate's mandatory
        // stages — a missing TTS degrades to subtitles and never blocks, so
        // claiming otherwise here would be false.
        out.push(t('engineUi.deleteNoModel', 'Deleting {{name}}: no {{stage}} model remains — sessions cannot start.', {
          name: displayName(id), stage: stageNoun,
        }));
      }
    }
  }
  return out;
}
