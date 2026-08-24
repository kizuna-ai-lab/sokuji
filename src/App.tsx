import React, { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { NativeTtsProto } from './components/dev/NativeTtsProto';
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';

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
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        e.preventDefault();
        setShowNativeTts((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="App">
      <RouterProvider router={router} />
      {showNativeTts && <NativeTtsProto onClose={() => setShowNativeTts(false)} />}
    </div>
  );
}

export default App;
