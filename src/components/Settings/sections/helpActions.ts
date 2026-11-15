// src/components/Settings/sections/helpActions.ts
//
// What the help section and the settings page's "General" both do: switch the interface language, check for an
// update and show the result for a moment, open a link outside the app.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../../utils/environment';
import { useUpdateStatus, useCheckForUpdates, useOpenUpdateDialog } from '../../../stores/updateStore';
import { useSetUILanguage } from '../../../stores/settingsStore';
import { useAnalytics } from '../../../lib/analytics';
import { changeLanguageWithLoad } from '../../../locales';
import { describeCause, reportError } from '../../../lib/diagnostics/report';

/** Open a link outside the app: the system browser on the desktop, a new tab elsewhere. */
export function openExternalUrl(url: string): void {
  if (isElectron() && (window as any).electron?.invoke) {
    (window as any).electron.invoke('open-external', url);
  } else {
    window.open(url, '_blank');
  }
}

/** Switch the interface language: the function a language picker's change calls with the language asked for. */
export function useInterfaceLanguageChange(source: string): (newLanguage: string) => void {
  const { i18n } = useTranslation();
  const setUILanguage = useSetUILanguage();
  const { trackEvent } = useAnalytics();
  // The language the user last asked for, and the chain the requests run on.
  const wantedLanguageRef = useRef<string | null>(null);
  const languageChainRef = useRef<Promise<void>>(Promise.resolve());

  return (newLanguage: string) => {
    const oldLanguage = i18n.language;
    wantedLanguageRef.current = newLanguage;

    // A <select> fires change on every arrow-key step, so holding a
    // direction walks the list and starts one request per language
    // passed. Checking only before the WRITES would be too late:
    // changeLanguageWithLoad calls i18n.changeLanguage() itself, so
    // a stale request allowed to run changes the visible language on
    // its way to being discarded — leaving the app showing one
    // language and having saved another.
    //
    // So the requests are serialised on a chain, and each asks
    // whether it is still wanted before doing anything at all. A
    // language the user scrolled past is never loaded.
    languageChainRef.current = languageChainRef.current.then(async () => {
      if (wantedLanguageRef.current !== newLanguage) return;

      // Split deliberately: these two failures need opposite
      // treatment, and one catch around both would have to guess.
      try {
        await changeLanguageWithLoad(newLanguage);
      } catch (err) {
        // The catalogue never loaded, so i18n never switched. There
        // is nothing to undo, and trying to "restore" would kick off
        // another load for a language that was never left.
        reportError(source, `Could not load the interface language: ${describeCause(err)}`, { cause: err });
        return;
      }

      try {
        // Awaited: this writes through the settings service, and
        // unawaited a failure became an unhandled rejection while
        // the event below reported a change that was never saved.
        await setUILanguage(newLanguage);
      } catch (err) {
        // Here the visible language HAS changed, and the store
        // applied its value before awaiting the service — so the app
        // is wearing a language it could not save. Put it back,
        // unless the user has since asked for something else and a
        // later link in the chain is about to set it anyway.
        reportError(source, `Could not save the interface language: ${describeCause(err)}`, { cause: err });
        if (wantedLanguageRef.current === newLanguage) {
          wantedLanguageRef.current = oldLanguage;
          try {
            await changeLanguageWithLoad(oldLanguage);
            await setUILanguage(oldLanguage);
          } catch {
            // Best effort: the service is evidently unwell. The
            // store's value is restored regardless, since it is
            // applied before the write that rejects.
          }
        }
        return;
      }

      trackEvent('language_changed', {
        from_language: oldLanguage,
        to_language: newLanguage,
        language_type: 'ui',
      });
    });
  };
}

/**
 * The update check: its status, the result of a check the user started (shown for five seconds: "Up to date" or
 * "Failed to check"), and the check itself. An update found opens the update dialog.
 */
export function useUpdateCheck(): { status: ReturnType<typeof useUpdateStatus>; result: 'not-available' | 'error' | null; check: () => void } {
  const status = useUpdateStatus();
  const checkForUpdates = useCheckForUpdates();
  const openUpdateDialog = useOpenUpdateDialog();
  // A new check passes through 'checking' first, so a second failure re-runs this.
  const [result, setResult] = useState<'not-available' | 'error' | null>(null);
  // Only a check the user started shows a result: a stale status held by the
  // store (or the one present at mount) must not flash on every reopen.
  const previousStatusRef = useRef(status);
  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous !== 'checking' || (status !== 'not-available' && status !== 'error')) {
      setResult(null);
      return;
    }
    setResult(status);
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (status === 'available') openUpdateDialog();
  }, [status, openUpdateDialog]);

  return { status, result, check: () => { if (status !== 'checking') checkForUpdates(); } };
}
