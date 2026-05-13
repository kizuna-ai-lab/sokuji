import React, { createContext, useContext } from 'react';
import type PostHog from 'posthog-js-lite';

// Module-scoped PostHog context. Lives in its own side-effect-free module
// so that any code (including unit tests) can mount the provider without
// pulling in the application entry point in `shared/index.tsx`.
const PostHogContext = createContext<PostHog | null>(null);

// PostHog Provider component - accepts null client for async initialization.
export const PostHogProvider: React.FC<{ client: PostHog | null; children: React.ReactNode }> = ({ client, children }) => {
  return (
    <PostHogContext.Provider value={client}>
      {children}
    </PostHogContext.Provider>
  );
};

// Hook to use PostHog in components.
// PostHog can be null during async initialization, this is expected.
// The useAnalytics hook already handles null checks properly.
export const usePostHog = () => {
  return useContext(PostHogContext);
};
