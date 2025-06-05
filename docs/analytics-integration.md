# PostHog Analytics Integration

This document describes the PostHog analytics integration implemented in Sokuji, following the requirements from [GitHub Issue #27](https://github.com/kizuna-ai-lab/sokuji/issues/27).

## Overview

PostHog has been integrated to provide comprehensive analytics tracking while maintaining strict privacy controls and GDPR compliance.

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

## Environment Setup

Create a `.env` file in the project root:

```env
# PostHog Analytics Configuration
VITE_PUBLIC_POSTHOG_KEY=your_posthog_project_key_here
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

## Usage

### Basic Event Tracking

```tsx
import { useAnalytics } from '../lib/analytics';

function MyComponent() {
  const { trackEvent } = useAnalytics();

  const handleFeatureUse = () => {
    trackEvent('feature_used', {
      feature_name: 'translation_start',
      context: 'main_panel'
    });
  };

  return <button onClick={handleFeatureUse}>Start Translation</button>;
}
```

### Available Events

The analytics system supports the following event types:

#### Application Lifecycle
- `app_startup`: Application start with version and platform
- `app_shutdown`: Application shutdown with session duration

#### Translation Sessions
- `translation_session_start`: Translation session begins
- `translation_session_end`: Translation session ends with metrics

#### Audio Handling
- `audio_device_changed`: Audio device selection changes
- `audio_quality_metric`: Audio quality measurements

#### User Interactions
- `settings_modified`: Settings changes
- `feature_used`: Feature usage tracking

#### Performance & Errors
- `performance_metric`: Performance measurements
- `error_occurred`: Error tracking (sanitized)

#### Extension Usage
- `extension_interaction`: Browser extension interactions

### Privacy Controls

#### Consent Management

```tsx
import { AnalyticsConsent } from '../lib/analytics';

// Check consent status
const hasConsent = AnalyticsConsent.hasConsent();

// Grant consent
AnalyticsConsent.grantConsent();

// Revoke consent
AnalyticsConsent.revokeConsent();
```

#### Settings Integration

```tsx
import { AnalyticsSettings } from '../components/AnalyticsConsent';

function SettingsPage() {
  return (
    <div>
      <h2>Privacy Settings</h2>
      <AnalyticsSettings />
    </div>
  );
}
```

## Data Privacy

### What We Track
- App usage patterns and feature interactions
- Performance metrics and error reports
- Language preferences and settings
- Device type and platform information

### What We DON'T Track
- ❌ Audio recordings or content
- ❌ Translation text or content
- ❌ Personal information (names, emails, etc.)
- ❌ IP addresses or location data
- ❌ Sensitive user data

### Data Sanitization

All tracked data goes through automatic sanitization:

```tsx
// Sensitive fields are automatically removed
const sanitizedData = sanitizeProperties({
  feature_name: 'translation',
  email: 'user@example.com', // ← This will be removed
  audio_content: 'Hello world', // ← This will be removed
  device_name: "John's MacBook" // ← This will be anonymized to "User's MacBook"
});
```

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