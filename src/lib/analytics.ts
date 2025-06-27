import { usePostHog } from '../../shared/index';
import { isDevelopment, getPlatform } from '../config/analytics';

// Analytics event types based on the GitHub issue requirements
export interface AnalyticsEvents {
  // Application lifecycle
  'app_startup': {}; // version and platform are now in Super Properties
  'app_shutdown': { session_duration: number };
  
  // Onboarding events
  'onboarding_started': { 
    is_first_time_user: boolean;
    onboarding_version: string;
  };
  'onboarding_completed': { 
    completion_method: 'finished' | 'skipped';
    steps_completed: number;
    total_steps: number;
    duration_ms: number;
    onboarding_version: string;
  };
  'onboarding_step_viewed': {
    step_index: number;
    step_target: string;
    step_title: string;
  };
  
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

// Sensitive fields that should be excluded from analytics
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

// Function to sync PostHog distinct_id to background script in extension environment
export async function syncDistinctIdToBackground(posthogInstance?: any): Promise<void> {
  // Only run in extension environment
  if (getPlatform() !== 'extension') {
    return;
  }

  try {
    // Get PostHog distinct_id from provided posthog instance
    let distinctId = null;
    
    // posthog-js-lite uses getDistinctId() method (no underscore)
    if (posthogInstance && typeof posthogInstance.getDistinctId === 'function') {
      distinctId = posthogInstance.getDistinctId();
      console.debug('[Sokuji] [Analytics] Retrieved distinct_id from PostHog instance');
    } else {
      console.debug('[Sokuji] [Analytics] PostHog instance not available or getDistinctId not found');
    }
    
    // Send message to background script to update uninstall URL
    (window as any).chrome.runtime.sendMessage({
      type: 'UPDATE_UNINSTALL_URL',
      distinct_id: distinctId
    }, (response: any) => {
      if ((window as any).chrome.runtime.lastError) {
        console.error('[Sokuji] [Analytics] Error syncing distinct_id to background:', (window as any).chrome.runtime.lastError);
      } else if (response?.success) {
        console.debug('[Sokuji] [Analytics] Successfully synced distinct_id to background script');
      } else {
        console.warn('[Sokuji] [Analytics] Background script returned unsuccessful response');
      }
    });
  } catch (error) {
    console.error('[Sokuji] [Analytics] Error syncing distinct_id to background:', error);
  }
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
        console.log("[Sokuji] [Analytics] Tracking event:", eventName, properties);
        const sanitizedProperties = sanitizeData(properties as Record<string, any>);
        posthog.capture(eventName, sanitizedProperties);
        
        // Sync distinct_id to background script after tracking events
        // Use a small delay to ensure PostHog has processed the event
        setTimeout(() => {
          syncDistinctIdToBackground(posthog);
        }, 100);
      } else {
        console.warn('[Sokuji] [Analytics] PostHog instance not available, event not tracked:', eventName);
      }
    } catch (error) {
      console.error('[Sokuji] [Analytics] Analytics tracking error:', error);
    }
  };

  const identifyUser = (userId: string, traits?: Record<string, any>) => {
    try {
      if (posthog) {
        const sanitizedTraits = traits ? sanitizeData(traits) : {};
        posthog.identify(userId, sanitizedTraits);
        
        // Sync distinct_id to background script after identifying user
        setTimeout(() => {
          syncDistinctIdToBackground(posthog);
        }, 100);
      }
    } catch (error) {
      console.error('[Sokuji] [Analytics] User identification error:', error);
    }
  };

  const setUserProperties = (properties: Record<string, any>) => {
    try {
      if (posthog) {
        const sanitizedProperties = sanitizeData(properties);
        posthog.identify(posthog.getDistinctId(), { $set: sanitizedProperties });
      }
    } catch (error) {
      console.error('[Sokuji] [Analytics] Set user properties error:', error);
    }
  };

  // Development helpers
  const enableCapturing = () => {
    if (isDevelopment() && posthog) {
      posthog.optIn();
      console.debug('[Sokuji] [Analytics] PostHog capturing enabled for development');
    }
  };

  const disableCapturing = () => {
    if (isDevelopment() && posthog) {
      posthog.optOut();
      console.debug('[Sokuji] [Analytics] PostHog capturing disabled for development');
    }
  };

  const isCapturingEnabled = () => {
    // posthog-js-lite doesn't have has_opted_out_capturing, we'll assume opted in unless explicitly opted out
    // This is a simplified implementation - you might want to track opt-out state separately
    return posthog ? true : false;
  };

  // Helper function to get current distinct_id
  const getDistinctId = () => {
    try {
      if (posthog && posthog.getDistinctId) {
        return posthog.getDistinctId();
      }
      return null;
    } catch (error) {
      console.error('[Sokuji] [Analytics] Error getting distinct_id:', error);
      return null;
    }
  };

  // Sync function that uses the current posthog instance
  const syncDistinctId = () => syncDistinctIdToBackground(posthog);

  return {
    trackEvent,
    identifyUser,
    setUserProperties,
    syncDistinctIdToBackground: syncDistinctId,
    getDistinctId,
    // Development helpers (only available in development)
    ...(isDevelopment() && {
      enableCapturing,
      disableCapturing,
      isCapturingEnabled,
    }),
  };
} 