# Footer Mode Picker & 3-Waveform Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MainPanel footer's 3 device icons with a Segmented Mode Picker (我/参会者/双向). Re-click active segment opens a popover with mode-relevant device config. Advanced mode adds a system-audio waveform; mic + sys share width when both visible (A2H layout: picker left, buttons centered, lang+duration right).

**Architecture:** Three new presentational components (`ModePicker`, `ModeDevicePopover`, `WaveformStrip`) + derived state in MainPanel (`currentMode`, `missingDeviceForMode`, `handleModeSwitch`) + audio service exposes a participant analyser node for visualization. Builds on the symmetric-channel architecture (existing `speakerWillStart` / `participantWillStart` predicates, `speakerChannelActive` / `participantChannelActive` flags, channel-gated `connectConversation`).

**Tech Stack:** React + TypeScript + Zustand + Vitest + @floating-ui/react + Web Audio AnalyserNode + WavRenderer.

**Spec:** `docs/superpowers/specs/2026-05-23-footer-mode-picker-design.md`

---

## Task 0: Setup — verify branch and baseline

**Files:** none

- [ ] **Step 1: Verify branch and baseline**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
git branch --show-current
git log --oneline -3
git status --short
```

Expected: on `docs/symmetric-channel-spec`. Latest commit is `00190fc5` (spec). Working tree has only the pre-existing unrelated files (`docs/github-issues/README.md`, `src/lib/modern-audio/ModernAudioPlayer.js`, `src/vite-env.d.ts`, `.playwright-mcp/`, `issue-246-...md`) untouched.

If on another branch, switch:
```bash
git checkout docs/symmetric-channel-spec
```

- [ ] **Step 2: Baseline test run**

```bash
npm run test -- --run
```

Expected: 785/785 passing. Note any pre-existing failures — they are not yours to fix.

- [ ] **Step 3: No commit needed**

---

## Task 1: audioStore — add set-style actions for mode picker

The mode picker writes both channels at once (e.g., picking `both` sets mic ON and participant ON). Existing actions are toggle-only. Add set-style siblings.

**Files:**
- Modify: `src/stores/audioStore.ts`
- Modify: `src/stores/audioStore.test.ts` (or create if it doesn't exist)

- [ ] **Step 1: Check current audioStore action surface**

```bash
grep -n "toggleInputDeviceState\|toggleSystemAudioCapture\|setInputDevice\|setSystemAudio" src/stores/audioStore.ts | head -20
ls src/stores/audioStore.test.ts 2>/dev/null || echo "TEST FILE MISSING — will create"
```

Note the existing toggle action names and whether `audioStore.test.ts` exists.

- [ ] **Step 2: If `audioStore.test.ts` does not exist, create it with the minimum harness**

If the test file is missing, create `src/stores/audioStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAudioStore } from './audioStore';

describe('audioStore — set-style actions', () => {
  beforeEach(() => {
    // Reset the relevant fields to a known state before each test
    useAudioStore.setState({
      isInputDeviceOn: false,
      isSystemAudioCaptureEnabled: false,
    } as any);
  });

  it('setInputDeviceOn(true) sets isInputDeviceOn to true', () => {
    useAudioStore.getState().setInputDeviceOn(true);
    expect(useAudioStore.getState().isInputDeviceOn).toBe(true);
  });

  it('setInputDeviceOn(false) sets isInputDeviceOn to false', () => {
    useAudioStore.setState({ isInputDeviceOn: true } as any);
    useAudioStore.getState().setInputDeviceOn(false);
    expect(useAudioStore.getState().isInputDeviceOn).toBe(false);
  });

  it('setSystemAudioCaptureEnabled(true) sets isSystemAudioCaptureEnabled to true', () => {
    useAudioStore.getState().setSystemAudioCaptureEnabled(true);
    expect(useAudioStore.getState().isSystemAudioCaptureEnabled).toBe(true);
  });

  it('setSystemAudioCaptureEnabled(false) sets isSystemAudioCaptureEnabled to false', () => {
    useAudioStore.setState({ isSystemAudioCaptureEnabled: true } as any);
    useAudioStore.getState().setSystemAudioCaptureEnabled(false);
    expect(useAudioStore.getState().isSystemAudioCaptureEnabled).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests — expect them to FAIL**

```bash
npm run test -- --run src/stores/audioStore.test.ts
```

Expected: 4 failures (setInputDeviceOn / setSystemAudioCaptureEnabled don't exist yet).

- [ ] **Step 4: Add the two actions in `audioStore.ts`**

In the store definition, find the interface declaration (search for `toggleInputDeviceState`). Add to the interface:

```typescript
setInputDeviceOn: (on: boolean) => void;
setSystemAudioCaptureEnabled: (enabled: boolean) => void;
```

In the store actions object (search for the existing `toggleInputDeviceState:` implementation), add the new actions:

```typescript
setInputDeviceOn: (on) => set({ isInputDeviceOn: on }),
setSystemAudioCaptureEnabled: (enabled) => set({ isSystemAudioCaptureEnabled: enabled }),
```

Then add exported hooks alongside the existing selector exports (search for `useIsInputDeviceOn` or similar pattern):

```typescript
export const useSetInputDeviceOn = () => useAudioStore((state) => state.setInputDeviceOn);
export const useSetSystemAudioCaptureEnabled = () => useAudioStore((state) => state.setSystemAudioCaptureEnabled);
```

If `useAudioContext()` (the compound hook) returns these as part of its memoized object, also add them there for callers that destructure from context.

- [ ] **Step 5: Re-run tests**

```bash
npm run test -- --run src/stores/audioStore.test.ts
```

Expected: 4 passing.

- [ ] **Step 6: Full suite still passes**

```bash
npm run test -- --run
```

Expected: 789/789 (785 baseline + 4 new).

- [ ] **Step 7: Commit**

```bash
git add src/stores/audioStore.ts src/stores/audioStore.test.ts
git commit -m "$(cat <<'EOF'
feat(audioStore): add setInputDeviceOn and setSystemAudioCaptureEnabled

Set-style siblings of the existing toggle actions. The footer mode
picker writes both channels in one click (mode=both → mic ON +
participant ON), which can't be expressed cleanly with toggles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Participant recorder — expose AnalyserNode for visualization

The participant capture pipeline already feeds audio into the participant client. To draw a waveform for it we tap the audio with a Web Audio `AnalyserNode` that the visualization loop in MainPanel reads each animation frame.

**Files:**
- Modify: `src/lib/modern-audio/IParticipantAudioRecorder.ts`
- Modify: `src/lib/modern-audio/ParticipantRecorder.ts`
- Modify: `src/lib/modern-audio/TabAudioRecorder.ts`
- Modify: `src/lib/modern-audio/LoopbackRecorder.ts` (if present and used)

- [ ] **Step 1: Read the interface and identify all implementations**

```bash
cat src/lib/modern-audio/IParticipantAudioRecorder.ts
grep -l "implements IParticipantAudioRecorder\|extends.*Recorder" src/lib/modern-audio/*.ts
```

Note the existing method shapes (start/stop/etc) so the new `getAnalyser()` matches style.

- [ ] **Step 2: Add `getAnalyser()` to the interface**

In `src/lib/modern-audio/IParticipantAudioRecorder.ts`, add to the interface:

```typescript
/**
 * Returns the AnalyserNode tapped from the captured audio stream, or null
 * if the recorder is not currently capturing. Consumers call
 * getByteTimeDomainData() against this node from a requestAnimationFrame
 * loop to draw a waveform.
 */
getAnalyser(): AnalyserNode | null;
```

- [ ] **Step 3: Implement in `ParticipantRecorder.ts`**

`ParticipantRecorder` is the high-level recorder that delegates to either tab or loopback capture. If it just wraps another recorder, forward:

```typescript
getAnalyser(): AnalyserNode | null {
  return this.activeRecorder?.getAnalyser() ?? null;
}
```

Replace `this.activeRecorder` with whatever the existing internal field is (read the existing class to identify it). If `ParticipantRecorder` has its own audio graph, fall through to Step 4's pattern.

- [ ] **Step 4: Implement in `TabAudioRecorder.ts`**

In the recorder class, locate the AudioContext + MediaStreamSourceNode setup (search for `createMediaStreamSource` or `AudioContext`). Right after the source node is created and before any existing downstream node is connected, insert an AnalyserNode tap that does NOT alter the existing audio path:

```typescript
// Inside the class, add a field:
private analyserNode: AnalyserNode | null = null;

// In the start/begin method, right after creating the source node:
const source = audioContext.createMediaStreamSource(stream);  // existing
this.analyserNode = audioContext.createAnalyser();
this.analyserNode.fftSize = 2048;
source.connect(this.analyserNode);
// The analyser is a "side branch" — it does NOT need to connect to a destination.
// AnalyserNodes work as observation taps; they are pull-based by the consumer.

// existing connections to whatever downstream node...

// In the stop method, clear:
this.analyserNode = null;

// Add the getter:
getAnalyser(): AnalyserNode | null {
  return this.analyserNode;
}
```

- [ ] **Step 5: Implement in `LoopbackRecorder.ts` (if present)**

If `LoopbackRecorder.ts` exists and is a separate implementation, apply the same pattern as Step 4. If it doesn't exist or `ParticipantRecorder` already covers it via delegation, skip.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "(IParticipantAudioRecorder|ParticipantRecorder|TabAudioRecorder|LoopbackRecorder)\.ts" | head -10
```

Expected: no new errors. If `getAnalyser` is missing on an implementation, fix.

- [ ] **Step 7: Test suite passes**

```bash
npm run test -- --run
```

Expected: 789/789 passing (no regressions).

- [ ] **Step 8: Commit**

```bash
git add src/lib/modern-audio/IParticipantAudioRecorder.ts src/lib/modern-audio/ParticipantRecorder.ts src/lib/modern-audio/TabAudioRecorder.ts src/lib/modern-audio/LoopbackRecorder.ts 2>/dev/null
git commit -m "$(cat <<'EOF'
feat(audio): expose AnalyserNode on participant recorders

Adds getAnalyser() to IParticipantAudioRecorder and each
implementation. Pull-based AnalyserNode is a side-branch off the
existing MediaStreamSource — no impact on the audio path feeding
the participant client.

The visualization loop in MainPanel will read getByteTimeDomainData()
from this node each animation frame to draw the participant waveform.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Adjust the `git add` list to only include files you actually modified.

---

## Task 3: ModernBrowserAudioService — expose getParticipantAnalyser

The MainPanel calls into `audioServiceRef.current.<method>()` and never directly touches the recorder class. Add a passthrough so MainPanel can request the analyser.

**Files:**
- Modify: `src/services/interfaces/IAudioService.ts`
- Modify: `src/lib/modern-audio/ModernBrowserAudioService.ts`

- [ ] **Step 1: Add to the IAudioService interface**

In `src/services/interfaces/IAudioService.ts`, find any existing analyser-related accessor (likely none for participant). Add:

```typescript
/**
 * AnalyserNode for the participant audio capture stream. Returns null
 * when participant capture is not active. Used by MainPanel to drive
 * the participant waveform visualization.
 */
getParticipantAnalyser(): AnalyserNode | null;
```

- [ ] **Step 2: Implement in `ModernBrowserAudioService.ts`**

Find the participant recorder field in the class (likely `participantRecorder` or similar). Add:

```typescript
getParticipantAnalyser(): AnalyserNode | null {
  return this.participantRecorder?.getAnalyser() ?? null;
}
```

If the service holds different recorders for tab vs loopback (extension vs Electron), forward to whichever is active.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "ModernBrowserAudioService|IAudioService" | head -10
```

Expected: no new errors.

- [ ] **Step 4: Test suite passes**

```bash
npm run test -- --run
```

Expected: 789/789 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/interfaces/IAudioService.ts src/lib/modern-audio/ModernBrowserAudioService.ts
git commit -m "$(cat <<'EOF'
feat(audio-service): expose getParticipantAnalyser accessor

MainPanel will call audioServiceRef.current.getParticipantAnalyser()
from its visualization rAF loop to draw the sys-wf waveform.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: MainPanel — currentMode, missingDeviceForMode, handleModeSwitch, popover state

Add the derived state and handlers the new components will read. No JSX changes yet — still using the old footer icons.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Locate the existing channel-state derivation block**

```bash
grep -n "speakerWillStart\|participantWillStart\|anyChannelWillStart" src/components/MainPanel/MainPanel.tsx | head -10
```

You'll find the `useMemo` definitions around line 352-363 (post-Task-3 of the previous spec). The new derived state goes immediately after.

- [ ] **Step 2: Add `currentMode` and `missingDeviceForMode` memos**

Right after the existing `anyChannelWillStart` line, insert:

```tsx
// Footer-level mode derived from channel will-start predicates.
// Picker uses this to highlight the active segment.
// The 'FooterMode' type is exported from ./ModePicker (added in Task 5);
// for now use the inline union — Task 8 will switch to the import.
const currentMode = useMemo<'speaker' | 'participant' | 'both' | 'none'>(() => {
  if (speakerWillStart && participantWillStart) return 'both';
  if (speakerWillStart) return 'speaker';
  if (participantWillStart) return 'participant';
  return 'none';
}, [speakerWillStart, participantWillStart]);

// Which segment should show an amber warning (mode targeted but the
// required device isn't actually selected/ready). Mirrors what the
// existing canStartSession gate checks but at per-segment granularity.
const missingDeviceForMode = useMemo<'speaker' | 'participant' | 'both' | null>(() => {
  if (currentMode === 'none') return null;
  const needSpeaker = currentMode === 'speaker' || currentMode === 'both';
  const needParticipant = currentMode === 'participant' || currentMode === 'both';
  const hasSpeaker = isInputDeviceOn && !!selectedInputDevice;
  const hasParticipant = isSystemAudioCaptureEnabled && (
    isExtension() || (!!selectedSystemAudioSource && isSystemAudioSourceReady)
  );
  if (needSpeaker && !hasSpeaker) return needParticipant && !hasParticipant ? 'both' : 'speaker';
  if (needParticipant && !hasParticipant) return 'participant';
  return null;
}, [currentMode, isInputDeviceOn, selectedInputDevice?.deviceId, isSystemAudioCaptureEnabled, selectedSystemAudioSource?.deviceId, isSystemAudioSourceReady]);
```

- [ ] **Step 3: Import the new audioStore setters**

Locate the existing `useAudioContext` destructure (around line 291-304). Add the new setters from the store via the hooks added in Task 1. At the top of the file's audioStore imports, add:

```tsx
import { useSetInputDeviceOn, useSetSystemAudioCaptureEnabled } from '../../stores/audioStore';
```

In the component body, near the existing audio context destructure:

```tsx
const setInputDeviceOn = useSetInputDeviceOn();
const setSystemAudioCaptureEnabled = useSetSystemAudioCaptureEnabled();
```

- [ ] **Step 4: Add `handleModeSwitch` and popover state**

Immediately after the `setSystemAudioCaptureEnabled` line:

```tsx
// Footer mode picker — pre-session, click a segment to write both channels.
const handleModeSwitch = useCallback((target: 'speaker' | 'participant' | 'both') => {
  if (isSessionActive) return;  // locked during session
  setInputDeviceOn(target === 'speaker' || target === 'both');
  setSystemAudioCaptureEnabled(target === 'participant' || target === 'both');
}, [isSessionActive, setInputDeviceOn, setSystemAudioCaptureEnabled]);

// Popover (re-click active segment) — anchored to the active segment ref
// supplied by ModePicker via callback.
const [modePopoverOpen, setModePopoverOpen] = useState(false);
const [modePopoverAnchor, setModePopoverAnchor] = useState<HTMLElement | null>(null);
```

- [ ] **Step 5: Typecheck and test**

```bash
npx tsc --noEmit 2>&1 | grep MainPanel.tsx | wc -l   # expect same as baseline + 0 from this task
npm run test -- --run
```

Expected: tsc count unchanged or +1 if `modePopoverAnchor`/`setModePopoverAnchor` are unused at this point (they'll be wired in Task 8). Tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(mainpanel): add mode-picker derived state and handlers

Introduces currentMode (speaker/participant/both/none), missingDeviceForMode
(per-segment amber warning trigger), handleModeSwitch (writes both
channel toggles), and popover open/anchor state.

No JSX wired yet — components are added next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ModePicker component (segmented control with click-active-to-popover)

**Files:**
- Create: `src/components/MainPanel/ModePicker.tsx`
- Create: `src/components/MainPanel/ModePicker.scss`
- Create: `src/components/MainPanel/ModePicker.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/MainPanel/ModePicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModePicker from './ModePicker';

describe('ModePicker', () => {
  it('renders three segments labeled by i18n keys (fallback to defaults)', () => {
    render(<ModePicker mode="speaker" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    expect(screen.getByRole('button', { name: /You|我/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Participants|参会者/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Both|双向/ })).toBeInTheDocument();
  });

  it('marks the active segment with aria-pressed', () => {
    render(<ModePicker mode="participant" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    const active = screen.getByRole('button', { name: /Participants|参会者/ });
    expect(active).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onSegmentClick with the segment key when an inactive segment is clicked', () => {
    const onSegmentClick = vi.fn();
    render(<ModePicker mode="speaker" locked={false} missingDeviceForMode={null} onSegmentClick={onSegmentClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Both|双向/ }));
    expect(onSegmentClick).toHaveBeenCalledWith('both', expect.any(HTMLElement));
  });

  it('calls onSegmentClick with the active segment key when the active segment is re-clicked', () => {
    const onSegmentClick = vi.fn();
    render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={onSegmentClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Both|双向/ }));
    expect(onSegmentClick).toHaveBeenCalledWith('both', expect.any(HTMLElement));
  });

  it('does not fire onSegmentClick when locked', () => {
    const onSegmentClick = vi.fn();
    render(<ModePicker mode="speaker" locked={true} missingDeviceForMode={null} onSegmentClick={onSegmentClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Both|双向/ }));
    expect(onSegmentClick).not.toHaveBeenCalled();
  });

  it('adds a warn class on the segment indicated by missingDeviceForMode', () => {
    render(<ModePicker mode="both" locked={false} missingDeviceForMode="speaker" onSegmentClick={() => {}} />);
    const speakerSeg = screen.getByRole('button', { name: /You|我/ });
    expect(speakerSeg.className).toMatch(/warn/);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
npm run test -- --run src/components/MainPanel/ModePicker.test.tsx
```

Expected: file not found / import error.

- [ ] **Step 3: Create `ModePicker.scss`**

```scss
.mode-picker {
  display: inline-flex;
  background: #2a2a2a;
  border-radius: 6px;
  padding: 2px;
  flex-shrink: 0;
  gap: 0;

  &__segment {
    padding: 4px 10px;
    font-size: 12px;
    color: #888;
    border-radius: 4px;
    user-select: none;
    cursor: pointer;
    background: transparent;
    border: 0;
    transition: background 0.15s, color 0.15s, box-shadow 0.15s;

    &:hover:not(:disabled) {
      color: #ccc;
      background: #333;
    }

    &--active {
      background: #10a37f;
      color: #fff;
      font-weight: 600;

      &:hover:not(:disabled) { background: #0f9472; }
    }

    &--warn {
      box-shadow: inset 0 0 0 1px #f59e0b;
    }
  }

  &--locked {
    .mode-picker__segment {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .mode-picker__segment--active {
      opacity: 1;
      background: #555;
      color: #fff;
    }
  }
}
```

- [ ] **Step 4: Create `ModePicker.tsx`**

```tsx
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './ModePicker.scss';

export type FooterMode = 'speaker' | 'participant' | 'both' | 'none';

interface ModePickerProps {
  mode: FooterMode;
  locked: boolean;
  missingDeviceForMode: 'speaker' | 'participant' | 'both' | null;
  onSegmentClick: (segment: 'speaker' | 'participant' | 'both', el: HTMLElement) => void;
}

const SEGMENTS: Array<'speaker' | 'participant' | 'both'> = ['speaker', 'participant', 'both'];

const ModePicker: React.FC<ModePickerProps> = ({ mode, locked, missingDeviceForMode, onSegmentClick }) => {
  const { t } = useTranslation();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const labelFor = (seg: 'speaker' | 'participant' | 'both') => {
    if (seg === 'speaker') return t('modePicker.modeYou', 'You');
    if (seg === 'participant') return t('modePicker.modeParticipants', 'Participants');
    return t('modePicker.modeBoth', 'Both');
  };

  const titleFor = (seg: 'speaker' | 'participant' | 'both') => {
    if (locked) return t('modePicker.switchDisabled', 'Mode is locked during a session.');
    if (missingDeviceForMode === seg || (missingDeviceForMode === 'both' && (seg === 'speaker' || seg === 'participant'))) {
      return t('modePicker.missingDevice', 'Configure devices for this mode to start.');
    }
    if (seg === mode) return t('modePicker.configureDevices', 'Click to configure devices.');
    return t('modePicker.switchTo', 'Switch to {{label}}', { label: labelFor(seg) });
  };

  return (
    <div className={`mode-picker${locked ? ' mode-picker--locked' : ''}`} role="group" aria-label={t('modePicker.groupLabel', 'Translation mode')}>
      {SEGMENTS.map((seg) => {
        const isActive = mode === seg;
        const isWarn =
          missingDeviceForMode === seg ||
          (missingDeviceForMode === 'both' && (seg === 'speaker' || seg === 'participant'));
        const classes = [
          'mode-picker__segment',
          isActive ? 'mode-picker__segment--active' : '',
          isWarn ? 'mode-picker__segment--warn' : '',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={seg}
            ref={(el) => { refs.current[seg] = el; }}
            type="button"
            className={classes}
            aria-pressed={isActive}
            disabled={locked}
            title={titleFor(seg)}
            onClick={() => {
              if (locked) return;
              const el = refs.current[seg];
              if (el) onSegmentClick(seg, el);
            }}
          >
            {labelFor(seg)}
          </button>
        );
      })}
    </div>
  );
};

export default ModePicker;
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
npm run test -- --run src/components/MainPanel/ModePicker.test.tsx
```

Expected: 6/6 passing.

- [ ] **Step 6: Full suite passes**

```bash
npm run test -- --run
```

Expected: 795/795 (789 + 6 new).

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/ModePicker.tsx src/components/MainPanel/ModePicker.scss src/components/MainPanel/ModePicker.test.tsx
git commit -m "$(cat <<'EOF'
feat(mainpanel): add ModePicker segmented control

Three segments: You / Participants / Both. Click inactive segment
fires onSegmentClick(target, el). Click active segment also fires
(caller decides whether to open the device popover). Locked state
disables clicks and dims non-active segments. Warning state outlines
a segment whose target mode is missing a required device.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: WaveformStrip component

Thin canvas wrapper + tinted background + corner label. Width-prop driven for the A2H rule.

**Files:**
- Create: `src/components/MainPanel/WaveformStrip.tsx`
- Create: `src/components/MainPanel/WaveformStrip.scss`

- [ ] **Step 1: Create `WaveformStrip.scss`**

```scss
.waveform-strip {
  height: 28px;
  border-radius: 3px;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;

  &--full { width: 110px; max-width: 140px; }
  &--half { width: 50px; }

  &__label {
    position: absolute;
    top: 50%;
    left: 6px;
    transform: translateY(-50%);
    font-size: 10px;
    color: rgba(255, 255, 255, 0.6);
    font-weight: 600;
    pointer-events: none;
    text-transform: uppercase;
    z-index: 1;
  }

  &__canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  &--mic { background: linear-gradient(90deg, rgba(0,153,255,0.15), rgba(0,153,255,0.30), rgba(0,153,255,0.15)); }
  &--system { background: linear-gradient(90deg, rgba(245,158,11,0.15), rgba(245,158,11,0.30), rgba(245,158,11,0.15)); }
  &--output { background: linear-gradient(90deg, rgba(16,163,127,0.15), rgba(16,163,127,0.30), rgba(16,163,127,0.15)); }
}
```

- [ ] **Step 2: Create `WaveformStrip.tsx`**

```tsx
import React from 'react';
import './WaveformStrip.scss';

interface WaveformStripProps {
  kind: 'mic' | 'system' | 'output';
  canvasRef: React.RefObject<HTMLCanvasElement>;
  width?: 'full' | 'half';
  label?: string;
}

const DEFAULT_LABELS: Record<WaveformStripProps['kind'], string> = {
  mic: 'mic',
  system: 'sys',
  output: 'out',
};

const WaveformStrip: React.FC<WaveformStripProps> = ({ kind, canvasRef, width = 'full', label }) => {
  const cls = `waveform-strip waveform-strip--${kind} waveform-strip--${width}`;
  return (
    <div className={cls}>
      <span className="waveform-strip__label">{label ?? DEFAULT_LABELS[kind]}</span>
      <canvas ref={canvasRef} className="waveform-strip__canvas" />
    </div>
  );
};

export default WaveformStrip;
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "WaveformStrip" | head -5
```

Expected: no errors.

- [ ] **Step 4: Full suite still passes**

```bash
npm run test -- --run
```

Expected: 795/795.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/WaveformStrip.tsx src/components/MainPanel/WaveformStrip.scss
git commit -m "$(cat <<'EOF'
feat(mainpanel): add WaveformStrip presentational component

Thin canvas wrapper with tinted background (blue=mic, amber=system,
green=output) and a corner label. Width prop drives the A2H rule:
'full' = 110px, 'half' = 50px (used when mic and sys are both visible).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ModeDevicePopover component

Floating popover anchored to the active picker segment, content varies by mode.

**Files:**
- Create: `src/components/MainPanel/ModeDevicePopover.tsx`
- Create: `src/components/MainPanel/ModeDevicePopover.scss`

- [ ] **Step 1: Inspect the existing floating-ui usage pattern**

```bash
grep -n "useFloating\|useDismiss\|FloatingPortal" src/components/MainPanel/MainPanel.tsx | head -5
grep -rn "useFloating" src/components/Display 2>/dev/null | head -5
```

Match the existing pattern. The project already uses `DisplaySettingsPopover` — note its structure for reference.

- [ ] **Step 2: Create `ModeDevicePopover.scss`**

```scss
.mode-device-popover {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 8px 0;
  width: 320px;
  font-size: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  color: #ccc;
  z-index: 1000;

  &__header {
    padding: 4px 14px 6px;
    color: #888;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  &__row {
    padding: 8px 14px;
    display: flex;
    align-items: center;
    gap: 8px;

    .label { color: #aaa; flex: 1; font-size: 12px; }

    select {
      max-width: 180px;
      background: #1a1a1a;
      color: #ddd;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 3px 6px;
      font-size: 11px;
    }

    .unset { color: #f59e0b; font-style: italic; }
  }

  &__divider { border-top: 1px solid #3a3a3a; margin: 4px 0; }

  &__footer {
    padding: 6px 14px;
    color: #888;
    font-size: 11px;

    a {
      color: #10a37f;
      cursor: pointer;
      &:hover { text-decoration: underline; }
    }
  }
}
```

- [ ] **Step 3: Create `ModeDevicePopover.tsx`**

```tsx
import React from 'react';
import {
  useFloating,
  useDismiss,
  useInteractions,
  FloatingPortal,
  offset,
  flip,
  shift,
} from '@floating-ui/react';
import { Mic, AudioLines, Volume2, Headphones } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAudioContext } from '../../stores/audioStore';
import { isExtension } from '../../utils/environment';
import { useNavigateToSettings } from '../../stores/settingsStore';
import './ModeDevicePopover.scss';

interface ModeDevicePopoverProps {
  mode: 'speaker' | 'participant' | 'both';
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const ModeDevicePopover: React.FC<ModeDevicePopoverProps> = ({ mode, open, anchorEl, onClose }) => {
  const { t } = useTranslation();
  const navigateToSettings = useNavigateToSettings();

  const {
    audioInputDevices,
    audioMonitorDevices,
    selectedInputDevice,
    selectedMonitorDevice,
    selectInputDevice,
    selectMonitorDevice,
    systemAudioSources,
    selectedSystemAudioSource,
    selectSystemAudioSource,
    participantAudioOutputDevice,
    selectParticipantAudioOutputDevice,
  } = useAudioContext();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    elements: { reference: anchorEl ?? undefined },
  });

  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  if (!open || !anchorEl) return null;

  const showMic = mode === 'speaker' || mode === 'both';
  const showParticipant = mode === 'participant' || mode === 'both';
  const showSpeaker = mode === 'speaker' || mode === 'both';
  const showExtensionPassthrough = isExtension() && (mode === 'participant' || mode === 'both');

  const headerKey = mode === 'speaker'
    ? t('modePicker.popoverHeaderYou', 'You — devices')
    : mode === 'participant'
      ? t('modePicker.popoverHeaderParticipants', 'Participants — devices')
      : t('modePicker.popoverHeaderBoth', 'Both — devices');

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="mode-device-popover"
        style={floatingStyles}
        {...getFloatingProps()}
      >
        <div className="mode-device-popover__header">{headerKey}</div>

        {showMic && (
          <div className="mode-device-popover__row">
            <Mic size={14} />
            <span className="label">{t('modePicker.deviceMic', 'Microphone')}</span>
            <select
              value={selectedInputDevice?.deviceId ?? ''}
              onChange={(e) => {
                const d = audioInputDevices.find((x) => x.deviceId === e.target.value);
                if (d) selectInputDevice(d);
              }}
            >
              <option value="" disabled>{t('modePicker.notSelected', 'Not selected')}</option>
              {audioInputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        {showParticipant && !isExtension() && (
          <div className="mode-device-popover__row">
            <AudioLines size={14} />
            <span className="label">{t('modePicker.deviceParticipantSource', 'Participant source')}</span>
            <select
              value={selectedSystemAudioSource?.deviceId ?? ''}
              onChange={(e) => {
                const s = (systemAudioSources ?? []).find((x: any) => x.deviceId === e.target.value);
                if (s) selectSystemAudioSource(s);
              }}
            >
              <option value="" disabled>{t('modePicker.notSelected', 'Not selected')}</option>
              {(systemAudioSources ?? []).map((s: any) => (
                <option key={s.deviceId} value={s.deviceId}>{s.label || s.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        {showExtensionPassthrough && (
          <div className="mode-device-popover__row">
            <Headphones size={14} />
            <span className="label">{t('modePicker.devicePassthrough', 'Original audio passthrough')}</span>
            <select
              value={participantAudioOutputDevice?.deviceId ?? ''}
              onChange={(e) => {
                const d = audioMonitorDevices.find((x) => x.deviceId === e.target.value);
                if (d) selectParticipantAudioOutputDevice(d);
              }}
            >
              <option value="">{t('modePicker.useDefault', 'Default output')}</option>
              {audioMonitorDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        {showSpeaker && (
          <div className="mode-device-popover__row">
            <Volume2 size={14} />
            <span className="label">{t('modePicker.deviceSpeakerMonitor', 'Speaker monitor')}</span>
            <select
              value={selectedMonitorDevice?.deviceId ?? ''}
              onChange={(e) => {
                const d = audioMonitorDevices.find((x) => x.deviceId === e.target.value);
                if (d) selectMonitorDevice(d);
              }}
            >
              <option value="" disabled>{t('modePicker.notSelected', 'Not selected')}</option>
              {audioMonitorDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mode-device-popover__divider" />
        <div className="mode-device-popover__footer">
          <a onClick={() => { navigateToSettings(null); onClose(); }}>
            {t('modePicker.popoverFooter', 'Full settings →')}
          </a>
        </div>
      </div>
    </FloatingPortal>
  );
};

export default ModeDevicePopover;
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "ModeDevicePopover" | head -5
```

Expected: no new errors. (If `useAudioContext` lacks one of the fields used here, adjust the destructure to match what exists.)

- [ ] **Step 5: Full suite passes**

```bash
npm run test -- --run
```

Expected: 795/795.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/ModeDevicePopover.tsx src/components/MainPanel/ModeDevicePopover.scss
git commit -m "$(cat <<'EOF'
feat(mainpanel): add ModeDevicePopover

Floating popover anchored to the active mode-picker segment. Shows
mode-relevant device selects (mic for speaker/both, participant source
+ optional extension passthrough for participant/both, speaker monitor
for speaker/both). Uses @floating-ui/react for positioning + dismiss.

Native HTML <select> elements bind directly to existing audioStore
selection actions — no custom dropdown infrastructure needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Replace basic-mode footer with ModePicker layout

Removes the basic-mode device-status icon row. Inserts ModePicker between status dot and the center cluster. Lang+duration moves to far right.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/components/MainPanel/MainPanel.scss`

- [ ] **Step 1: Locate the current basic-mode footer**

```bash
grep -n "control-footer basic\|device-status" src/components/MainPanel/MainPanel.tsx | head -10
```

The basic-mode footer is the block under `{uiMode === 'basic' && ( ... )}` around lines 3120-3175 (line numbers shifted by prior edits — locate by context).

- [ ] **Step 2: Replace the basic-mode footer JSX**

Find the entire basic-mode footer block. Inside it, locate the `<div className="status-info">...</div>` and the `<div className="main-controls">...</div>`. The whole row currently looks like:

```tsx
<div className="control-footer basic">
  <div className="status-info">
    <span className="status-dot ..." />
    {/* reconnecting label */}
    <span className="language-pair clickable" ...>{...}</span>
    {isSessionActive && (<span className="session-duration">...</span>)}
    <span className="device-status">
      <span className="device-icon ... mic">...</span>
      <span className="device-icon ... participant">...</span>   ← from previous spec
      <span className="device-icon ... speaker">...</span>
    </span>
  </div>
  <div className="main-controls">
    {isSessionActive && speakerChannelActive && canHoldToSpeak && (
      <button className="push-to-talk-btn">...</button>
    )}
    <button className="main-action-btn ..." disabled={...} title={...}>
      {/* Initializing / Stop / Start content */}
    </button>
  </div>
</div>
```

Replace the entire `<div className="control-footer basic">...</div>` block with:

```tsx
<div className="control-footer basic">
  <span className={`status-dot ${isReconnecting ? 'reconnecting' : isSessionActive ? 'active' : ''}`} />
  {isReconnecting && (
    <span className="reconnecting-label">
      {t('connectionStatus.reconnecting', 'Reconnecting...')}
    </span>
  )}
  <ModePicker
    mode={currentMode}
    locked={isSessionActive || isInitializing}
    missingDeviceForMode={missingDeviceForMode}
    onSegmentClick={(target, el) => {
      if (target === currentMode) {
        setModePopoverAnchor(el);
        setModePopoverOpen(true);
      } else {
        handleModeSwitch(target);
        setModePopoverOpen(false);
      }
    }}
  />

  <span className="footer-spacer" />

  <div className="action-cluster">
    {isSessionActive && speakerChannelActive && canHoldToSpeak && (
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
      title={
        !canStartSession && !isSessionActive
          ? !anyChannelWillStart
            ? t('mainPanel.noChannelConfigured', 'Enable microphone or participant audio before starting.')
            : provider === Provider.LOCAL_INFERENCE
              ? t('mainPanel.localModelsRequired', 'Download required models in settings to start.')
              : undefined
          : undefined
      }
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

  <span className="footer-spacer" />

  <div className="footer-metadata">
    <span
      className="language-pair clickable"
      onClick={() => navigateToSettings('languages')}
      title={t('simplePanel.clickToConfigLanguages', 'Click to configure languages')}
    >
      {currentSettings.sourceLanguage} → {currentSettings.targetLanguage}
    </span>
    {isSessionActive && (
      <span className="session-duration">{sessionDuration}</span>
    )}
  </div>
</div>
```

Add the import at the top (the type import doubles as the canonical `FooterMode` source — `currentMode`'s inline union is structurally identical and assigns cleanly):

```tsx
import ModePicker from './ModePicker';
```

- [ ] **Step 3: Add SCSS for the new basic-mode footer layout**

In `src/components/MainPanel/MainPanel.scss`, find the existing `.control-footer.basic` rules. Append:

```scss
.control-footer.basic {
  display: flex;
  align-items: center;
  gap: 10px;

  .footer-spacer { flex: 1; min-width: 12px; }

  .action-cluster {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .footer-metadata {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px;
    flex-shrink: 0;

    .language-pair {
      color: #ccc;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;

      &:hover { color: #fff; background: rgba(255,255,255,0.05); }
    }

    .session-duration {
      color: #888;
      font-size: 11px;
      white-space: nowrap;
    }
  }
}
```

Remove or comment out any old `.device-status` styles inside `.control-footer.basic` — they no longer apply.

- [ ] **Step 4: Wire ModeDevicePopover at component root**

Near the bottom of MainPanel's return statement (just before the closing wrapping `</div>`), add:

```tsx
{modePopoverOpen && currentMode !== 'none' && (
  <ModeDevicePopover
    mode={currentMode}
    open={modePopoverOpen}
    anchorEl={modePopoverAnchor}
    onClose={() => setModePopoverOpen(false)}
  />
)}
```

Add the import:

```tsx
import ModeDevicePopover from './ModeDevicePopover';
```

- [ ] **Step 5: Typecheck and run tests**

```bash
npx tsc --noEmit 2>&1 | grep MainPanel.tsx | wc -l
npm run test -- --run
```

Expected: tsc count baseline 9 (no new errors). 795/795 passing.

- [ ] **Step 6: Smoke check the basic mode in dev**

```bash
npm run build 2>&1 | tail -3
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.scss
git commit -m "$(cat <<'EOF'
feat(mainpanel): replace basic-mode footer with ModePicker layout

Removes the mic/participant/speaker device-icon row. New layout:
  [dot] [ModePicker] · · · [PTT?][Start] · · · [lang][duration]

Click inactive segment → switch mode (toggles audio-store state).
Click active segment → open ModeDevicePopover anchored to that segment.
Center action cluster (PTT + Start/Stop) sits between two flex spacers
so Start stays centered regardless of PTT visibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Replace advanced-mode footer with ModePicker + waveforms (A2H)

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/components/MainPanel/MainPanel.scss`

- [ ] **Step 1: Locate the current advanced-mode footer**

Find the block under `{uiMode === 'advanced' && ( ... )}`. It currently has `.input-viz`, `.participant-viz`, `.center-controls`, and `.output-viz`.

- [ ] **Step 2: Replace the advanced-mode footer JSX**

Replace the entire `<div className="control-footer advanced">...</div>` block with:

```tsx
<div className="control-footer advanced">
  <span className={`status-dot ${isSessionActive ? 'active' : ''}`} />

  <ModePicker
    mode={currentMode}
    locked={isSessionActive || isInitializing}
    missingDeviceForMode={missingDeviceForMode}
    onSegmentClick={(target, el) => {
      if (target === currentMode) {
        setModePopoverAnchor(el);
        setModePopoverOpen(true);
      } else {
        handleModeSwitch(target);
        setModePopoverOpen(false);
      }
    }}
  />

  {(currentMode === 'speaker' || currentMode === 'both') && (
    <WaveformStrip
      kind="mic"
      canvasRef={clientCanvasRef}
      width={currentMode === 'both' ? 'half' : 'full'}
    />
  )}
  {(currentMode === 'participant' || currentMode === 'both') && (
    <WaveformStrip
      kind="system"
      canvasRef={systemCanvasRef}
      width={currentMode === 'both' ? 'half' : 'full'}
    />
  )}

  <span className="footer-spacer" />

  <div className="action-cluster">
    {isSessionActive && speakerChannelActive && canHoldToSpeak && (
      <button
        className={`push-to-talk-button ${isRecording ? 'recording' : ''}`}
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        disabled={!isSessionActive || !canHoldToSpeak || !isInputDeviceOn}
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
        if (isSessionActive) {
          disconnectConversation();
        } else {
          connectConversation();
        }
      }}
      disabled={(!isSessionActive && !canStartSession) || isInitializing}
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
        <>
          <X size={14} />
          <span>{t('mainPanel.endSession')}</span>
        </>
      ) : (
        <>
          <Zap size={14} />
          <span>{t('mainPanel.startSession')}</span>
          {!anyChannelWillStart && (
            <span className="tooltip">
              {t('mainPanel.noChannelConfigured', 'Enable microphone or participant audio before starting.')}
            </span>
          )}
          {anyChannelWillStart && !isApiKeyValid && (
            <span className="tooltip">
              {provider === Provider.LOCAL_INFERENCE
                ? t('mainPanel.localModelsRequired', 'Download required models in settings to start.')
                : t('mainPanel.apiKeyRequired')}
            </span>
          )}
          {anyChannelWillStart && isApiKeyValid && availableModels.length === 0 && !loadingModels && (
            <span className="tooltip">{t('mainPanel.modelsRequired')}</span>
          )}
          {anyChannelWillStart && isApiKeyValid && loadingModels && (
            <span className="tooltip">{t('mainPanel.modelsLoading')}</span>
          )}
          {anyChannelWillStart && isApiKeyValid && provider === Provider.KIZUNA_AI && quota && quota.frozen && (
            <span className="tooltip">{t('mainPanel.walletFrozen', 'Wallet is frozen. Please contact support.')}</span>
          )}
          {anyChannelWillStart && isApiKeyValid && provider === Provider.KIZUNA_AI && quota && quota.balance !== undefined && quota.balance < 0 && (
            <span className="tooltip">{t('mainPanel.insufficientBalance', 'Insufficient token balance: {{balance}} tokens', { balance: quota.balance })}</span>
          )}
        </>
      )}
    </button>

    {isDevelopment() && (
      <button className={`debug-button ${isTestTonePlaying ? 'active' : ''}`} onClick={playTestTone}>
        <Wrench size={14} />
        <span>{isTestTonePlaying ? t('mainPanel.stopDebug') : t('mainPanel.debug')}</span>
      </button>
    )}
  </div>

  <span className="footer-spacer" />

  {currentMode !== 'none' && (
    <WaveformStrip kind="output" canvasRef={serverCanvasRef} width="full" />
  )}

  <div className="footer-metadata">
    <span
      className="language-pair clickable"
      onClick={() => navigateToSettings('languages')}
      title={t('simplePanel.clickToConfigLanguages', 'Click to configure languages')}
    >
      {currentSettings.sourceLanguage} → {currentSettings.targetLanguage}
    </span>
    {isSessionActive && (
      <span className="session-duration">{sessionDuration}</span>
    )}
  </div>
</div>
```

Add the import at the top:

```tsx
import WaveformStrip from './WaveformStrip';
```

- [ ] **Step 3: Add SCSS for the new advanced-mode footer layout**

In `src/components/MainPanel/MainPanel.scss`, find the existing `.control-footer.advanced` block. Replace its `.input-viz` / `.participant-viz` / `.output-viz` / `.center-controls` styles with the unified flex layout:

```scss
.control-footer.advanced {
  display: flex;
  align-items: center;
  gap: 10px;

  .footer-spacer { flex: 1; min-width: 12px; }

  .action-cluster {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .footer-metadata {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px;
    flex-shrink: 0;

    .language-pair {
      color: #ccc;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;

      &:hover { color: #fff; background: rgba(255,255,255,0.05); }
    }

    .session-duration { color: #888; font-size: 11px; white-space: nowrap; }
  }
}
```

Delete the old `.input-viz`, `.participant-viz`, `.output-viz`, and any `.input-viz-aux` rules introduced by the previous spec.

- [ ] **Step 4: Add `systemCanvasRef`**

Near the existing `clientCanvasRef` and `serverCanvasRef` declarations in MainPanel:

```bash
grep -n "clientCanvasRef\|serverCanvasRef" src/components/MainPanel/MainPanel.tsx | head -5
```

Add right after them:

```tsx
const systemCanvasRef = useRef<HTMLCanvasElement>(null);
```

- [ ] **Step 5: Typecheck and tests**

```bash
npx tsc --noEmit 2>&1 | grep MainPanel.tsx | wc -l
npm run test -- --run
```

Expected: tsc count unchanged. 795/795 passing.

- [ ] **Step 6: Smoke build**

```bash
npm run build 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.scss
git commit -m "$(cat <<'EOF'
feat(mainpanel): replace advanced-mode footer with ModePicker + waveforms

A2H layout:
  [dot] [ModePicker] [mic?] [sys?] · · · [PTT?][Start] · · · [out] [lang][duration]

Mode-aware waveform set — mic + sys both render at width='half' (50px)
when mode = 'both' so the input side balances the output (110px).
Single input shrinks to full (110px) when alone. Out is always full.

Removes input-viz / participant-viz / output-viz device-icon wrappers
from the previous spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire system canvas into the visualization loop

The mic and output canvases already animate via a `requestAnimationFrame` loop driving `WavRenderer.drawBars`. Add a third call against the new system canvas, driven by the participant analyser.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Find the existing visualization loop**

```bash
grep -n "WavRenderer\|requestAnimationFrame\|clientCanvasRef.current\|serverCanvasRef.current" src/components/MainPanel/MainPanel.tsx | head -15
```

You'll find a `useEffect` that schedules `requestAnimationFrame` and calls `WavRenderer.drawBars(...)` twice — once for the mic input analyser, once for the output (server) analyser. The effect runs on `isSessionActive` change.

- [ ] **Step 2: Add a third drawBars call inside the loop**

Inside the animation-frame callback, alongside the existing two `WavRenderer.drawBars(...)` calls, add (use the existing color and size conventions matching the other two draws):

```tsx
// Participant audio waveform (system audio capture)
if (systemCanvasRef.current) {
  const participantAnalyser = audioServiceRef.current?.getParticipantAnalyser?.() ?? null;
  if (participantAnalyser) {
    const ctx = systemCanvasRef.current.getContext('2d');
    if (ctx) {
      // Use the same WavRenderer helper used by the other two waveforms.
      // The argument shape (analyser, canvas, color, etc.) is established
      // by the existing calls — match them here.
      WavRenderer.drawBars(
        systemCanvasRef.current,
        ctx,
        new Uint8Array(participantAnalyser.frequencyBinCount).fill(0),  // placeholder; replaced by the analyser data below
        '#f59e0b',
        10,
        0,
        8
      );
      // If the existing drawBars takes the analyser directly instead of a data array,
      // mirror that pattern. The existing two calls are the source of truth — copy
      // their signature exactly and only swap the analyser, canvas, and color.
    }
  }
}
```

**Important:** the exact `WavRenderer.drawBars` call shape varies by codebase. Read the existing two calls in this very file and replicate their signature, only swapping:
- canvas: `systemCanvasRef.current`
- analyser source: `audioServiceRef.current?.getParticipantAnalyser?.() ?? null`
- color: `'#f59e0b'` (amber to match the sys-wf gradient)

Do not invent a new signature.

- [ ] **Step 3: Add gating — only draw when participant channel is active OR pre-session in a mode that uses it**

Guard the new draw call so it bails out cheaply when irrelevant:

```tsx
const showSystemWaveform = isSessionActive
  ? participantChannelActive
  : currentMode === 'participant' || currentMode === 'both';
if (showSystemWaveform && systemCanvasRef.current) {
  // ...the drawBars block above...
}
```

This avoids drawing into a hidden canvas (the JSX gating already prevents render when not in the right mode, but the rAF loop runs unconditionally — the guard prevents wasted draws).

- [ ] **Step 4: Update the effect's dependency array**

If the rAF effect has a dependency array, add `participantChannelActive` and `currentMode`. If the effect uses `useRef` for stable state, no change needed.

- [ ] **Step 5: Typecheck and test**

```bash
npx tsc --noEmit 2>&1 | grep MainPanel.tsx | wc -l
npm run test -- --run
```

Expected: tsc count unchanged. 795/795 passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(mainpanel): draw participant waveform in the rAF loop

Adds a third WavRenderer.drawBars call against systemCanvasRef driven
by audioServiceRef.getParticipantAnalyser(). Amber bars (#f59e0b)
match the WaveformStrip --system gradient.

Gated on participantChannelActive (in-session) or
currentMode ∈ {participant, both} (pre-session) so the loop doesn't
waste cycles when the canvas isn't rendered.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Add i18n strings for modePicker

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Find a good insertion point**

```bash
grep -n '"simplePanel"\|"mainPanel"' src/locales/en/translation.json | head -3
```

Add a new top-level object `modePicker` adjacent to `simplePanel` and `mainPanel`.

- [ ] **Step 2: Insert the new keys**

Insert (preserve JSON syntax — trailing commas correct, no duplicate keys):

```json
"modePicker": {
  "modeYou": "You",
  "modeParticipants": "Participants",
  "modeBoth": "Both",
  "groupLabel": "Translation mode",
  "switchTo": "Switch to {{label}}",
  "switchDisabled": "Mode is locked during a session.",
  "configureDevices": "Click to configure devices.",
  "missingDevice": "Configure devices for this mode to start.",
  "popoverHeaderYou": "You — devices",
  "popoverHeaderParticipants": "Participants — devices",
  "popoverHeaderBoth": "Both — devices",
  "popoverFooter": "Full settings →",
  "deviceMic": "Microphone",
  "deviceParticipantSource": "Participant source",
  "devicePassthrough": "Original audio passthrough",
  "deviceSpeakerMonitor": "Speaker monitor",
  "notSelected": "Not selected",
  "useDefault": "Default output"
},
```

- [ ] **Step 3: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json', 'utf8'))" && echo "JSON OK"
```

Expected: `JSON OK`.

- [ ] **Step 4: Tests pass**

```bash
npm run test -- --run
```

Expected: 795/795.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "$(cat <<'EOF'
i18n(en): add modePicker.* keys for footer mode picker

Labels (You/Participants/Both), segment titles, popover header/footer,
device-row labels, and select placeholders. Other locales picked up
via fallback to en + existing translation flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update OnboardingContext targets that pointed at removed icons

The previous spec already updated `#system-audio-section` → `#participant-section`. Verify no onboarding step still targets the removed footer device icons.

**Files:**
- Modify: `src/contexts/OnboardingContext.tsx` (if any target is stale)

- [ ] **Step 1: Audit references**

```bash
grep -n "device-icon\|input-viz\|participant-viz\|output-viz\|mic-icon\|speaker-icon" src/contexts/OnboardingContext.tsx 2>/dev/null
```

If matches exist, update each to a still-existing selector (e.g., `.mode-picker`, `.main-action-btn`, `.session-button`) that makes sense for the onboarding step's intent.

If no matches: skip to Step 3.

- [ ] **Step 2: Edit the targets**

For each stale target, pick the closest stable selector. Suggested mappings:
- `.input-viz` / `.mic-icon` → `.mode-picker` (mode picker now hosts the mic affordance via popover)
- `.output-viz` / `.speaker-icon` → `.mode-picker`
- `.participant-viz` → `.mode-picker`

Use the simplest selector that resolves to a unique element.

- [ ] **Step 3: Verify build + tests**

```bash
npx tsc --noEmit 2>&1 | grep "OnboardingContext.tsx" | wc -l
npm run test -- --run
```

Expected: tsc count unchanged (or 0 for that file). Tests pass.

- [ ] **Step 4: Commit (only if you actually changed the file)**

If no edits were needed (Step 1 returned no matches), skip this commit. Otherwise:

```bash
git add src/contexts/OnboardingContext.tsx
git commit -m "$(cat <<'EOF'
fix(onboarding): retarget steps that referenced removed footer icons

The mic / participant / speaker device icons are gone — their function
is hosted by ModePicker + ModeDevicePopover. Onboarding steps now point
at the picker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Build + typecheck + full test verification

**Files:** none

- [ ] **Step 1: Full test suite**

```bash
npm run test -- --run
```

Expected: 795/795 passing (or higher if any task added tests).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
npx tsc --noEmit 2>&1 | grep "MainPanel.tsx" | wc -l
```

Expected: total error count similar to baseline pre-plan. MainPanel.tsx error count back to baseline 9 (the original pre-existing errors — no new ones from this plan).

- [ ] **Step 3: Production build**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no errors.

- [ ] **Step 4: Local commit summary**

```bash
git log --oneline origin/docs/symmetric-channel-spec..HEAD
git diff --stat origin/docs/symmetric-channel-spec..HEAD
```

Note the chain of commits added by this plan.

- [ ] **Step 5: No commit needed for this verification task.**

---

## Task 14: Stop at local commits — await user decision

**STOP HERE.** Per `feedback-publish-actions-consent`, do NOT push, do NOT open a PR, do NOT rename the branch without explicit user approval.

- [ ] **Step 1: Summarize for user**

Report:
- Branch: `docs/symmetric-channel-spec`
- Number of new commits since `origin/docs/symmetric-channel-spec`
- Files changed (`git diff --stat origin/docs/symmetric-channel-spec..HEAD`)
- All quality gates green (tests, build, tsc)
- Manual verification (3 scenarios end-to-end) — flag this as NOT done, requires user at the dev server

- [ ] **Step 2: Await user direction**

Ask whether to push, whether to open a draft PR, whether to do manual verification first.

---

## Coverage check (spec → plan)

| Spec section | Tasks |
|---|---|
| Mode definitions (currentMode derivation) | Task 4 |
| Component 1: ModePicker | Task 5 |
| Component 2: ModeDevicePopover | Task 7 |
| Component 3: WaveformStrip | Task 6 |
| Footer layouts (A2H + center buttons + right metadata), basic | Task 8 |
| Footer layouts (A2H + center buttons + right metadata), advanced | Task 9 |
| Waveform width rule (full vs half) | Task 6 (component) + Task 9 (call sites) |
| State & glue logic (handleModeSwitch, popover state, missingDeviceForMode) | Task 4 |
| System audio waveform capture (Analyser pipeline) | Task 2, 3, 10 |
| Removal of existing footer device icons | Tasks 8, 9 |
| i18n strings | Task 11 |
| Mode label text — internal vs displayed | Task 5 (i18n in component) + Task 11 (key) |
| Audio store set-style actions | Task 1 |
| OnboardingContext targets | Task 12 |

| Spec acceptance criterion | Verified by |
|---|---|
| Basic-mode footer renders ModePicker; no device icons | Task 8 + Task 13 |
| Advanced-mode footer A2H layout; no device icons | Task 9 + Task 13 |
| PTT button does not displace Start | Task 8/9 layout (center spacers) |
| Width rule: mic/sys ~50px when both, ~110px when alone | Task 6 + Task 9 |
| Click inactive segment switches mode | Tasks 4 + 5 + 8/9 |
| Click active segment opens popover | Tasks 5 + 7 + 8/9 |
| Popover content matches mode | Task 7 |
| Popover device selects commit to audioStore | Task 7 |
| Popover "Full settings →" link | Task 7 |
| Amber on missing-device segment, Start disabled tooltip | Tasks 4 + 5 + 9 |
| In-session locked picker | Task 5 (locked prop) + Tasks 8/9 (callers pass isSessionActive) |
| PTT × speakerChannelActive × canHoldToSpeak gating | Tasks 8/9 (existing logic preserved) |
| System audio waveform live data | Tasks 2, 3, 10 |
| Scenario 2 still skips speaker client (regression check) | Task 13 (full test suite + manual) |
| 785/785 tests still pass + new tests pass | Task 13 |
| Build clean | Task 13 |
