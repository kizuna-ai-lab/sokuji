// src/viewer/main.tsx
import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from './ViewerApp';

// The present page is for the host's own window; its QR code module loads only there.
const PresentApp = lazy(() => import('./PresentApp'));

const root = document.getElementById('root');
if (root) {
  const present = window.location.pathname.startsWith('/present');
  createRoot(root).render(
    <React.StrictMode>
      {present ? <Suspense fallback={null}><PresentApp /></Suspense> : <ViewerApp />}
    </React.StrictMode>,
  );
}
