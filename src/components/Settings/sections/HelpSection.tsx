import React, { useState } from 'react';
import { HelpCircle, RefreshCw, Check, CircleAlert, Mail, MessageSquare, Globe, Wand2, SunMoon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import { isElectron } from '../../../utils/environment';
import { openExternalUrl, useInterfaceLanguageChange, useUpdateCheck } from './helpActions';
import { useStartBasicsTour } from '../../Tour/useStartBasicsTour';
import { useSetSetupWizardOpen } from '../../../stores/layoutStore';
import { useDiagnosticLogs, useSetDiagnosticLogs, useThemeSetting, useSetThemeSetting } from '../../../stores/settingsStore';
import { useAnalytics } from '../../../lib/analytics';
import { INTERFACE_LANGUAGES } from './interfaceLanguages';
import { THEME_SETTINGS, isThemeSetting, type ThemeSetting } from '../../../lib/theme/theme';

// "System", not "Follow system": at the panel's 300px minimum the longer label
// wrapped the option onto two lines (and its translations are longer still).
// The tooltip carries the meaning.
const APPEARANCE_FALLBACKS: Record<ThemeSetting, string> = { system: 'System', light: 'Light', dark: 'Dark' };

interface HelpSectionProps {
  toggleSettings?: () => void;
  isSessionActive?: boolean;
}

const HelpSection: React.FC<HelpSectionProps> = ({ toggleSettings, isSessionActive = false }) => {
  const { t, i18n } = useTranslation();
  const [appearanceFocused, setAppearanceFocused] = useState(false);
  const startTour = useStartBasicsTour();
  const setSetupWizardOpen = useSetSetupWizardOpen();
  const { status: updateStatus, result: checkResult, check: checkForUpdates } = useUpdateCheck();
  const changeLanguage = useInterfaceLanguageChange('HelpSection');
  const diagnosticLogs = useDiagnosticLogs();
  const setDiagnosticLogs = useSetDiagnosticLogs();
  const themeSetting = useThemeSetting();
  const setThemeSetting = useSetThemeSetting();
  const { trackEvent } = useAnalytics();

  // Opening the picker puts its list exactly where the tooltip sits, so the
  // tooltip would cover the thing the user just asked to see. A native select
  // reports no open/close, but it always takes focus to open — and suppressing
  // on focus also keeps the tooltip out of the way of keyboard users.
  const [pickerFocused, setPickerFocused] = useState(false);

  return (
    <div className="config-section" id="help-section">
      <h3>
        <HelpCircle size={18} />
        <span>{t('settings.help', 'Help')}</span>
        <span className="version-label">v{__APP_VERSION__}</span>
      </h3>
      <div className="help-links">
        <button
          type="button"
          className={`help-link${isSessionActive ? ' is-disabled' : ''}`}
          aria-disabled={isSessionActive}
          title={isSessionActive ? t('settings.sessionActiveNotice') : undefined}
          onClick={() => { if (isSessionActive) return; setSetupWizardOpen(true); if (toggleSettings) toggleSettings(); }}
        >
          <Wand2 size={13} />
          <span>{t('setup.rerun', 'Run setup again')}</span>
        </button>
        <button type="button" className="help-link" onClick={() => { startTour(); if (toggleSettings) toggleSettings(); }}>
          <HelpCircle size={13} />
          <span>{t('tour.restart', 'Restart Setup Guide')}</span>
        </button>
        {isElectron() && (
          <button
            type="button"
            className={[
              'help-link',
              updateStatus === 'checking' ? 'disabled' : '',
              checkResult === 'not-available' ? 'help-link--ok' : '',
              checkResult === 'error' ? 'help-link--error' : '',
            ].filter(Boolean).join(' ')}
            onClick={checkForUpdates}
          >
            {updateStatus === 'checking' ? <RefreshCw size={13} className="spinning" />
              : checkResult === 'not-available' ? <Check size={13} />
              : checkResult === 'error' ? <CircleAlert size={13} />
              : <RefreshCw size={13} />}
            <span>
              {updateStatus === 'checking' ? t('update.checking')
                : checkResult === 'not-available' ? t('update.upToDate')
                : checkResult === 'error' ? t('update.error')
                : t('update.checkButton')}
            </span>
          </button>
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
            onChange={(e) => changeLanguage(e.target.value)}
          >
            {INTERFACE_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
        </label>
        </Tooltip>
        {/*
          Appearance (spec 2026-10-22 §4), in the shape of the interface
          language beside it, because it is the same kind of thing: a fact
          about the application, not a feature setting. The sun-and-moon
          carries the meaning, the chosen option is the whole label (a
          "Appearance: Dark" entry would be the row's only "label: value"),
          and the tooltip carries what System does. The <select> joins the
          same base-select layer, so it draws the app's own popup and sizes to
          its chosen option. Not locked during a session: it changes nothing
          the session depends on.
        */}
        <Tooltip
          content={t('settings.appearanceTooltip', "How the app looks. System follows the operating system's light or dark setting.")}
          position="top"
          suppressed={appearanceFocused}
        >
        <label className="help-link help-link--picker">
          <SunMoon size={13} />
          <select
            className="help-link__select"
            aria-label={t('settings.appearance', 'Appearance')}
            value={themeSetting}
            onFocus={() => setAppearanceFocused(true)}
            onBlur={() => setAppearanceFocused(false)}
            onChange={(e) => {
              const mode = e.target.value;
              if (!isThemeSetting(mode) || mode === themeSetting) return;
              void setThemeSetting(mode);
              trackEvent('theme_changed', { from: themeSetting, to: mode });
            }}
          >
            {THEME_SETTINGS.map((mode) => (
              <option key={mode} value={mode}>{t(`settings.appearanceMode.${mode}`, APPEARANCE_FALLBACKS[mode])}</option>
            ))}
          </select>
        </label>
        </Tooltip>
        {/*
          Diagnostic logs are opt-in: while off, nothing is recorded and the
          title bar offers no logs button. Help is where a user asked for a
          bug report is sent to turn them on, so it sits just before the
          support address, the next step.

          A help link like its neighbours, carrying a switch track scaled to
          the row: the shape every other switch in Settings has, so the state
          reads at a glance, where a line-art toggle icon only moved a dot.
          The label stays a single phrase, since a "label: value" entry is
          what pushes Discussions onto a third line (see the picker above).
        */}
        <Tooltip content={t('settings.diagnosticLogsTooltip', 'Record what the app does, so you can attach it to a bug report. Off by default. While on, a “Logs” button appears in the title bar, and the setting stays on after a restart.')} position="top">
          <button
            type="button"
            role="switch"
            aria-checked={diagnosticLogs}
            className={`help-link help-link--toggle${diagnosticLogs ? ' is-on' : ''}`}
            onClick={() => { void setDiagnosticLogs(!diagnosticLogs); }}
          >
            <span className="help-link__switch" aria-hidden="true" />
            <span>{t('settings.diagnosticLogs', 'Diagnostic logs')}</span>
          </button>
        </Tooltip>
        <Tooltip content={t('settings.helpEmailTooltip', 'Report bugs or get help')} position="top">
          <button type="button" className="help-link" onClick={() => openExternalUrl('mailto:support@kizuna.ai')}>
            <Mail size={13} />
            <span>support@kizuna.ai</span>
          </button>
        </Tooltip>
        <Tooltip content={t('settings.helpDiscussionsTooltip', 'Feature requests, feedback, and community discussions')} position="top">
          <button type="button" className="help-link" onClick={() => openExternalUrl('https://github.com/kizuna-ai-lab/sokuji/discussions')}>
            <MessageSquare size={13} />
            <span>{t('settings.helpDiscussions', 'Discussions')}</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default HelpSection;
