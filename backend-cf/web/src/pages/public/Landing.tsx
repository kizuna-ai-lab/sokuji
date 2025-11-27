/**
 * Landing Page
 *
 * Public landing page with hero section, features, and platform selection.
 */

import { Link } from 'react-router-dom';
import {
  Mic,
  Languages,
  Cpu,
  Globe,
  Chrome,
  Monitor,
  ExternalLink,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Logo } from '@/components/ui/Logo';
import './Landing.scss';

export function Landing() {
  const { t } = useI18n();

  return (
    <div className="landing">
      {/* Hero Section */}
      <section className="landing__hero">
        <div className="landing__hero-content">
          <h1 className="landing__title">
            {t('landing.title')}
          </h1>
          <p className="landing__tagline">
            {t('landing.tagline')}
          </p>
          <p className="landing__subtitle">
            {t('landing.subtitle')}
          </p>

          <div className="landing__cta-group">
            <a
              href="https://chromewebstore.google.com/detail/sokuji-extension/ppmihnhelgfpjomhjhpecobloelicnak"
              target="_blank"
              rel="noopener noreferrer"
              className="landing__cta landing__cta--primary"
            >
              <Chrome size={20} />
              {t('landing.cta.extension')}
            </a>
            <a
              href="https://github.com/kizuna-ai-lab/sokuji/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="landing__cta landing__cta--secondary"
            >
              <Monitor size={20} />
              {t('landing.cta.desktop')}
            </a>
          </div>

          <Link to="/docs" className="landing__docs-link">
            {t('landing.cta.docs')} &rarr;
          </Link>
        </div>

        <div className="landing__hero-visual">
          <div className="landing__hero-logo">
            <Logo size={200} />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="landing__features">
        <div className="landing__features-content">
          <h2>{t('features.title')}</h2>

          <div className="landing__features-grid">
            <div className="landing__feature">
              <div className="landing__feature-icon">
                <Mic size={24} />
              </div>
              <h3>{t('features.realtime.title')}</h3>
              <p>{t('features.realtime.desc')}</p>
            </div>

            <div className="landing__feature">
              <div className="landing__feature-icon">
                <Languages size={24} />
              </div>
              <h3>{t('features.multilang.title')}</h3>
              <p>{t('features.multilang.desc')}</p>
            </div>

            <div className="landing__feature">
              <div className="landing__feature-icon">
                <Cpu size={24} />
              </div>
              <h3>{t('features.providers.title')}</h3>
              <p>{t('features.providers.desc')}</p>
            </div>

            <div className="landing__feature">
              <div className="landing__feature-icon">
                <Globe size={24} />
              </div>
              <h3>{t('features.integration.title')}</h3>
              <p>{t('features.integration.desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Selection Section */}
      <section className="landing__platforms">
        <div className="landing__platforms-content">
          <h2>{t('platform.title')}</h2>

          <div className="landing__platforms-grid">
            <div className="landing__platform-card">
              <h3>{t('platform.extension.title')}</h3>
              <p className="landing__platform-desc">{t('platform.extension.desc')}</p>

              <div className="landing__platform-links">
                <a
                  href="https://chromewebstore.google.com/detail/sokuji-extension/ppmihnhelgfpjomhjhpecobloelicnak"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing__platform-link"
                >
                  {t('platform.extension.chrome')}
                  <ExternalLink size={14} />
                </a>
                <a
                  href="https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing__platform-link"
                >
                  {t('platform.extension.edge')}
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>

            <div className="landing__platform-card">
              <h3>{t('platform.desktop.title')}</h3>
              <p className="landing__platform-desc">{t('platform.desktop.desc')}</p>

              <div className="landing__platform-links">
                <a
                  href="https://github.com/kizuna-ai-lab/sokuji/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing__platform-link"
                >
                  {t('platform.desktop.windows')}
                  <ExternalLink size={14} />
                </a>
                <a
                  href="https://github.com/kizuna-ai-lab/sokuji/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing__platform-link"
                >
                  {t('platform.desktop.macos')}
                  <ExternalLink size={14} />
                </a>
                <a
                  href="https://github.com/kizuna-ai-lab/sokuji/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing__platform-link"
                >
                  {t('platform.desktop.linux')}
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Installation Guides Section */}
      <section className="landing__guides">
        <div className="landing__guides-content">
          <h2>{t('install.title')}</h2>

          <div className="landing__guides-grid">
            <Link to="/docs/install/windows" className="landing__guide-card">
              <Monitor size={32} />
              <span>{t('install.windows')}</span>
            </Link>

            <Link to="/docs/install/macos" className="landing__guide-card">
              <Monitor size={32} />
              <span>{t('install.macos')}</span>
            </Link>

            <Link to="/docs/install/linux" className="landing__guide-card">
              <Monitor size={32} />
              <span>{t('install.linux')}</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
