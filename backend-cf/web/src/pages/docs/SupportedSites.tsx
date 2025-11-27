/**
 * Supported Sites Page
 *
 * List of supported video conferencing platforms.
 */

import { Link } from 'react-router-dom';
import { ExternalLink, BookOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

interface Site {
  key: string;
  url: string;
  visitUrl: string;
  tutorialPath?: string;
}

const sites: Site[] = [
  { key: 'meet', url: 'meet.google.com', visitUrl: 'https://meet.google.com', tutorialPath: '/docs/tutorials/google-meet' },
  { key: 'teams', url: 'teams.live.com / teams.microsoft.com', visitUrl: 'https://teams.live.com', tutorialPath: '/docs/tutorials/microsoft-teams' },
  { key: 'gather', url: 'app.gather.town', visitUrl: 'https://app.gather.town', tutorialPath: '/docs/tutorials/gather' },
  { key: 'whereby', url: 'whereby.com', visitUrl: 'https://whereby.com', tutorialPath: '/docs/tutorials/whereby' },
  { key: 'discord', url: 'discord.com', visitUrl: 'https://discord.com', tutorialPath: '/docs/tutorials/discord' },
  { key: 'slack', url: 'app.slack.com', visitUrl: 'https://app.slack.com', tutorialPath: '/docs/tutorials/slack' },
  { key: 'zoom', url: 'app.zoom.us', visitUrl: 'https://app.zoom.us', tutorialPath: '/docs/tutorials/zoom' },
];

export function SupportedSites() {
  const { t } = useI18n();

  return (
    <div className="docs-content sites-page">
      <h1>{t('sites.title')}</h1>
      <p className="sites-page__intro">{t('sites.subtitle')}</p>

      <div className="sites-page__info-box">
        <h3>{t('sites.howToUse.title')}</h3>
        <p>{t('sites.howToUse.desc')}</p>
      </div>

      <div className="sites-page__grid">
        {sites.map((site) => {
          const features = t(`sites.${site.key}.features`).split('|');

          return (
            <div key={site.key} className="sites-page__card">
              <h3>{t(`sites.${site.key}.name`)}</h3>
              <div className="sites-page__url">{site.url}</div>

              <ul className="sites-page__features">
                {features.map((feature, index) => (
                  <li key={index}>{feature}</li>
                ))}
              </ul>

              <div className="sites-page__actions">
                <a
                  href={site.visitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sites-page__btn"
                >
                  {t('sites.visitPlatform')}
                  <ExternalLink size={14} />
                </a>
                {site.tutorialPath && (
                  <Link to={site.tutorialPath} className="sites-page__btn sites-page__btn--secondary">
                    {t('sites.tutorial')}
                    <BookOpen size={14} />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sites-page__info-box">
        <h3>{t('sites.needHelp.title')}</h3>
        <p>
          {t('sites.needHelp.desc')}{' '}
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
