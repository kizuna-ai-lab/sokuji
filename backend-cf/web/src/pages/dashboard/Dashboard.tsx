import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/auth-client';
import { User, Mail, Calendar, Shield } from 'lucide-react';
import { useAnalytics } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { Alert } from '@/components/ui/Alert';
import './Dashboard.scss';

export function Dashboard() {
  const { data: session } = useSession();
  const { trackEvent } = useAnalytics();
  const { t, locale } = useI18n();
  const user = session?.user;

  // Track page view on mount
  useEffect(() => {
    trackEvent('dashboard_page_viewed', { page: 'home' });
  }, []);

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return t('dashboard.home.na');
    // Map locale to date format locale
    const localeMap: Record<string, string> = {
      en: 'en-US',
      zh: 'zh-CN',
      ja: 'ja-JP',
      ko: 'ko-KR',
    };
    return new Date(date).toLocaleDateString(localeMap[locale] || 'en-US', {
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
        <h1>{t('dashboard.home.welcomeBack').replace('{name}', user?.name || t('dashboard.user.fallback'))}</h1>
        <p>{t('dashboard.home.subtitle')}</p>
      </div>

      <div className="dashboard-page__grid">
        {/* Account Overview Card */}
        <div className="dashboard-card">
          <div className="dashboard-card__header">
            <User size={20} />
            <h2>{t('dashboard.home.accountOverview')}</h2>
          </div>
          <div className="dashboard-card__content">
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">{t('dashboard.home.name')}</span>
              <span className="dashboard-card__value">{user?.name || t('dashboard.home.notSet')}</span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">{t('dashboard.home.email')}</span>
              <span className="dashboard-card__value">{user?.email}</span>
            </div>
          </div>
        </div>

        {/* Account Status Card */}
        <div className="dashboard-card">
          <div className="dashboard-card__header">
            <Shield size={20} />
            <h2>{t('dashboard.home.accountStatus')}</h2>
          </div>
          <div className="dashboard-card__content">
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">{t('dashboard.home.emailVerified')}</span>
              <span className={`dashboard-card__badge ${user?.emailVerified ? 'dashboard-card__badge--success' : 'dashboard-card__badge--warning'}`}>
                {user?.emailVerified ? t('dashboard.home.verified') : t('dashboard.home.notVerified')}
              </span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">{t('dashboard.home.accountType')}</span>
              <span className="dashboard-card__value">
                {(user as { isAnonymous?: boolean })?.isAnonymous ? t('dashboard.home.anonymous') : t('dashboard.home.registered')}
              </span>
            </div>
          </div>
        </div>

        {/* Account Details Card */}
        <div className="dashboard-card dashboard-card--full">
          <div className="dashboard-card__header">
            <Calendar size={20} />
            <h2>{t('dashboard.home.accountDetails')}</h2>
          </div>
          <div className="dashboard-card__content dashboard-card__content--horizontal">
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">{t('dashboard.home.userId')}</span>
              <span className="dashboard-card__value dashboard-card__value--mono">{user?.id}</span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">{t('dashboard.home.created')}</span>
              <span className="dashboard-card__value">{formatDate(user?.createdAt)}</span>
            </div>
            <div className="dashboard-card__item">
              <span className="dashboard-card__label">{t('dashboard.home.lastUpdated')}</span>
              <span className="dashboard-card__value">{formatDate(user?.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* Quick Actions Card */}
        <div className="dashboard-card dashboard-card--full">
          <div className="dashboard-card__header">
            <Mail size={20} />
            <h2>{t('dashboard.home.quickActions')}</h2>
          </div>
          <div className="dashboard-card__actions">
            <Link to="/dashboard/profile" className="dashboard-card__action">
              <User size={18} />
              <span>{t('dashboard.home.editProfile')}</span>
            </Link>
            <Link to="/dashboard/security" className="dashboard-card__action">
              <Shield size={18} />
              <span>{t('dashboard.home.securitySettings')}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
