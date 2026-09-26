import { ArrowLeftRight, Languages } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../Tooltip/Tooltip';
import { pairSentence } from '../SetupWizard/languageSentence';
import { AUTO, normalizePair, swapped } from '../../lib/provider/languages';
import type { AnyProvider, LanguageOption, LanguagePair } from '../../lib/provider/types';
import type { AudioMode } from '../../stores/audioStore';
import { effectiveTextOnly } from '../../utils/effectiveTextOnly';

interface LanguagePairSectionProps {
  provider: AnyProvider;
  settings: unknown;
  pair: LanguagePair;
  onChange(pair: LanguagePair): void;
  disabled?: boolean;
  /**
   * Today's sentence (ruling 4): "I speak / they hear", or the mode-aware
   * labels `pairSentence` returns, plus the "both" mirror line. Absent: the
   * plain `settings.sourceLanguage` / `settings.targetLanguage` labels.
   */
  sentence?: { mode: AudioMode; textOnly: boolean };
}

/**
 * Any provider's language pair (spec: "Languages are two functions"): the
 * lists are its `sources` and `targets`, and the swap is the generic one,
 * allowed whenever the provider supports the reversed pair. Markup is
 * LanguageSection's translation-languages block.
 */
export function LanguagePairSection({ provider, settings, pair, onChange, disabled, sentence }: LanguagePairSectionProps) {
  const { t } = useTranslation();
  const id = useId();
  const sources = provider.languages.sources(settings);
  const targets = provider.languages.targets(pair.source, settings);
  const reversed = swapped(provider, settings, pair);
  const option = (o: LanguageOption) => (
    <option key={o.value} value={o.value}>{o.value === AUTO ? t('common.autoDetect') : o.name}</option>
  );

  // The capability maps the definition's `speech` onto the sentence's
  // text-only capability: a provider that always speaks is never text-only,
  // one that never speaks is always text-only, and 'optional' honours the toggle.
  const resolved = sentence && pairSentence({
    mode: sentence.mode,
    textOnly: effectiveTextOnly({ speakerLegRuns: sentence.mode !== 'participant', textOnly: sentence.textOnly }),
    capability: provider.speech === 'always' ? 'never' : provider.speech === 'never' ? 'always' : 'optional',
    source: pair.source,
    target: pair.target,
  });
  const sourceLabel = resolved ? t(resolved.my.key, resolved.my.fallback) : t('settings.sourceLanguage');
  const targetLabel = resolved ? t(resolved.their.key, resolved.their.fallback) : t('settings.targetLanguage');
  const sourceLanguageName = sources.find((o) => o.value === pair.source)?.name ?? pair.source;
  const targetLanguageName = targets.find((o) => o.value === pair.target)?.name ?? pair.target;

  return (
    <div className="config-section" id="languages-section">
      <h3>
        <Languages size={18} />
        <span>{t('simpleConfig.translationLanguages')}</span>
        <Tooltip
          content={t('simpleConfig.translationLanguagesDesc')}
          position="top"
          icon="help"
        />
      </h3>
      <div className="language-pair-row">
        <div className="language-select-group">
          <label htmlFor={`${id}-source`}>{sourceLabel}</label>
          <select
            id={`${id}-source`}
            className="language-select"
            value={pair.source}
            onChange={(e) => onChange(normalizePair(provider, settings, { source: e.target.value, target: pair.target }))}
            disabled={disabled}
          >
            {sources.map(option)}
          </select>
        </div>
        <div className="language-arrow">
          <button
            type="button"
            className="language-swap-btn"
            onClick={() => reversed && onChange(reversed)}
            disabled={disabled || !reversed}
            title={t('simpleConfig.swapLanguages')}
          >
            <ArrowLeftRight size={18} />
          </button>
        </div>
        <div className="language-select-group">
          <label htmlFor={`${id}-target`}>{targetLabel}</label>
          <select
            id={`${id}-target`}
            className="language-select"
            value={pair.target}
            onChange={(e) => onChange({ source: pair.source, target: e.target.value })}
            disabled={disabled}
          >
            {targets.map(option)}
          </select>
        </div>
      </div>
      {resolved?.showMirror && (
        <div className="language-mirror-line" data-testid="language-mirror-line">
          {t('settings.langSentence.mirror', 'They speak {{their}} → I read {{mine}}', {
            their: targetLanguageName,
            mine: sourceLanguageName,
          })}
        </div>
      )}
    </div>
  );
}
