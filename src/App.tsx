import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';
import { SignIn } from './routes/SignIn';
import { SignUp } from './routes/SignUp';
import { ForgotPassword } from './routes/ForgotPassword';
import { isExtension } from './utils/environment';

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
  return (
    <div className="App">
      <RouterProvider router={router} />
    </div>
  );
}

export default App;
