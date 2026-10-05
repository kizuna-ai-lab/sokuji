import React from 'react';
import type PostHog from 'posthog-js-lite';
import '../locales'; // i18n init side-effect
import { PostHogProvider } from '../contexts/PostHogContext'; // re-uses existing context

interface Props {
  posthogClient: PostHog | null;
  children: React.ReactNode;
}

export const AppProviders: React.FC<Props> = ({ posthogClient, children }) => {
  return (
    <React.StrictMode>
      <PostHogProvider client={posthogClient}>
        {children}
      </PostHogProvider>
    </React.StrictMode>
  );
};
