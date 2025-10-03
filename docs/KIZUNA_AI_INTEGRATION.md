# Kizuna AI Provider Integration

## Overview

Kizuna AI is a new AI provider that has been fully integrated into the Sokuji application. Unlike other providers that require users to manage their own API keys, Kizuna AI uses a backend-managed authentication system where API keys are automatically provided to authenticated users.

## Key Features

- **Backend-Managed API Keys**: Users don't need to input API keys manually
- **Authentication Required**: Only available to users signed in via Better Auth
- **OpenAI Compatibility**: Uses the same technical implementation as OpenAI
- **Automatic Key Generation**: API keys are generated on first request
- **Simplified User Experience**: No complex API key management needed

## Technical Implementation

### 1. Provider System Integration

**File**: `src/types/Provider.ts`
- Added `KIZUNA_AI = 'kizunaai'` to Provider enum
- Updated all provider arrays and utility functions

### 2. Settings Context Integration

**File**: `src/contexts/SettingsContext.tsx`
- Added `KizunaAISettings` interface (OpenAI-compatible without apiKey field)
- Integrated with `ApiKeyService` for backend key fetching
- Added caching mechanism (5-minute cache)

### 3. Provider Configuration

**File**: `src/services/providers/KizunaAIProviderConfig.ts`
- Extends OpenAI configuration with `requiresAuth: true` flag
- Same models, languages, and capabilities as OpenAI
- Proper display name and branding

### 4. API Key Service

**File**: `src/services/ApiKeyService.ts`
- Fetches API keys from backend endpoint
- Implements 5-minute caching to reduce server load
- Handles authentication token management
- Graceful error handling and fallbacks

### 5. Client Integration

**File**: `src/services/clients/ClientFactory.ts`
- Kizuna AI uses OpenAI client implementation
- Automatic API key injection from backend
- Full compatibility with existing OpenAI features

### 6. Backend API

**File**: `backend-cf/src/routes/user.ts`
- `GET /api/user/api-key` endpoint
- Auto-generates API key if user doesn't have one
- Single API key per user (no create/delete operations)
- Tied to user authentication and subscription

### 7. UI Integration

**File**: `src/components/SimpleConfigPanel/SimpleConfigPanel.tsx`
- Added User Account section for authentication
- Shows sign-in prompt for unauthenticated users
- Displays user info and account status when signed in
- Handles KizunaAI provider selection and validation

### 8. Internationalization

**File**: `src/locales/en/translation.json`
- Added translations for Kizuna AI provider
- Authentication-related messages
- User account management text

## Authentication Flow

1. **User Signs In**: Via Better Auth authentication system
2. **Provider Selection**: Kizuna AI becomes available in provider dropdown
3. **Automatic Key Fetch**: `ApiKeyService` fetches API key from backend
4. **Caching**: Key is cached for 5 minutes to reduce backend calls
5. **Provider Activation**: User can now use Kizuna AI for translations

## API Endpoint Details

### GET /api/user/api-key

**Purpose**: Retrieve or create user's Kizuna AI API key

**Authentication**: Required (Better Auth session token)

**Response**:
```json
{
  "apiKey": "sk-kizuna-abc123...xyz",
  "provider": "kizunaai"
}
```

**Behavior**:
- Auto-generates API key if user doesn't have one
- Returns existing key if already generated
- Key is tied to user's authentication status
- Single key per user (no multiple keys)

## Configuration and Settings

### Provider Configuration
```typescript
{
  id: 'kizunaai',
  displayName: 'Kizuna AI',
  requiresAuth: true, // Key difference from other providers
  models: [...], // Same as OpenAI models
  languages: [...], // Same as OpenAI languages
  capabilities: [...] // Same as OpenAI capabilities
}
```

### Settings Interface
```typescript
interface KizunaAISettings {
  model: string;
  voice: string;
  sourceLanguage: string;
  targetLanguage: string;
  // Note: No apiKey field - managed by backend
}
```

## User Experience

### For New Users
1. See "Sign In" prompt in User Account section
2. Click sign in to access Kizuna AI service
3. No need to manage API keys manually
4. Immediate access to AI translations

### For Technical Users
1. Can still use their own API keys with other providers
2. Kizuna AI available as an additional option when authenticated
3. Seamless switching between providers

## Files Modified/Created

### New Files
- `src/services/providers/KizunaAIProviderConfig.ts`
- `src/services/ApiKeyService.ts`
- `backend-cf/src/routes/user.ts` (endpoint added)

### Modified Files
- `src/types/Provider.ts`
- `src/contexts/SettingsContext.tsx`
- `src/services/clients/ClientFactory.ts`
- `src/services/providers/ProviderConfigFactory.ts`
- `src/components/SimpleConfigPanel/SimpleConfigPanel.tsx`
- `src/locales/en/translation.json`

## Testing and Validation

### Manual Testing Checklist
- [ ] User can sign in via Better Auth
- [ ] Kizuna AI appears in provider dropdown when authenticated
- [ ] API key is automatically fetched from backend
- [ ] Provider works for real-time translation
- [ ] Switching between providers works correctly
- [ ] Sign out removes access to Kizuna AI

### Error Scenarios
- [ ] Backend API failure - graceful degradation
- [ ] Authentication token expiry - automatic refresh
- [ ] Network connectivity issues - cached key usage
- [ ] Invalid API key response - error handling

## Future Enhancements

1. **Subscription Integration**: Tie API access to subscription tiers
2. **Usage Tracking**: Monitor token usage for billing
3. **Advanced Settings**: Provider-specific configuration options
4. **Multi-Key Support**: Support for multiple API keys per user
5. **Key Rotation**: Automatic API key rotation for security

## Security Considerations

1. **API Key Storage**: Keys are never stored in local storage
2. **Backend Validation**: All keys validated server-side
3. **Authentication Required**: No anonymous access to Kizuna AI
4. **Secure Transmission**: HTTPS for all API communications
5. **Token Expiry**: Automatic token refresh handling

## Support and Troubleshooting

### Common Issues
1. **Provider not showing**: Check authentication status
2. **API errors**: Verify backend connectivity
3. **Key validation failure**: Check user account status
4. **Translation not working**: Verify API key is valid

### Debug Information
- Check browser console for ApiKeyService logs
- Verify authentication token is valid
- Check backend API endpoint response
- Monitor network requests for errors

---

*This integration provides a seamless user experience while maintaining the technical excellence and security standards of the Sokuji application.*