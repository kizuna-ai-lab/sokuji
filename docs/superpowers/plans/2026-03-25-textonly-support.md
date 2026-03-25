# textOnly Support for Remaining AI Clients

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VolcengineST, VolcengineAST2, and LocalInference clients respect the `textOnly` flag in `BaseSessionConfig`, so participant audio sessions and user toggle skip unnecessary TTS generation.

**Architecture:** Three independent client changes: (1) add `textOnlyCapability` enum to `ProviderCapabilities` (`'always'` for VolcengineST, `'optional'` for most, `'never'` for PalabraAI), (2) switch VolcengineAST2 to `s2t` mode when textOnly, (3) skip TTS init/execution in LocalInference when textOnly. UI toggle visibility driven by `textOnlyCapability === 'optional'`.

**Tech Stack:** TypeScript, Vitest, protobuf (VolcengineAST2)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/services/providers/ProviderConfig.ts` | Modify | Add `textOnlyCapability` to `ProviderCapabilities` |
| `src/services/providers/VolcengineSTProviderConfig.ts` | Modify | Set `textOnlyCapability: 'always'` |
| `src/services/providers/PalabraAIProviderConfig.ts` | Modify | Set `textOnlyCapability: 'never'` |
| Other provider config files (5 total) | Modify | Set `textOnlyCapability: 'optional'` |
| `src/services/clients/VolcengineAST2Client.ts` | Modify | Conditional `s2t`/`s2s` mode + TTS event guards |
| `src/services/clients/LocalInferenceClient.ts` | Modify | Skip TTS init and execution when `textOnly: true` |
| `src/components/Settings/sections/LanguageSection.tsx` | Modify | Toggle visibility: `textOnlyCapability === 'optional'` |

---

### Task 1: Add `textOnlyCapability` to ProviderCapabilities

**Files:**
- Modify: `src/services/providers/ProviderConfig.ts:25-39`

- [x] **Step 1: Add `textOnlyCapability` field to `ProviderCapabilities` interface**

```typescript
  textOnlyCapability: 'always' | 'optional' | 'never';
```

- [x] **Step 2: Set values in all provider configs**

- VolcengineST: `textOnlyCapability: 'always'`
- PalabraAI: `textOnlyCapability: 'never'`
- All others (OpenAI, Gemini, AST2, LocalInference, etc.): `textOnlyCapability: 'optional'`

- [x] **Step 3: Update UI toggle visibility**

In `LanguageSection.tsx`, change toggle condition to `textOnlyCapability === 'optional'`.

- [x] **Step 4: Commit**

---

### Task 2: VolcengineAST2 — Use `s2t` mode when textOnly

**Files:**
- Modify: `src/services/clients/VolcengineAST2Client.ts`

- [x] **Step 1: Make `sendStartSession()` conditional on textOnly**

Read `this.currentConfig.textOnly`, set `mode: 's2t'` and omit `targetAudio` when true.

- [x] **Step 2: Update realtime event log to reflect actual mode**

- [x] **Step 3: Guard TTS event handlers with `this.currentConfig?.textOnly` checks**

- [x] **Step 4: Commit**

---

### Task 3: LocalInference — Skip TTS when textOnly

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts`

- [x] **Step 1: Skip TTS engine creation and initialization when textOnly**

In `connect()`, check `config.ttsModelId && !config.textOnly` before creating TTS engine.

**Note**: No changes needed in `processPipelineJob()` — existing code handles null `ttsEngine`.

- [x] **Step 2: Commit**

---

### Task 4: Final Verification

- [x] **Step 1: Run full type check** — `npx tsc --noEmit`
- [x] **Step 2: Run existing tests** — `npm run test` (50/50 pass)
- [x] **Step 3: Verify build succeeds** — `npm run build`
