/**
 * Landing Page Layout Component
 *
 * Full-width layout for the public landing page with
 * navigation header and footer.
 */

import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import {
  Menu,
  X,
  Globe,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { useI18n, localeNames, Locale } from '@/lib/i18n';
import './LandingLayout.scss';

export function LandingLayout() {
  const { t, locale, setLocale } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    setLangMenuOpen(false);
  };

  return (
    <div className="landing-layout">
      {/* Header */}
      <header className="landing-layout__header">
        <div className="landing-layout__header-content">
          <Link to="/" className="landing-layout__logo">
            <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="45" fill="#10a37f" />
              <path d="M30 50C30 38.954 38.954 30 50 30V70C38.954 70 30 61.046 30 50Z" fill="white" />
              <circle cx="60" cy="50" r="10" fill="white" />
            </svg>
            <span>Sokuji</span>
          </Link>

          <nav className="landing-layout__nav">
            <Link to="/docs" className="landing-layout__nav-link">
              {t('nav.docs')}
            </Link>
            <Link to="/docs/supported-sites" className="landing-layout__nav-link">
              {t('nav.platforms')}
            </Link>
            <Link to="/docs/ai-providers" className="landing-layout__nav-link">
              {t('nav.aiProviders')}
            </Link>
            <a
              href="https://github.com/kizuna-ai-lab/sokuji"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-layout__nav-link"
            >
              GitHub
              <ExternalLink size={14} />
            </a>
          </nav>

          <div className="landing-layout__actions">
            {/* Language Selector */}
            <div className="landing-layout__lang-menu">
              <button
                className="landing-layout__lang-btn"
                onClick={() => setLangMenuOpen(!langMenuOpen)}
              >
                <Globe size={18} />
                <span>{localeNames[locale]}</span>
                <ChevronDown size={14} />
              </button>

              {langMenuOpen && (
                <div className="landing-layout__lang-dropdown">
                  {(Object.keys(localeNames) as Locale[]).map((loc) => (
                    <button
                      key={loc}
                      className={`landing-layout__lang-option ${loc === locale ? 'landing-layout__lang-option--active' : ''}`}
                      onClick={() => handleLocaleChange(loc)}
                    >
                      {localeNames[loc]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Link to="/sign-in" className="landing-layout__sign-in-btn">
              {t('common.signIn')}
            </Link>

            <button
              className="landing-layout__mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="landing-layout__mobile-menu">
            <Link
              to="/docs"
              className="landing-layout__mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t('nav.docs')}
            </Link>
            <Link
              to="/docs/supported-sites"
              className="landing-layout__mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t('nav.platforms')}
            </Link>
            <Link
              to="/docs/ai-providers"
              className="landing-layout__mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t('nav.aiProviders')}
            </Link>
            <a
              href="https://github.com/kizuna-ai-lab/sokuji"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-layout__mobile-link"
            >
              GitHub
              <ExternalLink size={14} />
            </a>
            <div className="landing-layout__mobile-divider" />
            <Link
              to="/sign-in"
              className="landing-layout__mobile-cta"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t('common.signIn')}
            </Link>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="landing-layout__main">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="landing-layout__footer">
        <div className="landing-layout__footer-content">
          <div className="landing-layout__footer-brand">
            <Link to="/" className="landing-layout__logo landing-layout__logo--footer">
              <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="45" fill="#10a37f" />
                <path d="M30 50C30 38.954 38.954 30 50 30V70C38.954 70 30 61.046 30 50Z" fill="white" />
                <circle cx="60" cy="50" r="10" fill="white" />
              </svg>
              <span>Sokuji</span>
            </Link>
            <p>{t('landing.tagline')}</p>
          </div>

          <div className="landing-layout__footer-links">
            <div className="landing-layout__footer-column">
              <h4>{t('nav.docs')}</h4>
              <Link to="/docs/install/windows">{t('install.windows')}</Link>
              <Link to="/docs/install/macos">{t('install.macos')}</Link>
              <Link to="/docs/install/linux">{t('install.linux')}</Link>
            </div>

            <div className="landing-layout__footer-column">
              <h4>{t('docs.resources')}</h4>
              <Link to="/docs/supported-sites">{t('nav.platforms')}</Link>
              <Link to="/docs/ai-providers">{t('nav.aiProviders')}</Link>
              <Link to="/docs/privacy">{t('nav.privacy')}</Link>
            </div>

            <div className="landing-layout__footer-column">
              <h4>Links</h4>
              <a
                href="https://github.com/kizuna-ai-lab/sokuji"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href="https://chromewebstore.google.com/detail/sokuji-extension/ppmihnhelgfpjomhjhpecobloelicnak"
                target="_blank"
                rel="noopener noreferrer"
              >
                Chrome Extension
              </a>
              <a
                href="https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm"
                target="_blank"
                rel="noopener noreferrer"
              >
                Edge Extension
              </a>
            </div>
          </div>
        </div>

        <div className="landing-layout__footer-bottom">
          <p>&copy; {t('common.footer')}</p>
        </div>
      </footer>
    </div>
  );
}
