// src/components/SetupWizard/languageSentence.ts
//
// Which sentence the wizard prints over the language pair, as keys. The same
// sentence Settings prints (LanguageSection.tsx:479-491) — one vocabulary for
// the two surfaces — and the same rule for who speaks: the scenario asks, the
// provider's capability decides, because a provider that always speaks would
// make "they read" a lie.
//
// Keys, not text: this module stays free of i18n so it can be tested as data.
import type { ScenarioMode } from '../../lib/setup/scenarios';

export interface SentenceLabel { key: string; fallback: string }

export interface PairSentence {
  /** Labels the source select: what the user contributes to the forward leg. */
  my: SentenceLabel;
  /** Labels the target select: what the other side gets out of it. */
  their: SentenceLabel;
  /** 'both' runs a mirrored second leg. Neither surface has controls for it,
   *  so both state it as a sentence instead (Settings does the same). */
  showMirror: boolean;
}

export type TextOnlyCapability = 'always' | 'optional' | 'never';

export function pairSentence(
  mode: ScenarioMode,
  presetTextOnly: boolean,
  capability: TextOnlyCapability,
): PairSentence {
  const speakerLegTextOnly = capability === 'always' ? true
    : capability === 'never' ? false
    : presetTextOnly;
  return {
    my: mode === 'participant'
      ? { key: 'settings.langSentence.iRead', fallback: 'I read' }
      : { key: 'settings.langSentence.iSpeak', fallback: 'I speak' },
    their: mode === 'participant'
      ? { key: 'settings.langSentence.theySpeak', fallback: 'they speak' }
      : speakerLegTextOnly
        ? { key: 'settings.langSentence.theyRead', fallback: 'they read' }
        : { key: 'settings.langSentence.theyHear', fallback: 'they hear' },
    showMirror: mode === 'both',
  };
}
