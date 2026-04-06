# Palabra AI Error Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse Palabra AI error responses during session creation and display them to the user in the conversation panel.

**Architecture:** Two changes — PalabraAIClient parses the structured JSON error body from the Palabra API and throws a descriptive error. MainPanel's outer catch block creates a visible error ConversationItem so the user sees why the session failed.

**Tech Stack:** TypeScript, React (Zustand), Vitest

---

### Task 1: Parse Palabra API error response in PalabraAIClient

**Files:**
- Modify: `src/services/clients/PalabraAIClient.ts:420-422`

- [ ] **Step 1: Replace the generic error throw with parsed error handling**

In `PalabraAIClient.ts`, replace the existing `!response.ok` block (lines 420-422):

```typescript
// BEFORE (lines 420-422):
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }
```

With:

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

- [ ] **Step 2: Verify the app builds**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/services/clients/PalabraAIClient.ts
git commit -m "fix(palabra): parse structured error response from Palabra AI API

Extracts the detail/title from Palabra's JSON error body instead of
throwing a generic statusText message. For insufficient balance
(error_code 100050), the user now sees 'Palabra AI: Insufficient balance'.

Closes #176"
```

---

### Task 2: Surface connection errors in MainPanel conversation panel

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:1269-1283`

- [ ] **Step 1: Add error display to the outer catch block**

In `MainPanel.tsx`, replace the existing catch block (lines 1269-1283):

```typescript
// BEFORE (lines 1269-1283):
    } catch (error: any) {
      console.error('[Sokuji] [MainPanel] Failed to initialize session:', error);
      
      // Track session initialization failure
      trackEvent('error_occurred', {
        error_type: 'session_initialization',
        error_message: error.message || 'Failed to initialize session',
        component: 'MainPanel',
        severity: 'high',
        provider: provider,
        recoverable: true
      });
      
      // Reset state in case of error
      await disconnectConversation();
```

With:

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
      
      // Track session initialization failure
      trackEvent('error_occurred', {
        error_type: 'session_initialization',
        error_message: error.message || 'Failed to initialize session',
        component: 'MainPanel',
        severity: 'high',
        provider: provider,
        recoverable: true
      });
      
      // Reset state in case of error
      await disconnectConversation();
```

Note: `addLog` is already available from `useLogActions()` (line 133). `setItems` is already available as component state. No new imports needed.

- [ ] **Step 2: Verify the app builds**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "fix(ui): show connection-phase errors in conversation panel

Previously, if session initialization failed (e.g., Palabra AI
insufficient balance), the error was only logged to console. Now it
appears in both the conversation panel and LogsPanel, visible to the
user. This benefits all providers, not just Palabra AI."
```

---

### Task 3: Manual smoke test

- [ ] **Step 1: Test with invalid Palabra credentials**

1. Start the dev server: `npm run dev`
2. Open the app, select Palabra AI as provider
3. Enter invalid Client ID / Client Secret
4. Click connect
5. Verify: an error message appears in the conversation panel (not just console)

- [ ] **Step 2: Test with valid credentials but known error state (if possible)**

If you have a Palabra AI account with zero balance:
1. Enter valid Client ID / Client Secret
2. Click connect
3. Verify: `"Palabra AI: Insufficient balance"` appears in the conversation panel

- [ ] **Step 3: Test other providers still work**

1. Switch to OpenAI or Gemini
2. Enter an invalid API key
3. Click connect
4. Verify: error message appears in conversation panel (generic, not Palabra-specific)
5. Enter a valid API key, verify normal connection still works
