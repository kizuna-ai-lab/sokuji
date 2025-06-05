import { usePostHog } from 'posthog-js/react';

// Analytics event types based on the GitHub issue requirements
export interface AnalyticsEvents {
  // Application lifecycle
  'app_startup': {}; // version and platform are now in Super Properties
  'app_shutdown': { session_duration: number };
  
  // Translation sessions
  'translation_session_start': { 
    source_language: string; 
    target_language: string;
    session_id: string;
  };
  'translation_session_end': { 
    session_id: string;
    duration: number;
    translation_count: number;
  };
  
  // Audio handling
  'audio_device_changed': { 
    device_type: string;
    device_name?: string;
  };
  'audio_quality_metric': {
    quality_score: number;
    latency: number;
  };
  
  // User interactions
  'settings_modified': { 
    setting_name: string;
    old_value?: any;
    new_value?: any;
  };
  'language_changed': { 
    from_language?: string;
    to_language: string;
    language_type: 'source' | 'target';
  };
  'ui_interaction': { 
    component: string;
    action: string;
    element?: string;
  };
  
  // Performance metrics
  'performance_metric': {
    metric_name: string;
    value: number;
    unit?: string;
  };
  'latency_measurement': {
    operation: string;
    latency_ms: number;
  };
  
  // Error tracking
  'error_occurred': {
    error_type: string;
    error_message: string;
    component?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  };
  'api_error': {
    endpoint: string;
    status_code?: number;
    error_message: string;
  };
  
  // Extension usage
  'extension_installed': { extension_version: string };
  'extension_uninstalled': { extension_version: string };
  'extension_used': { 
    feature: string;
    usage_context?: string;
  };
}

// Sensitive data patterns to exclude from analytics
const SENSITIVE_FIELDS = [
  'email', 'phone', 'address', 'ip', 'password', 'token',
  'audio_content', 'translation_text', 'user_input', 'api_key'
];

// Function to sanitize data before sending to analytics
function sanitizeData(data: Record<string, any>): Record<string, any> {
  const sanitized = { ...data };
  
  for (const field of SENSITIVE_FIELDS) {
    if (field in sanitized) {
      delete sanitized[field];
    }
  }
  
  return sanitized;
}

// Custom hook for analytics
export function useAnalytics() {
  const posthog = usePostHog();

  const trackEvent = <T extends keyof AnalyticsEvents>(
    eventName: T,
    properties: AnalyticsEvents[T]
  ) => {
    try {
      if (posthog) {
        const sanitizedProperties = sanitizeData(properties as Record<string, any>);
        posthog.capture(eventName, sanitizedProperties);
      }
    } catch (error) {
      console.error('Analytics tracking error:', error);
    }
  };

  const identifyUser = (userId: string, traits?: Record<string, any>) => {
    try {
      if (posthog) {
        const sanitizedTraits = traits ? sanitizeData(traits) : {};
        posthog.identify(userId, sanitizedTraits);
      }
    } catch (error) {
      console.error('User identification error:', error);
    }
  };

  const setUserProperties = (properties: Record<string, any>) => {
    try {
      if (posthog) {
        const sanitizedProperties = sanitizeData(properties);
        posthog.people.set(sanitizedProperties);
      }
    } catch (error) {
      console.error('Set user properties error:', error);
    }
  };

  // Development helpers
  const enableCapturing = () => {
    if (import.meta.env.DEV && posthog) {
      posthog.opt_in_capturing();
      console.log('PostHog capturing enabled for development');
    }
  };

  const disableCapturing = () => {
    if (import.meta.env.DEV && posthog) {
      posthog.opt_out_capturing();
      console.log('PostHog capturing disabled for development');
    }
  };

  const isCapturingEnabled = () => {
    return posthog ? !posthog.has_opted_out_capturing() : false;
  };

  return {
    trackEvent,
    identifyUser,
    setUserProperties,
    // Development helpers (only available in development)
    ...(import.meta.env.DEV && {
      enableCapturing,
      disableCapturing,
      isCapturingEnabled,
    }),
  };
} 