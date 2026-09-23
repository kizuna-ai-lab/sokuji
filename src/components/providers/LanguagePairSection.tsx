import { ArrowLeftRight, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUTO, normalizePair, swapped } from '../../lib/provider/languages';
import type { AnyProvider, LanguageOption, LanguagePair } from '../../lib/provider/types';

interface LanguagePairSectionProps {
  provider: AnyProvider;
  settings: unknown;
  pair: LanguagePair;
  onChange(pair: LanguagePair): void;
}

/**
 * Any provider's language pair (spec: "Languages are two functions"): the
 * lists are its `sources` and `targets`, and the swap is the generic one,
 * allowed whenever the provider supports the reversed pair. Markup is
 * LanguageSection's translation-languages block.
 */
export function LanguagePairSection({ provider, settings, pair, onChange }: LanguagePairSectionProps) {
  const { t } = useTranslation();
  const sources = provider.languages.sources(settings);
  const targets = provider.languages.targets(pair.source, settings);
  const reversed = swapped(provider, settings, pair);
  const option = (o: LanguageOption) => (
    <option key={o.value} value={o.value}>{o.value === AUTO ? t('common.autoDetect') : o.name}</option>
  );

  return (
    <div className="config-section" id="languages-section">
      <h3>
        <Languages size={18} />
        <span>{t('simpleConfig.translationLanguages')}</span>
      </h3>
      <div className="language-pair-row">
        <div className="language-select-group">
          <label htmlFor="language-pair-source">{t('settings.sourceLanguage')}</label>
          <select
            id="language-pair-source"
            className="language-select"
            value={pair.source}
            onChange={(e) => onChange(normalizePair(provider, settings, { source: e.target.value, target: pair.target }))}
          >
            {sources.map(option)}
          </select>
        </div>
        <div className="language-arrow">
          <button
            type="button"
            className="language-swap-btn"
            onClick={() => reversed && onChange(reversed)}
            disabled={!reversed}
            title={t('simpleConfig.swapLanguages')}
          >
            <ArrowLeftRight size={18} />
          </button>
        </div>
        <div className="language-select-group">
          <label htmlFor="language-pair-target">{t('settings.targetLanguage')}</label>
          <select
            id="language-pair-target"
            className="language-select"
            value={pair.target}
            onChange={(e) => onChange({ source: pair.source, target: e.target.value })}
          >
            {targets.map(option)}
          </select>
        </div>
      </div>
    </div>
  );
}
