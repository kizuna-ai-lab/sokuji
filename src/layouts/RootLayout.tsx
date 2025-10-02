/**
 * Root layout component that wraps the entire application
 * and provides routing functionality for Chrome extensions
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAnalytics } from '../lib/analytics';

export function RootLayout() {
  const { trackEvent } = useAnalytics();

  React.useEffect(() => {
    // Track app startup - version, platform, environment are automatically included via Super Properties
    trackEvent('app_startup', {});

    // Track app shutdown on beforeunload
    const handleBeforeUnload = () => {
      const sessionStart = sessionStorage.getItem('session_start');
      const sessionDuration = sessionStart
        ? Date.now() - parseInt(sessionStart, 10)
        : 0;

      trackEvent('app_shutdown', {
        session_duration: sessionDuration
      });
    };

    // Store session start time
    if (!sessionStorage.getItem('session_start')) {
      sessionStorage.setItem('session_start', Date.now().toString());
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [trackEvent]);

  return <Outlet />;
}