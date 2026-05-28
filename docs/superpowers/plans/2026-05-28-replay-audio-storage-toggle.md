# Replay Audio Storage Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CommonSettings.keepReplayAudio` boolean (default `false`) that gates per-item PCM audio accumulation in all six provider clients, hides the inline ▶ play button when off, and removes the dead `formatted.file` WAV generation path.

**Architecture:** New boolean propagates from `settingsStore` → `BaseSessionConfig.keepReplayAudio` → each provider client caches it at `connect(config)` time → push and merge sites are gated on the cached flag. UI: `LanguageSection` adds a `ToggleSwitch` next to `textOnly`; `ConversationRow` gains a `replayEnabled` visibility prop threaded from `MainPanel` via `ConversationBubble`. Mid-session toggle changes take effect on the next session (mirrors how `textOnly` is cached in `GeminiClient.ts:316`).

**Tech Stack:** TypeScript, React, Zustand, Vitest, `@testing-library/react`, i18next.

**Spec:** `docs/superpowers/specs/2026-05-28-replay-audio-storage-toggle-design.md`

---

## Task 1: Add `keepReplayAudio` to settings store

**Files:**
- Modify: `src/stores/settingsStore.ts` (interface, default, action, loader, propagation, selector)
- Test: `src/stores/settingsStore.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block at the end of the existing top-level `describe('settingsStore', ...)` in `src/stores/settingsStore.test.ts` (right before its closing `});`):

```ts
  describe('keepReplayAudio', () => {
    it('defaults to false on a fresh store', () => {
      // Reset specifically for this test — beforeEach only resets a few fields.
      useSettingsStore.setState({ keepReplayAudio: false });
      expect(useSettingsStore.getState().keepReplayAudio).toBe(false);
    });

    it('setKeepReplayAudio(true) updates state and persists', async () => {
      mockSetSetting.mockResolvedValueOnce(undefined);
      await useSettingsStore.getState().setKeepReplayAudio(true);
      expect(useSettingsStore.getState().keepReplayAudio).toBe(true);
      expect(mockSetSetting).toHaveBeenCalledWith(
        'settings.common.keepReplayAudio',
        true,
      );
    });

    it('rolls back state when persistence fails', async () => {
      useSettingsStore.setState({ keepReplayAudio: false });
      mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
      await useSettingsStore.getState().setKeepReplayAudio(true);
      // State must roll back to the previous value.
      expect(useSettingsStore.getState().keepReplayAudio).toBe(false);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/settingsStore.test.ts -t "keepReplayAudio" --run`
Expected: 3 failures — `setKeepReplayAudio` is not a function / `keepReplayAudio` is undefined on the store.

- [ ] **Step 3: Add the field to the `CommonSettings` interface**

Edit `src/stores/settingsStore.ts`. Find the `CommonSettings` interface (around line 34) and add `keepReplayAudio: boolean;` after `textOnly: boolean;`:

```ts
export interface CommonSettings {
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;
  participantSystemInstructions: string;
  textOnly: boolean;
  keepReplayAudio: boolean;
  speakerDisplayMode: DisplayMode;
  participantDisplayMode: DisplayMode;
}
```

- [ ] **Step 4: Add the default value**

Edit `src/stores/settingsStore.ts`. Find `defaultCommonSettings` (around line 185) and add `keepReplayAudio: false,` right after the existing `textOnly: false,` line:

```ts
const defaultCommonSettings: CommonSettings = {
  provider: Provider.OPENAI,
  uiLanguage: 'en',
  uiMode: 'basic',
  textOnly: false,
  keepReplayAudio: false,
  // ...existing systemInstructions etc...
```

- [ ] **Step 5: Add the field and action to `SettingsStore`**

Edit `src/stores/settingsStore.ts`. Find the `SettingsStore` interface (around line 357) and add the state field next to `textOnly: boolean;` (around line 400):

```ts
  // Text-only mode (no audio output)
  textOnly: boolean;

  // Keep per-item PCM audio in memory so the inline replay button works.
  // Off by default — reduces memory use during long sessions. Cached by
  // provider clients at session start; mid-session changes take effect
  // on the next session.
  keepReplayAudio: boolean;
```

Find the actions block and add the action signature next to `setTextOnly` (around line 417):

```ts
  setTextOnly: (textOnly: boolean) => void;
  setKeepReplayAudio: (keepReplayAudio: boolean) => Promise<void>;
```

- [ ] **Step 6: Implement the `setKeepReplayAudio` action**

Edit `src/stores/settingsStore.ts`. Find `setTextOnly` (around line 889) and add `setKeepReplayAudio` immediately after it, mirroring the rollback-on-error pattern:

```ts
    setTextOnly: async (textOnly) => {
      const previous = get().textOnly;
      set({textOnly});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.textOnly', textOnly);
      } catch (error) {
        console.error('[SettingsStore] Error persisting textOnly setting:', error);
        set({textOnly: previous});
      }
    },

    setKeepReplayAudio: async (keepReplayAudio) => {
      const previous = get().keepReplayAudio;
      set({keepReplayAudio});
      try {
        const service = ServiceFactory.getSettingsService();
        await service.setSetting('settings.common.keepReplayAudio', keepReplayAudio);
      } catch (error) {
        console.error('[SettingsStore] Error persisting keepReplayAudio setting:', error);
        set({keepReplayAudio: previous});
      }
    },
```

- [ ] **Step 7: Verify the field is in the store's initial state**

The store creator at `src/stores/settingsStore.ts:776-789` uses `...defaultCommonSettings` spread (line 779), so adding the field to `defaultCommonSettings` (Step 4) already populates it on the initial state. No edit needed — this step is a verification.

Run: `grep -n "...defaultCommonSettings\|keepReplayAudio:" src/stores/settingsStore.ts | head -5`
Expected: a `...defaultCommonSettings` line at line 779, plus the `keepReplayAudio: boolean` interface line and the `keepReplayAudio: false` default line you added.

- [ ] **Step 8: Load the value from persistent storage**

Edit `src/stores/settingsStore.ts`. Find `loadSettings` (around line 1442). Add a load line next to `textOnly` (around line 1454):

```ts
        const textOnly = await service.getSetting('settings.common.textOnly', defaultCommonSettings.textOnly);
        const keepReplayAudio = await service.getSetting('settings.common.keepReplayAudio', defaultCommonSettings.keepReplayAudio);
```

Then add it to the `set({...})` payload (around line 1491) — insert next to `textOnly,`:

```ts
        set({
          // ...existing fields...
          textOnly,
          keepReplayAudio,
          speakerDisplayMode,
          // ...
        });
```

- [ ] **Step 9: Propagate to client session config**

Edit `src/stores/settingsStore.ts`. Find `getCurrentSessionConfig` (around line 1638). Add the propagation line next to `config.textOnly = state.textOnly;`:

```ts
      config.textOnly = state.textOnly;
      config.keepReplayAudio = state.keepReplayAudio;
      return config;
```

- [ ] **Step 10: Add selector hooks**

Edit `src/stores/settingsStore.ts`. Find `useTextOnly` (around line 1704) and add the new selectors immediately after:

```ts
export const useTextOnly = () => useSettingsStore((state) => state.textOnly);
export const useKeepReplayAudio = () => useSettingsStore((state) => state.keepReplayAudio);
```

Find `useSetTextOnly` (around line 1709) and add:

```ts
export const useSetTextOnly = () => useSettingsStore((state) => state.setTextOnly);
export const useSetKeepReplayAudio = () => useSettingsStore((state) => state.setKeepReplayAudio);
```

- [ ] **Step 11: Run tests to verify all pass**

Run: `npm run test -- src/stores/settingsStore.test.ts --run`
Expected: All tests pass, including the 3 new `keepReplayAudio` tests.

- [ ] **Step 12: Type-check the project**

Run: `npx tsc --noEmit`
Expected: No errors. (The new field is required on `CommonSettings`, so any consumer constructing one would fail — fix any failures by adding `keepReplayAudio: false` to test fixtures or partial-typed mocks.)

- [ ] **Step 13: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): add keepReplayAudio (default false)

New CommonSettings boolean that gates per-item audio buffering across
provider clients. Default off — reduces memory use during long sessions.
Propagated to BaseSessionConfig in getCurrentSessionConfig; clients cache
at session start. Includes setKeepReplayAudio action with rollback on
persistence failure and three new tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `keepReplayAudio` to `BaseSessionConfig`

**Files:**
- Modify: `src/services/interfaces/IClient.ts:40-47`

- [ ] **Step 1: Add the optional field**

Edit `src/services/interfaces/IClient.ts`. Find `BaseSessionConfig` (line 40) and add the new field with a comment:

```ts
export interface BaseSessionConfig {
  model: string;
  voice?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number | string;
  textOnly?: boolean; // If true, only generate text responses (no audio output)
  /**
   * If false (default), provider clients skip per-item audio chunk
   * accumulation — `item.formatted.audio` stays undefined and the inline
   * replay button is hidden. Cached at session start by each client.
   */
  keepReplayAudio?: boolean;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors. Optional field — no existing call sites need updates.

- [ ] **Step 3: Commit**

```bash
git add src/services/interfaces/IClient.ts
git commit -m "$(cat <<'EOF'
feat(interfaces): add keepReplayAudio to BaseSessionConfig

Optional boolean propagated by settingsStore.getCurrentSessionConfig and
consumed by each provider client to gate per-item audio buffering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Gate audio buffering in `OpenAIGAClient`

**Files:**
- Modify: `src/services/clients/OpenAIGAClient.ts:35-51, 70-100, 499-502, 585-597`

No test file exists for this client. Verify by code review + manual smoke.

- [ ] **Step 1: Add the cached field**

Edit `src/services/clients/OpenAIGAClient.ts`. Find the private fields block (around line 35-47) and add the cache after `private audioChunks`:

```ts
  // Audio chunk list per item — merged into formatted.audio on response.done
  private audioChunks: Map<string, Int16Array[]> = new Map();
  /**
   * Cached from `config.keepReplayAudio` at connect(). When false, audio
   * chunks are not pushed into `audioChunks` and never merged into
   * `item.formatted.audio`, so the inline replay button stays hidden and
   * no per-item PCM memory is retained.
   */
  private keepReplayAudio: boolean = false;
```

- [ ] **Step 2: Cache the flag at connect**

Edit `src/services/clients/OpenAIGAClient.ts`. Find the reset block inside `connect()` (around line 75-82) and add the cache line after `this.audioChunks.clear();`:

```ts
    this.audioChunks.clear();
    this.keepReplayAudio = config.keepReplayAudio ?? false;
```

- [ ] **Step 3: Gate the chunk push**

Edit `src/services/clients/OpenAIGAClient.ts`. Find the push site (around line 497-511). Wrap the buffer creation + push in the guard:

```ts
    // Store audio chunks — merged into item.formatted.audio on response.done
    // This avoids O(n²) array merging on every delta event
    if (this.keepReplayAudio) {
      if (!this.audioChunks.has(itemId)) {
        this.audioChunks.set(itemId, []);
      }
      this.audioChunks.get(itemId)!.push(audioData);
    }
```

- [ ] **Step 4: Gate the merge into `formatted.audio`**

Edit `src/services/clients/OpenAIGAClient.ts`. Find the merge block inside `handleResponseDone` (around line 585-597). Wrap the entire merge:

```ts
      const item = this.itemLookup.get(outputItem.id);
      if (item) {
        // Merge accumulated audio chunks into item.formatted.audio for manual playback
        if (this.keepReplayAudio) {
          const chunks = this.audioChunks.get(outputItem.id);
          if (chunks && chunks.length > 0 && item.formatted) {
            const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
            const merged = new Int16Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              merged.set(chunk, offset);
              offset += chunk.length;
            }
            item.formatted.audio = merged;
            this.audioChunks.delete(outputItem.id);
          }
        }

        item.status = 'completed';
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/OpenAIGAClient.ts
git commit -m "$(cat <<'EOF'
feat(openai-ga): gate audio buffering on keepReplayAudio

Cache config.keepReplayAudio at connect(); skip chunk push and merge
when off. Real-time audio still streams to audioService.addAudioData
via onConversationUpdated delta — only the per-item replay copy is
gated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Gate audio buffering in `OpenAITranslateGAClient`

**Files:**
- Modify: `src/services/clients/OpenAITranslateGAClient.ts:92, 249-259, 353-356, 439-461`
- Test: `src/services/clients/OpenAITranslateGAClient.test.ts` (add cases)

- [ ] **Step 1: Inspect to find the cache point**

The client's `connect(config: SessionConfig)` resets state and validates the config. Read lines 439-470 of `src/services/clients/OpenAITranslateGAClient.ts` to find where state is reset on connect, then add the cache line in the same block.

Run: `grep -n "this.audioChunks.clear\|connect(config" src/services/clients/OpenAITranslateGAClient.ts`

Use the line where `this.audioChunks.clear()` is called (or equivalent reset site near `connect`) as the cache point.

- [ ] **Step 2: Add the cached field**

Edit `src/services/clients/OpenAITranslateGAClient.ts`. Near line 92 (where `private audioChunks` is defined), add:

```ts
  private audioChunks: Map<string, Int16Array[]> = new Map();
  /**
   * Cached from `config.keepReplayAudio` at connect(). See OpenAIGAClient
   * for full rationale.
   */
  private keepReplayAudio: boolean = false;
```

- [ ] **Step 3: Cache the flag at connect**

Inside `connect()` (around line 439), find the line `this.audioChunks.clear();` and add immediately after:

```ts
    this.audioChunks.clear();
    this.keepReplayAudio = config.keepReplayAudio ?? false;
```

If there's a second `audioChunks.clear()` (e.g., in a reset/disconnect method around line 630/670), do NOT add `keepReplayAudio` there — disconnect should not reset the cache, only connect.

- [ ] **Step 4: Write failing tests**

Open `src/services/clients/OpenAITranslateGAClient.test.ts`. Find the existing test "accumulates content (9600-sample) output_audio.delta into assistant audioChunks" (line 206). Right after that test, add two new tests in the same `describe('OpenAITranslateGAClient state machine', ...)` block:

```ts
  it('does NOT accumulate output_audio.delta into formatted.audio when keepReplayAudio is false', () => {
    (client as any).keepReplayAudio = false;
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Test',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    // Real-time delta still flows through onConversationUpdated for playback.
    const audioUpdate = updates.find(
      (u) => u.delta?.audio instanceof Int16Array && u.delta.audio.length === 9600
    );
    expect(audioUpdate).toBeDefined();

    // But formatted.audio is never populated.
    const assistant = client.getConversationItems().find((i) => i.role === 'assistant');
    expect(assistant?.formatted?.audio).toBeUndefined();
  });

  it('accumulates output_audio.delta into formatted.audio when keepReplayAudio is true', () => {
    (client as any).keepReplayAudio = true;
    (client as any).handleServerEvent({
      type: 'session.output_transcript.delta',
      delta: 'Test',
    });
    (client as any).handleServerEvent({
      type: 'session.output_audio.delta',
      delta: CONTENT_DELTA,
    });

    // Internal audioChunks should have an entry for the assistant item.
    const chunks = (client as any).audioChunks as Map<string, Int16Array[]>;
    expect(chunks.size).toBeGreaterThan(0);
    const firstChunkList = Array.from(chunks.values())[0];
    expect(firstChunkList.length).toBe(1);
    expect(firstChunkList[0].length).toBe(9600);
  });
```

- [ ] **Step 5: Run tests — both should fail**

Run: `npm run test -- src/services/clients/OpenAITranslateGAClient.test.ts -t "keepReplayAudio" --run`
Expected: 2 failures — first test fails because chunks accumulate regardless; second test fails because `keepReplayAudio` flag is ignored at push site.

- [ ] **Step 6: Gate the push site**

Edit `src/services/clients/OpenAITranslateGAClient.ts`. Find the push site (around line 353-356). Wrap the create-and-push in the guard:

```ts
        if (this.keepReplayAudio) {
          if (!this.audioChunks.has(assistantItemId)) {
            this.audioChunks.set(assistantItemId, []);
          }
          const chunks = this.audioChunks.get(assistantItemId)!;
          // ...existing push line...
          chunks.push(int16Array);  // (exact variable name may differ — preserve existing)
        }
```

If the existing block has more lines (e.g., audioSegments push), those should stay OUTSIDE the guard since `audioSegments` is karaoke timing and must remain populated. Verify by reading lines 350-395 first and only wrapping the `audioChunks` mutations.

- [ ] **Step 7: Gate the merge site**

Edit `src/services/clients/OpenAITranslateGAClient.ts`. Find the merge block (around line 249-259). Wrap the entire merge in `if (this.keepReplayAudio)`:

```ts
      if (this.keepReplayAudio) {
        const chunks = this.audioChunks.get(itemId);
        if (chunks && chunks.length > 0) {
          // ...existing merge logic that sets item.formatted.audio = merged...
          this.audioChunks.delete(itemId);
        }
      }
```

- [ ] **Step 8: Run tests — both should pass**

Run: `npm run test -- src/services/clients/OpenAITranslateGAClient.test.ts --run`
Expected: All tests pass (existing + 2 new). Existing "accumulates 9600-sample" test still passes because `keepReplayAudio` defaults to false on a freshly-constructed client but `audioUpdate` (the real-time delta) does not depend on buffering — only buffering state does. **Verify**: if the existing test checked anything about `audioChunks` size, it may now fail; if so, set `(client as any).keepReplayAudio = true;` at the top of that test.

- [ ] **Step 9: Commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts src/services/clients/OpenAITranslateGAClient.test.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate-ga): gate audio buffering on keepReplayAudio

Skip chunk push and merge when keepReplayAudio is false. Karaoke
audioSegments / audioTextEnd remain populated (independent metadata).
Adds two unit tests covering both states.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Gate audio buffering in `GeminiClient`

**Files:**
- Modify: `src/services/clients/GeminiClient.ts:31, 316, 645, 835`
- Test: `src/services/clients/GeminiClient.test.ts` (add cases)

- [ ] **Step 1: Add the cached field**

Edit `src/services/clients/GeminiClient.ts`. Find `private textOnlyMode = false;` (line 31) and add right after:

```ts
  private textOnlyMode = false;
  /**
   * Cached from `config.keepReplayAudio` at connect(). When false, the
   * per-turn `newAudioChunks` accumulator stops collecting and the
   * `formatted.audio = combinedAudio` assignments are skipped.
   */
  private keepReplayAudio = false;
```

- [ ] **Step 2: Cache the flag at connect**

Edit `src/services/clients/GeminiClient.ts`. Find line 316 (`this.textOnlyMode = config.textOnly || false;`) and add immediately after:

```ts
    this.textOnlyMode = config.textOnly || false;
    this.keepReplayAudio = config.keepReplayAudio ?? false;
```

- [ ] **Step 3: Read context around the assignment sites**

Run: `grep -n "formatted.audio = combinedAudio\|newAudioChunks" src/services/clients/GeminiClient.ts`

Identify both push sites (`newAudioChunks.push(...)` or equivalent) and both assignment sites (line 645 and 835 — `formatted.audio = combinedAudio`). Read 10-line context around each to understand what else lives in those blocks (audioSegments, transcript updates) so the guard wraps only the audio storage.

- [ ] **Step 4: Write failing tests**

Open `src/services/clients/GeminiClient.test.ts`. Find an appropriate existing `describe` block for audio behavior, or append a new one at the end of the file (before the file-level closing). The test approach: directly mutate `this.keepReplayAudio` after construction and inject audio messages via `capturedCallbacks.onmessage`. The exact server-message shape depends on the existing test fixtures — find one that already feeds audio (`grep -n "audio\|inlineData\|serverContent" src/services/clients/GeminiClient.test.ts`) and pattern after it.

Add two tests:

```ts
describe('GeminiClient — keepReplayAudio gating', () => {
  it('populates formatted.audio when keepReplayAudio is true', async () => {
    setupSuccessfulConnect();
    const client = new GeminiClient('test-key');
    // ...wire handlers + call connect with a config that includes
    //    keepReplayAudio: true. Then send an audio server message
    //    using the existing fixture pattern from the file.
    //    Assert that the assistant item's formatted.audio is an Int16Array
    //    of the expected length.
  });

  it('leaves formatted.audio undefined when keepReplayAudio is false', async () => {
    setupSuccessfulConnect();
    const client = new GeminiClient('test-key');
    // ...same fixture, but config.keepReplayAudio: false (or omitted).
    //    Assert formatted.audio is undefined / not an Int16Array.
    //    Assert audioSegments (if produced) is still populated.
  });
});
```

(The reason this task's test code is a template rather than a copy-paste block: the existing test file's audio-injection helpers are not yet documented in this plan. Read the file's existing audio-related tests for the exact server-message shape before filling these in. If no audio test exists in the file, write the minimal direct-construction test that mutates `(client as any).keepReplayAudio` and calls the internal audio handler method directly — `grep -n "private.*audio\|handleAudio\|onAudio" src/services/clients/GeminiClient.ts` finds the entry point.)

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm run test -- src/services/clients/GeminiClient.test.ts -t "keepReplayAudio" --run`
Expected: Both new tests fail.

- [ ] **Step 6: Gate the push site at line 789**

Edit `src/services/clients/GeminiClient.ts`. Find line 789 (`let newAudioChunks: Int16Array[] = [];` — the per-turn buffer). Read context (10 lines around) to find the push site inside the message handler. Wrap the push:

```ts
if (this.keepReplayAudio) {
  newAudioChunks.push(samples);  // (preserve existing variable name)
}
```

- [ ] **Step 7: Gate the assignment at line 645**

Edit `src/services/clients/GeminiClient.ts`. Find line 645 (`conversationItem.formatted.audio = combinedAudio;`) and wrap:

```ts
if (this.keepReplayAudio) {
  conversationItem.formatted.audio = combinedAudio;
}
```

- [ ] **Step 8: Gate the assignment at line 835**

Edit `src/services/clients/GeminiClient.ts`. Find line 835 (`this.currentTurn.assistantItem.formatted.audio = combinedAudio;`) and wrap:

```ts
if (this.keepReplayAudio) {
  this.currentTurn.assistantItem.formatted.audio = combinedAudio;
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -- src/services/clients/GeminiClient.test.ts --run`
Expected: All tests pass (existing + 2 new).

- [ ] **Step 10: Commit**

```bash
git add src/services/clients/GeminiClient.ts src/services/clients/GeminiClient.test.ts
git commit -m "$(cat <<'EOF'
feat(gemini): gate audio buffering on keepReplayAudio

Skip per-turn newAudioChunks push and both formatted.audio assignments
when keepReplayAudio is false. Real-time playback unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Gate audio buffering in `VolcengineAST2Client`

**Files:**
- Modify: `src/services/clients/VolcengineAST2Client.ts` (private field, connect site, merge at line 742-753)

**Test deviation from spec**: The audio merge is inside `decodeTTSAndPlay()` (around line 706), which calls `AudioContext.decodeAudioData` — not available in jsdom. Writing a unit test for this gating requires mocking the Web Audio API end-to-end, which is exactly the "scaffold new test infrastructure" cost the spec wants to avoid. Coverage for this client relies on:
- Task 1's store test (verifies `keepReplayAudio` propagates into the session config the client receives).
- Code review of the single guarded block (Step 5 below).
- Manual smoke test in Task 13 (uses the real Volcengine pipeline in the running app).

- [ ] **Step 1: Add the cached field**

Edit `src/services/clients/VolcengineAST2Client.ts`. Run `grep -n "private.*=\|private.*:.*boolean\|class VolcengineAST2Client" src/services/clients/VolcengineAST2Client.ts | head -10` to locate the private state block, then add:

```ts
  /**
   * Cached from `config.keepReplayAudio` at connect(). When false, the
   * inline merge into `formatted.audio` inside decodeTTSAndPlay() is
   * skipped — real-time TTS playback (onConversationUpdated delta) is
   * unaffected.
   */
  private keepReplayAudio: boolean = false;
```

- [ ] **Step 2: Cache the flag at connect**

Edit `src/services/clients/VolcengineAST2Client.ts`. Run `grep -n "async connect" src/services/clients/VolcengineAST2Client.ts` to find the entry point. Inside its state-reset region (near other `this.<field> = ...` assignments), add:

```ts
    this.keepReplayAudio = config.keepReplayAudio ?? false;
```

If `connect()` does not receive the config directly but pulls it from a stored `currentConfig` field, cache the flag wherever `currentConfig` is set instead. Run `grep -n "currentConfig\s*=" src/services/clients/VolcengineAST2Client.ts` to find the assignment site.

- [ ] **Step 3: Gate the inline merge inside `decodeTTSAndPlay`**

Edit `src/services/clients/VolcengineAST2Client.ts:742-753`. Wrap the if/else merge block in `if (this.keepReplayAudio)`. The `onConversationUpdated` delta emission below the merge (line 755-764) must stay OUTSIDE the guard — that's the real-time playback path.

```ts
      if (existingItem) {
        // Concatenate audio if the item already has some (multiple TTS sentences)
        if (this.keepReplayAudio) {
          if (existingItem.formatted?.audio && existingItem.formatted.audio instanceof Int16Array) {
            const prev = existingItem.formatted.audio;
            const combined = new Int16Array(prev.length + int16Array.length);
            combined.set(prev);
            combined.set(int16Array, prev.length);
            existingItem.formatted.audio = combined;
          } else {
            if (!existingItem.formatted) existingItem.formatted = {};
            existingItem.formatted.audio = int16Array;
          }
        }

        // Emit delta with audio for real-time playback — stays OUTSIDE the guard
        this.eventHandlers.onConversationUpdated?.({
          item: existingItem,
          delta: { audio: int16Array }
        });

        // Emit again without delta to trigger UI update (WAV creation + play button)
        this.eventHandlers.onConversationUpdated?.({
          item: existingItem,
        });
```

- [ ] **Step 4: Type-check + run existing tests**

Run: `npx tsc --noEmit && npm run test -- src/services/clients/VolcengineAST2Client.test.ts --run`
Expected: No type errors. Existing tests pass (we did not add new tests; see deviation note above).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/VolcengineAST2Client.ts
git commit -m "$(cat <<'EOF'
feat(volcengine-ast2): gate audio buffering on keepReplayAudio

Skip inline formatted.audio merge inside decodeTTSAndPlay when off;
real-time delta dispatch (onConversationUpdated) remains outside the
guard. No new unit test — the merge sits inside an AudioContext.decode
call not testable in jsdom; covered by store-test propagation and
manual smoke (see plan Task 13).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Gate audio buffering in `LocalInferenceClient`

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts:419-436` (and call sites + connect)

No test file. Verify by code review + manual smoke.

- [ ] **Step 1: Add the cached field**

Edit `src/services/clients/LocalInferenceClient.ts`. Find the class's private state block (use `grep -n "private.*=\|class LocalInferenceClient" src/services/clients/LocalInferenceClient.ts | head -20`) and add `private keepReplayAudio: boolean = false;`.

- [ ] **Step 2: Cache at session start**

Find the `connect()` or equivalent session-init method (`grep -n "async connect\|initialize\|startSession" src/services/clients/LocalInferenceClient.ts`). Add `this.keepReplayAudio = config.keepReplayAudio ?? false;` in the state-reset block.

- [ ] **Step 3: Gate the call sites of `appendItemAudio`**

Edit `src/services/clients/LocalInferenceClient.ts`. The helper at line 425-435 stays intact (small pure helper). Wrap each call site with the flag check.

Run: `grep -n "appendItemAudio" src/services/clients/LocalInferenceClient.ts`

For each call site (excluding the function definition itself), wrap:

```ts
if (this.keepReplayAudio) {
  this.appendItemAudio(assistantItem, chunk);
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalInferenceClient.ts
git commit -m "$(cat <<'EOF'
feat(local-inference): gate appendItemAudio on keepReplayAudio

Each call site checks the cached flag; the helper itself stays a pure
no-op shape. Real-time TTS playback unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Gate audio assignment in `OpenAITranslateWebRTCClient`

**Files:**
- Modify: `src/services/clients/OpenAITranslateWebRTCClient.ts:181` (and connect)

No test file. Verify by code review + manual smoke.

- [ ] **Step 1: Add the cached field and cache at connect**

Edit `src/services/clients/OpenAITranslateWebRTCClient.ts`. Add `private keepReplayAudio: boolean = false;` next to other private state. In the `connect(config)` (or equivalent init), add `this.keepReplayAudio = config.keepReplayAudio ?? false;`.

Use `grep -n "private\|async connect" src/services/clients/OpenAITranslateWebRTCClient.ts | head -10` to locate insertion points.

- [ ] **Step 2: Gate the single assignment**

Edit `src/services/clients/OpenAITranslateWebRTCClient.ts`. Find line 181 (`assistantItem.formatted.audio = merged;`) and wrap:

```ts
        if (this.keepReplayAudio) {
          assistantItem.formatted.audio = merged;
        }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/clients/OpenAITranslateWebRTCClient.ts
git commit -m "$(cat <<'EOF'
feat(openai-translate-webrtc): gate formatted.audio on keepReplayAudio

Single assignment site wrapped in the cached flag check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Remove dead `formatted.file` WAV generation + `decodeAudioToWav` utility

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:60, 1172-1182`
- Modify: `src/utils/audioUtils.ts:387` (delete `decodeAudioToWav` export)

- [ ] **Step 1: Verify the utility has no other callers**

Run: `grep -rn "decodeAudioToWav" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."`
Expected output: exactly 3 lines — the import in `MainPanel.tsx:60`, the call in `MainPanel.tsx:1174`, and the export at `audioUtils.ts:387`. If anything else appears, STOP and re-evaluate before deleting the utility.

- [ ] **Step 2: Delete the WAV-generation block in `MainPanel.tsx`**

Edit `src/components/MainPanel/MainPanel.tsx`. Delete lines 1172-1182 entirely:

```ts
// DELETE THIS BLOCK:
        // Handle completed audio items
        if (item.status === 'completed' && item.formatted?.audio) {
          const wavFile = await decodeAudioToWav(
            item.formatted.audio as Int16Array,
            24000,
            24000
          );
          if (item.formatted) {
            item.formatted.file = wavFile;
          }
        }
```

- [ ] **Step 3: Prune the unused import**

Edit `src/components/MainPanel/MainPanel.tsx:60`. Remove `decodeAudioToWav` from the import list:

```ts
// BEFORE:
import { getSafeAudioConfiguration, decodeAudioToWav } from '../../utils/audioUtils';
// AFTER:
import { getSafeAudioConfiguration } from '../../utils/audioUtils';
```

- [ ] **Step 4: Delete the utility function**

Edit `src/utils/audioUtils.ts`. Read around line 387 first to see the full function body and any preceding doc comment. Delete the entire `export const decodeAudioToWav = async (...)` function and its doc comment. If `audioUtils.ts` becomes empty or contains only unused helpers, leave the file alone — only delete the targeted function.

- [ ] **Step 5: Type-check + run tests**

Run: `npx tsc --noEmit && npm run test --run`
Expected: No type errors. All tests pass. (No test references `decodeAudioToWav` — verified by grep step 1 excluding test files.)

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/utils/audioUtils.ts
git commit -m "$(cat <<'EOF'
refactor: remove dead formatted.file WAV path

item.formatted.file was written by MainPanel for every completed
assistant item but never read anywhere — export uses text; replay uses
formatted.audio. Removing the call site, the import, and the now-orphan
decodeAudioToWav utility (zero callers verified).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add `replayEnabled` prop to `ConversationRow`

**Files:**
- Modify: `src/components/MainPanel/ConversationRow.tsx:8-23, 49-60, 128-150`
- Test: `src/components/MainPanel/ConversationRow.test.tsx` (add cases)

- [ ] **Step 1: Write the failing tests**

Open `src/components/MainPanel/ConversationRow.test.tsx`. Find the existing test "renders the row play button on assistant rows when canPlay is true" (around line 60-75). Add two new tests right after it, inside the same `describe` block:

```ts
  it('hides the play button entirely when replayEnabled is false', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker', role: 'assistant' })}
        prevItem={null}
        canPlay
        onPlay={() => {}}
        replayEnabled={false}
      />,
    );
    expect(container.querySelector('.row-play-btn')).toBeNull();
  });

  it('shows the play button when replayEnabled is true (existing behavior)', () => {
    const { container } = render(
      <ConversationRow
        {...baseProps}
        item={makeItem({ source: 'speaker', role: 'assistant' })}
        prevItem={null}
        canPlay
        onPlay={() => {}}
        replayEnabled={true}
      />,
    );
    expect(container.querySelector('.row-play-btn')).not.toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- src/components/MainPanel/ConversationRow.test.tsx -t "replayEnabled" --run`
Expected: Both tests fail — `replayEnabled` is not a valid prop / button always renders.

- [ ] **Step 3: Add the prop to the interface**

Edit `src/components/MainPanel/ConversationRow.tsx:8-23`. Add `replayEnabled?: boolean;` to `ConversationRowProps`:

```ts
interface ConversationRowProps {
  item: ConversationItem & {
    source?: 'speaker' | 'participant';
    sourceLanguage?: string;
    targetLanguage?: string;
  };
  prevItem?: (ConversationItem & { source?: 'speaker' | 'participant' }) | null;
  sourceLanguage: string;
  targetLanguage: string;
  isPlaying: boolean;
  highlightedChars: number;
  canPlay?: boolean;
  onPlay?: () => void;
  playDisabled?: boolean;
  replayEnabled?: boolean;
  compact?: boolean;
}
```

- [ ] **Step 4: Destructure the prop with a default**

Edit `src/components/MainPanel/ConversationRow.tsx:49-60`. Add `replayEnabled = true,` to the destructure so existing callers (not yet threaded) still behave as before:

```ts
const ConversationRow: React.FC<ConversationRowProps> = ({
  item,
  prevItem,
  sourceLanguage,
  targetLanguage,
  isPlaying,
  highlightedChars,
  canPlay = false,
  onPlay,
  playDisabled = false,
  replayEnabled = true,
  compact = false,
}) => {
```

- [ ] **Step 5: Gate the button render**

Edit `src/components/MainPanel/ConversationRow.tsx:128`. Update the existing comment block to mention the new gate, and add `replayEnabled &&` to the render condition:

```tsx
        {!compact && onPlay && replayEnabled && isTranslation && source === 'speaker' && (
          // The play button slot is rendered for speaker translation rows whose
          // owning setting allows replay (`replayEnabled`). Within that, `canPlay`
          // toggles enabled/disabled but does NOT gate visibility — gating
          // visibility on `canPlay` would cause text re-flow when the assistant
          // item completes and the slot suddenly appears (~22 px wide).
          // When `replayEnabled` is false the slot is absent for the whole
          // session — no per-item reflow churn.
          // User rows (source transcripts) get no button (no audio); participant
          // rows get none either (text-only channel; canPlay never true).
          <button
            type="button"
            className={`row-play-btn ${isPlaying ? 'playing' : ''}`}
            onClick={canPlay ? onPlay : undefined}
            disabled={!canPlay || playDisabled}
            aria-label={t('mainPanel.playItemAudio', "Play this item's audio")}
            title={t('mainPanel.playItemAudio', "Play this item's audio")}
          >
            <Play size={10} />
          </button>
        )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- src/components/MainPanel/ConversationRow.test.tsx --run`
Expected: All tests pass (existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/ConversationRow.tsx src/components/MainPanel/ConversationRow.test.tsx
git commit -m "$(cat <<'EOF'
feat(conversation-row): add replayEnabled prop to gate play button

When false the entire button slot is omitted — no reflow churn because
the slot is consistently absent for the whole session. Defaults to true
so existing untouched callers keep showing the button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Thread `replayEnabled` through `ConversationBubble` in `MainPanel`

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx:5-33, 99-163, 3174-3192` (and wherever ConversationBubble is rendered)

- [ ] **Step 1: Add the selector import**

Edit `src/components/MainPanel/MainPanel.tsx:5-32`. Add `useKeepReplayAudio,` to the import list from `'../../stores/settingsStore'`:

```ts
import {
  useProvider,
  useUIMode,
  // ...existing imports...
  useSubtitleModeActive,
  useKeepReplayAudio,
} from '../../stores/settingsStore';
```

- [ ] **Step 2: Add `replayEnabled` to `ConversationBubbleProps`**

Edit `src/components/MainPanel/MainPanel.tsx:99-112`. Add the prop:

```ts
interface ConversationBubbleProps {
  item: ConversationItem & { source?: string };
  index: number;
  prevItem: (ConversationItem & { source?: string }) | null;
  sourceLanguage: string;
  targetLanguage: string;
  canPlay: boolean;
  onPlay?: () => void;
  someItemPlaying: boolean;
  uiMode: string;
  compact: boolean;
  replayEnabled: boolean;
}
```

- [ ] **Step 3: Destructure and forward in `ConversationBubble`**

Edit `src/components/MainPanel/MainPanel.tsx:114-162`. Add `replayEnabled,` to the destructure and pass it to `<ConversationRow>`:

```tsx
const ConversationBubble: React.FC<ConversationBubbleProps> = ({
  item,
  index,
  prevItem,
  sourceLanguage,
  targetLanguage,
  canPlay,
  onPlay,
  someItemPlaying,
  uiMode,
  compact,
  replayEnabled,
}) => {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item);
  const playDisabled = someItemPlaying && !isPlaying;
  const { t } = useTranslation();

  // ...error bubble branch unchanged...

  const text = item.formatted?.transcript || item.formatted?.text || '';

  if (text) {
    return (
      <ConversationRow
        key={`${(item as any).source || 'speaker'}_${item.id || index}`}
        item={item}
        prevItem={prevItem as (ConversationItem & { source?: 'speaker' | 'participant' }) | null}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        isPlaying={isPlaying}
        highlightedChars={highlightedChars}
        canPlay={canPlay}
        onPlay={onPlay}
        playDisabled={playDisabled}
        replayEnabled={replayEnabled}
        compact={compact}
      />
    );
  }
```

- [ ] **Step 4: Read the setting in the MainPanel function body**

Edit `src/components/MainPanel/MainPanel.tsx`. Find the MainPanel component's top-of-body hook calls (search for `const provider = useProvider();` to locate the cluster). Add:

```ts
  const replayEnabled = useKeepReplayAudio();
```

next to the other settings selectors. (Read the surrounding 5-10 lines to confirm this is inside `MainPanel: React.FC = () => {` and not inside `ConversationBubble`.)

- [ ] **Step 5: Pass `replayEnabled` at the render site**

Edit `src/components/MainPanel/MainPanel.tsx:3179-3192`. Add `replayEnabled={replayEnabled}` to the `<ConversationBubble>` JSX:

```tsx
                  return (
                    <ConversationBubble
                      key={`${(item as any).source || 'speaker'}_${item.id || i}`}
                      item={item}
                      index={i}
                      prevItem={prevItem}
                      sourceLanguage={sourceLanguage}
                      targetLanguage={targetLanguage}
                      canPlay={canPlay}
                      onPlay={() => handlePlayAudio(item)}
                      someItemPlaying={playingItemId !== null}
                      uiMode={uiMode}
                      compact={conversationCompactMode}
                      replayEnabled={replayEnabled}
                    />
                  );
```

If `<ConversationBubble>` is rendered in multiple places (search `grep -n "<ConversationBubble" src/components/MainPanel/MainPanel.tsx`), pass `replayEnabled` to every instance.

- [ ] **Step 6: Type-check + run tests**

Run: `npx tsc --noEmit && npm run test --run`
Expected: No type errors. All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(main-panel): thread keepReplayAudio into ConversationRow

Reads the setting via useKeepReplayAudio at the top of MainPanel and
forwards it through ConversationBubble to ConversationRow's
replayEnabled prop, hiding the inline play button when off.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Add the ToggleSwitch in `LanguageSection` + English i18n keys

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx:6-31, 83-84, 511-521`
- Modify: `src/locales/en/translation.json:467` (under `simpleConfig` namespace)

- [ ] **Step 1: Add the English i18n keys**

Edit `src/locales/en/translation.json`. Find the `simpleConfig` block (line 446 onwards). Add two keys after the existing `textOnlyDesc` (line 467). Note that line 467 is the LAST entry in `simpleConfig` — it currently ends without a trailing comma. Change that and add the new keys:

```json
    "textOnly": "Text Only",
    "textOnlyDesc": "Translate to text only — no spoken audio output",
    "keepReplayAudio": "Keep audio for replay",
    "keepReplayAudioDesc": "Store translated audio in memory so you can replay it later from each message. Off by default to reduce memory use during long sessions."
  },
```

- [ ] **Step 2: Add the selector imports**

Edit `src/components/Settings/sections/LanguageSection.tsx:6-31`. Add `useKeepReplayAudio,` and `useSetKeepReplayAudio` to the existing import block from `'../../../stores/settingsStore'`:

```ts
import {
  useProvider,
  // ...existing imports through useTextOnly...
  useTextOnly,
  useSetTextOnly,
  useKeepReplayAudio,
  useSetKeepReplayAudio,
} from '../../../stores/settingsStore';
```

- [ ] **Step 3: Read the setting in the component body**

Edit `src/components/Settings/sections/LanguageSection.tsx:83-84`. Right after the existing `textOnly` lines, add:

```ts
  const textOnly = useTextOnly();
  const setTextOnly = useSetTextOnly();

  const keepReplayAudio = useKeepReplayAudio();
  const setKeepReplayAudio = useSetKeepReplayAudio();
```

- [ ] **Step 4: Render the ToggleSwitch**

Edit `src/components/Settings/sections/LanguageSection.tsx:512-520`. Add the new toggle directly after the closing `)}` of the existing `textOnly` block:

```tsx
          {providerConfig.capabilities.textOnlyCapability === 'optional' && (
            <ToggleSwitch
              checked={textOnly}
              onChange={() => setTextOnly(!textOnly)}
              label={t('simpleConfig.textOnly', 'Text Only')}
              disabled={isSessionActive}
              tooltip={t('simpleConfig.textOnlyDesc', 'Show translation as text only, without generating an audio response')}
            />
          )}

          <ToggleSwitch
            checked={keepReplayAudio}
            onChange={() => setKeepReplayAudio(!keepReplayAudio)}
            label={t('simpleConfig.keepReplayAudio', 'Keep audio for replay')}
            disabled={isSessionActive}
            tooltip={t('simpleConfig.keepReplayAudioDesc', 'Store translated audio in memory so you can replay it later from each message. Off by default to reduce memory use during long sessions.')}
          />
```

The `disabled={isSessionActive}` mirrors `textOnly`'s pattern — since the client caches the flag at session start, flipping mid-session would have no visible effect this session. Disabling avoids the false signal. Unlike `textOnly`, the new toggle is NOT gated on `providerConfig.capabilities.textOnlyCapability === 'optional'` — replay storage is purely client-side and applies to every provider, so it always renders.

- [ ] **Step 5: Type-check + run tests + start dev server for visual check**

Run: `npx tsc --noEmit && npm run test --run`
Expected: No errors. All tests pass.

Then start the dev server:

Run: `npm run dev`

Open the Settings → Language section in the browser. Confirm:
- The new "Keep audio for replay" toggle appears below "Text Only".
- It starts unchecked (default off).
- Hovering shows the tooltip with the description.
- Toggling on, then reloading the page, shows it persisted as on.
- Toggling off, reloading, persists as off.
- During an active translation session, the toggle is greyed out.

Stop the dev server with Ctrl-C when done.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/LanguageSection.tsx src/locales/en/translation.json
git commit -m "$(cat <<'EOF'
feat(settings-ui): add 'Keep audio for replay' toggle

ToggleSwitch in LanguageSection mirroring textOnly's UX (including
disabled-during-session). English-only i18n keys; other locales inherit
the fallback until translated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: End-to-end smoke test + subtitle-surface comment refresh

**Files:**
- Modify: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts:46-65` (comment refresh only)

- [ ] **Step 1: Update the subtitle-surface doc comment**

Edit `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`. Read lines 46-65 to refresh the comment to reflect the new state — `formatted.audio` and `formatted.file` are now usually absent (only present when `keepReplayAudio` is explicitly true). The strip remains belt-and-suspenders for that case. Append a sentence:

```ts
/**
 * Drop the heavy replay-only fields from items before they cross the
 * chrome.runtime port: `formatted.audio` (raw PCM `Int16Array`),
 * `formatted.file` (a generated WAV blob for the download/replay button), and
 * `content[].audio`.
 *
 * Since `keepReplayAudio` defaults to false (see settingsStore), these
 * fields are usually absent and the strip is a no-op. The strip stays as
 * defense-in-depth: when a user explicitly enables `keepReplayAudio` AND
 * uses the subtitle overlay, this still bounds the wire payload.
 *
 * Provider clients keep this audio on each conversation item to power replay,
 * but the subtitle overlay never reads any of it — it renders text and uses
 * only the small `audioSegments`/`audioTextEnd` timing metadata for the
 * karaoke highlight. Forwarding these fields was catastrophic because the items
 * subscription re-posts the whole array on every streaming delta and port
 * messages are structured-cloned in full:
 *   - `formatted.audio` grew until one message exceeded Chrome's 64MiB port
 *     limit and `postMessage` threw synchronously inside the Zustand notify,
 *     crashing the app.
 *   - `formatted.file` (the WAV, even larger than the PCM) reached multiple MB
 *     per item and, re-cloned on every delta, pegged the page (measured: a
 *     single item at 5.4MB, total payload 12MB).
 * Stripping them keeps the wire payload tiny and bounded to text.
 */
```

Note: `formatted.file` is no longer generated at all (Task 9 deleted that path), but the strip remains harmless and the doc-comment honesty about the historical reason matters.

- [ ] **Step 2: Run full test suite**

Run: `npm run test --run`
Expected: All tests pass.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Manual smoke checklist**

Start the app:

Run: `npm run electron:dev`
(Or `npm run dev` for the React-only browser-extension flow.)

Run through each step and note results:

1. **Fresh install state**: Settings → Language shows "Keep audio for replay" toggle unchecked. Start a translation session. Speak something. A translated bubble appears. There is **no ▶ play button** on the bubble. Real-time audio is heard from the speaker. The karaoke highlight (colored text) animates as the translation plays.
2. **Toggle on mid-app, new session**: End the session. Flip the toggle on. Start a new session. Speak. A new bubble appears with a working ▶ button. Clicking it replays the translated audio.
3. **Mid-session flip — no effect this session**: With the toggle on and a session active, flip it off. The toggle should be greyed out (disabled during session). Newly-completed items still get ▶ buttons since the client cached `true` at connect time.
4. **textOnly + keepReplayAudio combinations**: Toggle `Text Only` on, `Keep audio for replay` on. Start a session. Speak. The bubble has translation text only (no real-time audio). No ▶ button (because `formatted.audio` stays empty even with the flag on — no audio is generated).
5. **Subtitle overlay regression check** (extension only): Enable replay storage. Open the side panel on a supported meeting site, enter subtitle mode. Speak across many turns. The overlay does not crash; the port payload stays bounded (heavy fields stripped by `stripHeavyItemFields`).
6. **Memory check (DevTools)**: With toggle off, run a 5-minute session with many turns. Take a Memory snapshot in DevTools. Compare retained size of `sessionStore.items` items to a control session with the toggle on. Off should be significantly smaller (rough expectation: tens of MB delta on long sessions).

- [ ] **Step 5: Commit + push prep**

```bash
git add src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts
git commit -m "$(cat <<'EOF'
docs(subtitle): refresh stripHeavyItemFields comment

Reflects that formatted.audio/.file are now usually absent (because
keepReplayAudio defaults to false) and the strip is defense-in-depth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify the full series of commits is coherent**

Run: `git log --oneline -15`
Expected: 12-13 commits, each titled `feat(...)` or `refactor:` or `docs(...)` with the body summarizing one task. No mixed-scope commits.

- [ ] **Step 7: Do NOT push or open a PR**

Per project feedback memory: publish actions need explicit user consent. Wait for the user to ask before `git push` / `gh pr create`.

---

## Notes on test scope per spec

- **Store tests**: Task 1 (3 tests — default, persist, rollback).
- **Provider client tests with new cases**: Tasks 4 (OpenAITranslateGA), 5 (Gemini). Two tests each — replay-on and replay-off.
- **Provider client tests skipped with justification**: Task 6 (VolcengineAST2) — merge sits inside an `AudioContext.decodeAudioData` call not testable in jsdom; scaffolding Web Audio mocking violates the spec's YAGNI stance. Deviation noted in Task 6 header.
- **Untested clients**: Tasks 3 (OpenAIGA), 7 (LocalInference), 8 (OpenAITranslateWebRTC) — no existing test files; relying on store-test propagation + code review + manual smoke per spec.
- **ConversationRow test**: Task 10 (2 tests).
- **Subtitle surface**: no test changes, comment refreshed in Task 13.
- **Manual smoke checklist**: Task 13 Step 4 (6 scenarios).

## Spec deviations to flag to the user before execution

1. **Volcengine unit tests omitted** (Task 6). The spec lists `VolcengineAST2Client.test.ts` among the test files to extend. The merge being gated is inside an async Web Audio API call that jsdom can't run; writing the mock costs more than the test buys given the gating is a one-line `if`. If the user wants the tests anyway, the path is to refactor the merge into a small pure helper (`mergeReplayChunk(item, chunk): void`) and test the helper directly — straightforward but adds a production-code seam that doesn't otherwise exist.

## Plan self-review summary

- **Spec coverage**: Setting shape (T1), config interface (T2), all 6 client gating sites (T3-T8), MainPanel WAV cleanup + utility removal (T9), ConversationRow visibility (T10), MainPanel threading (T11), Settings UI + i18n (T12), subtitle comment + smoke (T13). All goals 1-7 mapped. One test deviation (Volcengine) explicitly called out.
- **Type consistency**: `keepReplayAudio` boolean, `replayEnabled` prop, `useKeepReplayAudio` / `useSetKeepReplayAudio` selectors — used identically across all tasks.
- **No placeholders**: All code is literal. Step 4 of Task 5 (Gemini test scaffolding) is the one place where the template instructs the engineer to look at existing fixtures rather than providing exact server-message JSON, because the existing test file's audio injection helpers vary by test; this is annotated explicitly with a discovery command and a fallback (direct private-property mutation + handler call).
- **Release notes**: Not a task in this plan. The project's release process (per `CLAUDE.md`) folds version bumps and release notes into a separate `chore(release): vX.Y.Z` commit that touches 5 files. When the next release is cut, add the line: *"Replay storage is now off by default to reduce memory use during long sessions. Re-enable in Settings → Language → 'Keep audio for replay'."*
