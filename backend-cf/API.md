# Sokuji Backend API Documentation

Complete API reference for the Sokuji Cloudflare Workers backend.

## Base URL

- **Production**: `https://sokuji-api.kizuna.ai`
- **Development**: `http://localhost:8787`

## Authenticationu

All protected endpoints require a Bearer token in the Authorization header:

```http
Authorization: Bearer <jwt_token>
```

Tokens are obtained through the Clerk authentication flow and should be refreshed before expiration.

## Common Headers

```http
Content-Type: application/json
Authorization: Bearer <token>
X-Device-Id: <unique_device_id>
X-Platform: chrome-extension | electron
```

## Error Responses

All endpoints follow a consistent error format:

```json
{
  "error": "Error message",
  "details": {} // Optional additional information
}
```

### Common Error Codes

| Status Code | Description |
|------------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid or missing token |
| 402 | Payment Required - Quota exceeded |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

---

## Authentication Endpoints

### OAuth Sign-in

Initiates OAuth authentication flow with supported providers.

**Endpoint:** `GET /api/auth/oauth/:provider`

**Parameters:**
- `provider` (path) - OAuth provider (google, github, etc.)
- `extension` (query) - Set to "true" for Chrome Extension

**Response:**
- Redirects to OAuth provider

**Example:**
```bash
curl -X GET "https://sokuji-api.kizuna.ai/api/auth/oauth/google?extension=true"
```

---

### Refresh Token

Refreshes an expiring authentication token.

**Endpoint:** `POST /api/auth/refresh`

**Headers:**
- `Authorization: Bearer <current_token>`

**Response:**
```json
{
  "token": "new_jwt_token",
  "expiresAt": 1234567890000
}
```

**Example:**
```bash
curl -X POST "https://sokuji-api.kizuna.ai/api/auth/refresh" \
  -H "Authorization: Bearer current_token"
```

---

### Sign Out

Terminates the current session.

**Endpoint:** `POST /api/auth/signout`

**Headers:**
- `Authorization: Bearer <token>`
- `X-Device-Id: <device_id>` (optional)

**Response:**
```json
{
  "success": true
}
```

---

### Sync Authentication State

Synchronizes authentication state across devices.

**Endpoint:** `POST /api/auth/sync`

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "platform": "chrome-extension",
  "deviceId": "device_abc123",
  "session": {},
  "user": {}
}
```

**Response:**
```json
{
  "success": true
}
```

---

### Clerk Webhook

Handles Clerk webhook events (user creation, updates, deletion).

**Endpoint:** `POST /api/auth/webhook/clerk`

**Headers:**
- `svix-id: <webhook_id>`
- `svix-timestamp: <timestamp>`
- `svix-signature: <signature>`

**Note:** This endpoint is called by Clerk's webhook system only.

---

## User Management Endpoints

### Get User Profile

Retrieves the current user's profile with quota information.

**Endpoint:** `GET /api/user/profile`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "imageUrl": "https://...",
    "subscription": "premium",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  },
  "quota": {
    "total": 50000000,
    "used": 1234567,
    "remaining": 48765433,
    "resetDate": "2024-02-01T00:00:00Z"
  },
  "stats": {
    "apiKeyCount": 3,
    "sessionCount": 2
  }
}
```

---

### Update User Profile

Updates user profile information.

**Endpoint:** `PATCH /api/user/profile`

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "success": true
}
```

---

### Get Kizuna AI API Key

Retrieves or creates the user's Kizuna AI API key.

**Endpoint:** `GET /api/user/api-key`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "apiKey": "sk-kizuna-abc123...xyz",
  "provider": "kizunaai"
}
```

**Notes:**
- Automatically generates an API key if the user doesn't have one
- Each user has only one API key for Kizuna AI provider
- Key is cached and reused for subsequent requests
- Key is tied to the user's authentication and subscription status

---

### List Sessions

Retrieves all active sessions for the user.

**Endpoint:** `GET /api/user/sessions`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "sessions": [
    {
      "deviceId": "device_123",
      "platform": "chrome-extension",
      "lastActive": "2024-01-15T12:00:00Z",
      "metadata": {}
    }
  ]
}
```

---

### Delete Session

Terminates a specific session.

**Endpoint:** `DELETE /api/user/sessions/:deviceId`

**Headers:**
- `Authorization: Bearer <token>`

**Parameters:**
- `deviceId` (path) - Device ID to terminate

**Response:**
```json
{
  "success": true
}
```

---

## Subscription Management Endpoints

### Get Subscription Plans

Retrieves all available subscription plans.

**Endpoint:** `GET /api/subscription/plans`

**Response:**
```json
{
  "plans": [
    {
      "id": "free",
      "name": "Free",
      "price": 0,
      "interval": "month",
      "features": {
        "tokensPerMonth": 1000000,
        "apiKeys": 1,
        "sessions": 1,
        "support": "community",
        "providers": ["openai"]
      }
    },
    {
      "id": "premium",
      "name": "Premium",
      "price": 29.99,
      "interval": "month",
      "priceId": "price_premium_monthly",
      "features": {
        "tokensPerMonth": 50000000,
        "apiKeys": 10,
        "sessions": 10,
        "support": "priority",
        "providers": ["openai", "gemini", "comet", "palabra"]
      }
    }
  ]
}
```

---

### Get Current Subscription

Retrieves the user's current subscription status.

**Endpoint:** `GET /api/subscription/current`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "subscription": {
    "plan": "premium",
    "status": "active",
    "currentPeriodStart": "2024-01-01T00:00:00Z",
    "currentPeriodEnd": "2024-02-01T00:00:00Z",
    "cancelAtPeriodEnd": false,
    "stripeSubscriptionId": "sub_123"
  },
  "quota": {
    "total": 50000000,
    "used": 1234567,
    "remaining": 48765433,
    "resetDate": "2024-02-01T00:00:00Z"
  }
}
```

---

### Create Checkout Session

Creates a Stripe checkout session for subscription upgrade.

**Endpoint:** `POST /api/subscription/checkout`

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "planId": "premium",
  "successUrl": "https://sokuji.kizuna.ai/subscription/success",
  "cancelUrl": "https://sokuji.kizuna.ai/subscription/cancel"
}
```

**Response:**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_123"
}
```

---

### Cancel Subscription

Cancels the current subscription at period end.

**Endpoint:** `POST /api/subscription/cancel`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "cancelAt": "2024-02-01T00:00:00Z"
}
```

---

### Reactivate Subscription

Reactivates a canceled subscription before period end.

**Endpoint:** `POST /api/subscription/reactivate`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true
}
```

---

### Stripe Webhook

Handles Stripe webhook events for payment processing.

**Endpoint:** `POST /api/subscription/webhook/stripe`

**Headers:**
- `stripe-signature: <signature>`

**Note:** This endpoint is called by Stripe's webhook system only.

---

## Usage Tracking Endpoints

### Get Current Quota

Retrieves the user's current token quota status.

**Endpoint:** `GET /api/usage/quota`

**Headers:**
- `Authorization: Bearer <token>`
- `X-Device-Id: <device_id>` (optional)

**Response:**
```json
{
  "total": 50000000,
  "used": 1234567,
  "remaining": 48765433,
  "resetDate": "2024-02-01T00:00:00Z",
  "deviceUsage": {
    "deviceId": "device_123",
    "tokensUsed": 500000
  }
}
```

---

### Report Usage

Reports token usage from a device.

**Endpoint:** `POST /api/usage/report`

**Headers:**
- `Authorization: Bearer <token>`
- `X-Device-Id: <device_id>`
- `X-Platform: chrome-extension | electron`

**Body:**
```json
{
  "tokens": 1500,
  "model": "gpt-4",
  "provider": "openai",
  "sessionId": "session_123",
  "timestamp": "2024-01-15T12:00:00Z",
  "metadata": {
    "feature": "translation",
    "language": "en-es"
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "quota": {
    "total": 50000000,
    "used": 1236067,
    "remaining": 48763933,
    "resetDate": "2024-02-01T00:00:00Z"
  }
}
```

**Response (Quota Exceeded):**
```json
{
  "error": "Quota exceeded",
  "quota": {
    "total": 50000000,
    "used": 50000000,
    "remaining": 0,
    "requested": 1500
  }
}
```

---

### Get Usage History

Retrieves historical usage data with filtering options.

**Endpoint:** `GET /api/usage/history`

**Headers:**
- `Authorization: Bearer <token>`

**Query Parameters:**
- `startDate` - ISO date string
- `endDate` - ISO date string
- `provider` - Filter by provider
- `model` - Filter by model
- `deviceId` - Filter by device
- `limit` - Results per page (default: 100)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "logs": [
    {
      "id": 123,
      "tokens": 1500,
      "model": "gpt-4",
      "provider": "openai",
      "metadata": {
        "sessionId": "session_123",
        "deviceId": "device_123",
        "platform": "chrome-extension"
      },
      "createdAt": "2024-01-15T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 250,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### Get Usage Statistics

Retrieves aggregated usage statistics.

**Endpoint:** `GET /api/usage/stats`

**Headers:**
- `Authorization: Bearer <token>`

**Query Parameters:**
- `period` - Time period: 24h, 7d, 30d, 90d (default: 30d)

**Response:**
```json
{
  "period": "30d",
  "quota": {
    "total": 50000000,
    "used": 15000000,
    "remaining": 35000000,
    "percentageUsed": 30
  },
  "summary": {
    "totalRequests": 1234,
    "totalTokens": 15000000,
    "uniqueDevices": 2,
    "totalSessions": 45
  },
  "byProvider": {
    "openai": {
      "totalRequests": 1000,
      "totalTokens": 12000000,
      "models": {
        "gpt-4": {
          "requests": 500,
          "tokens": 8000000
        },
        "gpt-3.5-turbo": {
          "requests": 500,
          "tokens": 4000000
        }
      }
    }
  },
  "byDate": [
    {
      "date": "2024-01-15",
      "requests": 50,
      "tokens": 500000
    }
  ]
}
```

---

### Check Quota Availability

Checks if sufficient quota is available for estimated usage.

**Endpoint:** `POST /api/usage/check`

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "estimatedTokens": 5000
}
```

**Response:**
```json
{
  "hasQuota": true,
  "quota": {
    "total": 50000000,
    "used": 15000000,
    "remaining": 35000000,
    "requested": 5000
  }
}
```

---

### Reset Usage (Admin Only)

Resets token usage for a user. Requires admin privileges.

**Endpoint:** `POST /api/usage/reset`

**Headers:**
- `Authorization: Bearer <admin_token>`

**Body:**
```json
{
  "targetUserId": "user_123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Usage reset for user user_123"
}
```

---

## WebSocket Endpoint

### Real-time Quota Synchronization

Establishes a WebSocket connection for real-time quota updates across devices.

**Endpoint:** `GET /ws/quota`

**Headers:**
- `Authorization: Bearer <token>`
- `Upgrade: websocket`
- `Connection: Upgrade`

**Query Parameters:**
- `deviceId` - Unique device identifier
- `platform` - Platform type (chrome-extension | electron)

### Message Types

#### Client → Server

**Usage Report:**
```json
{
  "type": "usage_report",
  "data": {
    "tokens": 1500,
    "model": "gpt-4",
    "provider": "openai"
  }
}
```

**Quota Request:**
```json
{
  "type": "quota_request"
}
```

**Sync Request:**
```json
{
  "type": "sync_request"
}
```

**Pong (Keepalive):**
```json
{
  "type": "pong"
}
```

#### Server → Client

**Quota Update:**
```json
{
  "type": "quota_update",
  "data": {
    "userId": "user_123",
    "total": 50000000,
    "used": 15000000,
    "remaining": 35000000,
    "resetDate": "2024-02-01T00:00:00Z",
    "devices": [
      {
        "deviceId": "device_123",
        "platform": "chrome-extension",
        "tokensUsed": 5000000,
        "lastActive": "2024-01-15T12:00:00Z"
      }
    ]
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

**Ping (Keepalive):**
```json
{
  "type": "ping"
}
```

**Error:**
```json
{
  "type": "error",
  "error": "Error message"
}
```

### Connection Example (JavaScript)

```javascript
// Establish WebSocket connection
const ws = new WebSocket(
  'wss://sokuji-api.kizuna.ai/ws/quota?deviceId=device_123&platform=chrome-extension',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

// Handle connection open
ws.onopen = () => {
  console.log('Connected to quota sync');
  
  // Request current quota
  ws.send(JSON.stringify({ type: 'quota_request' }));
};

// Handle incoming messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'quota_update':
      updateLocalQuota(message.data);
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    case 'error':
      console.error('WebSocket error:', message.error);
      break;
  }
};

// Report usage
function reportUsage(tokens) {
  ws.send(JSON.stringify({
    type: 'usage_report',
    data: { tokens }
  }));
}

// Handle connection close
ws.onclose = () => {
  console.log('Disconnected from quota sync');
  // Implement reconnection logic
};
```

---

## Rate Limiting

Rate limits are enforced based on subscription tier:

| Tier | Requests/Minute | Burst Limit |
|------|----------------|-------------|
| Free | 10 | 20 |
| Basic | 60 | 100 |
| Premium | 300 | 500 |
| Enterprise | Unlimited | Unlimited |

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 299
X-RateLimit-Reset: 1234567890
```

When rate limited, the API returns:
```json
{
  "error": "Too many requests",
  "retryAfter": 60
}
```

---

## Security Considerations

### Authentication
- All tokens expire after 24 hours
- Refresh tokens before expiration to maintain session
- Store tokens securely (never in localStorage for extensions)

### API Keys
- Keys are masked in responses (only first 7 and last 4 characters shown)
- Keys can be revoked immediately via soft delete
- Each key is tied to a specific provider and rate limit

### CORS
- Only whitelisted origins are allowed
- Chrome extension origins must match manifest ID
- Credentials are required for authenticated requests

### Kizuna AI Integration
- Backend-managed API keys for simplified user experience
- Automatic key generation tied to user authentication
- Single API key per user with auto-renewal capabilities
- Seamless integration with existing provider architecture

### Webhooks
- All webhooks are verified using HMAC signatures
- Replay attacks are prevented with timestamp validation
- Failed webhooks are retried with exponential backoff

---

## Testing

### Using cURL

**Get user profile:**
```bash
curl -X GET "https://sokuji-api.kizuna.ai/api/user/profile" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Report usage:**
```bash
curl -X POST "https://sokuji-api.kizuna.ai/api/usage/report" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: device_123" \
  -H "X-Platform: chrome-extension" \
  -d '{
    "tokens": 1500,
    "model": "gpt-4",
    "provider": "openai"
  }'
```

### Using Postman

Import the following environment variables:
```json
{
  "base_url": "https://sokuji-api.kizuna.ai",
  "token": "YOUR_JWT_TOKEN",
  "device_id": "device_123",
  "platform": "chrome-extension"
}
```

### WebSocket Testing

Use a WebSocket client like `wscat`:
```bash
wscat -c "wss://sokuji-api.kizuna.ai/ws/quota?deviceId=device_123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Support

For API support and questions:
- GitHub Issues: [Report issues](https://github.com/your-repo/issues)
- Documentation: [Main README](./README.md)
- Status Page: https://status.kizuna.ai