/**
 * Root layout component that wraps the entire application with ClerkProvider
 * and provides routing functionality for Chrome extensions
 */

import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ClerkProvider } from '../lib/clerk/ClerkProvider';
import { useAnalytics } from '../lib/analytics';
import { dark } from '@clerk/themes';
import { loadClerkLocalization, getClerkLocalization } from '../lib/clerk/localization';
import i18n from '../locales';

export function RootLayout() {
  const navigate = useNavigate();
  const { trackEvent } = useAnalytics();
  const [clerkLocalization, setClerkLocalization] = React.useState(() => 
    getClerkLocalization(i18n.language)
  );

  // Router functions for Clerk to use with virtual routing
  const routerPush = (to: string) => {
    navigate(to);
  };

  const routerReplace = (to: string) => {
    navigate(to, { replace: true });
  };

  // Load Clerk localization when i18n language changes
  React.useEffect(() => {
    const handleLanguageChange = async (language: string) => {
      const localization = await loadClerkLocalization(language);
      setClerkLocalization(localization);
    };

    // Listen for language changes
    i18n.on('languageChanged', handleLanguageChange);

    // Load initial localization if different from default
    if (i18n.language !== 'en') {
      handleLanguageChange(i18n.language).catch(() => {});
    }

    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  // ClerkProvider props with routing functions for memory router navigation
  const clerkProps = {
    publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '',
    routerPush,
    routerReplace,
    fallbackRedirectUrl: '/',
    signInUrl: '/sign-in',
    signUpUrl: '/sign-up',
    appearance: {
      baseTheme: dark,
    },
    localization: clerkLocalization,
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