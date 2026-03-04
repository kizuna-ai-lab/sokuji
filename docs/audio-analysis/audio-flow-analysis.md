# Eburon Audio Flow Path Analysis (Updated)

## 1. Modern Audio Flow Path Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Eburon Modern Audio Flow                              │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Physical     │    │ModernAudioRecorder│   │   AI Client     │    │ModernAudioPlayer│
│  Microphone   │───▶│   (Recording)   │───▶│   (Processing)  │───▶│   (Playback)    │
└───────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
        ▲                       │                                            │
        │                       │                                            ▼
        │                       ▼                                   ┌─────────────────┐
        │            ┌─────────────────┐                          │ Monitor Device  │
        │            │  Passthrough    │◀─────────────────────────│ (Speakers/      │
        │            │  (Real Voice)   │                          │  Headphones)    │
        │            └─────────────────┘                          └─────────────────┘
        │                       │
        │            [Echo Cancellation Applied]
        └───────────────────────┘
```

## 2. Detailed Technical Flow Diagram

```
┌─────────────┐
│ User Speech │
└─────┬───────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            INPUT PROCESSING (ModernAudioRecorder)                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ navigator.mediaDevices.getUserMedia({                                              │
│   audio: {                                                                         │
│     echoCancellation: true,        // ✅ Effective with modern implementation     │
│     echoCancellationType: 'system', // ✅ Chrome M68+ system-level AEC           │
│     suppressLocalAudioPlayback: true, // ✅ Now effective!                       │
│     noiseSuppression: true,                                                       │
│     autoGainControl: true                                                         │
│   }                                                                                │
│ })                                                                                 │
└─────┬───────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          ModernAudioRecorder PROCESSING                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ MediaStreamSource → ScriptProcessor → Real-time PCM processing                     │
│                                                                                     │
│ scriptProcessor.onaudioprocess = (event) => {                                      │
│   const pcmData = convertToPCM16(inputData);                                      │
│                                                                                     │
│   // Optional passthrough (safety checks removed per user request)                 │
│   if (passthroughEnabled) {                                                       │
│     passthroughPlayer.addToPassthroughBuffer(pcmData, passthroughVolume);        │
│   }                                                                                │
│                                                                                     │
│   // Send to AI                                                                    │
│   if (onAudioData) onAudioData({ mono: pcmData });                               │
│ };                                                                                 │
└─────┬─────────────────────────────────────┬─────────────────────────────────────────┘
      │                                     │
      │ (Send to AI)                        │ (Optional Passthrough)
      ▼                                     ▼
┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
│        AI CLIENT                   │   │     PASSTHROUGH PATH                │
├─────────────────────────────────────┤   ├─────────────────────────────────────┤
│ client.appendInputAudio(data.mono)  │   │ Features:                           │
│                                     │   │ - Direct passthrough when enabled   │
│ ↓ Process and generate response     │   │ - Volume control (0-100%)           │
│                                     │   │ - Default volume: 30%               │
│ onConversationUpdated: ({ delta })  │   │                                     │
│ audioService.addAudioData(delta.audio)│ │ ↓ Queue-based playback             │
└─────────────────────────────────────┘   └─────────────────────────────────────┘
      │                                     │
      │ (AI response audio)                 │
      ▼                                     │
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        ModernAudioPlayer PROCESSING                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Queue-based audio management with event-driven playback                            │
│                                                                                     │
│ addStreamingAudio(audioData, trackId) {                                            │
│   // Accumulate chunks to prevent choppy playback                                 │
│   accumulateChunk(trackId, buffer, volume);                                       │
│   checkAndTriggerPlayback(trackId); // Play when buffer is ready                  │
│ }                                                                                  │
│                                                                                     │
│ playAudio(trackId, buffer, volume) {                                              │
│   const audio = new Audio(wavBlob);                                                │
│   connectToAnalyser(audio); // For visualization                                  │
│   audio.play();                                                                    │
│   audio.onended = () => processQueue(trackId); // Event-driven queue processing   │
│ }                                                                                  │
└─────┬───────────────────────────────────────────────────────────────────────────────┘
      │
      │ (Playback to monitor device)
      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MONITOR DEVICE OUTPUT                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ AudioContext.destination → Selected Monitor Device                                  │
│                                                                                     │
│ - Global volume control via GainNode                                               │
│ - Monitor on/off switch (volume 0 or 1)                                           │
│ - Device switching via AudioContext.setSinkId()                                    │
│                                                                                     │
│ 🔊 Output includes:                                                               │
│ - AI translated audio                                                              │
│ - Optional passthrough audio (if enabled and safe)                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Echo Cancellation Improvements

### Modern Echo Cancellation Stack:
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    Modern Echo Cancellation Implementation                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ 1. System-Level AEC (echoCancellationType: 'system'):                             │
│    - Uses OS-level echo cancellation                                              │
│    - More effective than browser-only AEC                                         │
│                                                                                     │
│ 2. suppressLocalAudioPlayback:                                                    │
│    - Now properly implemented in modern browsers                                   │
│    - Prevents local audio playback from being captured                            │
│                                                                                     │
│ 3. ScriptProcessor with Muted Output:                                             │
│    - Uses dummyGain node with gain.value = 0                                      │
│    - Prevents audio feedback while maintaining processing                          │
│                                                                                     │
│ 4. Passthrough Audio:                                                             │
│    - Direct passthrough when enabled by user                                      │
│    - No automatic safety checks (removed per user request)                        │
│    - User-controlled volume with default of 30%                                  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 4. Key Architecture Changes

### Old Architecture Issues:
- WavRecorder/WavStreamPlayer created feedback loops
- AudioWorklet-generated audio bypassed browser AEC
- No safety checks for passthrough
- Virtual devices complicated the audio path

### New Architecture Solutions:
- ✅ MediaRecorder API with proper echo cancellation
- ✅ HTMLAudioElement playback (AEC-friendly)
- ✅ Automatic safety checks for passthrough
- ✅ Simplified audio path without virtual devices
- ✅ Event-driven queue processing (no polling)

## 5. Audio Processing Components

### ModernAudioRecorder:
```javascript
// Key features:
- MediaStream with echo cancellation constraints
- ScriptProcessor for real-time PCM processing
- Configurable passthrough with safety checks
- Low-latency audio capture (20ms chunks)
```

### ModernAudioPlayer:
```javascript
// Key features:
- Queue-based chunk accumulation (100ms minimum)
- Event-driven playback (onended callbacks)
- Global volume control via GainNode
- Support for multiple concurrent tracks
```

## 6. Performance Optimizations

| Component | Old Implementation | New Implementation | Improvement |
|-----------|-------------------|-------------------|-------------|
| Recording | AudioWorklet polling | ScriptProcessor event-driven | Lower CPU usage |
| Playback | Continuous AudioWorklet | HTMLAudioElement with events | Better memory management |
| Echo Cancellation | Ineffective browser AEC | System-level AEC + safety checks | Eliminated echo issues |
| Device Management | Virtual devices via PulseAudio | Direct device selection + dynamic switching | Better flexibility |

## 7. Conclusion

The modern audio architecture successfully addresses the echo issues identified in the original analysis:

1. **Echo cancellation now works** thanks to proper API usage and system-level AEC
2. **Passthrough is user-controlled** without automatic safety checks
3. **Simplified architecture** without virtual devices improves reliability
4. **Better performance** through event-driven processing
5. **Cross-platform compatibility** by removing Linux-specific dependencies

The new implementation provides a robust, echo-free audio experience while maintaining all the original features.

## 8. Dynamic Device Switching

The modern architecture supports switching recording devices during active sessions:

### Implementation Details:
- `ModernBrowserAudioService.switchRecordingDevice()` method handles device changes
- Maintains recording state and callbacks during switch
- Tracks current device with `currentRecordingDeviceId`
- MainPanel detects device changes via React useEffect

### Best Practices:
- Use `deviceId` string in React dependencies, not full device objects
- Reset initialization flags when sessions end
- Handle errors gracefully with user feedback

This allows users to change microphones mid-session without interrupting translations.

## 9. Platform-Specific Differences: Electron vs Extension

### Architecture Overview

Both Electron and Extension environments use the same `ModernBrowserAudioService` implementation, but with key differences in audio routing:

#### Electron Environment:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Electron Audio Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ Physical Input → ModernAudioRecorder → AI Client → ModernAudioPlayer       │
│                     ↓                                  ↓                    │
│                  Passthrough                    Monitor Device              │
│                     ↓                           Virtual Speaker             │
│              Virtual Speaker                  (Eburon_Virtual_Speaker)      │
│                                                                             │
│ Key Features:                                                               │
│ - Supports virtual audio devices via PulseAudio (Linux)                    │
│ - Virtual speaker for system-wide audio injection                          │
│ - Direct audio routing without browser limitations                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Extension Environment:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Extension Audio Flow                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ Physical Input → ModernAudioRecorder → AI Client → ModernAudioPlayer       │
│                     ↓                                  ↓                    │
│                  Passthrough                    Monitor Device              │
│                     ↓                           Virtual Microphone          │
│               Virtual Microphone              (via sendPcmDataToTabs)       │
│                                                                             │
│ Key Features:                                                               │
│ - Virtual microphone via Chrome messaging API                              │
│ - Injects audio into web pages via content scripts                         │
│ - Browser security sandbox limitations                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Differences:

| Feature | Electron | Extension |
|---------|----------|-----------|
| Virtual Audio Devices | ✅ Eburon_Virtual_Speaker/Mic | ❌ Uses browser APIs |
| Virtual Output | Direct via PulseAudio | Chrome messaging to tabs |
| Passthrough Routing | Monitor + Virtual Speaker | Monitor + Virtual Microphone |
| Platform Support | Windows/macOS/Linux | Chrome/Edge browsers |
| Audio Injection | System-wide | Per-tab via content scripts |
| Security Model | Full system access | Browser sandbox |

### Implementation Details:

1. **Platform Detection**:
   ```javascript
   if (ServiceFactory.isElectron()) {
     // Initialize virtual speaker player
     this.virtualSpeakerPlayer = new ModernAudioPlayer({ sampleRate: 24000 });
   }
   ```

2. **Audio Routing**:
   - **AI-generated audio**: Both platforms use `addAudioData()` which:
     - Sends to monitor via `ModernAudioPlayer`
     - Sends to virtual speaker (Electron) or virtual microphone (Extension)
   
   - **Passthrough audio**: Via `handlePassthroughAudio()` which:
     - Sends to monitor with delay for echo cancellation (volume applied internally)
     - Sends to virtual speaker (Electron only, volume applied internally)
     - Sends to virtual microphone via `sendPcmDataToTabs()` (Extension, volume pre-applied)

3. **Virtual Microphone (Extension)**:
   - Uses `sendPcmDataToTabs()` to send PCM data
   - Chunks audio data for efficient messaging
   - Content scripts inject audio into web pages
   - Track IDs distinguish different audio sources
   - Passthrough audio (trackId='passthrough') plays immediately without queueing
   - Volume is pre-applied to passthrough audio before sending

4. **Virtual Speaker (Electron)**:
   - Auto-detects `Eburon_Virtual_Speaker` device
   - Direct audio output via Web Audio API
   - Not affected by monitor volume control

### Common Features:
- Same echo cancellation implementation
- Same recording and playback APIs
- Same AI client integration
- Same passthrough support with volume control
- Same dynamic device switching

### Recent Fixes (Extension Environment):
1. **Passthrough Audio to Virtual Microphone**: Fixed missing passthrough audio by adding `sendPcmDataToTabs()` call
2. **Immediate Playback**: Passthrough audio now plays immediately by recognizing 'passthrough' trackId as immediate
3. **Volume Control**: Fixed volume control by pre-applying volume to PCM data before sending to virtual microphone