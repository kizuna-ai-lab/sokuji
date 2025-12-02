import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  User,
  Shield,
  MessageCircle,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Globe,
  Wallet,
} from 'lucide-react';
import { useSession, signOut } from '@/lib/auth-client';
import { useI18n, localeNames, Locale } from '@/lib/i18n';
import { Logo } from '@/components/ui/Logo';
import './DashboardLayout.scss';

const navItems = [
  { path: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard.nav.dashboard' },
  { path: '/dashboard/profile', icon: User, labelKey: 'dashboard.nav.profile' },
  { path: '/dashboard/security', icon: Shield, labelKey: 'dashboard.nav.security' },
  { path: '/dashboard/wallet', icon: Wallet, labelKey: 'dashboard.nav.wallet' },
  { path: '/dashboard/feedback', icon: MessageCircle, labelKey: 'dashboard.nav.feedback' },
];

export function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { t, locale, setLocale } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    setLangMenuOpen(false);
  };

  const user = session?.user;

  return (
    <div className="dashboard-layout">
      {/* Mobile header */}
      <header className="dashboard-layout__header">
        <button
          className="dashboard-layout__menu-btn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        <Link to="/dashboard" className="dashboard-layout__logo">
          <Logo size={32} />
          <span>Sokuji</span>
        </Link>

        <div className="dashboard-layout__header-actions">
          {/* Language Selector */}
          <div className="dashboard-layout__lang-menu">
            <button
              className="dashboard-layout__lang-btn"
              onClick={() => setLangMenuOpen(!langMenuOpen)}
            >
              <Globe size={18} />
              <ChevronDown size={14} />
            </button>

            {langMenuOpen && (
              <div className="dashboard-layout__lang-dropdown">
                {(Object.keys(localeNames) as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    className={`dashboard-layout__lang-option ${loc === locale ? 'dashboard-layout__lang-option--active' : ''}`}
                    onClick={() => handleLocaleChange(loc)}
                  >
                    {localeNames[loc]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User Menu */}
          <div className="dashboard-layout__user-menu">
            <button
              className="dashboard-layout__user-btn"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
            >
              <div className="dashboard-layout__avatar">
                {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
              </div>
              <ChevronDown size={16} />
            </button>

            {userMenuOpen && (
              <div className="dashboard-layout__dropdown">
                <div className="dashboard-layout__dropdown-header">
                  <strong>{user?.name || t('dashboard.user.fallback')}</strong>
                  <span>{user?.email}</span>
                </div>
                <div className="dashboard-layout__dropdown-divider" />
                <button onClick={handleSignOut} className="dashboard-layout__dropdown-item">
                  <LogOut size={16} />
                  {t('dashboard.nav.signOut')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`dashboard-layout__sidebar ${sidebarOpen ? 'dashboard-layout__sidebar--open' : ''}`}>
        <div className="dashboard-layout__sidebar-header">
          <Link to="/dashboard" className="dashboard-layout__logo">
            <Logo size={32} />
            <span>Sokuji</span>
          </Link>
        </div>

        <nav className="dashboard-layout__nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`dashboard-layout__nav-item ${isActive ? 'dashboard-layout__nav-item--active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={20} />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="dashboard-layout__sidebar-footer">
          {/* Language Selector in Sidebar */}
          <div className="dashboard-layout__sidebar-lang">
            <button
              className="dashboard-layout__sidebar-lang-btn"
              onClick={() => setLangMenuOpen(!langMenuOpen)}
            >
              <Globe size={18} />
              <span>{localeNames[locale]}</span>
              <ChevronDown size={14} />
            </button>

            {langMenuOpen && (
              <div className="dashboard-layout__sidebar-lang-dropdown">
                {(Object.keys(localeNames) as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    className={`dashboard-layout__lang-option ${loc === locale ? 'dashboard-layout__lang-option--active' : ''}`}
                    onClick={() => handleLocaleChange(loc)}
                  >
                    {localeNames[loc]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleSignOut} className="dashboard-layout__sign-out">
            <LogOut size={20} />
            <span>{t('dashboard.nav.signOut')}</span>
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="dashboard-layout__overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="dashboard-layout__main">
        <Outlet />
      </main>
    </div>
  );
}
