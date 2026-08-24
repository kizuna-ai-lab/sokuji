import React, { useEffect, useRef, useState } from 'react';
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

  // Opening the picker puts its list exactly where the tooltip sits, so the
  // tooltip would cover the thing the user just asked to see. A native select
  // reports no open/close, but it always takes focus to open — and suppressing
  // on focus also keeps the tooltip out of the way of keyboard users.
  const [pickerFocused, setPickerFocused] = useState(false);

  // Serial number of the newest language request; see the change handler.
  const languageRequestRef = useRef(0);

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
        <Tooltip
          content={t('simpleConfig.interfaceLanguageDesc')}
          position="top"
          suppressed={pickerFocused}
        >
        <label className={['help-link', 'help-link--picker', isSessionActive ? 'disabled' : ''].filter(Boolean).join(' ')}>
          <Globe size={13} />
          {/*
            The language's own name is the whole label. Every other entry here
            is a single phrase — "Discussions", "support@kizuna.ai" — and a
            "Interface Language: English" would be the only "label: value" in
            the row, long enough to push Discussions onto a third line. The
            globe carries the meaning; the tooltip carries the caveat that this
            is not the translation language.

            The control is a plain <select> joined to Settings' shared
            base-select layer, like every other dropdown in this panel — not a
            hand-built popover, which would be a third pattern in a codebase
            that already has two. That layer draws the popup in-window with the
            app's own theme, and a base-select control lays out to its SELECTED
            option rather than its longest, so the width follows the chosen
            language on its own.
          */}
          <select
            className="help-link__select"
            aria-label={t('simpleConfig.interfaceLanguage', 'Interface Language')}
            value={i18n.language}
            disabled={isSessionActive}
            onFocus={() => setPickerFocused(true)}
            onBlur={() => setPickerFocused(false)}
            onChange={async (e) => {
              const oldLanguage = i18n.language;
              const newLanguage = e.target.value;

              // A <select> fires change on every arrow-key step, so holding a
              // direction walks the list and starts one catalogue load per
              // language passed. Each is independently async, so an earlier
              // one can finish last and leave the app speaking a language the
              // user only scrolled through. Only the newest request may write.
              const request = ++languageRequestRef.current;

              try {
                await changeLanguageWithLoad(newLanguage);
                if (request !== languageRequestRef.current) return;

                // Awaited: this writes through the settings service, and
                // unawaited a failure became an unhandled rejection while the
                // event below reported a change that was never saved.
                await setUILanguage(newLanguage);
                if (request !== languageRequestRef.current) return;

                trackEvent('language_changed', {
                  from_language: oldLanguage,
                  to_language: newLanguage,
                  language_type: 'ui',
                });
              } catch (err) {
                // The catalogue or the settings service failed. The language
                // is left as it was and nothing is reported as changed.
                // TODO(#441): route this through logStore once the repo-wide
                // logging convention lands, so the user can see it in Logs.
                console.error('[HelpSection] Could not change the interface language:', err);
              }
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
