import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import type { OverlayReceiver } from '../../lib/subtitle/wire';
import { showLanguageUncached } from '../../locales';
import { useReadable } from '../Conversation/useReadable';
import { SubtitleView, type SubtitleControls } from './SubtitleView';

/**
 * The extension overlay, drawn from its wire (plan 1e-4): the model the side
 * panel last sent; the four controls it takes back — press, release, Clear,
 * exit; and the side panel's interface language, applied to this document's
 * own i18next without storing it (ruling 5; controller ruling M11). No
 * start, stop or Settings: the overlay is read-only for the run (plan 1d-2
 * ruling 5; plan 1e-4 ruling 2). The extension's overlay page and the
 * development preview's iframe both mount it.
 */
export function ConnectedOverlay({ receiver }: { receiver: OverlayReceiver }) {
  const model = useReadable(receiver);
  const { i18n } = useTranslation();
  const language = model.language;
  // The last language this effect itself asked for — not `i18n.language`,
  // which does not move while a switch's own bundle is still loading. A
  // language that arrives mid-load would otherwise compare equal to that
  // stale value and be dropped (final-fix review Minor 2).
  // `showLanguageUncached` itself resolves the race between two such
  // requests (last call wins); this ref only makes sure every one of them is
  // actually sent.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!language) return;
    // Nothing requested yet (a fresh mount): a receiver whose language this
    // document already shows switches nothing.
    const baseline = requested.current ?? i18n.language;
    if (language === baseline) return;
    requested.current = language;
    showLanguageUncached(language).catch((error: unknown) =>
      reportWarning('SubtitleOverlay', `The overlay could not switch to the side panel's language (${language}): ${describeCause(error)}`, { cause: error, dedupeKey: 'overlay:language' }));
  }, [language, i18n]);
  const controls = useMemo<SubtitleControls>(() => ({
    exit: () => receiver.send({ type: 'subtitle:user-exit' }),
    clear: () => receiver.send({ type: 'subtitle:request-clear' }),
    press: () => receiver.send({ type: 'subtitle:turn-press' }),
    release: () => receiver.send({ type: 'subtitle:turn-release' }),
  }), [receiver]);
  return <SubtitleView surface="extension-overlay" model={model} controls={controls} />;
}
