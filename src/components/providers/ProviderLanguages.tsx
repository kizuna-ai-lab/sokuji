import { useAnalytics } from '../../lib/analytics';
import type { AnyProvider } from '../../lib/provider/types';
import type { AudioMode } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
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
 * The selected provider's language pair. Tracks each side that changed with
 * today's `language_changed` (ruling 14) before persisting the new pair.
 */
export function ProviderLanguages({ providers, disabled, sentence }: ProviderLanguagesProps) {
  const { trackEvent } = useAnalytics();
  const selection = useSelectedProvider(providers);
  if (!selection?.entry) return null;
  const { provider, entry } = selection;
  const { setPair } = useProviderStore.getState();

  return (
    <LanguagePairSection
      provider={provider}
      settings={entry.settings}
      pair={entry.pair}
      disabled={disabled}
      sentence={sentence}
      onChange={(pair) => {
        if (pair.source !== entry.pair.source) trackEvent('language_changed', { to_language: pair.source, language_type: 'source' });
        if (pair.target !== entry.pair.target) trackEvent('language_changed', { to_language: pair.target, language_type: 'target' });
        setPair(provider, pair);
      }}
    />
  );
}
