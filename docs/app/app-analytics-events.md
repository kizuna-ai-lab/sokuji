# App Analytics Events Documentation

This document provides a comprehensive reference for all PostHog analytics events implemented in the Sokuji application.

## Overview

The Sokuji application uses PostHog for analytics tracking to understand user behavior, application performance, and feature usage. All events are defined with TypeScript interfaces to ensure consistency and type safety.

## Super Properties

The following properties are automatically included with every event:

- `app_version`: Application version from package.json (e.g., "0.4.2")
- `environment`: "development" or "production" based on build mode
- `platform`: Dynamically detected platform ("app", "extension", or "web")
- `user_agent`: Browser user agent string

## Event Categories

### 🚀 Application Lifecycle Events

#### `app_startup`
**Description**: Triggered when the application starts up.

**Properties**: None (uses Super Properties only)

**Implementation**: `src/App.tsx`

**Example**:
```typescript
trackEvent('app_startup', {});
```

---

#### `app_shutdown`
**Description**: Triggered when the application is about to close.

**Properties**:
- `session_duration` (number): Duration of the session in milliseconds

**Implementation**: `src/App.tsx`

**Example**:
```typescript
trackEvent('app_shutdown', {
  session_duration: 1800000 // 30 minutes
});
```

### 🗣️ Translation Session Events

#### `translation_session_start`
**Description**: Triggered when a new translation session begins.

**Properties**:
- `source_language` (string): Source language code (e.g., "en", "zh")
- `target_language` (string): Target language code (e.g., "en", "zh")
- `session_id` (string): Unique identifier for the session

**Implementation**: `src/components/MainPanel/MainPanel.tsx`

**Example**:
```typescript
trackEvent('translation_session_start', {
  source_language: 'en',
  target_language: 'zh',
  session_id: 'session_123456789'
});
```

---

#### `translation_session_end`
**Description**: Triggered when a translation session ends.

**Properties**:
- `session_id` (string): Unique identifier for the session
- `duration` (number): Session duration in milliseconds
- `translation_count` (number): Number of translations performed in the session

**Implementation**: `src/components/MainPanel/MainPanel.tsx`

**Example**:
```typescript
trackEvent('translation_session_end', {
  session_id: 'session_123456789',
  duration: 600000, // 10 minutes
  translation_count: 15
});
```

### 🎯 Onboarding Events

#### `onboarding_started`
**Description**: Triggered when the user starts the onboarding process.

**Properties**:
- `is_first_time_user` (boolean): Whether this is a first-time user
- `onboarding_version` (string): Version of the onboarding flow

**Implementation**: `src/contexts/OnboardingContext.tsx`

**Example**:
```typescript
trackEvent('onboarding_started', {
  is_first_time_user: true,
  onboarding_version: '1.0.0'
});
```

---

#### `onboarding_completed`
**Description**: Triggered when the user completes or skips the onboarding process.

**Properties**:
- `completion_method` ('finished' | 'skipped'): How the onboarding was completed
- `steps_completed` (number): Number of steps the user went through
- `total_steps` (number): Total number of steps in the onboarding
- `duration_ms` (number): Time spent in onboarding in milliseconds
- `onboarding_version` (string): Version of the onboarding flow

**Implementation**: `src/contexts/OnboardingContext.tsx`

**Example**:
```typescript
trackEvent('onboarding_completed', {
  completion_method: 'finished',
  steps_completed: 10,
  total_steps: 10,
  duration_ms: 180000, // 3 minutes
  onboarding_version: '1.0.0'
});
```

---

#### `onboarding_step_viewed`
**Description**: Triggered when the user views a specific onboarding step.

**Properties**:
- `step_index` (number): Index of the step being viewed (0-based)
- `step_target` (string): CSS selector or target of the step
- `step_title` (string): Title of the onboarding step

**Implementation**: `src/contexts/OnboardingContext.tsx`

**Example**:
```typescript
trackEvent('onboarding_step_viewed', {
  step_index: 2,
  step_target: '.api-key-section',
  step_title: 'Step 2: Configure API Key'
});
```

### 🔊 Audio Handling Events

#### `audio_device_changed`
**Description**: Triggered when the user changes audio input or output device.

**Properties**:
- `device_type` (string): Type of device ("input" or "output")
- `device_name` (string, optional): Name of the selected device

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('audio_device_changed', {
  device_type: 'input',
  device_name: 'Built-in Microphone'
});
```

---

#### `audio_quality_metric`
**Description**: Triggered to report audio quality measurements.

**Properties**:
- `quality_score` (number): Audio quality score (0-100)
- `latency` (number): Audio latency in milliseconds

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('audio_quality_metric', {
  quality_score: 85,
  latency: 150
});
```

### 👤 User Interaction Events

#### `settings_modified`
**Description**: Triggered when user changes application settings.

**Properties**:
- `setting_name` (string): Name of the setting that was changed
- `old_value` (any, optional): Previous value of the setting
- `new_value` (any, optional): New value of the setting

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('settings_modified', {
  setting_name: 'theme',
  old_value: 'light',
  new_value: 'dark'
});
```

---

#### `language_changed`
**Description**: Triggered when user changes source or target language.

**Properties**:
- `from_language` (string, optional): Previous language code
- `to_language` (string): New language code
- `language_type` ('source' | 'target'): Whether source or target language was changed

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('language_changed', {
  from_language: 'en',
  to_language: 'zh',
  language_type: 'target'
});
```

---

#### `ui_interaction`
**Description**: Triggered for general UI interactions.

**Properties**:
- `component` (string): Name of the UI component
- `action` (string): Action performed (e.g., "click", "hover", "focus")
- `element` (string, optional): Specific element within the component

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('ui_interaction', {
  component: 'MainPanel',
  action: 'click',
  element: 'connect_button'
});
```

### 📊 Performance Monitoring Events

#### `performance_metric`
**Description**: Triggered to report general performance measurements.

**Properties**:
- `metric_name` (string): Name of the performance metric
- `value` (number): Measured value
- `unit` (string, optional): Unit of measurement

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('performance_metric', {
  metric_name: 'memory_usage',
  value: 256,
  unit: 'MB'
});
```

---

#### `latency_measurement`
**Description**: Triggered to report operation latency measurements.

**Properties**:
- `operation` (string): Name of the operation being measured
- `latency_ms` (number): Latency in milliseconds

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('latency_measurement', {
  operation: 'api_translation_request',
  latency_ms: 250
});
```

### ❌ Error Tracking Events

#### `error_occurred`
**Description**: Triggered when application errors occur.

**Properties**:
- `error_type` (string): Type/category of the error
- `error_message` (string): Error message or description
- `component` (string, optional): Component where the error occurred
- `severity` ('low' | 'medium' | 'high' | 'critical'): Error severity level

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('error_occurred', {
  error_type: 'audio_initialization_failed',
  error_message: 'Failed to initialize audio device',
  component: 'AudioService',
  severity: 'high'
});
```

---

#### `api_error`
**Description**: Triggered when API requests fail.

**Properties**:
- `endpoint` (string): API endpoint that failed
- `status_code` (number, optional): HTTP status code
- `error_message` (string): Error message from the API

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('api_error', {
  endpoint: '/api/translate',
  status_code: 500,
  error_message: 'Internal server error'
});
```

### 🔌 Extension Usage Events

#### `extension_installed`
**Description**: Triggered when the browser extension is installed.

**Properties**:
- `extension_version` (string): Version of the installed extension

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('extension_installed', {
  extension_version: '1.0.0'
});
```

---

#### `extension_uninstalled`
**Description**: Triggered when the browser extension is uninstalled.

**Properties**:
- `extension_version` (string): Version of the uninstalled extension

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('extension_uninstalled', {
  extension_version: '1.0.0'
});
```

---

#### `extension_used`
**Description**: Triggered when extension features are used.

**Properties**:
- `feature` (string): Name of the feature used
- `usage_context` (string, optional): Context in which the feature was used

**Status**: ⚠️ Defined but not yet implemented

**Example**:
```typescript
trackEvent('extension_used', {
  feature: 'audio_profile_notification',
  usage_context: 'zoom_meeting'
});
```

### 🔧 Extension Popup Events

#### `popup_opened`
**Description**: Triggered when the extension popup is opened.

**Properties**:
- `is_supported_site` (boolean): Whether the current site supports Sokuji
- `hostname` (string | null): Hostname of the current tab
- `full_url` (string, optional): Origin URL of the current tab
- `supported_site_match` (string | null): Which supported site pattern was matched
- `error_type` (string, optional): Type of error if tab info unavailable

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('popup_opened', {
  is_supported_site: true,
  hostname: 'meet.google.com',
  full_url: 'https://meet.google.com',
  supported_site_match: 'meet.google.com'
});
```

---

#### `popup_supported_state_shown`
**Description**: Triggered when popup shows the supported site state.

**Properties**:
- `hostname` (string): Hostname of the supported site
- `site_name` (string): Display name of the supported site

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('popup_supported_state_shown', {
  hostname: 'meet.google.com',
  site_name: 'Google Meet'
});
```

---

#### `popup_unsupported_state_shown`
**Description**: Triggered when popup shows the unsupported site state.

**Properties**:
- `hostname` (string): Hostname of the unsupported site
- `supported_sites_count` (number): Number of supported sites available

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('popup_unsupported_state_shown', {
  hostname: 'example.com',
  supported_sites_count: 4
});
```

---

#### `popup_error_state_shown`
**Description**: Triggered when popup shows an error state.

**Properties**:
- `error_type` (string): Type of error encountered

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('popup_error_state_shown', {
  error_type: 'unable_to_detect_site'
});
```

---

#### `popup_open_sidepanel_clicked`
**Description**: Triggered when user clicks the "Open Sokuji" button in popup.

**Properties**:
- `tab_id` (number): ID of the current tab
- `is_supported_site` (boolean): Whether the current site supports Sokuji

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('popup_open_sidepanel_clicked', {
  tab_id: 123456,
  is_supported_site: true
});
```

---

#### `sidepanel_opened_from_popup`
**Description**: Triggered when side panel is successfully opened from popup.

**Properties**:
- `tab_id` (number): ID of the tab where side panel was opened
- `method` ('direct_api' | 'background_message'): Method used to open side panel

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('sidepanel_opened_from_popup', {
  tab_id: 123456,
  method: 'direct_api'
});
```

---

#### `sidepanel_open_error`
**Description**: Triggered when side panel fails to open from popup.

**Properties**:
- `tab_id` (number): ID of the tab where opening failed
- `error_type` ('direct_api_failed' | 'background_message_failed'): Type of failure
- `error_message` (string): Error message from the failure

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('sidepanel_open_error', {
  tab_id: 123456,
  error_type: 'direct_api_failed',
  error_message: 'Side panel API not available'
});
```

---

#### `popup_site_navigation_clicked`
**Description**: Triggered when user clicks on a supported site in popup to navigate.

**Properties**:
- `target_site` (string): URL of the site being navigated to
- `target_site_name` (string): Display name of the target site
- `is_supported_site` (boolean): Whether current site was supported

**Status**: ✅ Implemented in `extension/popup.js`

**Example**:
```typescript
trackEvent('popup_site_navigation_clicked', {
  target_site: 'meet.google.com',
  target_site_name: 'Google Meet',
  is_supported_site: false
});
```

## Implementation Status

### ✅ Currently Implemented
- `app_startup` - Application lifecycle tracking
- `app_shutdown` - Session duration tracking
- `translation_session_start` - Translation session initiation
- `translation_session_end` - Translation session completion with metrics
- `onboarding_started` - Onboarding process initiation tracking
- `onboarding_completed` - Onboarding completion/skip tracking with metrics
- `onboarding_step_viewed` - Individual onboarding step tracking
- `popup_opened` - Extension popup opening tracking
- `popup_supported_state_shown` - Popup supported site state display
- `popup_unsupported_state_shown` - Popup unsupported site state display
- `popup_error_state_shown` - Popup error state display
- `popup_open_sidepanel_clicked` - Popup side panel button clicks
- `sidepanel_opened_from_popup` - Successful side panel opening from popup
- `sidepanel_open_error` - Side panel opening errors from popup
- `popup_site_navigation_clicked` - Popup site navigation clicks

### ⚠️ Defined but Not Implemented
- `audio_device_changed` - Audio device selection tracking
- `audio_quality_metric` - Audio quality monitoring
- `settings_modified` - Settings change tracking
- `language_changed` - Language selection tracking
- `ui_interaction` - General UI interaction tracking
- `performance_metric` - Performance monitoring
- `latency_measurement` - Operation latency tracking
- `error_occurred` - Error tracking
- `api_error` - API failure tracking
- `extension_installed` - Extension installation tracking
- `extension_uninstalled` - Extension removal tracking
- `extension_used` - Extension feature usage tracking

## Data Privacy and Security

### Automatic Data Sanitization

All events are automatically sanitized to remove sensitive information before being sent to PostHog. The following fields are automatically excluded:

- `email`, `phone`, `address`, `ip`
- `password`, `token`, `api_key`
- `audio_content`, `translation_text`, `user_input`

### Implementation

Data sanitization is handled by the `sanitizeData()` function in `src/lib/analytics.ts`:

```typescript
const SENSITIVE_FIELDS = [
  'email', 'phone', 'address', 'ip', 'password', 'token',
  'audio_content', 'translation_text', 'user_input', 'api_key'
];

function sanitizeData(data: Record<string, any>): Record<string, any> {
  const sanitized = { ...data };
  
  for (const field of SENSITIVE_FIELDS) {
    if (field in sanitized) {
      delete sanitized[field];
    }
  }
  
  return sanitized;
}
```

## Development and Testing

### Development Mode

In development mode:
- Analytics capturing is disabled by default (`opt_out_capturing_by_default: true`)
- Debug logging is enabled
- Manual control functions are available

### Manual Control Functions

```typescript
const { 
  enableCapturing, 
  disableCapturing, 
  isCapturingEnabled 
} = useAnalytics();

// Enable capturing for testing
enableCapturing();

// Disable capturing
disableCapturing();

// Check current status
const isEnabled = isCapturingEnabled();
```

### Console Commands

```javascript
// Enable capturing in development
window.posthog?.opt_in_capturing();

// Disable capturing in development
window.posthog?.opt_out_capturing();

// Check if capturing is enabled
!window.posthog?.has_opted_out_capturing();
```

## File Structure

```
src/
├── lib/
│   └── analytics.ts              # Event definitions and analytics utilities
├── App.tsx                       # App lifecycle events
├── components/
│   └── MainPanel/
│       └── MainPanel.tsx         # Translation session events
└── contexts/
    └── OnboardingContext.tsx     # Onboarding events

extension/
├── popup.js                      # Extension popup events (uses local posthog-js)
└── package.json                  # PostHog dependency management
```

## Next Steps

1. **Implement Missing Events**: Add tracking for the defined but unimplemented events
2. **Error Boundaries**: Integrate automatic error tracking
3. **Performance Monitoring**: Add performance metric collection
4. **Extension Analytics**: Implement extension-specific event tracking
5. **Dashboard Setup**: Configure PostHog dashboards for key metrics

## Related Documentation

- [App Analytics Integration](./app-analytics-integration.md) - PostHog setup and configuration
- [Extension Audio Profile Notification](./extension-audio-profile-notification.md) - Extension feature documentation 