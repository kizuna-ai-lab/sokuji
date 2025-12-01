import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/auth-client';
import { User, Mail, Calendar, Shield } from 'lucide-react';
import { useAnalytics } from '@/lib/analytics';
import { useTranslation } from '@/lib/i18n';
import { Alert } from '@/components/ui/Alert';
import './Dashboard.scss';

export function Dashboard() {
  const { data: session } = useSession();
  const { trackEvent } = useAnalytics();
  const { t } = useTranslation();
  const user = session?.user;

  // Track page view on mount
  useEffect(() => {
    trackEvent('dashboard_page_viewed', { page: 'home' });
  }, []);

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="dashboard-page">
      <Alert variant="info" className="dashboard-page__notice">
        {t('dashboard.notice.comingSoon')}
      </Alert>

      <div className="dashboard-page__header">
        <h1>Welcome back, {user?.name || 'User'}</h1>
        <p>Manage your account settings and preferences</p>
      </div>

      <div className="dashboard-page__grid">
        {/* Account Overview Card */}
        <div className="dashboard-card">
          <div className="dashboard-card__header">
            <User size={20} />
            <h2>Account Overview</h2>
          </div>
          <div className="dashboard-card__content">
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">Name</span>
              <span className="dashboard-card__value">{user?.name || 'Not set'}</span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">Email</span>
              <span className="dashboard-card__value">{user?.email}</span>
            </div>
          </div>
        </div>

        {/* Account Status Card */}
        <div className="dashboard-card">
          <div className="dashboard-card__header">
            <Shield size={20} />
            <h2>Account Status</h2>
          </div>
          <div className="dashboard-card__content">
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">Email Verified</span>
              <span className={`dashboard-card__badge ${user?.emailVerified ? 'dashboard-card__badge--success' : 'dashboard-card__badge--warning'}`}>
                {user?.emailVerified ? 'Verified' : 'Not Verified'}
              </span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">Account Type</span>
              <span className="dashboard-card__value">
                {(user as { isAnonymous?: boolean })?.isAnonymous ? 'Anonymous' : 'Registered'}
              </span>
            </div>
          </div>
        </div>

        {/* Account Details Card */}
        <div className="dashboard-card dashboard-card--full">
          <div className="dashboard-card__header">
            <Calendar size={20} />
            <h2>Account Details</h2>
          </div>
          <div className="dashboard-card__content dashboard-card__content--horizontal">
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">User ID</span>
              <span className="dashboard-card__value dashboard-card__value--mono">{user?.id}</span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">Created</span>
              <span className="dashboard-card__value">{formatDate(user?.createdAt)}</span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">Last Updated</span>
              <span className="dashboard-card__value">{formatDate(user?.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* Quick Actions Card */}
        <div className="dashboard-card dashboard-card--full">
          <div className="dashboard-card__header">
            <Mail size={20} />
            <h2>Quick Actions</h2>
          </div>
          <div className="dashboard-card__actions">
            <Link to="/dashboard/profile" className="dashboard-card__action">
              <User size={18} />
              <span>Edit Profile</span>
            </Link>
            <Link to="/dashboard/security" className="dashboard-card__action">
              <Shield size={18} />
              <span>Security Settings</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
