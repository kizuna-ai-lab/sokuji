import React from 'react';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';
import { Dashboard } from './routes/Dashboard';
import { TTSShowcase } from './routes/TTSShowcase';
import { SignIn } from './routes/SignIn';
import { SignUp } from './routes/SignUp';
import { ForgotPassword } from './routes/ForgotPassword';
import { isCapacitorNative, isElectron, isExtension } from './utils/environment';

const appRoutes = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: 'translator',
        element: <Home />,
      },
      {
        path: 'tts-showcase',
        element: <TTSShowcase />,
      },
    ],
  },
];

const usesMemoryRouter = isExtension() || isElectron() || isCapacitorNative();

// Extensions and Electron windows behave best without browser history,
// while the web/Vercel deployment needs proper URL-based routing.
const router = usesMemoryRouter
  ? createMemoryRouter(appRoutes)
  : createBrowserRouter(appRoutes);

function App() {
  return (
    <div className="App">
      <RouterProvider router={router} />
    </div>
  );
}

export default App;
