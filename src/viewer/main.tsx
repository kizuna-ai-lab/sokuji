// src/viewer/main.tsx (replaced by Task 11 with the real pages)
import { createRoot } from 'react-dom/client';
import { viewerT } from './strings';

const { t } = viewerT(navigator.languages ?? [navigator.language]);
const root = document.getElementById('root');
if (root) createRoot(root).render(<p>{t('viewer.title')}</p>);
