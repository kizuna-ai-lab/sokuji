# System Audio Capture - Participant Translation Feature

This document describes the system audio capture feature that enables real-time translation of other meeting participants' audio.

## Overview

The participant translation feature allows Sokuji to capture and translate audio from other meeting participants in video conferencing environments. It uses a **dual-client architecture** where:

- **Speaker Client**: Translates the user's microphone input (source language → target language)
- **Participant Client**: Translates other participants' audio (target language → source language)

This enables bidirectional real-time translation in meetings without audio feedback loops.

## Platform Support

| Platform | Capture Method | Implementation |
|----------|---------------|----------------|
| **Electron (Linux)** | System loopback audio via PipeWire/PulseAudio | `LinuxLoopbackRecorder.ts` |
| **Electron (Windows)** | System loopback audio via desktopCapturer | `WindowsLoopbackRecorder.ts` |
| **Chrome Extension** | Chrome `tabCapture` API | `TabAudioRecorder.ts` |

> **Note**: Electron system audio capture supports Linux (PipeWire/PulseAudio) and Windows (desktopCapturer loopback). macOS support may be added in future releases.

## Architecture

### Dual-Client Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        Sokuji Application                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐      ┌──────────────────────┐        │
│  │    Speaker Client    │      │  Participant Client  │        │
│  │  (Primary AI Client) │      │ (Secondary AI Client)│        │
│  ├──────────────────────┤      ├──────────────────────┤        │
│  │ Source: Microphone   │      │ Source: System/Tab   │        │
│  │ Lang: Source→Target  │      │ Lang: Target→Source  │        │
│  │ Output: Audio (TTS)  │      │ Output: Text only    │        │
│  │ VAD: User setting    │      │ VAD: Semantic VAD    │        │
│  └──────────────────────┘      └──────────────────────┘        │
│           │                              │                      │
│           ▼                              ▼                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Combined Conversation Display                │  │
│  │         (Items tagged by source: speaker/participant)     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Audio Flow

#### Extension (Tab Capture)

```
Browser Tab Audio
       │
       ▼
┌─────────────────┐
│ Background.js   │ ─── chrome.tabCapture.getMediaStreamId()
└────────┬────────┘
         │ streamId
         ▼
┌─────────────────┐
│ TabAudioRecorder│ ─── getUserMedia({ chromeMediaSource: 'tab' })
├─────────────────┤
│ • AudioWorklet  │ ─── Processes PCM audio chunks
│ • Passthrough   │ ─── Restores audio to user (tab is muted by API)
└────────┬────────┘
         │ PCM Int16 @ 24kHz
         ▼
┌─────────────────┐
│ Participant     │
│ AI Client       │ ─── Transcription + Translation (text only)
└─────────────────┘
```

#### Electron (System Audio - Linux)

```
System Audio Output (PipeWire/PulseAudio Monitor)
       │
       ▼
┌───────────────────────┐
│ LinuxLoopbackRecorder │ ─── Captures loopback device
├───────────────────────┤
│ • No echo cancel      │ ─── Audio already processed
│ • No noise suppress   │
│ • AudioWorklet        │ ─── Processes PCM audio chunks
└─────────┬─────────────┘
          │ PCM Int16 @ 24kHz
          ▼
┌─────────────────┐
│ Participant     │
│ AI Client       │ ─── Transcription + Translation (text only)
└─────────────────┘
```

#### Electron (System Audio - Windows)

```
System Audio Output (desktopCapturer loopback)
       │
       ▼
┌─────────────────────────┐
│ WindowsLoopbackRecorder │ ─── getDisplayMedia() with loopback audio
├─────────────────────────┤
│ • No echo cancel        │ ─── Audio already processed
│ • No noise suppress     │
│ • AudioWorklet          │ ─── Processes PCM audio chunks
└─────────┬───────────────┘
          │ PCM Int16 @ 24kHz
          ▼
┌─────────────────┐
│ Participant     │
│ AI Client       │ ─── Transcription + Translation (text only)
└─────────────────┘
```

## Participant Client Configuration

The participant client is configured differently from the speaker client:

### Configuration Differences

| Setting | Speaker Client | Participant Client |
|---------|---------------|-------------------|
| **Language Direction** | `sourceLanguage → targetLanguage` | `targetLanguage → sourceLanguage` (swapped) |
| **Audio Output** | Enabled (TTS playback) | **Disabled** (`textOnly: true`) |
| **Turn Detection** | User's setting (Normal/Semantic/Disabled) | **Always `semantic_vad`** |
| **VAD Eagerness** | User's setting | **Fixed: `high`** |
| **Response Interruption** | Based on user setting | **Disabled** (`interruptResponse: false`) |

### Code Example

```typescript
// MainPanel.tsx - Participant session config creation
const swappedSystemInstructions = getProcessedSystemInstructions(true); // true = swap languages

const participantSessionConfig = {
  ...createSessionConfig(swappedSystemInstructions),
  textOnly: true,  // No audio output - text transcription only
  turnDetection: {
    type: 'semantic_vad' as const,
    createResponse: true,
    interruptResponse: false,
    eagerness: 'high',
  }
};

await participantClient.connect(participantSessionConfig);
```

### Language Swapping

The `getProcessedSystemInstructions(swapLanguages)` function in `settingsStore.ts` handles language swapping:

```typescript
// settingsStore.ts
getProcessedSystemInstructions: (swapLanguages = false) => {
  // ...
  const effectiveSource = swapLanguages ? targetLangName : sourceLangName;
  const effectiveTarget = swapLanguages ? sourceLangName : targetLangName;

  return templateSystemInstructions
    .replace(/\{\{SOURCE_LANGUAGE\}\}/g, effectiveSource)
    .replace(/\{\{TARGET_LANGUAGE\}\}/g, effectiveTarget);
}
```

This ensures that when the user speaks English (source) to be translated to Japanese (target), the participant client will translate Japanese (participant's language) to English (displayed to user).

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/modern-audio/TabAudioRecorder.ts` | Chrome extension tab audio capture using `tabCapture` API |
| `src/lib/modern-audio/LinuxLoopbackRecorder.ts` | Electron system loopback audio capture on Linux (PulseAudio/PipeWire) |
| `src/lib/modern-audio/WindowsLoopbackRecorder.ts` | Electron system loopback audio capture on Windows (desktopCapturer) |
| `src/lib/modern-audio/ModernBrowserAudioService.ts` | Audio service with `startTabAudioRecording()` and `startSystemAudioRecording()` methods |
| `src/components/MainPanel/MainPanel.tsx` | Dual-client session management and conversation display |
| `extension/background/background.js` | Background script for coordinating `chrome.tabCapture` API calls |
| `src/stores/audioStore.ts` | Audio device state including `participantAudioOutputDevice` |
| `src/stores/logStore.ts` | Dual-client logging with `ClientId` type (`'speaker' | 'participant'`) |
| `src/stores/settingsStore.ts` | `getProcessedSystemInstructions()` with language swap support |

## Implementation Details

### Tab Audio Capture (Extension)

The `TabAudioRecorder` class handles tab audio capture:

1. **Stream ID Acquisition**: Communicates with `background.js` to get a `streamId` via `chrome.tabCapture.getMediaStreamId()`

2. **Media Stream Creation**: Uses the stream ID with `getUserMedia()`:
   ```typescript
   navigator.mediaDevices.getUserMedia({
     audio: {
       mandatory: {
         chromeMediaSource: 'tab',
         chromeMediaSourceId: streamId
       }
     }
   });
   ```

3. **Audio Passthrough**: Chrome's `tabCapture` API mutes the captured tab. The recorder restores audio by connecting the source directly to the audio context destination:
   ```typescript
   this.mediaStreamSource.connect(this.audioContext.destination);
   ```

4. **Audio Processing**: Uses AudioWorklet (with ScriptProcessor fallback) to process audio chunks and send them to the AI client.

### System Audio Capture (Electron)

#### Linux (`LinuxLoopbackRecorder`)

1. **Device Selection**: Uses PipeWire/PulseAudio monitor sources (virtual microphone)

2. **No Processing**: Disables all audio processing since the audio is already processed:
   ```javascript
   echoCancellation: false,
   noiseSuppression: false,
   autoGainControl: false,
   ```

3. **Silent Output**: Uses a gain node with zero volume to keep audio processing active without audible output

#### Windows (`WindowsLoopbackRecorder`)

1. **Screen Capture API**: Uses `getDisplayMedia()` with loopback audio provided by `setDisplayMediaRequestHandler`

2. **Video Track Discard**: The video track is immediately stopped and removed (only audio is needed)

3. **No External Software**: Unlike VB-CABLE approach, uses native Electron desktopCapturer API

4. **User Interaction**: Screen picker dialog appears when starting capture (Windows requirement)

### Session Management

In `MainPanel.tsx`, the session lifecycle manages both clients:

#### Session Start (`connectConversation`)

1. Create and connect the speaker client (lines 624-741)
2. If system audio capture enabled:
   - Create participant client (lines 743-830 for Electron, 834-912 for Extension)
   - Configure with swapped languages and text-only mode
   - Start recording from system/tab audio source

#### Session End (`disconnectConversation`)

1. Stop system/tab audio recording
2. Disconnect both clients
3. Clear streaming tracks
4. Reset conversation items

### Conversation Display

Speaker and participant items are combined for display:

```typescript
// MainPanel.tsx
const combinedItems = useMemo(() => {
  const speakerItems = items.map(item => ({ ...item, source: 'speaker' }));
  const participantItems = systemAudioItems.map(item => ({ ...item, source: 'participant' }));

  return [...speakerItems, ...participantItems].sort((a, b) =>
    (a.createdAt || 0) - (b.createdAt || 0)
  );
}, [items, systemAudioItems]);
```

Items are visually distinguished in the UI with different labels ("You" vs "Participant").

## UI Components

### AudioPanel / SimpleConfigPanel

- Toggle to enable/disable system audio capture
- Output device selector (Extension only) for participant audio playback
- Mutual exclusivity warning when both speaker and participant audio sources overlap

### LogsPanel

- Separate tabs for "Speaker" and "Participant" client logs
- Each log entry tagged with `clientId: 'speaker' | 'participant'`

## Mutual Exclusivity

The feature includes safeguards to prevent audio feedback:

- If the user enables system audio capture with the same device as their speaker output, a warning modal appears
- The UI prevents selecting conflicting device combinations

## Related Commits

| Commit | Description |
|--------|-------------|
| `2a824b2` | Initial system audio capture for participant translation |
| `9742f60` | Add mutual exclusivity between Speaker and Participant Audio |
| `5bd1ec6` | Add i18n translations for mutual exclusivity modal |
| `4daf9ba` | Enhance with logs, conversation display, and text-only mode |
| `4af71c4` | Add tab audio capture for Chrome extension |
| `60bd7b4` | Improve tab capture and simplify AudioPanel UI |
| `98ae9b3` | Fix i18n text and clear participant conversation on session end |
| `3e14439` | Improve language selector labels for clarity |

## Limitations

1. **Platform Support**: System audio capture requires:
   - Linux: PipeWire or PulseAudio
   - Windows: Screen picker dialog (user must select a screen)
   - macOS: Not yet supported
2. **Extension Permissions**: Chrome extension requires `tabCapture` permission
3. **No Audio Output**: Participant translations are text-only to prevent feedback
4. **Same Provider**: Both speaker and participant clients use the same AI provider and model
