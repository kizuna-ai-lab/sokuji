// src/subtitle-overlay-entry.tsx
import { createRoot } from 'react-dom/client';
import { AppProviders } from './components/AppProviders';
import SubtitleApp from './components/Subtitle/SubtitleApp';
import { installSessionPortMirror, postUserExit } from './stores/sessionPortMirror';
import { useSubtitleStore } from './stores/subtitleStore';

async function bootstrap() {
  // Hydrate the subtitle store from chrome.storage (via SettingsService).
  await useSubtitleStore.getState().hydrate();

  // Open the session-data port to the sidepanel.
  installSessionPortMirror();

  // Wire ✕ → port. SubtitleApp's local exitSubtitleMode resolves no-op in the
  // iframe context (no real settings store wiring for lifecycle here); we use
  // a window-level event to forward the click.
  window.addEventListener('sokuji:user-exit', postUserExit);

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    console.error('[Sokuji subtitle overlay] #root not found');
    return;
  }
  createRoot(rootEl).render(
    <AppProviders posthogClient={null}>
      <SubtitleApp surface="extension-overlay" />
    </AppProviders>,
  );
}

void bootstrap();
