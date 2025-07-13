# Extension PostHog Distinct ID Integration

This document explains how PostHog's `distinct_id` is captured and used in the browser extension environment, specifically for the `setUninstallURL` functionality.

## Overview

When users uninstall the Sokuji browser extension, we want to track this event and associate it with their existing PostHog user profile. To achieve this, we need to pass the user's `distinct_id` from the extension's frontend (sidepanel using React PostHogProvider) to the background script, which then includes it in the uninstall feedback URL.

## Implementation

### 1. Background Script Changes

The background script (`extension/background/background.js`) has been modified to:

- **Receive distinct_id from frontend**: Accepts `distinct_id` via message passing from the sidepanel
- **Store distinct_id locally**: Saves the received `distinct_id` in `chrome.storage.local`  
- **Update uninstall URL dynamically**: Includes the `distinct_id` as a URL parameter

```javascript
// Store PostHog distinct_id received from frontend
let currentDistinctId = null;

// Function to store distinct_id
async function storeDistinctId(distinctId) {
  try {
    await chrome.storage.local.set({ posthog_distinct_id: distinctId });
    currentDistinctId = distinctId;
    console.debug('[Sokuji] [Background] Stored distinct_id:', distinctId);
    return true;
  } catch (error) {
    console.error('[Sokuji] [Background] Error storing distinct_id:', error);
    return false;
  }
}

// Function to update uninstall URL with distinct_id
async function updateUninstallURL(distinctId = null) {
  try {
    const activeDistinctId = distinctId || currentDistinctId || await getStoredDistinctId();
    let uninstallUrl = UNINSTALL_FEEDBACK_BASE_URL;
    
    if (activeDistinctId) {
      const url = new URL(uninstallUrl);
      url.searchParams.set('distinct_id', activeDistinctId);
      uninstallUrl = url.toString();
    }
    
    if (chrome.runtime.setUninstallURL) {
      chrome.runtime.setUninstallURL(uninstallUrl);
    }
    
    return true;
  } catch (error) {
    console.error('[Sokuji] [Background] Error updating uninstall URL:', error);
    return false;
  }
}

// Handle UPDATE_UNINSTALL_URL message with distinct_id
if (message.type === 'UPDATE_UNINSTALL_URL') {
  const distinctId = message.distinct_id;
  if (distinctId) {
    // Store the distinct_id and update uninstall URL
    storeDistinctId(distinctId).then(() => {
      return updateUninstallURL(distinctId);
    }).then(() => {
      sendResponse({ success: true });
    });
  }
  return true;
}
```

### 2. Frontend Synchronization

The frontend analytics library (`src/lib/analytics.ts`) includes a function to trigger uninstall URL updates:

```typescript
// Function to sync PostHog distinct_id to background script in extension environment
export async function syncDistinctIdToBackground(posthogInstance?: any): Promise<void> {
  // Only run in extension environment
  if (getPlatform() !== 'extension') {
    return;
  }

  try {
    if (typeof window !== 'undefined' && 
        typeof (window as any).chrome !== 'undefined' && 
        typeof (window as any).chrome.runtime !== 'undefined') {
      
      // Get PostHog distinct_id from provided posthog instance
      let distinctId = null;
      
      if (posthogInstance && typeof posthogInstance.get_distinct_id === 'function') {
        distinctId = posthogInstance.get_distinct_id();
        console.debug('[Analytics] Retrieved distinct_id from PostHog instance:', distinctId);
      } else {
        console.debug('[Analytics] PostHog instance not available or get_distinct_id not found');
      }
      
      // Send message to background script to update uninstall URL
      (window as any).chrome.runtime.sendMessage({
        type: 'UPDATE_UNINSTALL_URL',
        distinct_id: distinctId
      }, (response: any) => {
        if (response?.success) {
          console.debug('[Analytics] Successfully synced distinct_id to background script');
        } else {
          console.warn('[Analytics] Background script returned unsuccessful response:', response);
        }
      });
    }
  } catch (error) {
    console.error('[Analytics] Error syncing distinct_id to background:', error);
  }
}

// In useAnalytics hook, we wrap this function to use the current posthog instance:
const syncDistinctId = () => syncDistinctIdToBackground(posthog);
```

### 3. Automatic Synchronization

The system automatically syncs the `distinct_id` in several scenarios:

1. **PostHog initialization**: When PostHog loads in the extension
2. **After tracking events**: When analytics events are captured
3. **After user identification**: When `posthog.identify()` is called
4. **Storage changes**: When PostHog data is updated in storage

### 4. Uninstall Feedback Page

The uninstall feedback page (`docs/uninstall_feedback.html`) has been updated to:

- **Read distinct_id from URL**: Extracts the `distinct_id` parameter from the URL
- **Identify user in PostHog**: Calls `posthog.identify()` with the provided `distinct_id`

```javascript
// Get distinct_id from URL parameters if provided
function getDistinctIdFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('distinct_id');
}

// Initialize survey
document.addEventListener('DOMContentLoaded', function() {
    // If distinct_id is provided in URL, identify the user
    const distinctId = getDistinctIdFromURL();
    if (distinctId) {
        console.debug('[Uninstall Feedback] Using distinct_id from URL:', distinctId);
        posthog.identify(distinctId);
    }
    
    fetchAndInitializeSurvey();
});
```

## Data Flow

1. **User interacts with extension**: PostHog generates or updates `distinct_id` in sidepanel
2. **Frontend triggers sync**: Analytics events trigger `syncDistinctIdToBackground()`
3. **Frontend retrieves distinct_id**: Gets `distinct_id` using `posthog.get_distinct_id()`
4. **Message passing**: Sends `distinct_id` to background script via `chrome.runtime.sendMessage`
5. **Background script stores and updates**: Stores `distinct_id` and updates `setUninstallURL`
6. **User uninstalls extension**: Chrome opens uninstall URL with `distinct_id` parameter
7. **Feedback page identifies user**: PostHog associates feedback with existing user profile

## URL Format

The uninstall URL will look like:
```
https://kizuna-ai-lab.github.io/sokuji/uninstall_feedback.html?distinct_id=abc123xyz
```

## Benefits

1. **User continuity**: Uninstall feedback is associated with the correct user profile
2. **Better analytics**: Can track user journey from installation to uninstallation
3. **Improved insights**: Understand which user segments are more likely to uninstall
4. **Personalized follow-up**: Potential for targeted re-engagement campaigns

## Error Handling

The implementation includes comprehensive error handling:

- **Missing distinct_id**: Falls back to base uninstall URL without parameters
- **Storage errors**: Logs errors but continues with basic functionality
- **Message passing failures**: Gracefully handles communication errors between frontend and background
- **Invalid JSON**: Safely parses PostHog data with try-catch blocks

## Privacy Considerations

- **No personal data**: Only the PostHog `distinct_id` is transmitted
- **User consent**: Follows existing PostHog consent mechanisms
- **Data minimization**: Only necessary data for analytics continuity is shared
- **Secure transmission**: All data is transmitted over HTTPS

## Testing

To test this functionality:

1. **Install extension**: Install the Sokuji extension in development mode
2. **Use the extension**: Interact with the extension to generate PostHog events
3. **Check background logs**: Verify that `distinct_id` is being captured
4. **Simulate uninstall**: Check that the uninstall URL includes the `distinct_id` parameter
5. **Test feedback page**: Verify that the feedback page correctly identifies the user

## Troubleshooting

### Common Issues

1. **distinct_id not found**: 
   - Ensure PostHog is properly initialized
   - Check that analytics events are being captured
   - Verify storage permissions in manifest.json

2. **Background script errors**:
   - Check browser console for error messages
   - Verify message passing between frontend and background
   - Ensure proper async/await usage

3. **Uninstall URL not updating**:
   - Check that `chrome.runtime.setUninstallURL` is available
   - Verify that the background script is receiving update messages
   - Test storage change listeners

### Debug Commands

```javascript
// Check stored distinct_id in background script
chrome.storage.local.get('posthog_distinct_id', (result) => {
  console.log('Stored distinct_id:', result);
});

// Get distinct_id from PostHog in sidepanel (using React hook)
// Note: This should be run inside a React component that has access to useAnalytics
const { getDistinctId, syncDistinctIdToBackground } = useAnalytics();
console.log('Current PostHog distinct_id:', getDistinctId());

// Manually trigger uninstall URL update with distinct_id
syncDistinctIdToBackground();

// Alternative: Direct message sending (if you have access to PostHog instance)
const { usePostHog } = require('posthog-js/react');
const posthog = usePostHog();
const distinctId = posthog?.get_distinct_id();
chrome.runtime.sendMessage({ 
  type: 'UPDATE_UNINSTALL_URL', 
  distinct_id: distinctId 
}, (response) => {
  console.log('Update response:', response);
});
```

## Future Enhancements

1. **Retry mechanism**: Add retry logic for failed sync attempts
2. **Batch updates**: Optimize by batching multiple sync requests
3. **User preferences**: Allow users to opt-out of uninstall tracking
4. **Analytics dashboard**: Create dashboard to monitor uninstall patterns
5. **A/B testing**: Test different uninstall feedback approaches 