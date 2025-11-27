/**
 * Privacy Policy Page
 */

import { Shield, Database, Trash2, User } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './docs.scss';

export function PrivacyPolicy() {
  const { t } = useI18n();

  const guaranteeItems = t('privacy.guarantee.items').split('|');
  const accountItems = t('privacy.account.items').split('|');
  const userProvidedItems = t('privacy.collect.userProvided.items').split('|');
  const analyticsItems = t('privacy.collect.analytics.items').split('|');
  const useItems = t('privacy.use.items').split('|');
  const analyticsControlItems = t('privacy.analytics.control.items').split('|');
  const serverStorageItems = t('privacy.storage.server.items').split('|');
  const deletionItems = t('privacy.deletion.items').split('|');
  const rightsItems = t('privacy.rights.items').split('|');

  return (
    <div className="docs-content privacy-page">
      <h1>{t('privacy.title')}</h1>
      <p><em>{t('privacy.lastUpdated')}</em></p>

      {/* Introduction */}
      <section className="privacy-page__section">
        <h2>{t('privacy.intro.title')}</h2>
        <p>{t('privacy.intro.content')}</p>
      </section>

      {/* Privacy Guarantee */}
      <div className="privacy-page__guarantee">
        <h3>
          <Shield size={20} />
          {t('privacy.guarantee.title')}
        </h3>
        <p>{t('privacy.guarantee.content')}</p>
        <ul>
          {guaranteeItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>

      {/* Account Information */}
      <section className="privacy-page__section">
        <h2>
          <User size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
          {t('privacy.account.title')}
        </h2>
        <p>{t('privacy.account.content')}</p>
        <ul>
          {accountItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>

      {/* Information We Collect */}
      <section className="privacy-page__section">
        <h2>{t('privacy.collect.title')}</h2>

        <h3>{t('privacy.collect.userProvided.title')}</h3>
        <ul>
          {userProvidedItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>

        <h3>{t('privacy.collect.analytics.title')}</h3>
        <div className="privacy-page__highlight">
          <p>{t('privacy.collect.analytics.content')}</p>
          <ul>
            {analyticsItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <p><em>{t('privacy.collect.analytics.optout')}</em></p>
        </div>
      </section>

      {/* How We Use Your Information */}
      <section className="privacy-page__section">
        <h2>{t('privacy.use.title')}</h2>
        <ul>
          {useItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>

      {/* Analytics and Tracking */}
      <section className="privacy-page__section">
        <h2>{t('privacy.analytics.title')}</h2>

        <h3>{t('privacy.analytics.posthog.title')}</h3>
        <p>{t('privacy.analytics.posthog.content')}</p>

        <div className="privacy-page__highlight">
          <h4>{t('privacy.analytics.control.title')}</h4>
          <ul>
            {analyticsControlItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Data Storage and Security */}
      <section className="privacy-page__section">
        <h2>
          <Database size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
          {t('privacy.storage.title')}
        </h2>

        <h3>{t('privacy.storage.local.title')}</h3>
        <p>{t('privacy.storage.local.content')}</p>

        <h3>{t('privacy.storage.server.title')}</h3>
        <p>{t('privacy.storage.server.content')}</p>
        <ul>
          {serverStorageItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>

        <h3>{t('privacy.storage.transmission.title')}</h3>
        <p>{t('privacy.storage.transmission.content')}</p>
      </section>

      {/* Third-Party Services */}
      <section className="privacy-page__section">
        <h2>{t('privacy.thirdParty.title')}</h2>

        <h3>{t('privacy.thirdParty.cloudflare.title')}</h3>
        <p>{t('privacy.thirdParty.cloudflare.content')}</p>

        <h3>{t('privacy.thirdParty.openai.title')}</h3>
        <p>{t('privacy.thirdParty.openai.content')}</p>

        <h3>{t('privacy.thirdParty.posthog.title')}</h3>
        <p>{t('privacy.thirdParty.posthog.content')}</p>
      </section>

      {/* Account Deletion */}
      <section className="privacy-page__section">
        <h2>
          <Trash2 size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
          {t('privacy.deletion.title')}
        </h2>
        <p>{t('privacy.deletion.content')}</p>
        <ul>
          {deletionItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>

      {/* Data Retention */}
      <section className="privacy-page__section">
        <h2>{t('privacy.retention.title')}</h2>
        <p>{t('privacy.retention.content')}</p>
      </section>

      {/* User Rights and Control */}
      <section className="privacy-page__section">
        <h2>{t('privacy.rights.title')}</h2>
        <ul>
          {rightsItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>

      {/* GDPR Compliance */}
      <section className="privacy-page__section">
        <h2>{t('privacy.gdpr.title')}</h2>
        <p>{t('privacy.gdpr.content')}</p>
      </section>

      {/* Children's Privacy */}
      <section className="privacy-page__section">
        <h2>{t('privacy.children.title')}</h2>
        <p>{t('privacy.children.content')}</p>
      </section>

      {/* Changes to This Privacy Policy */}
      <section className="privacy-page__section">
        <h2>{t('privacy.changes.title')}</h2>
        <p>{t('privacy.changes.content')}</p>
      </section>

      {/* Contact Us */}
      <section className="privacy-page__section">
        <h2>{t('privacy.contact.title')}</h2>
        <p>{t('privacy.contact.content')}</p>
        <div className="privacy-page__contact">
          <p>{t('privacy.contact.email')}</p>
          <p>{t('privacy.contact.privacy')}</p>
          <p>{t('privacy.contact.github')}</p>
        </div>
      </section>

      {/* Consent */}
      <section className="privacy-page__section">
        <h2>{t('privacy.consent.title')}</h2>
        <p>{t('privacy.consent.content')}</p>
      </section>
    </div>
  );
}
