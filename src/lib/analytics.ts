import { usePostHog } from 'posthog-js/react';

// Analytics event types based on the GitHub issue requirements
export interface AnalyticsEvents {
  // Application lifecycle
  'app_startup': { version: string; platform: string };
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
    device_name?: string; // anonymized
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
  
  // Anonymize device names if they contain personal info
  if (sanitized.device_name && typeof sanitized.device_name === 'string') {
    sanitized.device_name = anonymizeDeviceName(sanitized.device_name);
  }
  
  return sanitized;
};

// Anonymize device names to remove personal information
const anonymizeDeviceName = (deviceName: string): string => {
  // Replace common personal identifiers with generic terms
  return deviceName
    .replace(/\b\w+['']s\s/gi, 'User\'s ') // Replace possessive names
    .replace(/\b[A-Z][a-z]+\s+(MacBook|iPhone|iPad|PC|Computer)/gi, 'User $1') // Replace names before device types
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_ADDRESS]') // Replace IP addresses
    .trim();
};

// Consent management
export const AnalyticsConsent = {
  STORAGE_KEY: 'posthog_analytics_consent',
  
  hasConsent(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) === 'true';
  },
  
  grantConsent(): void {
    localStorage.setItem(this.STORAGE_KEY, 'true');
  },
  
  revokeConsent(): void {
    localStorage.setItem(this.STORAGE_KEY, 'false');
    // Clear any existing PostHog data
    localStorage.removeItem('ph_phc_EMOuUDTntTI5SuzKQATy11qHgxVrlhJsgNFbBaWEhet_posthog');
  },
  
  isConsentRequired(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) === null;
  }
}; 