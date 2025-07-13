# App Analytics Integration

This document outlines the PostHog analytics integration for the Sokuji React application.

## Overview

The application uses PostHog for comprehensive analytics tracking, including user interactions, performance metrics, and application lifecycle events.

## Configuration

### Configuration

PostHog credentials are now hardcoded in the source code for both Electron and extension environments. The configuration is located in `src/config/analytics.ts`:

```typescript
export const ANALYTICS_CONFIG = {
  POSTHOG_KEY: 'phc_EMOuUDTntTI5SuzKQATy11qHgxVrlhJsgNFbBaWEhet',
  POSTHOG_HOST: 'https://us.i.posthog.com',
} as const;
```

This approach ensures compatibility across all environments (Electron app, browser extension, and web) without requiring environment variable configuration.

### Development vs Production Behavior

#### Production Environment
- PostHog captures events automatically
- All tracking is enabled by default

#### Development Environment  
- PostHog is configured with `opt_out_capturing_by_default: true`
- Events are **NOT** captured by default to avoid sending test data
- Debug logging is enabled for troubleshooting
- Manual control available via developer helpers

### Super Properties

The application automatically sets the following Super Properties that are included with every tracked event:

- `app_version`: Application version from package.json (e.g., "0.4.2")
- `environment`: "development" or "production" based on build mode
- `platform`: Dynamically detected platform ("app", "extension", or "web")
- `user_agent`: Browser user agent string

These properties are set once during initialization and automatically included with all subsequent events, eliminating the need to pass them with each tracking call.

## Development Tools

### Manual Capturing Control

In development mode, you can manually control PostHog capturing:

```javascript
import { useAnalytics } from './lib/analytics';

function MyComponent() {
  const { 
    trackEvent, 
    enableCapturing, 
    disableCapturing, 
    isCapturingEnabled 
  } = useAnalytics();

  // Enable capturing for testing
  const handleEnableAnalytics = () => {
    enableCapturing();
  };

  // Disable capturing
  const handleDisableAnalytics = () => {
    disableCapturing();
  };

  // Check current status
  const captureStatus = isCapturingEnabled();

  return (
    <div>
      <p>Capturing enabled: {captureStatus ? 'Yes' : 'No'}</p>
      <button onClick={handleEnableAnalytics}>Enable Analytics</button>
      <button onClick={handleDisableAnalytics}>Disable Analytics</button>
    </div>
  );
}
```

### Console Commands

You can also control capturing directly from the browser console:

```javascript
// Enable capturing in development
window.posthog?.opt_in_capturing();

// Disable capturing in development
window.posthog?.opt_out_capturing();

// Check if capturing is enabled
!window.posthog?.has_opted_out_capturing();
```

## Event Types

### Application Lifecycle
- `app_startup`: Application starts
- `app_shutdown`: Application closes (includes session duration)

### Translation Sessions
- `translation_session_start`: Translation session begins
- `translation_session_end`: Translation session ends (includes duration and count)

### Audio Handling
- `audio_device_changed`: Audio input/output device changes
- `audio_quality_metric`: Audio quality measurements

### User Interactions
- `settings_modified`: User changes application settings
- `language_changed`: Source or target language selection changes
- `ui_interaction`: General UI interactions

### Performance Metrics
- `performance_metric`: General performance measurements
- `latency_measurement`: Operation latency tracking

### Error Tracking
- `error_occurred`: Application errors with severity levels
- `api_error`: API request failures

### Extension Usage
- `extension_installed`: Browser extension installation
- `extension_uninstalled`: Browser extension removal
- `extension_used`: Extension feature usage

## Data Privacy

### Automatic Data Sanitization

The analytics system automatically removes sensitive data before sending events:

**Excluded Fields:**
- `email`, `phone`, `address`, `ip`
- `password`, `token`, `api_key`
- `audio_content`, `translation_text`, `user_input`

### GDPR Compliance

- No personal data is collected without explicit consent
- All sensitive fields are automatically filtered
- Users can opt out of analytics at any time
- Data retention follows PostHog's policies

## Usage Examples

### Basic Event Tracking

```typescript
import { useAnalytics } from './lib/analytics';

function MyComponent() {
  const { trackEvent } = useAnalytics();

  const handleSettingChange = (setting: string, newValue: any) => {
    trackEvent('settings_modified', {
      setting_name: setting,
      new_value: newValue
    });
  };

  return <div>...</div>;
}
```

### User Identification

```typescript
const { identifyUser, setUserProperties } = useAnalytics();

// Identify user (only non-sensitive data)
identifyUser('user123', {
  subscription_plan: 'premium',
  signup_date: '2024-01-01'
});

// Set user properties
setUserProperties({
  preferred_language: 'en',
  theme: 'dark'
});
```

## Best Practices

1. **Test Events in Development**: Use `enableCapturing()` when testing analytics
2. **Verify Data Sanitization**: Check that no sensitive data is being sent
3. **Use Semantic Event Names**: Follow the predefined event structure
4. **Include Relevant Context**: Add meaningful properties to events
5. **Monitor Performance**: Track key metrics that matter to your application

## Troubleshooting

### Events Not Appearing

1. **Check Configuration**: Ensure `src/config/analytics.ts` has correct PostHog credentials
2. **Development Mode**: Remember that capturing is disabled by default in development
3. **Console Logs**: Look for PostHog initialization and error messages
4. **Network Tab**: Verify HTTP requests are being sent to PostHog
5. **Environment Detection**: Check that the environment is being detected correctly (development vs production)

### Debug Mode

In development, PostHog runs in debug mode with verbose console logging. Check the browser console for:

- PostHog initialization messages
- Event capture confirmations
- Error messages or warnings

## Features

### ✅ Implemented

- **PostHog SDK Integration**: React and Node.js SDKs integrated for Electron app
- **Privacy-First Design**: No audio content or personal translations are tracked
- **Consent Management**: GDPR-compliant consent banner and settings
- **Event Tracking**: Comprehensive event system for user interactions
- **Data Sanitization**: Automatic removal of sensitive information
- **Offline Support**: Events are queued when offline (handled by PostHog SDK)

### 🚧 Pending

- **Browser Extension Integration**: PostHog browser SDK for extension
- **Dashboard Configuration**: Custom dashboards for key metrics
- **Error Boundary Integration**: Automatic error tracking
- **Performance Monitoring**: Advanced performance metrics

## Implementation Details

### File Structure

```
src/
├── lib/
│   └── analytics.ts          # Core analytics utilities and types
├── components/
│   ├── AnalyticsConsent.tsx  # Consent banner and settings
│   └── AnalyticsConsent.scss # Consent component styles
└── index.tsx                 # PostHog provider setup
```

### PostHog Configuration

The PostHog provider is configured with privacy-first settings:

```tsx
const options = {
  api_host: ANALYTICS_CONFIG.POSTHOG_HOST,
  debug: isDevelopment(),
  autocapture: false, // Disabled for privacy
  capture_pageview: false, // Manual control
  mask_all_text: true, // Privacy protection
  mask_all_element_attributes: true, // Privacy protection
  opt_out_capturing_by_default: true // Disabled by default in development
};
```

## Browser Extension Integration

For the browser extension, add PostHog browser SDK:

```bash
npm install posthog-js
```

```tsx
// In extension background script
import posthog from 'posthog-js';

posthog.init('your_key', {
  api_host: 'https://us.i.posthog.com',
  // Extension-specific options
});
```

## Testing

To test the analytics integration:

1. **Development**: Run `npm start` (no environment variables needed)
2. **Consent Flow**: Clear localStorage and reload to see consent banner
3. **Event Tracking**: Check browser dev tools → Network tab for PostHog requests
4. **Privacy**: Verify no sensitive data in tracked events
5. **Extension Testing**: Build extension with `npm run build` in extension directory

## Compliance

### GDPR Compliance
- ✅ Explicit consent required before tracking
- ✅ Easy opt-out mechanism
- ✅ Data minimization (only necessary data)
- ✅ Transparent privacy policy

### Data Retention
- PostHog default retention: 7 years
- Can be configured in PostHog dashboard
- Users can request data deletion

## Next Steps

1. **Dashboard Setup**: Configure PostHog dashboards for key metrics
2. **Browser Extension**: Implement PostHog in browser extension
3. **Error Boundaries**: Add automatic error tracking
4. **Performance Monitoring**: Implement advanced performance metrics
5. **A/B Testing**: Utilize PostHog feature flags for experiments

## Resources

- [PostHog Documentation](https://posthog.com/docs)
- [PostHog React Integration](https://posthog.com/docs/libraries/react)
- [GDPR Compliance Guide](https://posthog.com/docs/privacy/gdpr-compliance) 