/**
 * Root layout component that wraps the entire application with ClerkProvider
 * and provides routing functionality for Chrome extensions
 */

import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ClerkProvider, isExtensionEnvironment } from '../lib/clerk/ClerkProvider';
import { useAnalytics } from '../lib/analytics';
import { dark } from '@clerk/themes';

export function RootLayout() {
  const navigate = useNavigate();
  const { trackEvent } = useAnalytics();

  // Router functions for Clerk to use with virtual routing
  const routerPush = (to: string) => {
    navigate(to);
  };

  const routerReplace = (to: string) => {
    navigate(to, { replace: true });
  };

  // Different props for different environments
  const clerkProps = isExtensionEnvironment
    ? {
        publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '',
        routerPush,
        routerReplace,
        fallbackRedirectUrl: '/',
        signInUrl: '/sign-in',
        signUpUrl: '/sign-up',
        appearance: {
          baseTheme: dark,
        },
      }
    : {
        publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '',
        fallbackRedirectUrl: '/',
        signInUrl: '/sign-in',
        signUpUrl: '/sign-up',
        appearance: {
          baseTheme: dark,
        },
      };

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

  return (
    <ClerkProvider {...clerkProps}>
      <Outlet />
    </ClerkProvider>
  );
}