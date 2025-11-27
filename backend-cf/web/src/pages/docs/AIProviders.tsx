/**
 * AI Providers Page
 *
 * List of supported AI providers for translation.
 */

import { Link } from 'react-router-dom';
import { ExternalLink, BookOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

interface Provider {
  key: string;
  docsUrl: string;
  tutorialPath?: string;
  isCompatible?: boolean;
}

const providers: Provider[] = [
  { key: 'openai', docsUrl: 'https://platform.openai.com', tutorialPath: '/docs/tutorials/openai-setup' },
  { key: 'gemini', docsUrl: 'https://aistudio.google.com', tutorialPath: '/docs/tutorials/gemini-setup' },
  { key: 'palabra', docsUrl: 'https://palabra.ai', tutorialPath: '/docs/tutorials/palabraai-setup' },
  { key: 'comet', docsUrl: 'https://cometapi.ai', tutorialPath: '/docs/tutorials/cometapi-setup', isCompatible: true },
];

export function AIProviders() {
  const { t } = useI18n();

  return (
    <div className="docs-content providers-page">
      <h1>{t('providers.title')}</h1>
      <p>{t('providers.subtitle')}</p>

      <div className="providers-page__info-box">
        <h3>{t('providers.setup.title')}</h3>
        <p>{t('providers.setup.desc')}</p>
      </div>

      <div className="providers-page__grid">
        {providers.map((provider) => {
          const features = t(`providers.${provider.key}.features`).split('|');

          return (
            <div key={provider.key} className="providers-page__card">
              <h3>{t(`providers.${provider.key}.name`)}</h3>
              <div className="providers-page__type">
                {t(`providers.${provider.key}.type`)}
              </div>

              {provider.isCompatible && (
                <div className="providers-page__compatible">
                  {t(`providers.${provider.key}.compatible`)}
                </div>
              )}

              <ul className="providers-page__features">
                {features.map((feature, index) => (
                  <li key={index}>{feature}</li>
                ))}
              </ul>

              <div className="providers-page__actions">
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="providers-page__btn providers-page__btn--primary"
                >
                  {t('providers.docs')}
                  <ExternalLink size={14} />
                </a>
                {provider.tutorialPath && (
                  <Link to={provider.tutorialPath} className="providers-page__btn providers-page__btn--secondary">
                    {t('providers.setupTutorial')}
                    <BookOpen size={14} />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="providers-page__info-box">
        <h3>{t('providers.choosing.title')}</h3>
        <p><strong>OpenAI:</strong> {t('providers.openai.desc')}</p>
        <p><strong>Gemini:</strong> {t('providers.gemini.desc')}</p>
        <p><strong>PalabraAI:</strong> {t('providers.palabra.desc')}</p>
        <p><strong>CometAPI:</strong> {t('providers.comet.desc')}</p>
      </div>

      <div className="providers-page__info-box">
        <h3>{t('providers.needHelp.title')}</h3>
        <p>
          {t('providers.needHelp.desc')}{' '}
          <a
            href="https://github.com/kizuna-ai-lab/sokuji"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Repository
          </a>
        </p>
      </div>
    </div>
  );
}
