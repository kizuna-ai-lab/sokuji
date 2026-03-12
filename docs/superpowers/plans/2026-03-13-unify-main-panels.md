# Unify MainPanel and SimpleMainPanel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge SimpleMainPanel into MainPanel as a single component with `uiMode`-driven layout variants, eliminating ~950 lines of duplicate code.

**Architecture:** MainPanel keeps all session management logic (unchanged). The render section is rewritten to use a unified bubble-style conversation display and a flex-column layout. The control area renders as a footer bar in both modes — Basic shows status + buttons, Advanced shows input waveform + controls + status + output waveform. SimpleMainPanel is deleted.

**Tech Stack:** React, TypeScript, SCSS, Zustand

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/components/MainPanel/MainPanel.tsx` | Rewrite render section (lines ~2311-2715); remove SimpleMainPanel import; unify conversation rendering, text input, and footer |
| Modify | `src/components/MainPanel/MainPanel.scss` | Replace absolute-positioned layout with flex; add unified bubble styles; add footer variants for basic/advanced |
| Delete | `src/components/SimpleMainPanel/SimpleMainPanel.tsx` | No longer needed |
| Delete | `src/components/SimpleMainPanel/SimpleMainPanel.scss` | No longer needed |
| Modify | `CLAUDE.md` | Update references to SimpleMainPanel (remove from architecture docs) |

**No new files created.** All changes happen in existing MainPanel files.

---

## Design Specification

### Unified Conversation Display (both modes)

```
.conversation-display { flex: 1; overflow-y: auto; }
  .message-bubble { max-width: 80%; border-radius: 16px; }
    .message-header { 11px uppercase, opacity 0.7 }
    .message-content { 15px, line-height 1.4 }
      // Advanced mode extras: tool calls, audio indicators, content arrays
```

- **user**: align-self: flex-end, background #2a2a2a, bottom-right radius 4px
- **assistant**: align-self: flex-start, background #10a37f, bottom-left radius 4px
- **participant-source**: orange left border + tinted background (same as current)
- **error**: centered, red border + background (same as current)
- **playing**: box-shadow glow `0 0 10px rgba(16, 163, 127, 0.3)`

### Unified Karaoke

```scss
.karaoke-played { color: #10a37f; font-weight: bold; text-shadow: 0 0 8px rgba(16,163,127,0.6); }
.karaoke-unplayed { opacity: 0.7; }
// Exception: assistant bubble (green bg) uses white highlight
.assistant .karaoke-played { color: #fff; text-shadow: 0 0 8px rgba(255,255,255,0.8); }
```

### Unified Empty State

```tsx
<div className="empty-state">
  <MessageSquare size={32} />
  <p>{t('simplePanel.startToBegin')}</p>
</div>
```

No icon box wrapper. Simple centered layout.

### Unified Text Input

```
.text-input-section { flex-shrink: 0; }  // Between conversation and footer
```

Same pill-shaped input + round send button as current. No absolute positioning.

### Footer — Basic Mode

```
[●] [ja → en] [00:12:34] [🎤] [🔊]          [Hold] [Start/Stop]
└─── .status-info ─────────────────┘          └── .main-controls ─┘
```

Identical to current SimpleMainPanel footer.

### Footer — Advanced Mode

```
[🎤 input▓▓░░]    [PTT] [Session] [Debug] [●] [ja→en] [00:12]    [output▓▓░░ 🔊]
└ .input-viz ─┘    └──────────── .center-controls ────────────┘    └─ .output-viz ─┘
```

- `.control-footer` with `display: flex; align-items: center; justify-content: space-between;`
- `.input-viz`: mic icon + canvas, flex-shrink: 0, width ~20%
- `.center-controls`: flex: 1, centered buttons + status info
- `.output-viz`: canvas + speaker icon, flex-shrink: 0, width ~20%
- Canvas height: 28px (same as current)
- Both canvases use same `requestAnimationFrame` render loop as current

### Conversation Item Filtering

```typescript
const filteredItems = useMemo(() => {
  return combinedItems.filter(item => {
    const hasText = item.formatted?.transcript || item.formatted?.text;
    const isBasic = (item.type === 'error' || item.role === 'user' || item.role === 'assistant') && hasText;
    if (uiMode === 'basic') return isBasic;
    // Advanced: also show tool calls, audio-only, system messages
    return isBasic || item.formatted?.tool || item.formatted?.output || item.formatted?.audio;
  });
}, [combinedItems, uiMode]);
```

---

## Chunk 1: SCSS Refactor

### Task 1: Replace MainPanel.scss layout model

**Files:**
- Modify: `src/components/MainPanel/MainPanel.scss`

- [ ] **Step 1: Read current MainPanel.scss to confirm exact content**

Run: Review file is already read.

- [ ] **Step 2: Replace `.main-panel` absolute layout with flex layout**

Replace the `.main-panel` block. Remove `position: absolute` from `.conversation-container`, `.text-input-section`, `.audio-visualization`. Convert to flex column.

```scss
.main-panel-wrapper {
  position: relative;
  height: 100%;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.main-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
```

- [ ] **Step 3: Add unified `.conversation-display` styles**

Replace `.conversation-container` + `.conversation-content` with unified `.conversation-display`:

```scss
.conversation-display {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 3px;
    &:hover { background: #555; }
  }
}
```

- [ ] **Step 4: Add unified bubble message styles**

Replace `.conversation-item` with `.message-bubble`:

```scss
.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .message-bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 16px;
    position: relative;
    transition: background-color 0.3s ease, box-shadow 0.3s ease;

    &.user {
      align-self: flex-end;
      background: #2a2a2a;
      margin-left: auto;
      border-bottom-right-radius: 4px;
      &.playing { background: #353535; box-shadow: 0 0 10px rgba(16,163,127,0.3); }
    }

    &.assistant {
      align-self: flex-start;
      background: #10a37f;
      margin-right: auto;
      border-bottom-left-radius: 4px;
      &.playing { background: #12b88f; box-shadow: 0 0 10px rgba(16,163,127,0.5); }
    }

    &.system {
      align-self: center;
      background: #444;
      font-style: italic;
      max-width: 90%;
      &.playing { background: #555; box-shadow: 0 0 10px rgba(16,163,127,0.3); }
    }

    &.participant-source {
      border-left: 3px solid #f39c12;
      &.user { background: rgba(243,156,18,0.15); &.playing { background: rgba(243,156,18,0.25); box-shadow: 0 0 10px rgba(243,156,18,0.3); } }
      &.assistant { background: #e67e22; &.playing { background: #f39c12; box-shadow: 0 0 10px rgba(243,156,18,0.5); } }
    }

    &.error {
      align-self: center;
      background: #5a1a1a;
      border: 1px solid #cc4444;
      margin-left: auto;
      margin-right: auto;
      .message-header { color: #ff6b6b; font-weight: 600; svg { margin-right: 4px; } }
      .message-content.error-content { color: #ff6b6b; }
    }

    .message-header {
      font-size: 11px;
      text-transform: uppercase;
      opacity: 0.7;
      margin-bottom: 4px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .message-content {
      font-size: 15px;
      line-height: 1.4;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
  }
}
```

- [ ] **Step 5: Add unified karaoke styles**

```scss
// Karaoke — default (dark backgrounds)
.karaoke-played {
  color: #10a37f;
  font-weight: bold;
  text-shadow: 0 0 8px rgba(16,163,127,0.6);
  transition: all 0.2s ease;
}
.karaoke-unplayed {
  opacity: 0.7;
  transition: all 0.2s ease;
}

// Karaoke — assistant bubble (green background)
.message-bubble.assistant .karaoke-played {
  color: #fff;
  text-shadow: 0 0 8px rgba(255,255,255,0.8);
}
```

- [ ] **Step 6: Add unified `.text-input-section` (flex, non-absolute)**

```scss
.text-input-section {
  flex-shrink: 0;
  background: #252525;
  border-top: 1px solid #333;
  padding: 8px 12px;

  .text-input-container {
    display: flex;
    gap: 8px;
    align-items: center;

    .text-input {
      flex: 1;
      background: #1e1e1e;
      border: 1px solid #444;
      border-radius: 20px;
      padding: 8px 16px;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s ease;
      &::placeholder { color: #666; }
      &:focus { border-color: #10a37f; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .send-btn {
      background: #10a37f;
      border: none;
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;
      &:hover:not(:disabled) { background: #0d8c6d; transform: scale(1.05); }
      &:disabled, &.disabled { background: #444; color: #666; cursor: not-allowed; transform: none; }
    }
  }
}
```

- [ ] **Step 7: Add `.control-footer` with basic and advanced variants**

```scss
.control-footer {
  flex-shrink: 0;
  background: #2a2a2a;
  border-top: 1px solid #333;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;

  // ─── Basic mode (same as current SimpleMainPanel) ───
  &.basic {
    .status-info {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: #888;

      .status-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #666; transition: background 0.3s ease;
        &.active { background: #10a37f; }
      }

      .language-pair {
        font-weight: 500; color: #aaa;
        &.clickable { cursor: default; transition: color 0.2s ease; &:hover { color: #fff; text-decoration: underline; } }
      }

      .session-duration {
        font-weight: 500; color: #aaa;
        padding-left: 12px; border-left: 1px solid #444;
      }

      .device-status {
        display: flex; align-items: center; gap: 8px;
        margin-left: 8px; padding-left: 12px; border-left: 1px solid #444;

        .device-icon {
          display: flex; align-items: center;
          color: #666; transition: color 0.2s ease;
          &.active { color: #10a37f; }
          &.clickable { cursor: default; &:hover { color: #aaa; transform: scale(1.1); } }
        }
      }
    }

    .main-controls {
      display: flex; gap: 10px; align-items: center;
    }
  }

  // ─── Advanced mode footer ───
  &.advanced {
    gap: 8px;

    .input-viz, .output-viz {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      width: 18%;
      min-width: 80px;

      .device-icon {
        display: flex; align-items: center;
        color: #666; transition: color 0.2s ease;
        &.active { color: #10a37f; }
        &.clickable { cursor: default; &:hover { color: #aaa; } }
      }

      .visualization-canvas {
        flex: 1;
        height: 28px;
        border-radius: 4px;
      }
    }

    .input-viz .visualization-canvas { background: rgba(0,153,255,0.1); }
    .output-viz .visualization-canvas { background: rgba(0,153,0,0.1); }

    .center-controls {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;

      .status-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #666; transition: background 0.3s ease;
        &.active { background: #10a37f; }
      }

      .language-pair { font-size: 13px; font-weight: 500; color: #aaa; }
      .session-duration { font-size: 13px; font-weight: 500; color: #aaa; }
    }
  }

  // ─── Shared button styles ───
  .push-to-talk-btn, .push-to-talk-button {
    background: #444; border: none; color: #fff;
    padding: 6px 12px; border-radius: 4px;
    font-size: 12px; font-weight: 500;
    cursor: pointer; transition: all 0.2s ease;
    display: flex; align-items: center; gap: 6px; height: 28px;
    &:hover { background: #555; }
    &.recording { background: #e74c3c; &:hover { background: #c0392b; } }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }

  .session-button, .main-action-btn {
    background: #10a37f; border: none; color: #fff;
    padding: 6px 16px; border-radius: 4px;
    font-size: 12px; font-weight: 500;
    cursor: pointer; transition: all 0.2s ease;
    display: flex; align-items: center; gap: 6px;
    min-width: 100px; justify-content: center; height: 28px;
    &:hover:not(:disabled) { background: #0d8c6d; }
    &:disabled { background: #444; color: #666; cursor: not-allowed; }
    &.stop, &.active { background: #e74c3c; &:hover { background: #c0392b; } }
    .spinning { animation: spin 1s linear infinite; }
  }

  .debug-button {
    background: transparent; border: 1px solid #555;
    border-radius: 6px; color: white;
    padding: 6px 12px; font-size: 13px;
    cursor: pointer; height: 28px;
    display: flex; align-items: center; gap: 8px;
    transition: background-color 0.2s;
    &:hover { background: rgba(255,255,255,0.1); }
    &.active { background: #444; &:hover { background: #555; } }
  }

  // Responsive
  @media (max-width: 768px) {
    &.advanced {
      .input-viz, .output-viz { min-width: 50px; width: 12%; }
      .center-controls { gap: 6px; }
    }
    .push-to-talk-btn, .push-to-talk-button,
    .session-button, .main-action-btn {
      padding: 6px 10px; min-width: auto;
      .btn-text, span:not(.stop-icon):not(.play-icon) { display: none; }
    }
  }
}

// Empty state
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #666;
  gap: 16px;
  svg { opacity: 0.3; }
  p { margin: 0; font-size: 16px; max-width: 300px; }
}

// Advanced-only content styles within bubbles
.content-item {
  margin-bottom: 4px;
  &:last-child { margin-bottom: 0; }

  &.audio .audio-indicator {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px;
    .audio-icon { display: flex; align-items: center; color: rgba(255,255,255,0.8); }
    .audio-text { font-size: 14px; color: rgba(255,255,255,0.8); flex: 1; }
  }

  &.tool-call, &.tool-output {
    background: rgba(0,0,0,0.2); border-radius: 6px; padding: 10px;
    .tool-name { font-weight: bold; margin-bottom: 5px; font-size: 14px; }
    .tool-args, .output-content {
      pre { margin: 0; white-space: pre-wrap; font-family: monospace; font-size: 13px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; overflow-x: auto; }
    }
  }
}

// Inline play button (dev mode only)
.inline-play-button {
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.1); border: none; border-radius: 3px;
  width: 16px; height: 16px; padding: 0; color: white; cursor: pointer;
  transition: background-color 0.2s ease;
  &:hover { background: rgba(255,255,255,0.2); }
  &.playing { background: rgba(16,163,127,0.5); }
}

// Tooltip for disabled session button
.session-button:disabled .tooltip {
  visibility: hidden; width: 200px; background: #333; color: #fff;
  text-align: center; border-radius: 6px; padding: 8px;
  position: absolute; z-index: 10; bottom: 125%; left: 50%;
  margin-left: -100px; opacity: 0; transition: opacity 0.3s;
  font-weight: normal; font-size: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  pointer-events: none;
  &::after {
    content: ""; position: absolute; top: 100%; left: 50%; margin-left: -5px;
    border-width: 5px; border-style: solid; border-color: #333 transparent transparent transparent;
  }
}
.session-button:disabled:hover .tooltip { visibility: visible; opacity: 1; }

// AudioFeedbackWarning is rendered outside footer — no changes needed

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

- [ ] **Step 8: Remove old SimpleMainPanel SCSS classes**

Delete `src/components/SimpleMainPanel/SimpleMainPanel.scss`.

- [ ] **Step 9: Verify SCSS compiles**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react && npx vite build --mode development 2>&1 | head -30`
Expected: No SCSS compilation errors.

- [ ] **Step 10: Commit SCSS refactor**

```bash
git add src/components/MainPanel/MainPanel.scss
git commit -m "refactor(ui): replace absolute layout with flex and unify bubble styles in MainPanel SCSS"
```

---

## Chunk 2: MainPanel.tsx Render Refactor

### Task 2: Add session duration state and basic-mode status logic

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

MainPanel currently does NOT track session duration or display status info (that was SimpleMainPanel's job). We need to add these.

- [ ] **Step 1: Add session duration tracking**

After existing state declarations (around line 183), add:

```typescript
// Session duration for footer display
const [sessionDuration, setSessionDuration] = useState<string>('00:00');
const sessionStartTime = useSessionStartTime();
```

Note: `useSessionStartTime` is already imported via `useSession`. Extract it as a separate selector or use the existing `sessionStartTime` from `useSession()`.

- [ ] **Step 2: Add session duration effect**

Add after the existing `useEffect` blocks (before the render section):

```typescript
// Update session duration display
useEffect(() => {
  if (!isSessionActive || !sessionStartTime) {
    setSessionDuration('00:00');
    return;
  }
  const updateDuration = () => {
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    setSessionDuration(
      h > 0
        ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
        : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    );
  };
  updateDuration();
  const interval = setInterval(updateDuration, 1000);
  return () => clearInterval(interval);
}, [isSessionActive, sessionStartTime]);
```

- [ ] **Step 3: Add `navigateToSettings` import**

```typescript
import { ..., useNavigateToSettings } from '../../stores/settingsStore';
```

And in the component:

```typescript
const navigateToSettings = useNavigateToSettings();
```

- [ ] **Step 4: Add balance validation logic (from SimpleMainPanel)**

After `canPushToTalk` state, add:

```typescript
const hasValidBalance = (provider !== Provider.KIZUNA_AI) ||
  (quota && quota.balance !== undefined && quota.balance >= 0 && !quota.frozen);

const canStartSession = isApiKeyValid && availableModels.length > 0 &&
  !loadingModels && !isInitializing && hasValidBalance;
```

- [ ] **Step 5: Add `filteredItems` memo**

```typescript
const filteredItems = useMemo(() => {
  return combinedItems.filter(item => {
    const hasText = item.formatted?.transcript || item.formatted?.text;
    const isBasic = (item.type === 'error' || item.role === 'user' || item.role === 'assistant') && hasText;
    if (uiMode === 'basic') return isBasic;
    return isBasic || item.formatted?.tool || item.formatted?.output ||
      (item.formatted?.audio && !item.formatted?.transcript && !item.formatted?.text);
  });
}, [combinedItems, uiMode]);
```

- [ ] **Step 6: Commit state additions**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(ui): add session duration, balance validation, and item filtering to MainPanel"
```

### Task 3: Rewrite render section — conversation display

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (lines ~2311-2715)

- [ ] **Step 1: Remove the basic-mode early return and SimpleMainPanel import**

Delete lines 2311-2333 (the `if (uiMode === 'basic')` block that renders `<SimpleMainPanel>`).

Delete line 39: `import SimpleMainPanel from '../SimpleMainPanel/SimpleMainPanel';`

- [ ] **Step 2: Add `MessageSquare` to lucide imports**

```typescript
import { X, Zap, Users, Mic, MicOff, Loader, Play, Volume2, VolumeX, Wrench, Send, AlertCircle, MessageSquare } from 'lucide-react';
```

- [ ] **Step 3: Write unified conversation rendering function**

Add this helper before the return statement:

```typescript
const renderConversationItem = useCallback((item: ConversationItem, index: number) => {
  const isPlaying = playingItemId === item.id;
  const text = item.formatted?.transcript || item.formatted?.text || '';
  const isParticipant = item.source === 'participant';

  const highlightedChars = isPlaying
    ? getHighlightedChars(
        playbackProgress?.currentTime ?? 0,
        item.formatted?.audioSegments,
        text.length,
        progressRatio,
      )
    : 0;

  // Error items
  if (item.type === 'error') {
    return (
      <div key={item.id || index} className="message-bubble error">
        <div className="message-header">
          <AlertCircle size={12} />
          {t('mainPanel.error', 'Error')}
        </div>
        <div className="message-content error-content">
          {item.formatted?.text || t('mainPanel.unknownError', 'Unknown error')}
        </div>
      </div>
    );
  }

  // Regular message items
  return (
    <div
      key={item.id || index}
      className={`message-bubble ${item.role} ${isParticipant ? 'participant-source' : 'speaker-source'} ${isPlaying ? 'playing' : ''}`}
    >
      <div className="message-header">
        <span className="role">
          {item.role === 'user'
            ? (isParticipant ? t('simplePanel.participant', 'Participant') : t('simplePanel.you', 'You'))
            : t('simplePanel.translation', 'Translation')}
        </span>
        {/* Dev-only play button */}
        {isDevelopment() && item.formatted?.audio && (item as any).status && (
          <button
            className={`inline-play-button ${isPlaying ? 'playing' : ''}`}
            onClick={() => handlePlayAudio(item)}
            disabled={playingItemId !== null}
          >
            <Play size={10} />
          </button>
        )}
      </div>
      <div className={`message-content ${isPlaying ? 'karaoke-active' : ''}`}>
        {/* Primary: transcript or text with karaoke */}
        {text ? (
          isPlaying ? (
            <>
              <span className="karaoke-played">{text.slice(0, highlightedChars)}</span>
              <span className="karaoke-unplayed">{text.slice(highlightedChars)}</span>
            </>
          ) : (
            text
          )
        ) : null}

        {/* Advanced-only: tool calls */}
        {uiMode === 'advanced' && item.formatted?.tool && (
          <div className="content-item tool-call">
            <div className="tool-name">{t('mainPanel.function')}: {item.formatted.tool.name}</div>
            <div className="tool-args">
              <pre>{(() => { try { return JSON.stringify(JSON.parse(item.formatted.tool!.arguments), null, 2); } catch { return item.formatted.tool!.arguments; } })()}</pre>
            </div>
          </div>
        )}

        {/* Advanced-only: tool output */}
        {uiMode === 'advanced' && item.formatted?.output && (
          <div className="content-item tool-output">
            <div className="output-content">
              <pre>{(() => { try { return JSON.stringify(JSON.parse(item.formatted.output!), null, 2); } catch { return item.formatted.output; } })()}</pre>
            </div>
          </div>
        )}

        {/* Advanced-only: audio-only indicator */}
        {uiMode === 'advanced' && !text && item.formatted?.audio && (
          <div className="content-item audio">
            <div className="audio-indicator">
              <span className="audio-icon"><Volume2 size={16} /></span>
              <span className="audio-text">{t('mainPanel.audioContent')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}, [playingItemId, playbackProgress, progressRatio, uiMode, t, handlePlayAudio]);
```

- [ ] **Step 4: Commit conversation rendering**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(ui): add unified bubble-style conversation rendering to MainPanel"
```

### Task 4: Rewrite render section — main return JSX

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Replace the entire return block (from `return (` to end)**

Replace with:

```tsx
return (
  <div className="main-panel-wrapper">
    <div className="main-panel">
      {/* Conversation Display */}
      <div className="conversation-display" ref={conversationContainerRef}>
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <MessageSquare size={32} />
            <p>{t('simplePanel.startToBegin', 'Click Start to begin real-time translation')}</p>
          </div>
        ) : (
          <div className="conversation-list">
            {filteredItems.map((item, index) => renderConversationItem(item, index))}
          </div>
        )}
      </div>

      {/* Text Input Section */}
      {isSessionActive && supportsTextInput && (
        <div className="text-input-section">
          <div className="text-input-container">
            <input
              type="text"
              className="text-input"
              placeholder={t('mainPanel.typeMessage', 'Text to translate...')}
              value={advancedTextInput}
              onChange={(e) => setAdvancedTextInput(e.target.value)}
              onKeyDown={handleAdvancedTextKeyDown}
              maxLength={1000}
            />
            <button
              className={`send-btn ${!advancedTextInput.trim() ? 'disabled' : ''}`}
              onClick={handleAdvancedTextSubmit}
              onMouseDown={(e) => e.preventDefault()}
              disabled={!advancedTextInput.trim() || isAdvancedSending}
              title={t('mainPanel.send', 'Send')}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Control Footer */}
      {uiMode === 'basic' ? (
        /* ─── Basic Mode Footer ─── */
        <div className="control-footer basic">
          <div className="status-info">
            <span className={`status-dot ${isSessionActive ? 'active' : ''}`} />
            <span
              className="language-pair clickable"
              onClick={() => navigateToSettings('languages')}
              title={t('simplePanel.clickToConfigLanguages', 'Click to configure languages')}
            >
              {getCurrentProviderSettings().sourceLanguage} → {getCurrentProviderSettings().targetLanguage}
            </span>
            {isSessionActive && (
              <span className="session-duration">
                {t('simplePanel.sessionDuration', 'Duration')}: {sessionDuration}
              </span>
            )}
            <span className="device-status">
              <span
                className={`device-icon ${isInputDeviceOn ? 'active' : ''} clickable`}
                onClick={() => navigateToSettings('microphone')}
                title={t('simplePanel.clickToConfigMicrophone', 'Click to configure microphone')}
              >
                {isInputDeviceOn ? <Mic size={14} /> : <MicOff size={14} />}
              </span>
              <span
                className={`device-icon ${isMonitorDeviceOn ? 'active' : ''} clickable`}
                onClick={() => navigateToSettings('speaker')}
                title={t('simplePanel.clickToConfigSpeaker', 'Click to configure speaker')}
              >
                {isMonitorDeviceOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </span>
            </span>
          </div>
          <div className="main-controls">
            {isSessionActive && canPushToTalk && (
              <button
                className={`push-to-talk-btn ${isRecording ? 'recording' : ''}`}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
              >
                <Mic size={12} />
                <span className="btn-text">{isRecording ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold')}</span>
              </button>
            )}
            <button
              className={`main-action-btn ${isSessionActive ? 'stop' : 'start'}`}
              onClick={isSessionActive ? disconnectConversation : connectConversation}
              disabled={!canStartSession && !isSessionActive}
            >
              {isInitializing ? (
                <>
                  <Loader className="spinning" size={16} />
                  <span className="btn-text">
                    {initProgress
                      ? t('simplePanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: initProgress.completed, total: initProgress.total })
                      : t('simplePanel.connecting', 'Connecting...')}
                  </span>
                </>
              ) : isSessionActive ? (
                <>
                  <span className="stop-icon">■</span>
                  <span className="btn-text">{t('simplePanel.stop', 'Stop')}</span>
                </>
              ) : (
                <>
                  <span className="play-icon">▶</span>
                  <span className="btn-text">{t('simplePanel.start', 'Start')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* ─── Advanced Mode Footer ─── */
        <div className="control-footer advanced">
          <div className="input-viz">
            <span className={`device-icon ${isInputDeviceOn ? 'active' : ''}`}>
              <Mic size={14} />
            </span>
            <canvas ref={clientCanvasRef} className="visualization-canvas" />
          </div>

          <div className="center-controls">
            {isSessionActive && canPushToTalk && (
              <button
                className={`push-to-talk-button ${isRecording ? 'recording' : ''} ${!isInputDeviceOn ? 'disabled' : ''}`}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                disabled={!isSessionActive || !canPushToTalk || !isInputDeviceOn}
              >
                <Mic size={14} />
                <span>
                  {isRecording ? t('mainPanel.release') : isInputDeviceOn ? t('mainPanel.pushToTalk') : t('mainPanel.inputDeviceOff')}
                </span>
              </button>
            )}
            <button
              className={`session-button ${isSessionActive ? 'active' : ''}`}
              onClick={() => {
                trackEvent('session_control_clicked', { action: isSessionActive ? 'stop' : 'start', method: 'button' });
                isSessionActive ? disconnectConversation() : connectConversation();
              }}
              disabled={(!isSessionActive && (!isApiKeyValid || availableModels.length === 0 || loadingModels || (provider === Provider.KIZUNA_AI && quota && (quota.balance === undefined || quota.balance < 0 || quota.frozen)))) || isInitializing}
            >
              {isInitializing ? (
                <>
                  <Loader size={14} className="spinner" />
                  <span>
                    {initProgress
                      ? t('mainPanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: initProgress.completed, total: initProgress.total })
                      : t('mainPanel.initializing')}
                  </span>
                </>
              ) : isSessionActive ? (
                <><X size={14} /><span>{t('mainPanel.endSession')}</span></>
              ) : (
                <>
                  <Zap size={14} />
                  <span>{t('mainPanel.startSession')}</span>
                  {!isApiKeyValid && <span className="tooltip">{t('mainPanel.apiKeyRequired')}</span>}
                  {isApiKeyValid && availableModels.length === 0 && !loadingModels && <span className="tooltip">{t('mainPanel.modelsRequired')}</span>}
                  {isApiKeyValid && loadingModels && <span className="tooltip">{t('mainPanel.modelsLoading')}</span>}
                </>
              )}
            </button>
            {isDevelopment() && (
              <button className={`debug-button ${isTestTonePlaying ? 'active' : ''}`} onClick={playTestTone}>
                <Wrench size={14} />
                <span>{isTestTonePlaying ? t('mainPanel.stopDebug') : t('mainPanel.debug')}</span>
              </button>
            )}

            <span className={`status-dot ${isSessionActive ? 'active' : ''}`} />
            <span className="language-pair">
              {getCurrentProviderSettings().sourceLanguage} → {getCurrentProviderSettings().targetLanguage}
            </span>
            {isSessionActive && <span className="session-duration">{sessionDuration}</span>}
          </div>

          <div className="output-viz">
            <canvas ref={serverCanvasRef} className="visualization-canvas" />
            <span className={`device-icon ${isMonitorDeviceOn ? 'active' : ''}`}>
              <Volume2 size={14} />
            </span>
          </div>
        </div>
      )}

      <AudioFeedbackWarning
        isVisible={showFeedbackWarning}
        inputDeviceLabel={selectedInputDevice?.label}
        outputDeviceLabel={selectedMonitorDevice?.label}
        recommendedAction={
          getSafeAudioConfiguration(selectedInputDevice, selectedMonitorDevice, isRealVoicePassthroughEnabled).recommendedAction
        }
        feedbackRisk={
          getSafeAudioConfiguration(selectedInputDevice, selectedMonitorDevice, isRealVoicePassthroughEnabled).feedbackRisk
        }
        onDismiss={() => { setShowFeedbackWarning(false); setFeedbackWarningDismissed(true); }}
      />
    </div>
  </div>
);
```

- [ ] **Step 2: Update canvas render loop**

The existing `useEffect` for canvas rendering (around line 1768) checks `uiMode` in its dependency array. The canvases are now inside the footer, so they only mount in advanced mode. Update the effect to handle null refs gracefully (already does via `if (clientCanvas && audioService)`). No code change needed — just verify.

- [ ] **Step 3: Verify auto-scroll effect works with new ref**

The `conversationContainerRef` now points to `.conversation-display` div (same as before). No change needed.

- [ ] **Step 4: Commit render refactor**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(ui): replace dual-panel render with unified bubble layout and footer variants"
```

---

## Chunk 3: Cleanup

### Task 5: Delete SimpleMainPanel

**Files:**
- Delete: `src/components/SimpleMainPanel/SimpleMainPanel.tsx`
- Delete: `src/components/SimpleMainPanel/SimpleMainPanel.scss`

- [ ] **Step 1: Delete SimpleMainPanel files**

```bash
rm src/components/SimpleMainPanel/SimpleMainPanel.tsx
rm src/components/SimpleMainPanel/SimpleMainPanel.scss
rmdir src/components/SimpleMainPanel/
```

- [ ] **Step 2: Verify no remaining imports**

Run: `grep -r "SimpleMainPanel" src/`
Expected: No results.

- [ ] **Step 3: Remove unused imports from MainPanel**

After deleting SimpleMainPanel, check MainPanel.tsx for any imports that were only used in the old render path (e.g., `Users` from lucide if it was only used in the old placeholder). Add `MicOff`, `VolumeX` to imports since they're now used in basic footer.

- [ ] **Step 4: Update CLAUDE.md**

Remove references to SimpleMainPanel in the architecture documentation. Update the "Simple Mode Components" section to reflect unified MainPanel.

- [ ] **Step 5: Build and verify**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react && npm run build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Run tests**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react && npm run test -- --run 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 7: Commit cleanup**

```bash
git add -A
git commit -m "refactor(ui): delete SimpleMainPanel, unify into single MainPanel component

Merged SimpleMainPanel into MainPanel with uiMode-driven layout variants:
- Unified bubble-style conversation display for both modes
- Flex column layout replaces absolute positioning
- Basic mode: compact status footer
- Advanced mode: footer with input/output waveforms flanking center controls
- Eliminated ~950 lines of duplicate code"
```

### Task 6: Visual verification

- [ ] **Step 1: Start dev server**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react && npm run electron:dev`

- [ ] **Step 2: Verify Basic mode**

Check: bubble messages, empty state, text input, footer with status + controls, session start/stop, karaoke highlighting.

- [ ] **Step 3: Verify Advanced mode**

Check: bubble messages with tool/audio content, footer with waveforms flanking controls, canvas animation, debug button, session start/stop, karaoke highlighting.

- [ ] **Step 4: Verify responsive behavior**

Resize window to mobile width. Check button text hides, canvases shrink, bubbles widen to 85%.
