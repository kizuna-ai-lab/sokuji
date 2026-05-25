# Symmetric Channel Architecture — Design

**Date:** 2026-05-22
**Status:** Draft
**Scope:** Decouple speaker and participant client lifecycle so either can be the sole channel of a session, and lift participant audio's UX visibility to match the speaker channel.

## Problem

Sokuji's session model assumes the user is being translated *out* to others (scenario 1). Two consequences:

1. **Architectural coupling.** `connectConversation()` in `MainPanel.tsx:1273` always creates the speaker client (`clientRef`), regardless of whether the user actually needs their own voice translated. The participant client (`systemAudioClientRef`) is bolted on conditionally. Three impacts:
   - Scenario 2 (only translate other participants) wastes a client connection. For Kizuna AI this means billed token usage on a channel the user never wanted.
   - The "session is active" concept is implicitly tied to "speaker client is connected", leaking through condition checks (`canStartSession`, footer enable state, PTT visibility).
   - Code reads as if speaker is mandatory and participant is an add-on, when the product needs them to be peers.

2. **Buried UX.** Participant audio is the *last* configurable section in `SimpleSettings.tsx`, after Account / UI Lang / Translation Lang / Provider / Mic / Speaker. The footer status row in `MainPanel.tsx` has clickable icons for mic and speaker but **none** for participant audio. Users who primarily want subtitles for a foreign-language meeting (scenario 2 / 3) have no top-level affordance pointing to the feature.

The product reality is that translating other participants' speech is at least as common as translating the user's own speech. The architecture and UI should treat the two channels as equals.

## Scenarios

Three scenarios drive the design. They are not modes the user picks explicitly — they emerge from which input sources the user enables before starting.

| | Scenario 1: Speaker only | Scenario 2: Participant only | Scenario 3: Both |
|---|---|---|---|
| **Use case** | User speaks in a foreign meeting; others hear translation | User attends a foreign meeting; reads subtitles | Bidirectional 1:1 or small-group |
| **Speaker client** | ON | **OFF** | ON |
| **Participant client** | OFF | ON | ON |
| **Mic required** | Yes | No | Yes |
| **Speaker monitor required** | Optional (self-monitor) | No (text-only subtitles) | Yes (hear translation) |
| **System audio source required** | No | Yes | Yes |
| **PTT button** | If user picks PTT-like mode | Never shown | If user picks PTT-like mode (speaker only) |
| **Output destination** | Virtual mic + optional monitor | Subtitles only | Virtual mic + monitor |
| **Mutual exclusivity (Electron speaker out ↔ system audio capture)** | N/A (no participant capture) | N/A (no monitor output) | Applies (current warning behavior retained) |

Scenario 2 is the new first-class scenario. The participant client is already `textOnly: true` in `createParticipantSessionConfig` (`MainPanel.tsx:501`), so no audio output plumbing needs to change to support it.

## Goals

1. Either client can be the sole client of a session — speaker, participant, or both.
2. Channel composition is locked at start. No mid-session addition or removal of a channel.
3. If any client closes unexpectedly mid-session, the entire session ends (atomic teardown — matches current behavior, simpler than per-channel survival).
4. Footer surfaces participant audio at the same visual rank as mic and speaker.
5. `SimpleSettings` reorders so participant audio sits with the other *input* affordances (mic), not below the *output* (speaker).
6. No new "mode selector" UI. The user expresses intent by configuring sources; the architecture derives which clients to start.

## Non-Goals

- No mid-session channel toggling.
- No language UI rework. Current "source language / target language" remains user-centric ("I speak source, others hear target"); the participant client continues to swap internally via `createParticipantSessionConfig`.
- No change to the speaker output ↔ system audio capture mutual exclusivity warning on Electron. That feedback-loop protection is orthogonal and stays as-is.
- No survival of one channel when the other crashes (out of scope, may revisit if users report lost participant transcripts after speaker disconnects).
- No new audio playback for participant translations (participant remains text-only).

## Design

### Channel concept

Two channels with shared lifecycle vocabulary:

| Channel | Source enable predicate | Client ref | Purpose |
|---|---|---|---|
| **Speaker** | `isInputDeviceOn && selectedInputDevice` | `speakerClientRef` (renamed from `clientRef`) | Translate user's voice for others |
| **Participant** | `isSystemAudioCaptureEnabled && (extension OR (electron && selectedSystemAudioSource && isSystemAudioSourceReady))` | `participantClientRef` (renamed from `systemAudioClientRef`) | Translate other participants' audio into subtitles |

Derived state at the session level:

```
speakerWillStart      = speakerConfigured   (computed pre-start)
participantWillStart  = participantConfigured (computed pre-start)
anyChannelWillStart   = speakerWillStart || participantWillStart
```

`canStartSession` gains `&& anyChannelWillStart` (in addition to current API key / model / quota gates).

During a session, two refs track *which channels are actually running*:

```
speakerChannelActive     = speakerClientRef.current !== null
participantChannelActive = participantClientRef.current !== null
isSessionActive          = speakerChannelActive || participantChannelActive (existing semantics, re-derived)
```

These are read by UI for footer icon states, PTT button visibility, and waveform rendering.

### `connectConversation` refactor

Current flow (simplified):

```
validate → init audio → resolve apiKey/model → create speaker client
  → setup speaker listeners → connect speaker → wire mic capture
  → (if participant configured) create+connect participant client → wire capture
  → setIsSessionActive(true)
```

New flow:

```
validate → init audio → resolve apiKey/model
  → if speakerWillStart:
      create speaker client, listeners, connect, wire mic capture, mute/passthrough
  → if participantWillStart:
      create participant client, listeners, connect, wire participant capture
  → setIsSessionActive(true) iff at least one client connected
```

Speaker-only side effects (passthrough setup, monitor mute, PTT recorder priming) move inside the `if (speakerWillStart)` branch. The native-capture WebRTC path (`usesNativeCapture`) is speaker-only and stays inside that branch.

The initialization-failure catch already calls `disconnectConversation()`, which now must tolerate either client being absent (covered in the next section).

### `disconnectConversation` refactor

Current code already null-checks both refs before disconnecting — it works for the "speaker present, participant absent" case. Two adjustments:

1. **Per-client teardown is independent of the *other* client.** Current code is already structured this way (each ref is checked and disconnected separately).
2. **The atomic-teardown invariant moves into the `onClose` handlers, not into `disconnectConversation` itself.** Both `setupClientListeners` (speaker) and `createParticipantEventHandlers` (participant) already route through `disconnectConversationRef.current?.()` on `onClose`. Keep that. The re-entry guard `disconnectInProgressRef` handles the cascade.

The cleanup for audio quality intervals, WebRTC state, and refetchAll remain at the session level.

### `setupClientListeners` (speaker)

No behavioral change required. The function is renamed conceptually to "speaker client listeners" but the existing implementation handles speaker semantics correctly. The `onConversationUpdated` audio-delta path (line 1038) is speaker-only and stays.

### `createParticipantEventHandlers`

Unchanged. Already handles participant-only concerns (text-only, source tagging, symmetric teardown via `disconnectConversationRef`).

### State / naming changes

| Old | New | File | Reason |
|---|---|---|---|
| `clientRef` | `speakerClientRef` | `MainPanel.tsx:705` | Symmetry with `participantClientRef` |
| `systemAudioClientRef` | `participantClientRef` | `MainPanel.tsx:708` | "System audio" describes the source on Electron; "participant" is the cross-environment concept (extension uses tab capture) |
| `systemAudioItems` / `setSystemAudioItems` | `participantItems` / `setParticipantItems` | `MainPanel.tsx:724` | Same reason |
| `setStoreSystemAudioItems` | `setStoreParticipantItems` | `MainPanel.tsx:283`, `sessionStore.ts` | Same reason |
| `useSetSystemAudioItems` | `useSetParticipantItems` | `sessionStore.ts` | Same reason |

`isSystemAudioCaptureEnabled` is an *audio source* toggle, not a client identifier — keep that name. The store actions `toggleSystemAudioCapture`, `connectSystemAudioSource`, `disconnectSystemAudioSource` describe audio service operations, not client lifecycle — keep those names too.

The `systemAudioClientRef.current?.clearConversationItems()` reference in `clearConversation` (`MainPanel.tsx:744`) and the conversation-merge logic (`combinedItems`, `MainPanel.tsx:770`) need the rename but no logic change.

### UI changes

**Footer status row — basic mode** (`MainPanel.tsx:3061-3076`): add a third device icon between mic and speaker:

```
[mic icon: navigateToSettings('microphone')]
[participant icon: navigateToSettings('participant')]   ← new
[speaker icon: navigateToSettings('speaker')]
```

Icon state:
- Active when channel is configured (pre-session) or running (in-session). Reuses existing `device-icon active` class.
- Click navigates to settings with `'participant'` highlight target.
- Icon: `AudioLines` (already used by `SystemAudioSection.tsx`).

**Footer status row — advanced mode** (`MainPanel.tsx:3127-3241`): the input/output viz are flanked by mic/speaker icons today. Add the participant icon in a small group with the mic icon (both are *inputs*). Exact placement:

```
[input-viz: mic icon + waveform]
[input-viz-aux: participant icon]   ← new
[center-controls: PTT + Start/Stop]
[output-viz: waveform + speaker icon]
```

The participant icon does not need a waveform (participant audio is captured but not visualized in the existing canvas pair; we can add visualization later if requested).

**Settings reorder** (`SimpleSettings.tsx:71-117`): place participant audio with the other input affordance, not below the output:

```
AccountSection
LanguageSection (UI)
LanguageSection (translation)
ProviderSection
AudioDeviceSection (microphone)            ← input 1
SystemAudioSection (participant audio)     ← input 2 (was below speaker)
AudioDeviceSection (speaker)               ← output
HelpSection
```

Both inputs sit before the output. The `'participant'` navigation target maps to `SystemAudioSection`'s existing `id="system-audio-section"` — add an alias or rename to `id="participant-section"` (and update navigation targets in any onboarding hint).

**PTT button visibility** (`MainPanel.tsx:3080`, `3141`): guard on `speakerChannelActive`:

```js
{isSessionActive && speakerChannelActive && canHoldToSpeak && (...)}
```

PTT controls the user's own voice — irrelevant in scenario 2.

**Empty-state hint** when no channel is configured and the user hovers/clicks Start: tooltip "Enable mic or participant audio to start" (string key `mainPanel.noChannelConfigured`).

**Onboarding**: existing onboarding focuses on scenario 1. Out of scope for this design — file a follow-up task to add a scenario 2 walkthrough.

### Speech Mode tooltip

In Scenario 3, the speech mode setting (Auto / Semantic / PTT / Push-to-Translate) applies only to the speaker channel; the participant channel is always `semantic_vad`. Add a small inline tooltip on the speech mode label:

> "Applies to your voice. Participant audio always uses semantic VAD."

(Localization key: `settings.speechModeAppliesTo`.)

This is a one-liner with no behavior change.

### Analytics

Extend the `connection_status` event (currently tracked at session start and `onClose`) with channel composition:

```
{ status: 'connected', provider, channels: ['speaker' | 'participant' | both] }
```

And a new `session_started` event field `channels` to track scenario distribution.

## Affected files

| File | Change |
|---|---|
| `src/components/MainPanel/MainPanel.tsx` | Rename refs/state, gate speaker creation, PTT visibility, footer icon |
| `src/components/Settings/SimpleSettings/SimpleSettings.tsx` | Reorder sections |
| `src/components/Settings/sections/SystemAudioSection.tsx` | DOM id alias, no behavior change |
| `src/stores/sessionStore.ts` | Rename `systemAudioItems` → `participantItems` and selector hooks |
| `src/stores/settingsStore.ts` | Navigation target enum gains `'participant'` if not already present |
| `src/lib/analytics.ts` | Add `channels` field to relevant events |
| `src/locales/*/translation.json` | New strings for tooltip and empty-state |
| `src/components/MainPanel/MainPanel.scss` | Style for third footer icon if spacing needs tweaking |

## Edge cases

1. **User configures only participant audio, then changes mind after Start.** The Mic icon in the footer is clickable but navigates to settings, where the mic section is disabled while session is active. User must Stop, enable mic, Start again. Acceptable.

2. **`isInputDeviceOn` is on but no mic device selected.** `speakerWillStart` is false (predicate requires both). Start button gates on this correctly.

3. **Extension scenario 2 with no audio passthrough output picked.** Extension's `SystemAudioSection` allows toggling capture without picking a passthrough device. Capture still works; user just doesn't hear the original audio. Fine.

4. **Speaker initialization fails after participant succeeds.** Current code uses a single try/catch around the whole `connectConversation`; failure calls `disconnectConversation()`. With the refactor, if speaker creation throws after participant has connected, the catch still calls `disconnectConversation()` which tears down both. Acceptable — atomic session.

5. **Participant initialization fails (non-GPU-OOM) after speaker succeeded.** Current code logs and continues with speaker only. The user got *less* than they asked for. Keep this behavior (it's strictly better than tearing down speaker too). The participant icon in the footer will reflect "not active". *Note:* this is a deviation from "atomic teardown" — but it only applies to failure at *start*, not mid-session. Acceptable.

6. **Test paths.** `MainPanel.tsx` has no direct test today (it's the main integration surface). `sessionStore.ts` rename will require updating `sessionStore.test.ts` and `sessionPortMirror.test.ts` if they reference `systemAudioItems`. Verify and update.

## Acceptance criteria

- [ ] Start with only mic enabled (no participant source): only speaker client created, no participant network traffic, no participant token usage on Kizuna AI.
- [ ] Start with only participant source enabled (mic off or no device): only participant client created, no speaker client, no mic capture started.
- [ ] Start with both enabled: both clients connect, behavior identical to current "scenario 3".
- [ ] Start button disabled when neither source is configured.
- [ ] Footer in basic mode shows participant icon between mic and speaker; clicking navigates to participant settings; active state matches `participantChannelActive` during session and `participantWillStart` pre-session.
- [ ] `SimpleSettings` shows participant audio section between mic and speaker.
- [ ] PTT button does not appear in scenario 2.
- [ ] Mid-session: footer icons reflect locked state — clicking them navigates but settings are disabled.
- [ ] Mid-session crash of either client tears down the whole session (regression check on current behavior).
- [ ] Analytics event includes `channels` array.
- [ ] Existing scenario 1 user flow unaffected.

## Out of scope / future work

- Scenario 2 audio output for participant translation (TTS playback of subtitles).
- Per-channel session survival on crash.
- Onboarding for scenarios 2 and 3.
- Revisiting the speaker-output ↔ system-audio-capture mutual exclusivity warning with smarter detection (e.g., allow when monitor device is a headphone).
- Multi-source participant capture (e.g., two separate meeting tabs).
