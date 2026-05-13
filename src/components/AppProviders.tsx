import React from 'react';
import type PostHog from 'posthog-js-lite';
import '../locales'; // i18n init side-effect
import { ToastProvider } from './Toast';
import { PostHogProvider } from '../contexts/PostHogContext'; // re-uses existing context

interface Props {
  posthogClient: PostHog | null;
  children: React.ReactNode;
}

export const AppProviders: React.FC<Props> = ({ posthogClient, children }) => {
  return (
    <React.StrictMode>
      <PostHogProvider client={posthogClient}>
        <ToastProvider>{children}</ToastProvider>
      </PostHogProvider>
    </React.StrictMode>
  );
};
