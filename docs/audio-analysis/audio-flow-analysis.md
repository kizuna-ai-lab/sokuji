# Sokuji Audio Flow Path Analysis (Updated)

## 1. Modern Audio Flow Path Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Sokuji Modern Audio Flow                              │
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
│   // Optional passthrough with safety checks                                       │
│   if (passthroughEnabled && isSafeForPassthrough()) {                             │
│     passthroughPlayer.addToPassthroughBuffer(pcmData);                           │
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
│ client.appendInputAudio(data.mono)  │   │ Safety Checks:                      │
│                                     │   │ - Different input/output devices    │
│ ↓ Process and generate response     │   │ - No virtual devices as output      │
│                                     │   │ - Volume control (0-60%)            │
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
│ 4. Safety Checks for Passthrough:                                                 │
│    - Automatic detection of same input/output devices                             │
│    - Disables passthrough when feedback loop detected                             │
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
| Device Management | Virtual devices via PulseAudio | Direct device selection | Cross-platform compatibility |

## 7. Conclusion

The modern audio architecture successfully addresses the echo issues identified in the original analysis:

1. **Echo cancellation now works** thanks to proper API usage and system-level AEC
2. **Passthrough is safe** with automatic feedback detection
3. **Simplified architecture** without virtual devices improves reliability
4. **Better performance** through event-driven processing
5. **Cross-platform compatibility** by removing Linux-specific dependencies

The new implementation provides a robust, echo-free audio experience while maintaining all the original features.