import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/scrollbar.scss';
import './index.scss';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { PostHogProvider } from 'posthog-js/react';
import { AnalyticsConsent } from './lib/analytics';

const options = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  // Disable automatic tracking until consent is granted
  autocapture: false,
  capture_pageview: false,
  disable_session_recording: !AnalyticsConsent.hasConsent(),
  opt_out_capturing_by_default: !AnalyticsConsent.hasConsent(),
  // Privacy settings
  mask_all_text: true,
  mask_all_element_attributes: true,
  // Performance settings
  loaded: (posthog: any) => {
    if (AnalyticsConsent.hasConsent()) {
      posthog.opt_in_capturing();
    } else {
      posthog.opt_out_capturing();
    }
  }
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Only initialize PostHog if we have the required environment variables
const shouldInitializePostHog = 
  import.meta.env.VITE_PUBLIC_POSTHOG_KEY && 
  import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

root.render(
  <React.StrictMode>
    {shouldInitializePostHog ? (
      <PostHogProvider 
        apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY}
        options={options}
      >
        <App />
      </PostHogProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
