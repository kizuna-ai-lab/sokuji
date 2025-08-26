import { usePostHog } from '../../shared/index';
import { isDevelopment, getPlatform } from '../config/analytics';

// Analytics event types - Comprehensive product metrics for Sokuji
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
    provider: string;
    model?: string;
    vad_mode?: string;
  };
  'translation_session_end': { 
    session_id: string;
    duration: number;
    translation_count: number;
    provider: string;
    error_count?: number;
  };
  'translation_completed': {
    session_id: string;
    source_language: string;
    target_language: string;
    latency_ms: number;
    provider: string;
  };
  
  // Audio handling
  'audio_device_changed': { 
    device_type: 'input' | 'output';
    device_name?: string;
    change_type: 'selected' | 'connected' | 'disconnected';
    during_session: boolean;
  };
  'audio_quality_metric': {
    quality_score: number;
    latency: number;
    echo_cancellation_enabled: boolean;
    noise_suppression_enabled: boolean;
  };
  'audio_passthrough_toggled': {
    enabled: boolean;
    volume_level: number;
  };
  'virtual_device_warning': {
    device_type: 'input' | 'output';
    action_taken: 'ignored' | 'changed_device';
  };
  
  // Settings & Configuration
  'settings_modified': { 
    setting_name: string;
    old_value?: any;
    new_value?: any;
    provider?: string;
    category: 'api' | 'audio' | 'language' | 'advanced';
  };
  'language_changed': { 
    from_language?: string;
    to_language: string;
    language_type: 'source' | 'target' | 'ui';
  };
  'provider_switched': {
    from_provider: string;
    to_provider: string;
    during_session: boolean;
  };
  'api_key_validated': {
    provider: string;
    success: boolean;
    error_type?: string;
  };
  
  // User interactions
  'ui_interaction': { 
    component: string;
    action: string;
    element?: string;
    value?: any;
  };
  'ui_mode_toggled': {
    from_mode: 'basic' | 'advanced';
    to_mode: 'basic' | 'advanced';
  };
  'user_type_selected': {
    user_type: 'regular' | 'experienced';
    is_first_time_user: boolean;
  };
  'user_type_applied': {
    user_type: 'regular' | 'experienced';
    ui_mode: 'basic' | 'advanced';
  };
  'push_to_talk_used': {
    session_id: string;
    hold_duration_ms: number;
  };
  'session_control_clicked': {
    action: 'start' | 'stop';
    method: 'button' | 'keyboard';
  };
  'panel_viewed': {
    panel_name: 'main' | 'settings' | 'audio' | 'logs';
    view_duration_ms?: number;
  };
  'help_accessed': {
    help_type: 'onboarding' | 'tutorial' | 'documentation';
    source: string;
  };
  
  // Performance metrics
  'performance_metric': {
    metric_name: string;
    value: number;
    unit?: string;
    percentile?: number;
  };
  'latency_measurement': {
    operation: 'api_call' | 'audio_processing' | 'translation' | 'websocket';
    latency_ms: number;
    provider?: string;
  };
  'connection_status': {
    status: 'connected' | 'disconnected' | 'reconnecting';
    provider: string;
    duration_ms?: number;
  };
  
  // Error tracking
  'error_occurred': {
    error_type: string;
    error_message: string;
    component?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    provider?: string;
    recoverable: boolean;
  };
  'api_error': {
    provider: string;
    endpoint?: string;
    status_code?: number;
    error_message: string;
    error_type: 'auth' | 'rate_limit' | 'network' | 'server' | 'client';
  };
  'audio_error': {
    error_type: 'device_access' | 'processing' | 'playback' | 'recording';
    error_message: string;
    device_info?: string;
  };
  
  // Extension specific events
  'extension_installed': { extension_version: string };
  'extension_uninstalled': { extension_version: string };
  'extension_popup_opened': {
    is_supported_site: boolean;
    hostname: string | null;
    browser_type?: string;
  };
  'extension_popup_supported_state_shown': {
    hostname: string;
    site_name: string;
  };
  'extension_popup_unsupported_state_shown': {
    hostname: string;
    supported_sites_count: number;
  };
  'extension_popup_error': {
    error_type: string;
    error_message?: string;
  };
  'extension_side_panel_opened': {
    trigger: 'popup' | 'action' | 'context_menu';
    site?: string;
  };
  'extension_side_panel_closed': {
    duration_ms: number;
  };
  'extension_site_navigated': {
    from_site?: string;
    to_site: string;
    navigation_source: 'popup' | 'link';
  };
  'extension_permissions_requested': {
    permission_type: string;
    granted: boolean;
  };
  
  // Feature adoption
  'feature_discovered': {
    feature_name: string;
    discovery_method: 'onboarding' | 'exploration' | 'documentation';
  };
  'feature_first_use': {
    feature_name: string;
    time_since_install_hours?: number;
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
    }
    
    // Send message to background script to update uninstall URL
    (window as any).chrome.runtime.sendMessage({
      type: 'UPDATE_UNINSTALL_URL',
      distinct_id: distinctId
    }, (response: any) => {
      if ((window as any).chrome.runtime.lastError) {
        console.error('[Sokuji] [Analytics] Error syncing distinct_id to background:', (window as any).chrome.runtime.lastError);
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
        const sanitizedProperties = sanitizeData(properties as Record<string, any>);
        posthog.capture(eventName, sanitizedProperties);
        
        // Sync distinct_id to background script after tracking events
        // Use a small delay to ensure PostHog has processed the event
        setTimeout(() => {
          syncDistinctIdToBackground(posthog);
        }, 100);
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
    }
  };

  const disableCapturing = () => {
    if (isDevelopment() && posthog) {
      posthog.optOut();
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