import { useRunParticipantSpeech } from '../../app/useRun';
import { useMemo } from 'react';
import { useAnalytics } from '../../lib/analytics';
import { usePlan, useStageUnit } from '../../lib/plan/fromStores';
import type { AnyProvider } from '../../lib/provider/types';
import { speechFromStores } from '../../lib/session/appShape';
import { languageContext, legSpeaks, planLanguages } from '../../lib/session/shape';
import useAudioStore, { type AudioMode } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { LanguagePairSection, type ReceiveChoices, type SpokenBy } from './LanguagePairSection';
import { useProviderEntry, useStageProvider } from './useProviderEntry';

interface ProviderLanguagesProps {
  providers: readonly AnyProvider[];
  /** A run is not idle: both selects and the swap are locked. */
  disabled?: boolean;
  /** The language pair's sentence (ruling 4); the app passes it, the preview does not. */
  sentence?: { mode: AudioMode; textOnly: boolean };
  /** False: the pair without its own heading (the settings page, where the page names it). */
  heading?: boolean;
  /** The sentence's "hear / read" words as choices (the line-up page); see `LanguagePairSection`. */
  receive?: ReceiveChoices;
}

/**
 * The run's language pair, offered by the plan: the sources and the reverse
 * of a pair from the provider whose unit transcribes, the targets from the
 * one whose unit translates, for the language context the store holds —
 * its legs and whether the speech unit speaks them (Stage 2 Volcengine AST2,
 * choice 1). Each of the two is told it speaks only when it is the provider
 * whose unit serves speech (`planLanguages`): read by another provider's
 * voice, it offers what it offers as text. A leg that is read aloud by a voice that says what it reads is
 * offered only the languages that voice reads; a leg that is not read aloud,
 * every language. The pair itself is never changed for the voice: one it
 * does not read stays, and the line-up says so.
 * Tracks each side that changed with today's
 * `language_changed` (ruling 14) before persisting the new pair.
 * `providers` must be the offered list (`presentProviders()`): until the
 * plan is ready, the provider shown is looked up in it.
 */
export function ProviderLanguages({ providers, disabled, sentence, heading, receive }: ProviderLanguagesProps) {
  const { trackEvent } = useAnalytics();
  // The transcription unit's provider, with its entry; until the plan is ready, the provider the line-up names for
  // transcription, so that its entry loads.
  const transcription = useStageUnit('transcription');
  const speechUnit = useStageUnit('speech');
  const transcribing = useStageProvider(providers, 'transcription');
  const selection = useProviderEntry(transcription?.provider ?? transcribing);
  const legs = useProviderStore((st) => st.legs);
  const speech = useProviderStore((st) => st.speech);
  // What `speechFromStores` reads for Translation I hear, subscribed so "I hear" follows the switch, the mode and the source.
  useRoutingStore((st) => st.participantSpeech);
  useAudioStore((st) => st.mode);
  useAudioStore((st) => st.otherSide);
  useAudioStore((st) => st.selectedParticipantSource?.deviceId);
  useAudioStore((st) => st.participantCaptureWidened);
  // As the Speech block reads it: a run that speaks the other side follows the switch live (#595), one that does not stays off.
  const runSpeech = useRunParticipantSpeech();
  const found = usePlan();
  // The plan's languages, each list from the provider that answers it.
  const offer = useMemo(() => (found.state === 'ready' ? planLanguages(found) : null), [found]);
  const voice = speechUnit?.capabilities;
  // What the voice reads, for each leg a start would open and read aloud. A unit that does not say reads whatever
  // its provider translates into. Asked on the capabilities themselves: a unit may read them through `this`.
  const spoken = useMemo((): SpokenBy | undefined => {
    if (!voice?.speaks) return undefined;
    const reads = (language: string) => voice.speaks!(language);
    const by: SpokenBy = {};
    if (legs.includes('speaker') && legSpeaks(voice, 'speaker', speech)) by.speaker = reads;
    if (legs.includes('participant') && legSpeaks(voice, 'participant', speech)) by.participant = reads;
    return by;
  }, [voice, legs, speech]);
  const shownProvider = selection?.provider;
  const shown = useMemo(
    () => (shownProvider && offer ? ({ ...shownProvider, ...offer } as typeof shownProvider) : shownProvider),
    [shownProvider, offer],
  );
  if (!transcription || !speechUnit || !selection?.entry || !shown) return null;
  const { provider, entry } = selection;
  const speaking = speechUnit.capabilities;
  const { setPair } = useProviderStore.getState();

  return (
    <LanguagePairSection
      provider={shown}
      settings={entry.settings}
      speech={speaking.speech}
      spoken={spoken}
      pair={entry.pair}
      disabled={disabled}
      heading={heading}
      receive={receive}
      sentence={sentence && { ...sentence, participantSpeaks: runSpeech !== false && speechFromStores(speaking).them }}
      context={languageContext(speaking, legs, speech)}
      reverseContext={{ speech: legSpeaks(speaking, 'participant', speech) }}
      onChange={(pair) => {
        if (pair.source !== entry.pair.source) trackEvent('language_changed', { to_language: pair.source, language_type: 'source' });
        if (pair.target !== entry.pair.target) trackEvent('language_changed', { to_language: pair.target, language_type: 'target' });
        setPair(provider, pair);
      }}
    />
  );
}
