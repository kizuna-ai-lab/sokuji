/**
 * The extension overlay's page (plan 1e-4): the iframe the content script
 * mounts in the meeting page draws `SubtitleView` from the side panel's wire.
 * Its display settings are its own (`subtitleStore`, hydrated from
 * `chrome.storage` first); everything about the run arrives on the port.
 */
import { createRoot } from 'react-dom/client';
import { AppProviders } from './components/AppProviders';
import { ConnectedOverlay } from './components/Subtitle/ConnectedOverlay';
import { reportError } from './lib/diagnostics/report';
import { connectOverlay } from './lib/subtitle/overlayPort';
import type { ChromePortLike } from './lib/subtitle/wire';
import { useSubtitleStore } from './stores/subtitleStore';

/** The part of the extension API this page uses: the repo's global `chrome` typing has no `connect`. */
declare const chrome: { runtime: { connect(info: { name: string }): ChromePortLike } };

async function bootstrap(): Promise<void> {
  await useSubtitleStore.getState().hydrate();
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    reportError('SubtitleOverlay', 'The overlay page has no #root to draw into.');
    return;
  }
  const receiver = connectOverlay((info) => chrome.runtime.connect(info), window.parent);
  if (!receiver) return;
  createRoot(rootEl).render(
    <AppProviders posthogClient={null}>
      <ConnectedOverlay receiver={receiver} />
    </AppProviders>,
  );
}

void bootstrap();
