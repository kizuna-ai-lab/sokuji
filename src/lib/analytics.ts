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
    old_value?: string;
    new_value?: string;
  };
  'feature_used': { 
    feature_name: string;
    context?: string;
  };
  
  // Performance metrics
  'performance_metric': {
    metric_name: string;
    value: number;
    unit: string;
  };
  
  // Error tracking
  'error_occurred': {
    error_type: string;
    error_message?: string; // sanitized
    component?: string;
  };
  
  // Extension usage
  'extension_interaction': {
    platform: string;
    action: string;
    context?: string;
  };
}

// Custom hook for analytics
export const useAnalytics = () => {
  const posthog = usePostHog();

  const trackEvent = <T extends keyof AnalyticsEvents>(
    eventName: T,
    properties: AnalyticsEvents[T]
  ) => {
    if (!posthog) return;
    
    // Ensure no sensitive data is tracked
    const sanitizedProperties = sanitizeProperties(properties);
    
    // Super Properties (app_version, environment, platform, user_agent) 
    // are automatically included with every event
    posthog.capture(eventName, sanitizedProperties);
  };

  const identifyUser = (userId: string, properties?: Record<string, any>) => {
    if (!posthog) return;
    
    // Only track non-sensitive user properties
    const sanitizedProperties = sanitizeProperties(properties || {});
    posthog.identify(userId, sanitizedProperties);
  };

  const setUserProperties = (properties: Record<string, any>) => {
    if (!posthog) return;
    
    const sanitizedProperties = sanitizeProperties(properties);
    posthog.setPersonProperties(sanitizedProperties);
  };

  const resetUser = () => {
    if (!posthog) return;
    posthog.reset();
  };

  return {
    trackEvent,
    identifyUser,
    setUserProperties,
    resetUser,
    posthog
  };
};

// Utility function to sanitize properties and remove sensitive data
const sanitizeProperties = (properties: Record<string, any>): Record<string, any> => {
  const sanitized = { ...properties };
  
  // Remove or hash sensitive fields
  const sensitiveFields = ['email', 'phone', 'address', 'ip', 'audio_content', 'translation_text'];
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      delete sanitized[field];
    }
  });
  
  return sanitized;
}; 