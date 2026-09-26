import type { LanguageOption, LanguagePair, Provider, SharedSettings } from '../provider/types';

/** The settings today's `getProcessedSystemInstructions` reads. */
export interface InstructionSettings {
  useTemplateMode: boolean;
  templateSystemInstructions: string;
  systemInstructions: string;
  participantSystemInstructions: string;
}

/**
 * What every builder may read beyond its own settings, resolved once per run.
 * Instructions follow today's `getProcessedSystemInstructions`: in template
 * mode, the template with the direction's English language names; otherwise
 * the user's prompt for the speaker's direction and, for the reverse, the
 * participant prompt or — when blank — the user's.
 */
export function buildSharedSettings<S>(
  p: Pick<Provider<S, never, never>, 'languages'>,
  s: S,
  pair: LanguagePair,
  instructions: InstructionSettings,
  pauses: SharedSettings['pauses'],
  segmentation: SharedSettings['segmentation'],
): Omit<SharedSettings, 'models'> {
  const name = (code: string, options: readonly LanguageOption[]) => options.find((o) => o.value === code)?.englishName || code;
  return {
    pauses,
    segmentation,
    reversed: (direction) => direction.source === pair.target && direction.target === pair.source,
    instructions(direction) {
      if (instructions.useTemplateMode) {
        const source = name(direction.source, p.languages.sources(s));
        const target = name(direction.target, p.languages.targets(direction.source, s));
        return instructions.templateSystemInstructions
          .replace(/\{\{SOURCE_LANGUAGE\}\}/g, source)
          .replace(/\{\{TARGET_LANGUAGE\}\}/g, target);
      }
      const speakers = direction.source === pair.source && direction.target === pair.target;
      return speakers ? instructions.systemInstructions : instructions.participantSystemInstructions.trim() || instructions.systemInstructions;
    },
  };
}
