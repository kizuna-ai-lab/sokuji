# PostHog Analytics Integration

This document outlines the PostHog analytics integration for the Sokuji React application.

## Overview

The application uses PostHog for comprehensive analytics tracking, including user interactions, performance metrics, and application lifecycle events.

## Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
VITE_PUBLIC_POSTHOG_KEY=your_posthog_project_key
VITE_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

### Super Properties

The application automatically sets the following Super Properties that are included with every tracked event:

- `app_version`: Application version from package.json (e.g., "0.4.2")
- `environment`: "development" or "production" based on build mode
- `platform`: "web" (constant for web application)
- `user_agent`: Browser user agent string

These properties are set once during PostHog initialization and automatically attached to all subsequent events, eliminating the need to manually include them in each `trackEvent` call.

## Analytics Events

### Application Lifecycle
- `app_startup`: Triggered when the application starts
- `app_shutdown`: Triggered before the application closes (includes session duration)

### Translation Sessions
- `translation_session_start`: When a new translation session begins
- `translation_session_end`: When a translation session ends (includes duration and translation count)

### Audio Handling
- `audio_device_changed`: When user changes audio input/output device
- `audio_quality_metric`: Performance metrics for audio processing

### User Interactions
- `settings_modified`: When user changes application settings
- `feature_used`: When user interacts with specific features

### Performance Metrics
- `performance_metric`: General performance measurements

### Error Tracking
- `error_occurred`: When errors occur in the application

### Extension Usage
- `extension_interaction`: When user interacts with browser extensions

## Usage

### Basic Event Tracking

```typescript
import { useAnalytics } from '../lib/analytics';

const { trackEvent } = useAnalytics();

// Simple event - app_version, environment, platform are automatically included
trackEvent('app_startup', {});

// Event with properties
trackEvent('translation_session_start', {
  source_language: 'en',
  target_language: 'ja',
  session_id: 'session_123'
});
```

### User Identification

```typescript
const { identifyUser, setUserProperties } = useAnalytics();

// Identify a user
identifyUser('user_123', {
  subscription_plan: 'premium'
});

// Set user properties
setUserProperties({
  preferred_language: 'japanese'
});
```

## Data Privacy

### Automatic Data Sanitization

The analytics system automatically removes sensitive data fields before sending events to PostHog:

- `email`
- `phone`
- `address`
- `ip`
- `audio_content`
- `translation_text`

### No Consent Required

The application automatically enables analytics tracking without requiring user consent. All tracking focuses on application usage patterns and performance metrics rather than personal data.

## Development

### Debug Mode

In development mode (`npm run dev`), PostHog debug logging is automatically enabled, allowing you to see all tracked events in the browser console.

### Testing

Events are only sent to PostHog when both `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` environment variables are configured. If these are missing, the application will run without analytics.

## Benefits of Super Properties

1. **Consistency**: Every event automatically includes version, environment, and platform information
2. **Reduced Code Duplication**: No need to manually add common properties to each event
3. **Performance**: Properties are set once rather than computed for each event
4. **Maintainability**: Centralized configuration of common tracking properties

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
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  autocapture: false, // Disabled for privacy
  capture_pageview: false, // Manual control
  mask_all_text: true, // Privacy protection
  mask_all_element_attributes: true, // Privacy protection
  opt_out_capturing_by_default: !AnalyticsConsent.hasConsent()
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

1. **Development**: Set environment variables and run `npm start`
2. **Consent Flow**: Clear localStorage and reload to see consent banner
3. **Event Tracking**: Check browser dev tools → Network tab for PostHog requests
4. **Privacy**: Verify no sensitive data in tracked events

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

## Troubleshooting

### Common Issues

1. **Events not appearing**: Check environment variables and network connectivity
2. **Consent banner not showing**: Clear localStorage to reset consent state
3. **Build errors**: Ensure PostHog SDK is properly installed

### Debug Mode

Enable debug logging in development:

```tsx
const options = {
  // ... other options
  debug: process.env.NODE_ENV === 'development'
};
```

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