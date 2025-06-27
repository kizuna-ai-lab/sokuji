import React, { useState, useEffect, createContext, useContext } from 'react';
import ReactDOM from 'react-dom/client';
import App from '../src/App';
import PostHog from 'posthog-js-lite';
import { ANALYTICS_CONFIG, isDevelopment, getPlatform, getEnvironment } from '../src/config/analytics';

// Create PostHog context for React
const PostHogContext = createContext<PostHog | null>(null);

// PostHog Provider component
export const PostHogProvider: React.FC<{ client: PostHog; children: React.ReactNode }> = ({ client, children }) => {
  return (
    <PostHogContext.Provider value={client}>
      {children}
    </PostHogContext.Provider>
  );
};

// Hook to use PostHog in components
export const usePostHog = () => {
  const posthog = useContext(PostHogContext);
  if (!posthog) {
    console.warn('[Sokuji] usePostHog called outside of PostHogProvider');
  }
  return posthog;
};

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
      console.warn('[Sokuji] Could not load styles:', e2);
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

const initializePostHog = async () => {
  const packageInfo = await getPackageInfo();

  const options = {
    host: ANALYTICS_CONFIG.POSTHOG_HOST,
    debug: isDevelopment(),
    // debug: false,
    // posthog-js-lite specific options
    persistence: 'localStorage' as 'localStorage',
    // Enable SPA navigation tracking
    captureHistoryEvents: true,
    defaultOptIn: true,
    autocapture: true,
    disableCompression: isDevelopment(),
    // // Disable batching - send events immediately
    flushAt: 1,        // Send immediately after 1 event (no batching)
    flushInterval: 2000   // Don't wait for time interval
  };

  // Initialize PostHog with posthog-js-lite
  const posthog = new PostHog(ANALYTICS_CONFIG.POSTHOG_KEY, options);
  
  // Set Super Properties that will be included with every event
  await posthog.register({
    app_version: packageInfo.version,
    environment: getEnvironment(),
    platform: getPlatform(),
    user_agent: navigator.userAgent,
  });
  
  // In development, opt out by default
  if (isDevelopment()) {
    // posthog.optOut();
    // console.debug('[Sokuji] PostHog initialized in development mode - capturing is opt-out by default');
    // console.debug('[Sokuji] Call posthog.optIn() to enable tracking in development');
  }
  
  // Sync distinct_id to background script in extension environment
  if (getPlatform() === 'extension') {
    // Import and call sync function
    import('../src/lib/analytics').then(({ syncDistinctIdToBackground }) => {
      // Small delay to ensure PostHog is fully initialized
      setTimeout(() => {
        syncDistinctIdToBackground(posthog);
      }, 500);
    }).catch(error => {
      console.warn('[Sokuji] [PostHog] Could not sync distinct_id to background script:', error.message);
    });
  }
  
  return posthog;
};

const UnifiedApp = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [posthogClient, setPosthogClient] = useState<PostHog | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      // Load styles
      await loadStyles();
      
      // Initialize PostHog client
      const client = await initializePostHog();
      setPosthogClient(client);
      
      // Mark as loaded
      setIsLoaded(true);
    };

    initializeApp();
  }, []);

  if (!isLoaded || !posthogClient) {
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
      <PostHogProvider client={posthogClient}>
        <App />
      </PostHogProvider>
    </React.StrictMode>
  );
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(<UnifiedApp />); 