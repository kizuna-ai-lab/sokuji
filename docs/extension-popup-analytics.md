# Extension Popup Analytics Integration

This document describes the PostHog analytics integration implemented in the browser extension popup (`extension/popup.js`).

## Overview

The extension popup now tracks user interactions and page context to provide insights into:
- How users discover and access Sokuji
- Which sites are being used with the extension
- Common user flows and pain points
- Success rates for opening the side panel

## Implementation Details

### PostHog Installation and Initialization

The popup uses the locally installed `posthog-js` package (not CDN) for better security and offline support:

```javascript
// Import PostHog from installed package
import posthog from 'posthog-js';

const ANALYTICS_CONFIG = {
  POSTHOG_KEY: 'phc_EMOuUDTntTI5SuzKQATy11qHgxVrlhJsgNFbBaWEhet',
  POSTHOG_HOST: 'https://us.i.posthog.com'
};
```

The extension has `posthog-js` as a dependency and bundles it via webpack for production use.

### Benefits of Local Installation

- **Security**: No external CDN dependencies
- **Reliability**: Works offline and in restricted environments
- **Performance**: Bundled with the extension, no additional network requests
- **CSP Compliance**: Avoids potential Content Security Policy issues

### Super Properties

The following properties are automatically included with every popup event:

- `app_version`: Extension version from manifest
- `environment`: 'development' or 'production' based on update_url
- `platform`: Always 'extension'
- `component`: Always 'popup'

## Tracked Events

### Core Navigation Events

#### `popup_opened`
**When**: Popup window is opened by user
**Properties**:
- `is_supported_site` (boolean): Whether the current site supports Sokuji
- `hostname` (string): Current site hostname
- `full_url` (string): Site origin URL
- `supported_site_match` (string|null): Which supported site pattern matched

#### `popup_supported_state_shown`
**When**: Popup displays the "supported site" interface
**Properties**:
- `hostname` (string): Current site hostname
- `site_name` (string): Friendly name of the site

#### `popup_unsupported_state_shown`
**When**: Popup displays the "unsupported site" interface
**Properties**:
- `hostname` (string): Current site hostname
- `supported_sites_count` (number): Total number of supported sites

#### `popup_error_state_shown`
**When**: Popup displays error state (unable to detect site)
**Properties**:
- `error_type` (string): Type of error ('unable_to_detect_site')

### User Action Events

#### `popup_open_sidepanel_clicked`
**When**: User clicks the "Open Sokuji" button
**Properties**:
- `tab_id` (number): Browser tab ID
- `is_supported_site` (boolean): Whether site is supported

#### `sidepanel_opened_from_popup`
**When**: Side panel successfully opens from popup
**Properties**:
- `tab_id` (number): Browser tab ID
- `method` (string): How sidepanel was opened ('direct_api' or 'background_message')

#### `sidepanel_open_error`
**When**: Error occurs opening side panel
**Properties**:
- `tab_id` (number): Browser tab ID
- `error_type` (string): Type of error ('direct_api_failed' or 'background_message_failed')
- `error_message` (string): Error details

#### `popup_site_navigation_clicked`
**When**: User clicks on a supported site to navigate to it
**Properties**:
- `target_site` (string): Domain user navigated to
- `target_site_name` (string): Friendly name of target site
- `is_supported_site` (boolean): Whether current site was supported

## Privacy and Security

### Data Sanitization
All event properties are automatically sanitized to remove sensitive information:
- API keys and passwords are filtered out
- Personal data is excluded per configuration
- Only essential context is captured

### Opt-out Respect
- Analytics respects the main app's opt-out settings
- Uses privacy-first configuration (`opt_out_capturing_by_default: true`)
- No pageview tracking by default

### Development Mode
- Detailed console logging in development builds
- Events are clearly marked for debugging
- No tracking in test environments

## Usage Analytics

These events help answer key questions:

**Discovery & Access**:
- How often do users try to use Sokuji on unsupported sites?
- Which supported sites are most popular?
- What's the success rate for opening the side panel?

**User Experience**:
- Do users understand which sites are supported?
- Are there common error patterns when opening Sokuji?
- How often do users navigate to supported sites from the popup?

**Product Development**:
- Which unsupported sites should we prioritize?
- Are there UX improvements needed in the popup flow?
- How effective is the current supported sites list?

## Integration with Main App

The popup analytics use the same PostHog project and configuration as the main Sokuji application, enabling:
- Unified user journey analysis
- Cross-component feature flag support
- Consistent privacy and opt-out handling
- Centralized analytics dashboard

## Build Configuration

The popup is built as a webpack entry point that bundles `posthog-js`:

```javascript
// webpack.config.js includes popup.js as an entry point
entry: {
  // ... other entries
  popup: './popup.js'
}
```

This ensures the PostHog library is properly bundled and available offline.

## Testing and Debugging

### Development Mode

In development mode (unpacked extension):
- PostHog events are logged to console
- Analytics capturing is disabled by default
- Use browser dev tools to verify event data

### Testing Events

1. **Install extension in development mode**
2. **Navigate to various sites** (supported and unsupported)
3. **Open popup and interact** with different buttons
4. **Check console logs** for event tracking confirmation
5. **Verify in PostHog dashboard** (if capturing enabled)

### Console Debugging

```javascript
// Enable capturing for testing (in popup console)
window.posthog?.opt_in_capturing();

// Check if events are being tracked
console.log('PostHog instance:', window.posthog);

// Manually trigger test event
window.posthog?.capture('test_event', { source: 'manual_test' });
```

## Data Analysis Use Cases

### User Behavior Analysis

1. **Site Discovery**: Which unsupported sites do users try Sokuji on?
2. **Navigation Patterns**: Do users navigate to supported sites from popup?
3. **Success Rates**: How often does popup→side panel flow succeed?
4. **Error Patterns**: What technical issues prevent successful usage?

### Product Development

1. **Feature Requests**: Most requested unsupported sites
2. **UX Improvements**: Points where users drop off
3. **Technical Issues**: Common error patterns to fix
4. **Usage Patterns**: When and where users access Sokuji

### Metrics Dashboard

Recommended PostHog dashboard widgets:

1. **Popup Opens by Site Type** (supported vs unsupported)
2. **Side Panel Open Success Rate** over time
3. **Top Unsupported Sites** requested by users
4. **Error Rate Trends** for technical issues
5. **User Flow Analysis** from popup to active usage

## Privacy Compliance

- No personal information is collected
- Only interaction patterns and technical context
- Users can opt-out through PostHog's privacy controls
- Data retention follows PostHog's standard policies
- Complies with Chrome Web Store privacy requirements

## Future Enhancements

1. **A/B Testing**: Test different popup layouts and messaging
2. **Performance Tracking**: Monitor popup load times and responsiveness
3. **Feature Flags**: Control popup features based on user segments
4. **Custom Surveys**: Collect user feedback through PostHog surveys
5. **Funnel Analysis**: Track complete user journey from install to usage

## Related Documentation

- [App Analytics Events](./app-analytics-events.md) - Complete event reference
- [App Analytics Integration](./app-analytics-integration.md) - PostHog setup guide
- [Extension Audio Profile Notification](./extension-audio-profile-notification.md) - Extension features 