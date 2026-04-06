# Palabra AI Error Message Design

**Issue:** [kizuna-ai-lab/sokuji#176](https://github.com/kizuna-ai-lab/sokuji/issues/176)
**Date:** 2026-04-06

## Problem

When Palabra AI returns an error during session creation (e.g., 403 with `error_code: 100050` for insufficient balance), the UI shows nothing. The user sees the session fail with no explanation. The current code throws a generic `"Failed to create session: Forbidden"` that is only logged to the console.

## Approach

Parse Palabra AI's structured error responses and surface them in the conversation panel. Also fix the MainPanel catch block so connection-phase errors are visible to the user for all providers.

Two files changed: `PalabraAIClient.ts` and `MainPanel.tsx`. No i18n changes — Palabra's error messages are already detailed and in English, which is sufficient for Palabra users.

## Design

### 1. PalabraAIClient.createSession() — Parse error response

In `createSession()`, when `!response.ok`, parse the JSON body to extract the Palabra error structure:

```typescript
if (!response.ok) {
  let errorMessage = `Failed to create session: ${response.statusText}`;
  try {
    const errorData = await response.json();
    const firstError = errorData?.errors?.[0];
    if (firstError) {
      errorMessage = `Palabra AI: ${firstError.detail || firstError.title || response.statusText}`;
    }
  } catch {
    // JSON parse failed, keep generic message
  }
  throw new Error(errorMessage);
}
```

**Palabra error response format:**
```json
{
  "ok": false,
  "errors": [
    {
      "type": "https://docs.palabra.ai/docs/error_codes#forbiddenresource",
      "title": "Forbidden resource",
      "detail": "Insufficient balance",
      "instance": "/session-storage/session",
      "status": 403,
      "error_code": 100050
    }
  ]
}
```

For `error_code: 100050`, the user sees: `"Palabra AI: Insufficient balance"`

For other errors, the user sees: `"Palabra AI: <detail or title>"`

If JSON parsing fails (non-JSON error body), falls back to: `"Failed to create session: <statusText>"`

### 2. MainPanel catch block — Show connection errors in UI

The outer catch block in `connectConversation()` (around line 1269) currently only logs to console and disconnects. Add an error ConversationItem so the user sees the error in the conversation panel, plus log it to the LogsPanel:

```typescript
} catch (error: any) {
  console.error('[Sokuji] [MainPanel] Failed to initialize session:', error);

  // Show error in conversation panel so it's visible to user
  const errorMessage = error.message || 'Network connection error';
  addLog(errorMessage, 'error');
  setItems(prevItems => [...prevItems, {
    id: `error-${Date.now()}`,
    role: 'system',
    type: 'error',
    status: 'completed',
    createdAt: Date.now(),
    formatted: { text: errorMessage },
  }]);

  // Track session initialization failure (existing code)
  trackEvent('error_occurred', { ... });

  // Reset state in case of error (existing code)
  await disconnectConversation();
}
```

This change benefits all providers — any connection-phase error now appears in the conversation panel.

## Files Changed

| File | Change |
|------|--------|
| `src/services/clients/PalabraAIClient.ts` | Parse Palabra error response JSON in `createSession()` |
| `src/components/MainPanel/MainPanel.tsx` | Add error ConversationItem + addLog in outer catch block |

## Error Flow

```
Palabra API returns 403
  -> PalabraAIClient.createSession() parses JSON error body
  -> Throws Error("Palabra AI: Insufficient balance")
  -> MainPanel.connectConversation() catch block
     -> addLog(errorMessage, 'error')           -> LogsPanel
     -> setItems([...prev, errorItem])           -> Conversation panel
     -> trackEvent('error_occurred', ...)        -> Analytics
     -> disconnectConversation()                 -> Cleanup
```
