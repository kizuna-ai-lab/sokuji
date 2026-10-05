import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { NativeTtsProto } from './components/dev/NativeTtsProto';
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';

// Development builds only: in a release build the condition is false at build time and these imports go.
const SpinePreview = import.meta.env.DEV ? lazy(() => import('./components/dev/SpinePreview').then((m) => ({ default: m.SpinePreview }))) : null;
const OverlayPreview = import.meta.env.DEV ? lazy(() => import('./components/dev/OverlayPreview').then((m) => ({ default: m.OverlayPreview }))) : null;
const NoticesPreview = import.meta.env.DEV ? lazy(() => import('./components/dev/NoticesPreview').then((m) => ({ default: m.NoticesPreview }))) : null;

// Create the memory router for Chrome extension
// Memory router is recommended for Chrome extensions as they don't have a URL bar
const router = createMemoryRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
    ],
  },
]);

function App() {
  // Dev-only: Ctrl+Shift+N toggles the native python-sidecar TTS proto.
  const [showNativeTts, setShowNativeTts] = useState(false);
  // Dev-only: Ctrl+Shift+L toggles the notices preview over the running app
  // (the same page as `?preview=notices`), so it can be looked at in Electron.
  const [showNotices, setShowNotices] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        e.preventDefault();
        setShowNativeTts((v) => !v);
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        setShowNotices((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dev-only: `?preview=spine` shows the new provider layer alone (plans 1b–1d).
  if (SpinePreview && new URLSearchParams(window.location.search).get('preview') === 'spine') {
    return (
      <div className="App">
        <Suspense fallback={null}>
          <SpinePreview />
        </Suspense>
      </div>
    );
  }

  // Dev-only: `?preview=notices` draws every status line above the real footer
  // (spec 2026-10-05 §3), to look at.
  if (NoticesPreview && new URLSearchParams(window.location.search).get('preview') === 'notices') {
    return (
      <div className="App">
        <Suspense fallback={null}>
          <NoticesPreview />
        </Suspense>
      </div>
    );
  }

  // Dev-only: `?preview=overlay` is the extension overlay's stand-in, drawn
  // inside the spine preview's iframe (plan 1d-2).
  if (OverlayPreview && new URLSearchParams(window.location.search).get('preview') === 'overlay') {
    return (
      <div className="App">
        <Suspense fallback={null}>
          <OverlayPreview />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="App">
      <RouterProvider router={router} />
      {showNativeTts && <NativeTtsProto onClose={() => setShowNativeTts(false)} />}
      {showNotices && NoticesPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000 }}>
          <Suspense fallback={null}>
            <NoticesPreview />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default App;
