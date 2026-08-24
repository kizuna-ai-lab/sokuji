import React, { useEffect } from 'react';
import { HelpCircle, RefreshCw, Mail, MessageSquare, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import { isElectron } from '../../../utils/environment';
import { useOnboarding } from '../../../contexts/OnboardingContext';
import { useUpdateStatus, useCheckForUpdates, useOpenUpdateDialog } from '../../../stores/updateStore';
import { useSetUILanguage } from '../../../stores/settingsStore';
import { useAnalytics } from '../../../lib/analytics';
import { changeLanguageWithLoad } from '../../../locales';
import { INTERFACE_LANGUAGES } from './interfaceLanguages';

interface HelpSectionProps {
  toggleSettings?: () => void;
  isSessionActive?: boolean;
}

const HelpSection: React.FC<HelpSectionProps> = ({ toggleSettings, isSessionActive = false }) => {
  const { t, i18n } = useTranslation();
  const { startOnboarding } = useOnboarding();
  const updateStatus = useUpdateStatus();
  const checkForUpdates = useCheckForUpdates();
  const openUpdateDialog = useOpenUpdateDialog();
  const setUILanguage = useSetUILanguage();
  const { trackEvent } = useAnalytics();

  const openExternalUrl = (url: string) => {
    if (isElectron() && (window as any).electron?.invoke) {
      (window as any).electron.invoke('open-external', url);
    } else {
      window.open(url, '_blank');
    }
  };

  useEffect(() => {
    if (updateStatus === 'available') openUpdateDialog();
  }, [updateStatus, openUpdateDialog]);

  return (
    <div className="config-section" id="help-section">
      <h3>
        <HelpCircle size={18} />
        <span>{t('settings.help', 'Help')}</span>
        <span className="version-label">v{__APP_VERSION__}</span>
      </h3>
      <div className="help-links">
        <a className="help-link" onClick={() => { startOnboarding(); if (toggleSettings) toggleSettings(); }}>
          <HelpCircle size={13} />
          <span>{t('onboarding.restartTour', 'Restart Setup Guide')}</span>
        </a>
        {isElectron() && (
          <a
            className={`help-link ${updateStatus === 'checking' ? 'disabled' : ''}`}
            onClick={() => { if (updateStatus !== 'checking') checkForUpdates(); }}
          >
            <RefreshCw size={13} className={updateStatus === 'checking' ? 'spinning' : ''} />
            <span>{updateStatus === 'checking' ? t('update.checking') : t('update.checkButton')}</span>
          </a>
        )}
        {/*
          Interface language, at the weight of a link rather than a section of
          its own. It is set once and never revisited, and by its own
          description it does not affect what can be translated — so it is a
          fact about the application, like the version above and the update
          check beside it, not a feature setting.

          A native <select> rather than a custom popover: the list is 30 long,
          and the platform renders it outside this panel's bounds, with its own
          keyboard handling and type-ahead, at no cost here.
        */}
        <Tooltip content={t('simpleConfig.interfaceLanguageDesc')} position="top">
        <label className={`help-link help-link--picker ${isSessionActive ? 'disabled' : ''}`}>
          <Globe size={13} />
          {/*
            The language's own name is the whole label. Every other entry here
            is a single phrase — "Discussions", "support@kizuna.ai" — and a
            "Interface Language: English" would be the only "label: value" in
            the row, long enough to push Discussions onto a third line. The
            globe carries the meaning; the tooltip carries the caveat that this
            is not the translation language.
          */}
          <select
            className="help-link__select"
            aria-label={t('simpleConfig.interfaceLanguage', 'Interface Language')}
            value={i18n.language}
            disabled={isSessionActive}
            onChange={async (e) => {
              const oldLanguage = i18n.language;
              const newLanguage = e.target.value;
              await changeLanguageWithLoad(newLanguage);
              setUILanguage(newLanguage);
              trackEvent('language_changed', {
                from_language: oldLanguage,
                to_language: newLanguage,
                language_type: 'ui',
              });
            }}
          >
            {INTERFACE_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
        </label>
        </Tooltip>
        <Tooltip content={t('settings.helpEmailTooltip', 'Report bugs or get help')} position="top">
          <a className="help-link" onClick={() => openExternalUrl('mailto:support@kizuna.ai')}>
            <Mail size={13} />
            <span>support@kizuna.ai</span>
          </a>
        </Tooltip>
        <Tooltip content={t('settings.helpDiscussionsTooltip', 'Feature requests, feedback, and community discussions')} position="top">
          <a className="help-link" onClick={() => openExternalUrl('https://github.com/kizuna-ai-lab/sokuji/discussions')}>
            <MessageSquare size={13} />
            <span>{t('settings.helpDiscussions', 'Discussions')}</span>
          </a>
        </Tooltip>
      </div>
    </div>
  );
};

export default HelpSection;
