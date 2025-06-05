import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from '../src/App';
import { PostHogProvider } from 'posthog-js/react';
import { ANALYTICS_CONFIG, isDevelopment, getPlatform, getEnvironment } from '../src/config/analytics';

// Dynamically import styles based on environment
const loadStyles = async () => {
  try {
    // Try to import main project styles (Vite environment)
    await import('../src/styles/scrollbar.scss' as any);
    await import('../src/index.scss' as any);
  } catch (e) {
    // If failed, try to import extension environment styles
    try {
      await import('../src/App.scss' as any);
    } catch (e2) {
      console.warn('Could not load styles:', e2);
    }
  }
};

// Dynamically get package.json (handle different environment paths)
const getPackageInfo = async () => {
  try {
    const packageInfo = await import('../package.json');
    return packageInfo.default || packageInfo;
  } catch (e) {
    // If unable to get package.json, return default value
    return { version: '0.4.2' };
  }
};

const PostHogOptions = async () => {
  const packageInfo = await getPackageInfo();
  const platform = getPlatform();
  
  return {
    api_host: ANALYTICS_CONFIG.POSTHOG_HOST,
    debug: isDevelopment(),
    // According to official documentation, browser extensions must disable external dependency loading
    disable_external_dependency_loading: true,
    disable_surveys: true,
    // Recommended persistence method for browser extensions
    persistence: platform === 'extension' ? 'localStorage' : 'localStorage+cookie',
    // Set Super Properties during initialization
    loaded: (posthog: any) => {
      // Set Super Properties that will be included with every event
      posthog.register({
        app_version: packageInfo.version,
        environment: getEnvironment(),
        platform: getPlatform(),
        user_agent: navigator.userAgent,
      });
      
      // In development, manually opt in to capturing if needed
      if (isDevelopment()) {
        // You can manually opt in during development by calling:
        // posthog.opt_in_capturing();
        console.debug('PostHog initialized in development mode - capturing is opt-out by default');
      }
    }
  };
};

const UnifiedApp = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [posthogOptions, setPosthogOptions] = useState<any>(null);

  useEffect(() => {
    const initializeApp = async () => {
      // Load styles
      await loadStyles();
      
      // Set PostHog options
      const options = await PostHogOptions();
      setPosthogOptions(options);
      
      // Mark as loaded
      setIsLoaded(true);
    };

    initializeApp();
  }, []);

  if (!isLoaded || !posthogOptions) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <React.StrictMode>
      <PostHogProvider 
        apiKey={ANALYTICS_CONFIG.POSTHOG_KEY}
        options={posthogOptions}
      >
        <App />
      </PostHogProvider>
    </React.StrictMode>
  );
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(<UnifiedApp />); 