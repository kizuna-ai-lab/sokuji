import React, { useState, useEffect } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';
import { SignIn } from './routes/SignIn';
import { SignUp } from './routes/SignUp';
import { ForgotPassword } from './routes/ForgotPassword';
import { isExtension } from './utils/environment';
import { TranslationProto } from './lib/local-inference/TranslationProto';
import { AsrProto } from './lib/local-inference/AsrProto';
import { TtsProto } from './lib/local-inference/TtsProto';

const isExtensionEnvironment = isExtension();

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
      {
        path: 'sign-in/*',
        element: <SignIn />,
      },
      {
        path: 'sign-up/*',
        element: <SignUp />,
      },
      {
        path: 'forgot-password',
        element: <ForgotPassword />,
      },
    ],
  },
]);

function App() {
  // DEV ONLY: Ctrl+Shift+T toggles translation prototype overlay
  const [showProto, setShowProto] = useState(false);
  // DEV ONLY: Ctrl+Shift+A toggles ASR prototype overlay
  const [showAsrProto, setShowAsrProto] = useState(false);
  // DEV ONLY: Ctrl+Shift+S toggles TTS prototype overlay
  const [showTtsProto, setShowTtsProto] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        setShowProto(prev => !prev);
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setShowAsrProto(prev => !prev);
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        setShowTtsProto(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="App">
      <RouterProvider router={router} />
      {import.meta.env.DEV && showProto && (
        <div style={{
          position: 'fixed', top: 10, right: 10, zIndex: 99999,
          maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', borderRadius: 8,
        }}>
          <TranslationProto />
        </div>
      )}
      {import.meta.env.DEV && showAsrProto && (
        <div style={{
          position: 'fixed', top: 10, left: 10, zIndex: 99999,
          maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', borderRadius: 8,
        }}>
          <AsrProto />
        </div>
      )}
      {import.meta.env.DEV && showTtsProto && (
        <div style={{
          position: 'fixed', bottom: 10, right: 10, zIndex: 99999,
          maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', borderRadius: 8,
        }}>
          <TtsProto />
        </div>
      )}
    </div>
  );
}

export default App;
