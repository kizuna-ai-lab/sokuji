/**
 * Documentation Home Page
 *
 * Overview of documentation with links to all guides.
 */

import { Link } from 'react-router-dom';
import {
  Monitor,
  Globe,
  Cpu,
  Shield,
  BookOpen,
  ExternalLink,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

export function DocsHome() {
  const { t } = useI18n();

  return (
    <div className="docs-content docs-home">
      <h1>{t('docs.title')}</h1>
      <p className="docs-home__subtitle">{t('docs.subtitle')}</p>

      {/* Getting Started Section */}
      <section className="docs-home__section">
        <h2>{t('docs.gettingStarted')}</h2>
        <div className="docs-home__cards">
          <Link to="/docs/install/windows" className="docs-home__card">
            <Monitor size={24} />
            <div>
              <h3>{t('install.windows')}</h3>
              <p>Install Sokuji on Windows 10/11</p>
            </div>
          </Link>

          <Link to="/docs/install/macos" className="docs-home__card">
            <Monitor size={24} />
            <div>
              <h3>{t('install.macos')}</h3>
              <p>Install Sokuji on macOS</p>
            </div>
          </Link>

          <Link to="/docs/install/linux" className="docs-home__card">
            <Monitor size={24} />
            <div>
              <h3>{t('install.linux')}</h3>
              <p>Install Sokuji on Linux</p>
            </div>
          </Link>
        </div>
      </section>

      {/* Resources Section */}
      <section className="docs-home__section">
        <h2>{t('docs.resources')}</h2>
        <div className="docs-home__cards">
          <Link to="/docs/supported-sites" className="docs-home__card">
            <Globe size={24} />
            <div>
              <h3>{t('nav.platforms')}</h3>
              <p>Google Meet, Zoom, Teams, Discord, and more</p>
            </div>
          </Link>

          <Link to="/docs/ai-providers" className="docs-home__card">
            <Cpu size={24} />
            <div>
              <h3>{t('nav.aiProviders')}</h3>
              <p>OpenAI, Google Gemini, PalabraAI, CometAPI</p>
            </div>
          </Link>

          <Link to="/docs/privacy" className="docs-home__card">
            <Shield size={24} />
            <div>
              <h3>{t('nav.privacy')}</h3>
              <p>Privacy policy and data handling</p>
            </div>
          </Link>
        </div>
      </section>

      {/* External Links */}
      <section className="docs-home__section">
        <h2>Links</h2>
        <div className="docs-home__links">
          <a
            href="https://github.com/kizuna-ai-lab/sokuji"
            target="_blank"
            rel="noopener noreferrer"
            className="docs-home__link"
          >
            <BookOpen size={20} />
            GitHub Repository
            <ExternalLink size={14} />
          </a>

          <a
            href="https://chromewebstore.google.com/detail/sokuji-extension/ppmihnhelgfpjomhjhpecobloelicnak"
            target="_blank"
            rel="noopener noreferrer"
            className="docs-home__link"
          >
            <Globe size={20} />
            Chrome Web Store
            <ExternalLink size={14} />
          </a>

          <a
            href="https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm"
            target="_blank"
            rel="noopener noreferrer"
            className="docs-home__link"
          >
            <Globe size={20} />
            Edge Add-ons
            <ExternalLink size={14} />
          </a>
        </div>
      </section>
    </div>
  );
}
