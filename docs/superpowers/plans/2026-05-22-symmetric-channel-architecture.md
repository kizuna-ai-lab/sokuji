# Symmetric Channel Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make speaker and participant clients equal-status — either can be the sole channel of a session — and surface the participant channel in the UI at the same rank as mic and speaker.

**Architecture:** Two channels (`speaker`, `participant`) with independent start gating but shared session lifecycle. Channel composition locked at session start. UI gets a third footer icon and a reordered settings layout placing participant audio with the other input affordance.

**Tech Stack:** React + TypeScript + Zustand (sessionStore, settingsStore, audioStore), Vitest, sokuji existing client/audio service layer.

**Spec:** `docs/superpowers/specs/2026-05-22-symmetric-channel-architecture-design.md`

---

## Task 0: Setup

**Files:**
- None (branch and env setup)

- [ ] **Step 1: Verify on correct branch**

The spec lives on `docs/symmetric-channel-spec`. Implementation work continues on this branch but the branch name no longer fits — rename it.

Run:
```bash
git status
git branch --show-current
```
Expected: clean working tree on `docs/symmetric-channel-spec` (the spec is the only file changed vs `origin/main`).

If on a different branch, switch:
```bash
git checkout docs/symmetric-channel-spec
```

- [ ] **Step 2: Rename branch locally and on remote**

Run:
```bash
git branch -m docs/symmetric-channel-spec feat/symmetric-channel
git push origin :docs/symmetric-channel-spec feat/symmetric-channel
git push --set-upstream origin feat/symmetric-channel
```
Expected: `feat/symmetric-channel` exists locally and remotely; `docs/symmetric-channel-spec` is deleted on remote.

If the user has already opened a PR from the old branch, **STOP** and ask before renaming.

- [ ] **Step 3: Baseline test run**

Run:
```bash
npm run test -- --run
```
Expected: all current tests pass. Note any pre-existing failures and proceed — do not fix unrelated failures in this plan.

- [ ] **Step 4: No commit needed for this task** (no file changes)

---

## Task 1: Rename store state `systemAudioItems` → `participantItems` (atomic across IPC)

The wire format and the store field must rename together because the bundle ships both sides of the IPC. Touching: `sessionStore.ts`, `sessionPortMirror.ts`, `ExtensionContentScriptSubtitleSurface.ts`, `SubtitleApp.tsx`, `MainPanel.tsx`, plus tests.

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/stores/sessionPortMirror.ts`
- Modify: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts`
- Modify: `src/components/Subtitle/SubtitleApp.tsx`
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/stores/sessionPortMirror.test.ts`
- Modify: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts`

- [ ] **Step 1: Update `sessionStore.ts`**

Replace every occurrence of `systemAudioItems` / `setSystemAudioItems` / `useSystemAudioItems` / `useSetSystemAudioItems` with `participantItems` / `setParticipantItems` / `useParticipantItems` / `useSetParticipantItems`.

Exact edits in `src/stores/sessionStore.ts`:

```typescript
// Line 14 (interface):
participantItems: ConversationItem[];

// Line 29 (interface):
setParticipantItems: (items: ConversationItem[]) => void;

// Line 47 (initial state):
participantItems: [],

// Line 57 (action):
setParticipantItems: (participantItems) => set({ participantItems }),

// Line 82 (endSession reset):
participantItems: [],

// Line 94 (resetSession):
participantItems: [],

// Line 117 (selector):
export const useParticipantItems = () => useSessionStore((state) => state.participantItems);

// Line 119 (selector):
export const useSetParticipantItems = () => useSessionStore((state) => state.setParticipantItems);
```

- [ ] **Step 2: Update `sessionPortMirror.ts`**

Rename every `systemAudioItems` to `participantItems` (both the wire field and the store read/write):

```typescript
// Lines 14, 27 (interface payload fields):
participantItems?: any[];

// Line 162:
participantItems: msg.payload.participantItems ?? [],

// Line 189:
participantItems: msg.participantItems ?? useSessionStore.getState().participantItems,
```

- [ ] **Step 3: Update `ExtensionContentScriptSubtitleSurface.ts`**

```typescript
// Line 179:
participantItems: session.participantItems,

// Line 192 (subscribe selector):
(s) => ({ items: s.items, participantItems: s.participantItems }),

// Lines 197, 202 (post + comparison):
participantItems: next.participantItems,
a.items === b.items && a.participantItems === b.participantItems,
```

- [ ] **Step 4: Update `SubtitleApp.tsx`**

```tsx
// Line 27 (import):
import { ..., useParticipantItems, ... } from '../../stores/sessionStore';

// Line 83:
const participantItems = useParticipantItems();

// Line 138 (in combinedItems memo, the spread inside .map):
...participantItems.map(tagParticipant),

// Line 141 (dep array):
}, [items, participantItems, sourceLanguage, targetLanguage]);

// Line 214:
const participantHasAudio = participantItems.length > 0;
```

- [ ] **Step 5: Update `MainPanel.tsx`** (rename store hook import, local state variable)

```tsx
// Line 45 (import):
import useSessionStore, {
  useSession, useIsReconnecting, useSetIsReconnecting,
  useSetItems as useSetStoreItems,
  useSetParticipantItems as useSetStoreParticipantItems,  // renamed
  useClearConversationVersion, useRequestClearConversation
} from '../../stores/sessionStore';

// Line 283:
const setStoreParticipantItems = useSetStoreParticipantItems();

// Line 472 (inside createParticipantEventHandlers):
setParticipantItems(client.getConversationItems());

// Line 724 (local state):
const [participantItems, setParticipantItems] = useState<ConversationItem[]>([]);

// Line 733-734 (effect mirroring to store):
useEffect(() => {
  setStoreParticipantItems(participantItems);
}, [participantItems, setStoreParticipantItems]);

// Line 747 (clearConversation):
setParticipantItems([]);

// Line 790 (combinedItems map — keep the `participantItems` local name on the right but rename the iteratee):
const participantTagged = participantItems.map(item => tag(item, 'participant'));
// Replace any downstream `participantItems` references in this memo that were using the OLD local name to mean "the array post-tagging" — verify by searching surrounding lines.

// Line 807 (dep array):
}, [items, participantItems, getCurrentProviderSettings]);

// Line 1295 (in connectConversation cleanup):
setParticipantItems([]);

// Line 2400 (dep array of conversation effect):
}, [items, participantItems]);

// Line 2712 (memo input):
participantItems,

// Line 2719 (dep array):
}, [participantItems, isSessionActive, sendAnchorIfNeeded, getProcessedSystemInstructions]);

// Line 2866 (conditional render — replace the local var name):
{participantItems.length > 0 && (
```

**IMPORTANT — name collision in `combinedItems` memo:** The current code at line 790 does:
```tsx
const participantItems = systemAudioItems.map(item => tag(item, 'participant'));
```
After rename, this would shadow the state variable. Resolve by renaming the tagged array to `participantTagged`:

```tsx
const speakerItems = items.map(item => tag(item, 'speaker'));
const participantTagged = participantItems.map(item => tag(item, 'participant'));
// Then downstream:
for (const it of speakerItems) liveIds.add(it.id);
for (const it of participantTagged) liveIds.add(it.id);
return [...speakerItems, ...participantTagged].sort(...);
```

- [ ] **Step 6: Update `sessionPortMirror.test.ts`**

In `src/stores/sessionPortMirror.test.ts` lines 27 and 147, replace:
```typescript
systemAudioItems: [],
```
with:
```typescript
participantItems: [],
```

- [ ] **Step 7: Update `ExtensionContentScriptSubtitleSurface.test.ts`**

In `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.test.ts` line 99:
```typescript
useSessionStore.setState({ items: [], participantItems: [], isSessionActive: false } as any);
```

- [ ] **Step 8: Run typecheck and tests**

```bash
npm run test -- --run
```
Expected: all tests pass. If TypeScript errors appear about `systemAudioItems`, search for remaining references:
```bash
grep -rn "systemAudioItems" src extension public 2>/dev/null | grep -v "extension/dist"
```
Fix any stragglers. The `extension/dist/` directory is build output — ignore it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(session): rename systemAudioItems → participantItems

The wire field and store state both rename atomically. The 'system
audio' name described the *source* on Electron only (loopback); on
extensions it's tab capture. 'Participant' is the cross-environment
concept and matches the upcoming symmetric channel architecture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Rename client refs in MainPanel — `clientRef` → `speakerClientRef`, `systemAudioClientRef` → `participantClientRef`

Mechanical rename. No behavior change.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Rename `clientRef` to `speakerClientRef`**

In `src/components/MainPanel/MainPanel.tsx`, find every occurrence of `clientRef` (the speaker client) and rename to `speakerClientRef`. Be careful: there is also a `client` local variable used inside `setupClientListeners` and `connectConversation` — leave those alone. Only the `useRef<IClient | null>(null)` at line 705 and its `.current` accesses get renamed.

```tsx
// Line 705:
const speakerClientRef = useRef<IClient | null>(null);
```

Then sweep all `clientRef.current` → `speakerClientRef.current`. Check sites include:
- Line 743 (clearConversation): `speakerClientRef.current?.clearConversationItems();`
- Lines 910-913 (setupClientListeners): `const client = speakerClientRef.current;`
- Line 1195-1216 (disconnectConversation cleanup): rename
- Line 1371 (connectConversation creation): `speakerClientRef.current = createAIClient(...)`
- Line 1376 (`const client = speakerClientRef.current`)
- Line 1511, 1541 (audio callbacks reading the ref)
- Any `clientRef.current?.setOutputMuted(...)` or similar method calls

- [ ] **Step 2: Rename `systemAudioClientRef` to `participantClientRef`**

In the same file, rename every `systemAudioClientRef` to `participantClientRef`:

```tsx
// Line 708:
const participantClientRef = useRef<IClient | null>(null);
```

Sweep:
- Line 744 (clearConversation)
- Line 1219 (`const systemClient = participantClientRef.current;` — also rename the local `systemClient` to `participantClient` for consistency)
- Line 1224 (`participantClientRef.current = null;`)
- Lines 1573, 1576, 1583 (creation in connectConversation)
- Line 2706-2711 (effect for participant active state)

- [ ] **Step 3: Run typecheck**

```bash
npm run test -- --run MainPanel  # if any MainPanel tests exist; if not, this is a no-op
```

Then verify the file still compiles:
```bash
npx tsc --noEmit
```
Expected: no new errors compared to baseline.

- [ ] **Step 4: Smoke-test the build**

```bash
npm run build 2>&1 | tail -20
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
refactor(mainpanel): rename client refs for channel symmetry

clientRef → speakerClientRef
systemAudioClientRef → participantClientRef

Mechanical rename to match the symmetric channel vocabulary. No
behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add channel-state derivation in MainPanel

Introduce `speakerWillStart`, `participantWillStart`, `anyChannelWillStart` (pre-start predicates) and `speakerChannelActive`, `participantChannelActive` (in-session per-channel flags). No gating yet — Task 4 wires the predicates into the start path.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Add useState for active flags**

Find the existing state declarations near line 310 (`const [isUsingWebRTC, setIsUsingWebRTC] = useState(false);`). Below that, add:

```tsx
// Per-channel active flags. Distinct from `isSessionActive` (which is true
// when at least one channel is up) so the UI can render channel-specific
// affordances (PTT button for speaker only, etc.).
const [speakerChannelActive, setSpeakerChannelActive] = useState(false);
const [participantChannelActive, setParticipantChannelActive] = useState(false);
```

- [ ] **Step 2: Add derived predicates via useMemo**

Find the `canStartSession` const near line 343. Just *above* it, add:

```tsx
// Channel start predicates — evaluated pre-start. Used by canStartSession
// and by connectConversation to decide which clients to create. Locked
// after Start (settings disable on isSessionActive).
const speakerWillStart = useMemo(
  () => isInputDeviceOn && !!selectedInputDevice,
  [isInputDeviceOn, selectedInputDevice]
);

const participantWillStart = useMemo(() => {
  if (!isSystemAudioCaptureEnabled) return false;
  if (isExtension()) return true;  // extension: tab capture, no device gate
  return !!selectedSystemAudioSource && isSystemAudioSourceReady;
}, [isSystemAudioCaptureEnabled, selectedSystemAudioSource, isSystemAudioSourceReady]);

const anyChannelWillStart = speakerWillStart || participantWillStart;
```

- [ ] **Step 3: Extend `canStartSession`**

Replace the existing `canStartSession` (line 343):

```tsx
const canStartSession = isApiKeyValid && availableModels.length > 0 &&
  !loadingModels && !isInitializing && hasValidBalance && anyChannelWillStart;
```

- [ ] **Step 4: Run build**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(mainpanel): add channel-state derivation

Introduces speakerWillStart, participantWillStart, anyChannelWillStart
predicates and speakerChannelActive / participantChannelActive flags.
canStartSession now requires at least one channel configured.

No behavior change in connect/disconnect yet — wired in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Gate speaker client creation on `speakerWillStart`

This is the architectural change. The speaker client and its audio-capture wiring move inside an `if (speakerWillStart)` block. The participant block stays as-is (it was already conditional). Per-channel active flags get set/reset.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Wrap speaker client creation and listener setup**

Find `connectConversation` around line 1273. The current flow (~lines 1357-1554) is:

```
get apiKey → get modelName → useWebRTC decision → createAIClient (speaker)
  → setupClientListeners → speaker connect logic
  → mic capture wiring → passthrough setup → monitor mute (WebRTC)
  → participant block (lines 1560-1625)
  → setIsSessionActive(true)
```

Wrap the speaker section in `if (speakerWillStart) { ... }`. Concretely:

Before the line `clientRef.current = createAIClient(modelName, apiKey, useWebRTC);` (line 1371, post-rename `speakerClientRef.current`), insert:

```tsx
if (speakerWillStart) {
```

Then close the block *after* the speaker's audio-quality interval setup (which is currently outside the speaker-specific code, so really the closing brace goes *before* the participant block at line 1560 or 1567 — examine carefully). The cleanest cut: close `if (speakerWillStart)` immediately before the comment `// Start participant audio client...` at line 1560.

Inside the block, after the speaker successfully `connect()`s, set the active flag. Find the `await client.connect(...)` call inside the speaker block (line ~1486 area) and add right after:

```tsx
setSpeakerChannelActive(true);
```

If `speakerWillStart` is false: no speaker client created, no `setupClientListeners()` call, no mic capture wiring, no passthrough setup, no native-capture WebRTC.

- [ ] **Step 2: Set `participantChannelActive(true)` on success**

Inside the existing `if (shouldCaptureParticipantAudio)` block (line ~1567), after the line `await participantClient.connect(participantSessionConfig);` (line 1585), add:

```tsx
setParticipantChannelActive(true);
```

- [ ] **Step 3: Update the no-channel error path**

At the start of `connectConversation`, after the initial validation, add an early-return guard:

```tsx
if (!speakerWillStart && !participantWillStart) {
  setIsInitializing(false);
  addRealtimeEvent(
    { type: 'session.init_error', data: { message: t('mainPanel.noChannelConfigured', 'Enable microphone or participant audio before starting.') } },
    'client', 'session.init_error'
  );
  return;
}
```

Place it directly after the existing local-inference validation block (around line 1291).

- [ ] **Step 4: Reset active flags in `disconnectConversation`**

In `disconnectConversation` (line 1130), inside the try block near the existing flag resets (line 1145-1149), add:

```tsx
setSpeakerChannelActive(false);
setParticipantChannelActive(false);
```

- [ ] **Step 5: Skip speaker-only side effects when speaker absent — passthrough effect**

The passthrough setup effect at line 623 unconditionally calls `audioService.setupPassthrough()`. When no speaker is active, this is pointless but harmless. Leave as-is for now (no regression risk).

- [ ] **Step 6: Skip speaker-only side effects when speaker absent — noise suppression effect**

At line 655, the noise suppression effect runs on `isSessionActive`. When only participant is active, this calls `getRecorder().setNoiseSuppressionMode()` on a recorder that wasn't started by the speaker channel. Guard it:

```tsx
useEffect(() => {
  if (!isSessionActive || !speakerChannelActive || !audioServiceRef.current) return;
  void audioServiceRef.current
    .getRecorder()
    .setNoiseSuppressionMode(noiseSuppressionMode)
    .catch((error: unknown) => {
      console.error('[Sokuji] [MainPanel] Failed to set noise suppression mode:', error);
    });
}, [noiseSuppressionMode, isSessionActive, speakerChannelActive]);
```

- [ ] **Step 7: Run build and confirm structure**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(mainpanel): gate speaker client creation on speakerWillStart

The speaker client and its audio-capture wiring now only run when a
mic device is selected and enabled. Sessions with only participant
audio configured no longer spin up an idle speaker client (saves
tokens on Kizuna AI and removes a wasted WebSocket).

Per-channel active flags (speakerChannelActive, participantChannelActive)
are set on successful connect and cleared in disconnectConversation.

No-channel start is now a clear init_error rather than a confused
half-startup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Gate PTT button visibility on `speakerChannelActive`

PTT only makes sense for the speaker channel — hide it in scenario 2.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Update basic-mode PTT button condition**

At line 3080:

```tsx
{isSessionActive && speakerChannelActive && canHoldToSpeak && (
  <button ...>
```

- [ ] **Step 2: Update advanced-mode PTT button condition**

At line 3141:

```tsx
{isSessionActive && speakerChannelActive && canHoldToSpeak && (
  <button ...>
```

- [ ] **Step 3: Guard the space-key handler**

Find the keyboard event handler (search for `canHoldToSpeak` in keyDown/keyUp logic — around line 2480). Add `speakerChannelActive` to the gate so pressing space in scenario 2 doesn't try to start recording.

```tsx
// Inside the keydown handler:
if (!canHoldToSpeak || !speakerChannelActive) return;
```

Adjust the dep array accordingly.

- [ ] **Step 4: Run build**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(mainpanel): hide PTT in participant-only sessions

PTT controls the user's voice channel and is meaningless when only
participant audio is being translated. Both basic and advanced footer
buttons, plus the space-key handler, now gate on speakerChannelActive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add `'participant'` navigation target

`SimpleSettings` already handles arbitrary nav targets generically (DOM id lookup). The participant section's current DOM id is `system-audio-section`. Add an alias `participant-section` so `navigateToSettings('participant')` lands on it.

**Files:**
- Modify: `src/components/Settings/sections/SystemAudioSection.tsx`

- [ ] **Step 1: Add participant id to the section root**

In `src/components/Settings/sections/SystemAudioSection.tsx`, find the div at line 196:

```tsx
<div className={`config-section ${className}`} id="system-audio-section">
```

Replace with:

```tsx
<div
  className={`config-section ${className}`}
  id="participant-section"
  data-section-aliases="system-audio-section"
>
```

The data attribute documents the legacy id for future readers; the lookup in `SimpleSettings.tsx:39-42` uses `document.getElementById`, which checks the primary id only — so the rename is safe.

- [ ] **Step 2: Verify no other code depends on `system-audio-section` id**

```bash
grep -rn "system-audio-section" src extension public 2>/dev/null | grep -v "extension/dist"
```
Expected: only the section file itself (now the alias data attribute) and any docs. If callers exist, update them to `participant`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/sections/SystemAudioSection.tsx
git commit -m "$(cat <<'EOF'
refactor(settings): rename participant section id to 'participant-section'

Sets up navigateToSettings('participant') for the new footer icon.
The old 'system-audio-section' id is preserved via data attribute for
documentation only — no consumer still references it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add participant icon to footer — basic mode

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Import the `AudioLines` icon**

In `src/components/MainPanel/MainPanel.tsx` line 2, add `AudioLines` to the lucide-react import:

```tsx
import {X, Zap, Mic, MicOff, Loader, Volume2, VolumeX, Wrench, Send, AlertCircle, MessageSquare, Trash2, AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown, Captions, Settings, AudioLines} from 'lucide-react';
```

- [ ] **Step 2: Insert participant icon between mic and speaker in basic-mode footer**

Find the basic-mode device-status block (lines 3061-3076). Between the mic-icon span (ends at line 3068) and the speaker-icon span (starts at line 3069), insert:

```tsx
<span
  className={`device-icon ${(isSessionActive ? participantChannelActive : participantWillStart) ? 'active' : ''} clickable`}
  onClick={() => navigateToSettings('participant')}
  title={t('simplePanel.clickToConfigParticipant', 'Click to configure participant audio')}
>
  <AudioLines size={14} />
</span>
```

The active state derives from `participantChannelActive` during a session and from `participantWillStart` pre-session, mirroring how the mic icon already uses `isInputDeviceOn` (which doubles as pre-start configured + in-session reflection of the same toggle).

- [ ] **Step 3: Add the new i18n key**

In `src/locales/en/translation.json`, locate the existing `simplePanel.clickToConfigMicrophone` and `simplePanel.clickToConfigSpeaker` entries. Add a sibling:

```json
"clickToConfigParticipant": "Click to configure participant audio",
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Manual visual check**

Run dev server and confirm the third icon appears between mic and speaker:
```bash
npm run dev
```
Open the app, basic mode (default), footer status row. Toggle the participant audio source on/off in settings — icon should reflect.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/locales/en/translation.json
git commit -m "$(cat <<'EOF'
feat(mainpanel): add participant audio icon to basic-mode footer

Surfaces the participant channel at the same visual rank as mic and
speaker. Clicking navigates to the participant audio section. Active
state reflects participantChannelActive in-session and
participantWillStart pre-session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add participant icon to footer — advanced mode

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/components/MainPanel/MainPanel.scss`

- [ ] **Step 1: Insert participant icon in advanced-mode footer**

Find the advanced-mode input-viz block (lines 3129-3138). Just after the `</div>` closing input-viz, add a new mini-block:

```tsx
<div className="participant-viz">
  <span
    className={`device-icon ${(isSessionActive ? participantChannelActive : participantWillStart) ? 'active' : ''} clickable`}
    onClick={() => navigateToSettings('participant')}
    title={t('mainPanel.participantAudio', 'Participant audio')}
  >
    <AudioLines size={14} />
  </span>
</div>
```

- [ ] **Step 2: Add corresponding SCSS**

In `src/components/MainPanel/MainPanel.scss`, find the `.control-footer.advanced` styles (search for `.input-viz` style block). Below the existing `.input-viz` styles, add:

```scss
.participant-viz {
  display: flex;
  align-items: center;
  margin: 0 8px;

  .device-icon {
    // Reuse the same sizing/animation as input-viz device-icon.
    // If a shared class is appropriate, prefer that; otherwise this matches.
  }
}
```

If existing rules already style `.device-icon` globally inside `.control-footer.advanced`, the new wrapper picks them up. Verify visually.

- [ ] **Step 3: Add i18n key**

In `src/locales/en/translation.json`, find the `mainPanel` object and add:

```json
"participantAudio": "Participant audio",
```

- [ ] **Step 4: Manual verification**

Switch to advanced mode in settings (uiMode toggle), confirm the participant icon appears between input viz and center controls.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.scss src/locales/en/translation.json
git commit -m "$(cat <<'EOF'
feat(mainpanel): add participant audio icon to advanced-mode footer

Mirrors the basic-mode change in the advanced footer layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Reorder SimpleSettings — participant audio between mic and speaker

**Files:**
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.tsx`

- [ ] **Step 1: Move `SystemAudioSection` above the speaker `AudioDeviceSection`**

Current order (lines 70-117 of `SimpleSettings.tsx`):

```
AccountSection
LanguageSection (UI)
LanguageSection (translation)
ProviderSection
AudioDeviceSection (microphone)
AudioDeviceSection (speaker)        ← currently here
SystemAudioSection                  ← currently below
HelpSection
```

Change to:

```
AccountSection
LanguageSection (UI)
LanguageSection (translation)
ProviderSection
AudioDeviceSection (microphone)     ← input 1
SystemAudioSection                  ← input 2 (moved up)
AudioDeviceSection (speaker)        ← output
HelpSection
```

Concrete edit — replace the block from line 93 to line 117 with:

```tsx
{/* Microphone Selection */}
<AudioDeviceSection
  isSessionActive={isSessionActive}
  showMicrophone={true}
  showSpeaker={false}
/>

{/* Participant Audio (system audio capture) */}
<SystemAudioSection
  isSessionActive={isSessionActive}
  isMonitorDeviceOn={isMonitorDeviceOn}
  onMutualExclusivity={() => setWarningType('mutual-exclusivity-participant')}
/>

{/* Speaker Selection */}
<AudioDeviceSection
  isSessionActive={isSessionActive}
  showMicrophone={false}
  showSpeaker={true}
  isSystemAudioEnabled={isSystemAudioCaptureEnabled}
  onSpeakerMutualExclusivity={() => setWarningType('mutual-exclusivity-speaker')}
/>

{/* Help & Updates */}
<HelpSection />
```

- [ ] **Step 2: Manual verification**

Run dev server, open settings panel in basic mode, confirm new order.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/SimpleSettings/SimpleSettings.tsx
git commit -m "$(cat <<'EOF'
refactor(settings): group inputs before output in SimpleSettings

Move SystemAudioSection (participant audio) above the speaker section
so the two input affordances (mic, participant) sit together and the
output (speaker) follows. Matches the symmetric channel UX where
participant audio is at the same rank as mic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Speech mode tooltip — clarify it only affects the speaker channel

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Add tooltip next to speech mode label**

The `settings.speechMode` label appears at lines 474 and 1053 (and likely a couple more for other providers). Locate each occurrence:

```bash
grep -n 't(.settings.speechMode' src/components/Settings/sections/ProviderSpecificSettings.tsx
```

For each occurrence, wrap or augment the label with a Tooltip. Existing pattern in the codebase (from `SystemAudioSection.tsx`):

```tsx
{t('settings.speechMode')}
<Tooltip
  content={t('settings.speechModeAppliesTo', 'Applies to your voice. Participant audio always uses semantic VAD.')}
  position="top"
  icon="help"
  maxWidth={280}
/>
```

Make sure `Tooltip` is already imported at the top of the file. If not:

```tsx
import Tooltip from '../../Tooltip/Tooltip';
```

- [ ] **Step 2: Add i18n key**

In `src/locales/en/translation.json`, find the `settings` object (around line 114). Add a sibling next to `speechMode`:

```json
"speechMode": "Speech Mode",
"speechModeAppliesTo": "Applies to your voice. Participant audio always uses semantic VAD.",
```

- [ ] **Step 3: Manual verification**

Open settings, find the speech mode label (visible in advanced settings or provider-specific settings depending on provider). Hover the help icon, confirm tooltip.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx src/locales/en/translation.json
git commit -m "$(cat <<'EOF'
docs(settings): clarify speech mode scope via tooltip

Speech mode (Auto / Normal / Semantic / PTT / Push-to-Translate) only
applies to the speaker channel. The participant channel is always
semantic VAD. Inline tooltip avoids surprising scenario 3 users
without cluttering the settings UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Empty-state hint when no channel configured

The new `canStartSession` gate disables the Start button if neither channel is configured. Add a tooltip so the user knows why.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Update basic-mode Start button tooltip**

The basic-mode Start button (line 3093-3121) currently has a `title` only for local-inference. Extend it to also cover the no-channel case:

```tsx
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
```

- [ ] **Step 2: Update advanced-mode Start button tooltip**

The advanced-mode button (line 3155-3209) renders a child `<span class="tooltip">` for various states. Add a new case for `!anyChannelWillStart` near the existing `!isApiKeyValid` block (line 3188):

```tsx
{!anyChannelWillStart && (
  <span className="tooltip">
    {t('mainPanel.noChannelConfigured', 'Enable microphone or participant audio before starting.')}
  </span>
)}
{!isApiKeyValid && anyChannelWillStart && (
  <span className="tooltip">
    {provider === Provider.LOCAL_INFERENCE
      ? t('mainPanel.localModelsRequired', 'Download required models in settings to start.')
      : t('mainPanel.apiKeyRequired')}
  </span>
)}
```

Order matters: `noChannelConfigured` should win if both gates fail, because it's the more fundamental blocker.

- [ ] **Step 3: Add i18n key**

In `src/locales/en/translation.json`, find the `mainPanel` object and add:

```json
"noChannelConfigured": "Enable microphone or participant audio before starting.",
```

- [ ] **Step 4: Manual verification**

Open the app, turn off mic via the device toggle, ensure participant audio is also off. Hover the disabled Start button. Tooltip should read the new string.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/locales/en/translation.json
git commit -m "$(cat <<'EOF'
feat(mainpanel): tooltip when no channel is configured

When both mic and participant audio are off, the Start button is
disabled. Surface the reason via tooltip in both basic and advanced
modes so the user knows they need to enable at least one source.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Analytics — add `channels` field

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Compute channel array at session start**

Inside `connectConversation`, just before `setIsSessionActive(true)` (line 1629), add:

```tsx
const channels: string[] = [];
if (speakerChannelActive) channels.push('speaker');
if (participantChannelActive) channels.push('participant');
```

Wait — those state setters are asynchronous; the `useState` value won't update mid-render. Use local boolean trackers instead. Refactor:

Inside the speaker block (Task 4), introduce a local `speakerStarted = false` flag set to true after `await client.connect(...)` succeeds. Similarly `participantStarted = false` in the participant block. Then build the analytics array from those locals:

```tsx
// Near the top of connectConversation:
let speakerStarted = false;
let participantStarted = false;

// Inside speaker `if` block, after successful connect:
speakerStarted = true;
setSpeakerChannelActive(true);

// Inside participant block, after successful connect:
participantStarted = true;
setParticipantChannelActive(true);

// Before setIsSessionActive(true):
const channels: string[] = [];
if (speakerStarted) channels.push('speaker');
if (participantStarted) channels.push('participant');
```

- [ ] **Step 2: Track session_started event with channels**

Locate any existing `trackEvent('session_started', ...)` or `trackEvent('connection_status', { status: 'connected', ... })` near the success path. If `session_started` doesn't exist as an event, add it right before `setIsSessionActive(true)`:

```tsx
trackEvent('session_started', {
  provider: provider || Provider.OPENAI,
  channels,                                   // ['speaker'], ['participant'], or both
  speech_mode: currentTurnDetectionMode,
});
```

If `connection_status` is already the event used, extend its payload at the existing call sites:

```tsx
trackEvent('connection_status', {
  status: 'connected',
  provider: provider || Provider.OPENAI,
  channels,
});
```

Use whichever event the codebase already tracks for session start; don't introduce two duplicate events.

- [ ] **Step 3: Verify event reaches PostHog (dev mode)**

```bash
npm run dev
```

Open the app, start a session with one channel only, open browser DevTools → Network → filter for posthog, find the `/e/` POST. Confirm `channels: ['speaker']` (or `['participant']`) in the payload. If analytics is disabled in dev, this step is informational only.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(analytics): track channels used per session

session_started (or connection_status) event now includes channels:
['speaker'] / ['participant'] / both. Enables distribution analysis
of scenario 1 vs 2 vs 3 usage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: End-to-end manual verification (three scenarios)

No code changes. This is a checklist the executor runs and reports back on.

**Files:**
- None

- [ ] **Step 1: Build the extension**

```bash
npm run build 2>&1 | tail -5
```
Expected: clean build.

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Scenario 1 — speaker only**

Settings:
- Microphone: ON, device selected
- Participant audio: OFF
- Speaker: ON (any device)

Click Start. Expect:
- Session starts.
- Footer mic icon active, participant icon dim, speaker icon active.
- PTT button visible if speech mode is PTT-like.
- DevTools Network: only one WebSocket / API connection for the provider (speaker).
- Speak; transcription and translation appear; assistant audio plays through speaker.
- Click Stop. Session ends cleanly.

- [ ] **Step 4: Scenario 2 — participant only**

Settings:
- Microphone: OFF (toggle off)
- Participant audio: ON, source/device selected
- Speaker: any state (irrelevant for participant — text-only)

Click Start. Expect:
- Session starts.
- Footer mic icon dim, participant icon active.
- PTT button NOT visible regardless of speech mode.
- DevTools Network: only one client connection (participant); NO speaker connection.
- On Kizuna AI: token balance does not deduct for an idle speaker.
- Play some external audio that the participant source can capture; subtitle should appear in conversation panel tagged as participant.
- Click Stop. Session ends cleanly.

- [ ] **Step 5: Scenario 3 — both**

Settings:
- Microphone: ON
- Participant audio: ON
- Speaker: ON (headphones recommended to avoid feedback)

Click Start. Expect:
- Session starts.
- All three footer icons active.
- Both speaker and participant clients connect.
- Speech mode tooltip shows the new "Applies to your voice..." string.
- Speak and play external audio; both transcriptions appear, source-tagged.

- [ ] **Step 6: No-channel state**

Turn off both mic and participant audio. Verify:
- Start button disabled.
- Tooltip on hover shows "Enable microphone or participant audio before starting."

- [ ] **Step 7: Mid-session crash regression**

During a scenario 3 session, simulate a participant client failure (e.g., kill network or stop the participant audio source). Expect:
- Existing symmetric teardown still fires.
- Session ends; both clients tear down.
- This matches current behavior — confirms no regression from the architectural change.

- [ ] **Step 8: No commit needed** — record results in PR description.

---

## Task 14: Stop at local commits

**STOP HERE.** Per `feedback-publish-actions-consent`, do NOT `git push`, do NOT open a PR. Summarize the local commits to the user and wait for their call on push / PR.

- [ ] **Step 1: Summarize local state**

Run:
```bash
git log --oneline origin/main..HEAD
git status --short
```

Report to the user:
- Branch name: `feat/symmetric-channel`
- Number of commits since `origin/main`
- Spec verification reminder
- Ask whether to push and (if so) whether to open a draft PR or stop at pushed branch

- [ ] **Step 2: Await user decision**

If user says push: `git push -u origin feat/symmetric-channel` (single command, no PR).
If user says open PR: that's a second, separate decision per the consent feedback.

---

## Coverage check

| Spec section | Tasks |
|---|---|
| Symmetric start (gate speaker on speakerWillStart) | Task 3, 4 |
| Channel composition locked at start | Task 4 (no mid-session toggling — existing settings disable on isSessionActive covers it) |
| Atomic teardown on crash | Existing behavior (no change), regression-tested in Task 13 Step 7 |
| Footer participant icon (basic + advanced) | Task 7, 8 |
| SimpleSettings reorder | Task 9 |
| PTT hidden in scenario 2 | Task 5 |
| Speech mode tooltip | Task 10 |
| Empty-state hint | Task 11 |
| Analytics channels field | Task 12 |
| Store rename (systemAudioItems → participantItems) | Task 1 |
| Client ref rename | Task 2 |
| Navigation target 'participant' | Task 6 |

| Spec acceptance criterion | Verified by |
|---|---|
| Start with only mic enabled | Task 13 Step 3 |
| Start with only participant source | Task 13 Step 4 |
| Start with both | Task 13 Step 5 |
| Start disabled when neither configured | Task 13 Step 6 |
| Footer participant icon present and navigates | Task 7, 8 + Task 13 Step 3-5 |
| SimpleSettings new order | Task 9 |
| PTT hidden in scenario 2 | Task 13 Step 4 |
| Mid-session locked settings | Existing isSessionActive disable (unchanged) |
| Mid-session crash teardown | Task 13 Step 7 |
| Analytics channels array | Task 12 Step 3 |
| Scenario 1 unaffected | Task 13 Step 3 |
