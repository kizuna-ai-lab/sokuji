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
} from 'lucide-react';
import { useSession, signOut } from '@/lib/auth-client';
import { Logo } from '@/components/ui/Logo';
import './DashboardLayout.scss';

const navItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/dashboard/profile', icon: User, label: 'Profile' },
  { path: '/dashboard/security', icon: Shield, label: 'Security' },
  { path: '/dashboard/feedback', icon: MessageCircle, label: 'Feedback' },
];

export function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
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
                <strong>{user?.name || 'User'}</strong>
                <span>{user?.email}</span>
              </div>
              <div className="dashboard-layout__dropdown-divider" />
              <button onClick={handleSignOut} className="dashboard-layout__dropdown-item">
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
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
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="dashboard-layout__sidebar-footer">
          <button onClick={handleSignOut} className="dashboard-layout__sign-out">
            <LogOut size={20} />
            <span>Sign out</span>
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
