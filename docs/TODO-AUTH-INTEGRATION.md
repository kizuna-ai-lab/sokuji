# TODO: Authentication & Quota Integration Tasks

> **Note**: This document was created during the Clerk to Better Auth migration. Many tasks have been completed with Better Auth implementation. This is kept for historical reference and to track remaining UI/UX improvements.

## Overview
This document outlines the remaining tasks needed to complete the authentication and quota management integration for the Sokuji AI translation service (now using Better Auth).

## ✅ Completed Components
- [x] Backend API (Cloudflare Workers)
- [x] Authentication services (Electron & Chrome Extension)
- [x] Quota management services with WebSocket sync
- [x] React Context providers (AuthContext & QuotaContext)
- [x] Service factories and integration
- [x] **Kizuna AI Provider Integration**: Complete authentication-based AI provider
  - [x] Provider type system and enums
  - [x] Settings context integration with backend API key fetching
  - [x] ApiKeyService with caching for backend-managed keys
  - [x] Provider configuration with `requiresAuth` flag
  - [x] Client factory integration using OpenAI-compatible API
  - [x] Backend API endpoint for single user API key
  - [x] UI integration in SimpleConfigPanel with authentication flow
  - [x] Internationalization support

## 🔧 Frontend UI Integration

### 1. Authentication UI Components

#### 1.1 Sign-In Component
- [ ] Create `src/components/SignIn/SignIn.tsx`
  - [ ] OAuth provider buttons (Google, GitHub)
  - [ ] Email sign-in form
  - [ ] Loading states
  - [ ] Error handling display
  - [ ] Remember me option

#### 1.2 User Profile Component
- [ ] Create `src/components/UserProfile/UserProfile.tsx`
  - [ ] Display user avatar and name
  - [ ] Show subscription tier
  - [ ] Sign out button
  - [ ] Manage subscription link
  - [ ] API keys management

#### 1.3 Integration Points
- [ ] Add sign-in trigger to SimpleConfigPanel
- [ ] Add user profile section to settings
- [ ] Show authentication state in header
- [ ] Add auth guard for premium features

### 2. Quota Display Components

#### 2.1 Quota Status Bar
- [ ] Create `src/components/QuotaStatus/QuotaStatus.tsx`
  - [ ] Token usage progress bar
  - [ ] Remaining tokens display
  - [ ] Reset date countdown
  - [ ] Warning indicators

#### 2.2 Quota Warning Modal
- [ ] Create `src/components/QuotaWarning/QuotaWarning.tsx`
  - [ ] Low quota warning (20% remaining)
  - [ ] Critical warning (5% remaining)
  - [ ] Quota exceeded message
  - [ ] Upgrade prompt with link

#### 2.3 Usage History
- [ ] Create `src/components/UsageHistory/UsageHistory.tsx`
  - [ ] Daily/weekly/monthly views
  - [ ] Provider breakdown
  - [ ] Model usage statistics
  - [ ] Export functionality

### 3. Integration with Existing Components

#### 3.1 SimpleMainPanel Updates
- [ ] Add quota status to header
- [ ] Show sync status indicator
- [ ] Display device connection count
- [ ] Add usage reporting after each translation

#### 3.2 SimpleConfigPanel Updates
- [ ] Add authentication section
- [ ] Show user info when logged in
- [ ] Display subscription features
- [ ] Add upgrade prompts for free users

#### 3.3 Session Component Updates
- [ ] Report token usage to QuotaContext
- [ ] Check quota before starting session
- [ ] Show quota warnings during session
- [ ] Handle quota exceeded errors

## 🔌 Electron Integration

### 1. Main Process Updates
- [ ] Add authentication window handler in `electron/main.js`
  - [ ] Create auth window for OAuth flow
  - [ ] Handle redirect URLs
  - [ ] Extract tokens from callback
  - [ ] Return auth result to renderer

### 2. Preload Script Updates
- [ ] Add auth methods to `electron/preload.js`
  - [ ] `openAuthWindow(url)` - Opens OAuth window
  - [ ] `getSecureData(key)` - Retrieves secure storage
  - [ ] `setSecureData(key, value)` - Stores secure data
  - [ ] `deleteSecureData(key)` - Removes secure data

### 3. Secure Storage Implementation
- [ ] Implement secure storage using electron-store
  - [ ] Install `electron-store` package
  - [ ] Configure encryption for sensitive data
  - [ ] Add storage methods to main process
  - [ ] Expose via contextBridge

## 🧩 Chrome Extension Integration

### 1. Manifest Updates
- [ ] Update `extension/manifest.json`
  - [ ] Add `identity` permission for OAuth
  - [ ] Add `storage` permission for data persistence
  - [ ] Add backend URL to `host_permissions`
  - [ ] Configure OAuth redirect URL

### 2. Background Script
- [ ] Create `extension/background.js`
  - [ ] Handle authentication flows
  - [ ] Manage WebSocket connections
  - [ ] Sync quota across tabs
  - [ ] Handle extension updates

### 3. Content Script Updates
- [ ] Update authentication state injection
- [ ] Add quota checking before operations
- [ ] Report usage from content scripts
- [ ] Handle auth expiration

## 🔄 Service Integration

### 1. API Client Updates
- [ ] Update all AI client implementations
  - [ ] Add token usage calculation
  - [ ] Report usage to QuotaService
  - [ ] Handle quota exceeded errors
  - [ ] Add retry logic for auth failures

### 2. Error Handling
- [ ] Create unified error handler
  - [ ] Auth errors → trigger re-authentication
  - [ ] Quota errors → show upgrade prompt
  - [ ] Network errors → queue for retry
  - [ ] Rate limit errors → implement backoff

### 3. Offline Support
- [ ] Implement offline queue for usage reports
- [ ] Cache quota info locally
- [ ] Sync on reconnection
- [ ] Show offline indicator

## 🧪 Testing Requirements

### 1. Unit Tests
- [ ] Test auth services
- [ ] Test quota services
- [ ] Test context providers
- [ ] Test UI components

### 2. Integration Tests
- [ ] Test OAuth flows
- [ ] Test WebSocket sync
- [ ] Test cross-device sync
- [ ] Test offline scenarios

### 3. E2E Tests
- [ ] Test complete auth flow
- [ ] Test quota tracking
- [ ] Test subscription upgrade
- [ ] Test multi-device usage

## 📝 Documentation Updates

### 1. User Documentation
- [ ] How to sign in
- [ ] Understanding quotas
- [ ] Managing subscriptions
- [ ] Troubleshooting auth issues

### 2. Developer Documentation
- [ ] Update CLAUDE.md with auth info
- [ ] API authentication guide
- [ ] Quota system architecture
- [ ] Testing instructions

### 3. Configuration Guide
- [ ] Environment variables setup
- [ ] Better Auth configuration
- [ ] Stripe setup (optional)
- [ ] Cloudflare deployment

## 🚀 Deployment Tasks

### 1. Backend Deployment
- [ ] Create Cloudflare D1 database
- [ ] Create KV namespaces
- [ ] Set environment variables
- [ ] Deploy Workers code
- [ ] Configure custom domain

### 2. Better Auth Setup
- [ ] Configure Better Auth backend
- [ ] Set up OAuth providers
- [ ] Configure session management
- [ ] Set up authentication endpoints

### 3. Stripe Setup (Optional)
- [ ] Create Stripe products
- [ ] Configure pricing plans
- [ ] Set up webhooks
- [ ] Test payment flows

## 🎯 Priority Order

### Phase 1: Core Authentication (Required)
1. Electron preload/main updates
2. Chrome extension manifest updates
3. Sign-in UI component
4. User profile component
5. Auth integration in SimpleConfigPanel

### Phase 2: Quota Display (Required)
1. Quota status component
2. Integration in SimpleMainPanel
3. Usage reporting in AI clients
4. Warning modals

### Phase 3: Enhanced Features (Optional)
1. Usage history component
2. Subscription management UI
3. API key management
4. Device management

### Phase 4: Polish & Testing
1. Error handling improvements
2. Offline support
3. Unit & integration tests
4. Documentation updates

## 📅 Estimated Timeline

- **Phase 1**: 2-3 days
- **Phase 2**: 2-3 days
- **Phase 3**: 3-4 days
- **Phase 4**: 2-3 days

**Total**: ~10-13 days for complete integration

## 🔗 Dependencies

### NPM Packages to Install
```json
{
  "electron-store": "^8.1.0",  // For Electron secure storage
  "better-auth": "latest",  // For Better Auth backend
  "recharts": "^2.10.0"  // For usage charts (optional)
}
```

### External Services Required
- Better Auth configuration
- Cloudflare account with Workers enabled
- Stripe account (optional, for payments)

## 📋 Checklist for Production

- [ ] All environment variables configured
- [ ] Better Auth endpoints verified and active
- [ ] Stripe webhooks configured (if using)
- [ ] CORS settings updated for production URLs
- [ ] SSL certificates configured
- [ ] Rate limiting configured
- [ ] Monitoring and logging set up
- [ ] Backup strategy implemented
- [ ] Security audit completed
- [ ] Load testing performed

## 🐛 Known Issues & Considerations

1. **WebSocket in Chrome Extension**: May need to use long-polling fallback
2. **OAuth in Electron**: Requires careful handling of redirect URLs
3. **Token Storage**: Must use secure storage, never localStorage
4. **Cross-Device Sync**: Consider network latency and conflict resolution
5. **Quota Accuracy**: Implement optimistic updates with server reconciliation

## 📞 Support & Resources

- [Better Auth Documentation](https://www.better-auth.com/docs)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Electron Security Guide](https://www.electronjs.org/docs/latest/tutorial/security)
- [Chrome Extension Best Practices](https://developer.chrome.com/docs/extensions/mv3/security/)

---

*Last Updated: 2025-01-03*
*Status: Migrated to Better Auth - Partial Implementation Complete*