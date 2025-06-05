import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/scrollbar.scss';
import './index.scss';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { PostHogProvider } from 'posthog-js/react';
import packageInfo from '../package.json';

const options = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  debug: import.meta.env.DEV,
  // Set Super Properties during initialization
  loaded: (posthog: any) => {
    // Set Super Properties that will be included with every event
    posthog.register({
      app_version: packageInfo.version,
      environment: import.meta.env.DEV ? 'development' : 'production',
      platform: 'web',
      user_agent: navigator.userAgent,
    });
  }
}

// Only initialize PostHog if we have the required environment variables
const shouldInitializePostHog = 
  import.meta.env.VITE_PUBLIC_POSTHOG_KEY && 
  import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

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
