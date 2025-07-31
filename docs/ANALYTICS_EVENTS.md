# Sokuji Analytics Events Documentation

This document provides a comprehensive overview of all analytics events tracked in the Sokuji real-time translation application. All events are sent to PostHog for product analytics.

## Table of Contents
1. [Application Lifecycle Events](#application-lifecycle-events)
2. [Onboarding Events](#onboarding-events)
3. [Translation Session Events](#translation-session-events)
4. [Audio Device Management Events](#audio-device-management-events)
5. [Settings & Configuration Events](#settings--configuration-events)
6. [User Interaction Events](#user-interaction-events)
7. [Performance & Latency Events](#performance--latency-events)
8. [Error Tracking Events](#error-tracking-events)
9. [Extension-Specific Events](#extension-specific-events)
10. [Feature Adoption Events](#feature-adoption-events)

## Application Lifecycle Events

### `app_startup`
**Description**: Tracked when the application starts  
**Properties**:
- None (version and platform are in Super Properties)

### `app_shutdown`
**Description**: Tracked when the application is closed  
**Properties**:
- `session_duration` (number): Total time the app was open in milliseconds

## Onboarding Events

### `onboarding_started`
**Description**: User begins the onboarding flow  
**Properties**:
- `is_first_time_user` (boolean): Whether this is the user's first time
- `onboarding_version` (string): Version of the onboarding flow

### `onboarding_completed`
**Description**: User completes or skips onboarding  
**Properties**:
- `completion_method` ('finished' | 'skipped'): How onboarding ended
- `steps_completed` (number): Number of steps completed
- `total_steps` (number): Total number of steps
- `duration_ms` (number): Time spent in onboarding
- `onboarding_version` (string): Version of the onboarding flow

### `onboarding_step_viewed`
**Description**: User views a specific onboarding step  
**Properties**:
- `step_index` (number): Zero-based index of the step
- `step_target` (string): DOM selector of the highlighted element
- `step_title` (string): Title of the step

## Translation Session Events

### `translation_session_start`
**Description**: User starts a translation session  
**Properties**:
- `source_language` (string): Source language code
- `target_language` (string): Target language code
- `session_id` (string): Unique session identifier
- `provider` (string): AI provider (openai, gemini, comet_api, palabra_ai)
- `model` (string, optional): Model name
- `vad_mode` (string, optional): Voice activity detection mode

### `translation_session_end`
**Description**: Translation session ends  
**Properties**:
- `session_id` (string): Unique session identifier
- `duration` (number): Session duration in milliseconds
- `translation_count` (number): Number of translations performed
- `provider` (string): AI provider used
- `error_count` (number, optional): Number of errors during session

### `translation_completed`
**Description**: Individual translation completed  
**Properties**:
- `session_id` (string): Session identifier
- `source_language` (string): Source language code
- `target_language` (string): Target language code
- `latency_ms` (number): Translation latency in milliseconds
- `provider` (string): AI provider used

## Audio Device Management Events

### `audio_device_changed`
**Description**: User changes audio input/output device  
**Properties**:
- `device_type` ('input' | 'output'): Type of device changed
- `device_name` (string, optional): Name of the new device
- `change_type` ('selected' | 'connected' | 'disconnected'): Type of change
- `during_session` (boolean): Whether change happened during active session

### `audio_quality_metric`
**Description**: Periodic audio quality measurements  
**Properties**:
- `quality_score` (number): Audio quality score (0-100)
- `latency` (number): Audio processing latency
- `echo_cancellation_enabled` (boolean): Echo cancellation status
- `noise_suppression_enabled` (boolean): Noise suppression status

### `audio_passthrough_toggled`
**Description**: User toggles real voice passthrough  
**Properties**:
- `enabled` (boolean): Whether passthrough was enabled
- `volume_level` (number): Volume level (0-0.6)

### `virtual_device_warning`
**Description**: User attempts to select virtual device  
**Properties**:
- `device_type` ('input' | 'output'): Type of virtual device
- `action_taken` ('ignored' | 'changed_device'): User's response

## Settings & Configuration Events

### `settings_modified`
**Description**: User modifies any setting  
**Properties**:
- `setting_name` (string): Name of the setting changed
- `old_value` (any, optional): Previous value
- `new_value` (any, optional): New value
- `provider` (string, optional): Provider if provider-specific setting
- `category` ('api' | 'audio' | 'language' | 'advanced'): Setting category

### `language_changed`
**Description**: User changes language settings  
**Properties**:
- `from_language` (string, optional): Previous language
- `to_language` (string): New language
- `language_type` ('source' | 'target' | 'ui'): Type of language setting

### `provider_switched`
**Description**: User switches AI provider  
**Properties**:
- `from_provider` (string): Previous provider
- `to_provider` (string): New provider
- `during_session` (boolean): Whether switch happened during active session

### `api_key_validated`
**Description**: API key validation attempt  
**Properties**:
- `provider` (string): Provider being validated
- `success` (boolean): Whether validation succeeded
- `error_type` (string, optional): Type of validation error

## User Interaction Events

### `ui_interaction`
**Description**: General UI interaction tracking  
**Properties**:
- `component` (string): Component name
- `action` (string): Action performed
- `element` (string, optional): Specific element interacted with
- `value` (any, optional): Value associated with interaction

### `push_to_talk_used`
**Description**: User uses push-to-talk feature  
**Properties**:
- `session_id` (string): Session identifier
- `hold_duration_ms` (number): How long button was held

### `session_control_clicked`
**Description**: User clicks session start/stop button  
**Properties**:
- `action` ('start' | 'stop'): Action performed
- `method` ('button' | 'keyboard'): How action was triggered

### `panel_viewed`
**Description**: User views different panels  
**Properties**:
- `panel_name` ('main' | 'settings' | 'audio' | 'logs'): Panel viewed
- `view_duration_ms` (number, optional): How long panel was viewed

### `help_accessed`
**Description**: User accesses help resources  
**Properties**:
- `help_type` ('onboarding' | 'tutorial' | 'documentation'): Type of help
- `source` (string): Where help was accessed from

## Performance & Latency Events

### `performance_metric`
**Description**: General performance measurements  
**Properties**:
- `metric_name` (string): Name of the metric
- `value` (number): Metric value
- `unit` (string, optional): Unit of measurement
- `percentile` (number, optional): Percentile for statistical metrics

### `latency_measurement`
**Description**: Specific latency measurements  
**Properties**:
- `operation` ('api_call' | 'audio_processing' | 'translation' | 'websocket'): Operation type
- `latency_ms` (number): Latency in milliseconds
- `provider` (string, optional): Provider if applicable

### `connection_status`
**Description**: Connection state changes  
**Properties**:
- `status` ('connected' | 'disconnected' | 'reconnecting'): Connection status
- `provider` (string): Provider connection
- `duration_ms` (number, optional): Connection duration

## Error Tracking Events

### `error_occurred`
**Description**: General error tracking  
**Properties**:
- `error_type` (string): Type of error
- `error_message` (string): Error message
- `component` (string, optional): Component where error occurred
- `severity` ('low' | 'medium' | 'high' | 'critical'): Error severity
- `provider` (string, optional): Provider if applicable
- `recoverable` (boolean): Whether error is recoverable

### `api_error`
**Description**: API-specific errors  
**Properties**:
- `provider` (string): API provider
- `endpoint` (string, optional): API endpoint
- `status_code` (number, optional): HTTP status code
- `error_message` (string): Error message
- `error_type` ('auth' | 'rate_limit' | 'network' | 'server' | 'client'): Error category

### `audio_error`
**Description**: Audio-related errors  
**Properties**:
- `error_type` ('device_access' | 'processing' | 'playback' | 'recording'): Error category
- `error_message` (string): Error message
- `device_info` (string, optional): Device information

## Extension-Specific Events

### `extension_installed`
**Description**: Extension installed  
**Properties**:
- `extension_version` (string): Version of extension

### `extension_uninstalled`
**Description**: Extension uninstalled  
**Properties**:
- `extension_version` (string): Version of extension

### `extension_popup_opened`
**Description**: Extension popup opened  
**Properties**:
- `is_supported_site` (boolean): Whether on supported site
- `hostname` (string | null): Current site hostname
- `browser_type` (string, optional): Browser type

### `extension_popup_supported_state_shown`
**Description**: Popup shows supported site state  
**Properties**:
- `hostname` (string): Site hostname
- `site_name` (string): Friendly site name

### `extension_popup_unsupported_state_shown`
**Description**: Popup shows unsupported site state  
**Properties**:
- `hostname` (string): Site hostname
- `supported_sites_count` (number): Number of supported sites

### `extension_popup_error`
**Description**: Error in extension popup  
**Properties**:
- `error_type` (string): Type of error
- `error_message` (string, optional): Error details

### `extension_side_panel_opened`
**Description**: Side panel opened  
**Properties**:
- `trigger` ('popup' | 'action' | 'context_menu'): How panel was opened
- `site` (string, optional): Current site

### `extension_side_panel_closed`
**Description**: Side panel closed  
**Properties**:
- `duration_ms` (number): How long panel was open

### `extension_site_navigated`
**Description**: User navigates to supported site  
**Properties**:
- `from_site` (string, optional): Previous site
- `to_site` (string): Target site
- `navigation_source` ('popup' | 'link'): Navigation source

### `extension_permissions_requested`
**Description**: Extension requests permissions  
**Properties**:
- `permission_type` (string): Type of permission
- `granted` (boolean): Whether permission was granted

## Feature Adoption Events

### `feature_discovered`
**Description**: User discovers a feature  
**Properties**:
- `feature_name` (string): Name of feature
- `discovery_method` ('onboarding' | 'exploration' | 'documentation'): How discovered

### `feature_first_use`
**Description**: First time feature is used  
**Properties**:
- `feature_name` (string): Name of feature
- `time_since_install_hours` (number, optional): Hours since installation

## Super Properties

These properties are automatically included with every event:

- `app_version`: Application version
- `environment`: 'development' or 'production'
- `platform`: 'app' (Electron), 'extension', or 'web'
- `component`: Component sending the event (e.g., 'main', 'popup')

## Privacy Considerations

The following data is automatically sanitized before sending:
- Email addresses
- Phone numbers
- Physical addresses
- IP addresses
- Passwords and tokens
- Audio content
- Translation text
- User input
- API keys

All analytics are opt-in and respect user privacy preferences.