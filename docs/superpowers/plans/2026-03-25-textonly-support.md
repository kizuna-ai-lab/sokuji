# textOnly Support for Remaining AI Clients

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VolcengineST, VolcengineAST2, and LocalInference clients respect the `textOnly` flag in `BaseSessionConfig`, so participant audio sessions (and future user toggles) skip unnecessary TTS generation.

**Architecture:** Three independent client changes: (1) add `inherentlyTextOnly` capability flag for VolcengineST, (2) switch VolcengineAST2 to `s2t` mode when textOnly, (3) skip TTS init/execution in LocalInference when textOnly. All clients already receive `textOnly: true` from `createParticipantSessionConfig()` in MainPanel — they just need to act on it.

**Tech Stack:** TypeScript, Vitest, protobuf (VolcengineAST2)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/services/providers/ProviderConfig.ts` | Modify | Add `inherentlyTextOnly` to `ProviderCapabilities` |
| `src/services/providers/VolcengineSTProviderConfig.ts` | Modify | Set `inherentlyTextOnly: true` |
| `src/services/providers/VolcengineAST2ProviderConfig.ts` | Modify | Set `inherentlyTextOnly: false` |
| Other provider config files (7 total) | Modify | Set `inherentlyTextOnly: false` |
| `src/services/clients/VolcengineAST2Client.ts` | Modify | Conditional `s2t`/`s2s` mode + TTS event guards |
| `src/services/clients/LocalInferenceClient.ts` | Modify | Skip TTS init and execution when `textOnly: true` |

---

### Task 1: Add `inherentlyTextOnly` to ProviderCapabilities

**Files:**
- Modify: `src/services/providers/ProviderConfig.ts:25-39`

- [ ] **Step 1: Add `inherentlyTextOnly` field to `ProviderCapabilities` interface**

In `src/services/providers/ProviderConfig.ts`, add after line 31 (`hasModelConfiguration: boolean;`):

```typescript
  inherentlyTextOnly: boolean; // Provider always outputs text-only (no TTS capability)
```

- [ ] **Step 2: Set `inherentlyTextOnly: true` in VolcengineST provider config**

In `src/services/providers/VolcengineSTProviderConfig.ts`, inside the `capabilities` object (line 80), add:

```typescript
  inherentlyTextOnly: true,
```

- [ ] **Step 3: Set `inherentlyTextOnly: false` in all other provider configs**

Add `inherentlyTextOnly: false` to the `capabilities` object in each of:
- `src/services/providers/VolcengineAST2ProviderConfig.ts`
- `src/services/providers/OpenAIProviderConfig.ts`
- `src/services/providers/GeminiProviderConfig.ts`
- `src/services/providers/OpenAICompatibleProviderConfig.ts`
- `src/services/providers/PalabraAIProviderConfig.ts`
- `src/services/providers/KizunaAIProviderConfig.ts`
- `src/services/providers/LocalInferenceProviderConfig.ts`

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors — all provider configs satisfy the updated interface.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/
git commit -m "feat: add inherentlyTextOnly capability to ProviderCapabilities"
```

---

### Task 2: VolcengineAST2 — Use `s2t` mode when textOnly

**Files:**
- Modify: `src/services/clients/VolcengineAST2Client.ts:376-425` (sendStartSession)
- Modify: `src/services/clients/VolcengineAST2Client.ts:530-550` (TTS event handling)

- [ ] **Step 1: Make `sendStartSession()` conditional on textOnly**

In `sendStartSession()` (line 380), change the `TranslateRequest.encode` payload. Read `textOnly` directly from `this.currentConfig` (no separate instance field needed):

```typescript
    const isTextOnly = this.currentConfig.textOnly || false;

    const requestPayload: any = {
      requestMeta: {
        Endpoint: 'volc.bigasr.sauc.duration',
        AppKey: this.appId,
        ResourceID: this.resourceId,
        ConnectionID: this.connectionId,
        SessionID: this.sessionId,
        Sequence: this.sequence++,
      },
      event: EventType.StartSession,
      user: {
        uid: 'sokuji-user',
        platform: 'web',
      },
      sourceAudio: {
        format: 'pcm',
        rate: INPUT_SAMPLE_RATE,
        bits: 16,
        channel: 1,
      },
      request: {
        mode: isTextOnly ? 's2t' : 's2s',
        sourceLanguage: this.currentConfig.sourceLanguage,
        targetLanguage: this.currentConfig.targetLanguage,
      },
    };

    // Only include targetAudio in s2s mode
    if (!isTextOnly) {
      requestPayload.targetAudio = {
        format: 'ogg_opus',
        rate: OUTPUT_SAMPLE_RATE,
      };
    }

    const request = TranslateRequest.encode(requestPayload).finish();
```

- [ ] **Step 2: Update the realtime event log to reflect actual mode**

In the same method, update the event data (around line 421) to use the actual mode:

```typescript
        data: {
          sessionId: this.sessionId,
          sourceLanguage: this.currentConfig.sourceLanguage,
          targetLanguage: this.currentConfig.targetLanguage,
          mode: isTextOnly ? 's2t' : 's2s',
        }
```

- [ ] **Step 3: Guard TTS event handlers**

In `handleMessage()` (around line 530-550), add guards to skip TTS processing when textOnly. Use `this.currentConfig?.textOnly` directly:

```typescript
        // TTS audio response
        case EventType.TTSResponse:
          if (!this.currentConfig?.textOnly) this.handleTTSResponse(response);
          break;

        // TTS lifecycle
        case EventType.TTSSentenceStart:
          if (!this.currentConfig?.textOnly) {
            this.ttsChunks = [];
            this.ttsSentenceTargetItemId = this.currentTranslationItemId || this.lastCompletedTranslationItemId;
          }
          break;
        case EventType.TTSSentenceEnd:
          if (!this.currentConfig?.textOnly) this.decodeTTSAndPlay();
          break;
        case EventType.TTSEnded:
          if (!this.currentConfig?.textOnly && this.ttsChunks.length > 0) {
            this.decodeTTSAndPlay();
          }
          break;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/VolcengineAST2Client.ts
git commit -m "feat: support textOnly mode in VolcengineAST2Client via s2t API mode"
```

---

### Task 3: LocalInference — Skip TTS when textOnly

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts:81-220` (connect)
- Modify: `src/services/clients/LocalInferenceClient.ts:389-480` (processPipelineJob)

- [ ] **Step 1: Skip TTS engine creation and initialization when textOnly**

In `connect()`, the TTS engine block is at lines 160-166. Change the condition to also check `textOnly`:

```typescript
      // TTS engine (optional — skip when textOnly or no TTS model configured)
      if (config.ttsModelId && !config.textOnly) {
        console.info('[LocalInference] Initializing TTS engine:', config.ttsModelId);
        this.ttsEngine = new TtsEngine();
      } else {
        console.info('[LocalInference] No TTS:', config.textOnly ? 'text-only mode' : 'no TTS model configured');
      }
```

Also update the `engines` array at line 92-93 to match:

```typescript
    const engines = ['asr', 'translation'];
    if (config.ttsModelId && !config.textOnly) engines.push('tts');
```

**Note**: No changes needed in `processPipelineJob()`. The existing code at lines 508-510 already unconditionally marks the assistant item as `completed` after the TTS block. When `this.ttsEngine` is null (because textOnly skipped init), the TTS `if` block is simply skipped and execution falls through to the completion handler.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Manual testing checklist**

Test the following scenarios:
- LocalInference with TTS model + `textOnly: false` → TTS plays (existing behavior)
- LocalInference with TTS model + `textOnly: true` (participant audio) → no TTS engine initialized, translation text appears
- LocalInference without TTS model → no TTS (existing behavior preserved)
- VolcengineAST2 with participant audio → second client sends `mode: 's2t'`, no TTS audio
- VolcengineAST2 normal session → `mode: 's2s'`, TTS audio plays
- VolcengineST → works as before (inherently text-only)

- [ ] **Step 4: Commit**

```bash
git add src/services/clients/LocalInferenceClient.ts
git commit -m "feat: skip TTS engine when textOnly in LocalInferenceClient"
```

---

### Task 4: Final Verification

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors across entire project.

- [ ] **Step 2: Run existing tests**

Run: `npm run test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors.
