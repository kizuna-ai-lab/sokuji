import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PostHogProvider } from './lib/analytics';
import { I18nProvider } from './lib/i18n';
import App from './App';
import './styles/global.scss';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <PostHogProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PostHogProvider>
    </I18nProvider>
  </StrictMode>
);
