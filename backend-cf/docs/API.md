# Sokuji Backend API Documentation

Complete API reference for the Sokuji Cloudflare Workers backend with wallet-based token system.

## Base URL

- **Production**: `https://sokuji-api.kizuna.ai`
- **Development**: `http://localhost:8787`

## Authentication

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

Retrieves the current user's profile information (without token balance data).

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
    "subscription": "pro",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

**Note:** Token balance and usage information is now retrieved via the `/api/wallet/status` endpoint.

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



## Wallet Management Endpoints

The wallet system replaces the traditional quota model with tokens that never expire and are minted proportionally based on payments.

### Get Wallet Status

Retrieves the user's current wallet balance, plan information, and usage statistics.

**Endpoint:** `GET /api/wallet/status`

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "balance": 50000000,
  "frozen": false,
  "plan": "pro",
  "monthlyQuota": 50000000,
  "last30DaysUsage": 1234567,
  "features": ["advanced_models", "api_access"],
  "rateLimitRpm": 300,
  "maxConcurrentSessions": 5,
  "total": 50000000,
  "used": 0,
  "remaining": 50000000,
  "resetDate": null
}
```

**Fields:**
- `balance`: Current token balance (never expires)
- `frozen`: Whether the wallet is frozen (subscription issues)
- `plan`: Current subscription plan
- `monthlyQuota`: Tokens allocated monthly for this plan
- `last30DaysUsage`: Tokens used in the past 30 days
- `features`: Plan features and capabilities
- `rateLimitRpm`: Rate limit in requests per minute
- `maxConcurrentSessions`: Maximum concurrent sessions allowed
- `total`, `used`, `remaining`: Compatibility fields for legacy clients
- `resetDate`: Always null (tokens don't reset)

---

### Use Tokens

Deducts tokens from the user's wallet balance (atomic operation).

**Endpoint:** `POST /api/wallet/use`

**Headers:**
- `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "tokens": 1000,
  "metadata": {
    "model": "gpt-4",
    "session_id": "session_123"
  }
}
```

**Success Response:**
```json
{
  "success": true,
  "remaining": 49999000,
  "message": "Used 1000 tokens successfully"
}
```

**Error Response (Insufficient Balance):**
```json
{
  "error": "Insufficient balance",
  "available": 500,
  "requested": 1000
}
```

---

### Get Transaction History

Retrieves the user's token transaction history from the ledger.

**Endpoint:** `GET /api/wallet/history`

**Headers:**
- `Authorization: Bearer <token>`

**Query Parameters:**
- `limit` (optional): Number of transactions to return (default: 20, max: 100)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "transactions": [
    {
      "id": "txn_123",
      "type": "mint",
      "tokens": 50000000,
      "balance": 50000000,
      "metadata": {
        "plan": "pro_plan",
        "amount_paid": 5000
      },
      "createdAt": "2024-01-15T10:00:00Z"
    },
    {
      "id": "txn_124",
      "type": "use",
      "tokens": -1000,
      "balance": 49999000,
      "metadata": {
        "model": "gpt-4",
        "session_id": "session_123"
      },
      "createdAt": "2024-01-15T11:00:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
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

### Wallet Security
- **Atomic Operations**: All token deductions are atomic to prevent race conditions
- **Idempotency**: External event IDs prevent duplicate payment processing
- **Negative Balance Protection**: Automatic wallet freezing on negative balance
- **Mint Capping**: Maximum 12 months of tokens per transaction
- **Audit Trail**: Complete immutable ledger of all token movements

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
- Duplicate prevention via processed_events table
- Payment events trigger proportional token minting

---

## Testing

### Using cURL

**Get user profile (without quota):**
```bash
curl -X GET "https://sokuji-api.kizuna.ai/api/user/profile" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Get wallet status:**
```bash
curl -X GET "https://sokuji-api.kizuna.ai/api/wallet/status" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Use tokens from wallet:**
```bash
curl -X POST "https://sokuji-api.kizuna.ai/api/wallet/use" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tokens": 1000, "metadata": {"model": "gpt-4"}}'
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