import { useRunParticipantSpeech } from '../../app/useRun';
import { useAnalytics } from '../../lib/analytics';
import type { AnyProvider } from '../../lib/provider/types';
import { speechFromStores } from '../../lib/session/appShape';
import { languageContext } from '../../lib/session/shape';
import useAudioStore, { type AudioMode } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { LanguagePairSection } from './LanguagePairSection';
import { useSelectedProvider } from './useSelectedProvider';

interface ProviderLanguagesProps {
  providers: readonly AnyProvider[];
  /** A run is not idle: both selects and the swap are locked. */
  disabled?: boolean;
  /** The language pair's sentence (ruling 4); the app passes it, the preview does not. */
  sentence?: { mode: AudioMode; textOnly: boolean };
}

/**
 * The selected provider's language pair, offered for the language context
 * the store holds — its legs and whether they speak (Stage 2 Volcengine
 * AST2, choice 1). Tracks each side that changed with today's
 * `language_changed` (ruling 14) before persisting the new pair.
 */
export function ProviderLanguages({ providers, disabled, sentence }: ProviderLanguagesProps) {
  const { trackEvent } = useAnalytics();
  const selection = useSelectedProvider(providers);
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
  if (!selection?.entry) return null;
  const { provider, entry } = selection;
  const { setPair } = useProviderStore.getState();

  return (
    <LanguagePairSection
      provider={provider}
      settings={entry.settings}
      pair={entry.pair}
      disabled={disabled}
      sentence={sentence && { ...sentence, participantSpeaks: runSpeech !== false && speechFromStores(provider).them }}
      context={languageContext(provider, legs, speech)}
      onChange={(pair) => {
        if (pair.source !== entry.pair.source) trackEvent('language_changed', { to_language: pair.source, language_type: 'source' });
        if (pair.target !== entry.pair.target) trackEvent('language_changed', { to_language: pair.target, language_type: 'target' });
        setPair(provider, pair);
      }}
    />
  );
}
