import React, { useState, useEffect, lazy, Suspense } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';
import { SignIn } from './routes/SignIn';
import { SignUp } from './routes/SignUp';
import { ForgotPassword } from './routes/ForgotPassword';

const VoxtralAsrProto = lazy(() =>
  import('./lib/local-inference/VoxtralAsrProto').then((m) => ({
    default: m.VoxtralAsrProto,
  })),
);

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
  const [showVoxtralProto, setShowVoxtralProto] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+V: Toggle Voxtral ASR Prototype
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        setShowVoxtralProto((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="App">
      <RouterProvider router={router} />
      {showVoxtralProto && (
        <Suspense fallback={null}>
          <VoxtralAsrProto onClose={() => setShowVoxtralProto(false)} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
