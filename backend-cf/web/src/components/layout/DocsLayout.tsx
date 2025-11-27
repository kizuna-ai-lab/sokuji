/**
 * Documentation Layout Component
 *
 * Layout for public documentation pages with navigation sidebar,
 * language selector, and responsive design.
 */

import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  Menu,
  X,
  Home,
  BookOpen,
  Monitor,
  Globe,
  Cpu,
  Shield,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { useI18n, localeNames, Locale } from '@/lib/i18n';
import './DocsLayout.scss';

interface NavItem {
  path: string;
  icon: typeof Home;
  labelKey: string;
  children?: NavItem[];
}

const navItems: NavItem[] = [
  { path: '/docs', icon: Home, labelKey: 'nav.docs' },
  {
    path: '/docs/install',
    icon: BookOpen,
    labelKey: 'nav.install',
    children: [
      { path: '/docs/install/windows', icon: Monitor, labelKey: 'install.windows' },
      { path: '/docs/install/macos', icon: Monitor, labelKey: 'install.macos' },
      { path: '/docs/install/linux', icon: Monitor, labelKey: 'install.linux' },
    ],
  },
  {
    path: '/docs/supported-sites',
    icon: Globe,
    labelKey: 'nav.platforms',
    children: [
      { path: '/docs/supported-sites', icon: Globe, labelKey: 'nav.platformsOverview' },
      { path: '/docs/tutorials/zoom', icon: Monitor, labelKey: 'tutorials.zoom' },
      { path: '/docs/tutorials/google-meet', icon: Monitor, labelKey: 'tutorials.googleMeet' },
      { path: '/docs/tutorials/microsoft-teams', icon: Monitor, labelKey: 'tutorials.teams' },
      { path: '/docs/tutorials/discord', icon: Monitor, labelKey: 'tutorials.discord' },
      { path: '/docs/tutorials/slack', icon: Monitor, labelKey: 'tutorials.slack' },
      { path: '/docs/tutorials/whereby', icon: Monitor, labelKey: 'tutorials.whereby' },
      { path: '/docs/tutorials/gather', icon: Monitor, labelKey: 'tutorials.gather' },
    ],
  },
  {
    path: '/docs/ai-providers',
    icon: Cpu,
    labelKey: 'nav.aiProviders',
    children: [
      { path: '/docs/ai-providers', icon: Cpu, labelKey: 'nav.providersOverview' },
      { path: '/docs/tutorials/openai-setup', icon: Cpu, labelKey: 'tutorials.openai' },
      { path: '/docs/tutorials/gemini-setup', icon: Cpu, labelKey: 'tutorials.gemini' },
      { path: '/docs/tutorials/palabraai-setup', icon: Cpu, labelKey: 'tutorials.palabraai' },
      { path: '/docs/tutorials/cometapi-setup', icon: Cpu, labelKey: 'tutorials.cometapi' },
      { path: '/docs/tutorials/realtime-api-tester', icon: Cpu, labelKey: 'tutorials.realtimeTester' },
    ],
  },
  { path: '/docs/privacy', icon: Shield, labelKey: 'nav.privacy' },
];

export function DocsLayout() {
  const location = useLocation();
  const { t, locale, setLocale } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>(['/docs/install', '/docs/supported-sites', '/docs/ai-providers']);

  const toggleSection = (path: string) => {
    setExpandedSections((prev) =>
      prev.includes(path)
        ? prev.filter((p) => p !== path)
        : [...prev, path]
    );
  };

  const isActive = (path: string) => {
    if (path === '/docs') {
      return location.pathname === '/docs';
    }
    return location.pathname.startsWith(path);
  };

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    setLangMenuOpen(false);
  };

  return (
    <div className="docs-layout">
      {/* Header */}
      <header className="docs-layout__header">
        <div className="docs-layout__header-content">
          <button
            className="docs-layout__menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle menu"
          >
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          <Link to="/" className="docs-layout__logo">
            <svg width="32" height="32" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="45" fill="#10a37f" />
              <path d="M30 50C30 38.954 38.954 30 50 30V70C38.954 70 30 61.046 30 50Z" fill="white" />
              <circle cx="60" cy="50" r="10" fill="white" />
            </svg>
            <span>Sokuji</span>
          </Link>

          <nav className="docs-layout__header-nav">
            <Link to="/" className="docs-layout__header-link">
              {t('nav.home')}
            </Link>
            <Link to="/docs" className="docs-layout__header-link docs-layout__header-link--active">
              {t('nav.docs')}
            </Link>
            <a
              href="https://github.com/kizuna-ai-lab/sokuji"
              target="_blank"
              rel="noopener noreferrer"
              className="docs-layout__header-link"
            >
              GitHub
              <ExternalLink size={14} />
            </a>
          </nav>

          <div className="docs-layout__header-actions">
            {/* Language Selector */}
            <div className="docs-layout__lang-menu">
              <button
                className="docs-layout__lang-btn"
                onClick={() => setLangMenuOpen(!langMenuOpen)}
              >
                <Globe size={18} />
                <span>{localeNames[locale]}</span>
                <ChevronDown size={14} />
              </button>

              {langMenuOpen && (
                <div className="docs-layout__lang-dropdown">
                  {(Object.keys(localeNames) as Locale[]).map((loc) => (
                    <button
                      key={loc}
                      className={`docs-layout__lang-option ${loc === locale ? 'docs-layout__lang-option--active' : ''}`}
                      onClick={() => handleLocaleChange(loc)}
                    >
                      {localeNames[loc]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Link to="/sign-in" className="docs-layout__sign-in-btn">
              {t('common.signIn')}
            </Link>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`docs-layout__sidebar ${sidebarOpen ? 'docs-layout__sidebar--open' : ''}`}>
        <nav className="docs-layout__nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            const hasChildren = item.children && item.children.length > 0;
            const expanded = expandedSections.includes(item.path);

            return (
              <div key={item.path} className="docs-layout__nav-group">
                {hasChildren ? (
                  <>
                    <button
                      className={`docs-layout__nav-item docs-layout__nav-item--parent ${active ? 'docs-layout__nav-item--active' : ''}`}
                      onClick={() => toggleSection(item.path)}
                    >
                      <Icon size={18} />
                      <span>{t(item.labelKey)}</span>
                      <ChevronDown
                        size={16}
                        className={`docs-layout__nav-chevron ${expanded ? 'docs-layout__nav-chevron--open' : ''}`}
                      />
                    </button>
                    {expanded && (
                      <div className="docs-layout__nav-children">
                        {item.children?.map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = location.pathname === child.path;

                          return (
                            <Link
                              key={child.path}
                              to={child.path}
                              className={`docs-layout__nav-item docs-layout__nav-item--child ${childActive ? 'docs-layout__nav-item--active' : ''}`}
                              onClick={() => setSidebarOpen(false)}
                            >
                              <ChildIcon size={16} />
                              <span>{t(child.labelKey)}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <Link
                    to={item.path}
                    className={`docs-layout__nav-item ${active ? 'docs-layout__nav-item--active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Icon size={18} />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="docs-layout__overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="docs-layout__main">
        <div className="docs-layout__content">
          <Outlet />
        </div>

        {/* Footer */}
        <footer className="docs-layout__footer">
          <p>&copy; {t('common.footer')}</p>
        </footer>
      </main>
    </div>
  );
}
