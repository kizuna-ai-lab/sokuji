import React from 'react';
import { createRoot } from 'react-dom/client';
import { PocketPlayground } from './components/dev/PocketPlayground';

const el = document.getElementById('pocket-root');
if (el) createRoot(el).render(<React.StrictMode><PocketPlayground /></React.StrictMode>);
