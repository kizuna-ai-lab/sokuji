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

**Note:** Authentication is handled through Clerk. Only webhook endpoints are maintained in the backend.

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
  }
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



## Usage Tracking Endpoints

**Note:** Usage tracking is now simplified. Token usage is tracked automatically by the relay server and recorded directly in the `usage_logs` table. Frontend applications no longer need to report usage manually.

### Get Current Quota

Retrieves the user's current token quota status. Calculates usage from `usage_logs` table in real-time.

**Endpoint:** `GET /api/usage/quota`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "total": 50000000,
  "used": 1234567,
  "remaining": 48765433,
  "resetDate": "2024-02-01T00:00:00Z"
}
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

**Get current quota:**
```bash
curl -X GET "https://sokuji-api.kizuna.ai/api/usage/quota" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
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