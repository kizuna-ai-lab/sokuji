// src/components/SetupWizard/languageSentence.ts
//
// Which sentence the language pair reads as, for every surface that prints it:
// the wizard's pair step, the wizard's summary, and Settings' language section.
// One implementation, because the three used to state the same session in three
// hand-written copies and only the newest one was ever corrected.
//
// Keys rather than text: this module stays free of i18n so it is testable as
// data, and its caller decides the fallbacks.

export interface SentenceLabel { key: string; fallback: string }

export type SentenceMode = 'speaker' | 'participant' | 'both';
export type TextOnlyCapability = 'always' | 'optional' | 'never';

export interface PairSentenceInput {
  mode: SentenceMode;
  /** What the caller has already resolved for the speaker leg: the scenario's
   *  preset in the wizard, `effectiveTextOnly(...)` in Settings. Consulted only
   *  when the provider leaves the choice open. */
  textOnly: boolean;
  capability: TextOnlyCapability;
  /** The pair as it stands. 'auto' is a source the mirror cannot name, and a
   *  half-filled pair has nothing to mirror yet. */
  source: string | null;
  target: string | null;
}

export interface PairSentence {
  /** Labels the source select: what the user contributes to the forward leg. */
  my: SentenceLabel;
  /** Labels the target select: what the other side gets out of it. */
  their: SentenceLabel;
  /** 'both' runs a mirrored second leg. No surface has controls for it, so
   *  they all state it — and all fall silent on a pair that cannot be named. */
  showMirror: boolean;
}

export function pairSentence({ mode, textOnly, capability, source, target }: PairSentenceInput): PairSentence {
  const speakerLegTextOnly = capability === 'always' ? true
    : capability === 'never' ? false
    : textOnly;
  return {
    my: mode === 'participant'
      ? { key: 'settings.langSentence.iRead', fallback: 'I read' }
      : { key: 'settings.langSentence.iSpeak', fallback: 'I speak' },
    their: mode === 'participant'
      ? { key: 'settings.langSentence.theySpeak', fallback: 'they speak' }
      : speakerLegTextOnly
        ? { key: 'settings.langSentence.theyRead', fallback: 'they read' }
        : { key: 'settings.langSentence.theyHear', fallback: 'they hear' },
    showMirror: mode === 'both' && !!source && source !== 'auto' && !!target,
  };
}
