# Sokuji Audio Flow Path Analysis

## 1. Main Audio Flow Path Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  Sokuji Audio Flow                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Physical     │    │   wav_recorder  │    │   AI Client     │    │  wav_stream     │
│  Microphone   │───▶│   (Recording)   │───▶│   (Processing)  │───▶│   _player       │
└───────────────┘    └─────────────────┘    └─────────────────┘    │   (Playback)    │
        ▲                       │                                   └─────────────────┘
        │                       │                                            │
        │                       ▼                                            ▼
        │            ┌─────────────────┐                          ┌─────────────────┐
        │            │  Passthrough    │                          │   Physical      │
        │            │  (Real Voice)   │◀─────────────────────────│   Speakers      │
        │            └─────────────────┘                          └─────────────────┘
        │                       │
        │                       ▼
        │            ┌─────────────────┐
        └────────────│  ECHO FEEDBACK  │
                     │     LOOP        │
                     └─────────────────┘
```

## 2. Detailed Technical Flow Diagram

```
┌─────────────┐
│ User Speech │
└─────┬───────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            INPUT PROCESSING                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ navigator.mediaDevices.getUserMedia({                                              │
│   audio: {                                                                         │
│     echoCancellation: true,        // ✗ Ineffective - cannot process AudioWorklet │
│     suppressLocalAudioPlayback: true, // ✗ Ineffective - only works for <audio>  │
│     googEchoCancellation: true     // ✗ Ineffective - cannot identify programmatic│
│   }                                                                                │
│ })                                                                                 │
└─────┬───────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          WAV_RECORDER PROCESSING                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ MediaStreamSource → AudioWorkletNode(audio_processor) → data chunks               │
│                                                                                     │
│ processor.port.onmessage = (e) => {                                               │
│   if (event === 'chunk') {                                                        │
│     this.handlePassthrough(data);  // ← Immediate playback (ECHO SOURCE 1)       │
│     this._chunkProcessor(data);     // ← Send to AI                               │
│   }                                                                                │
│ };                                                                                 │
└─────┬─────────────────────────────────────┬─────────────────────────────────────────┘
      │                                     │
      │ (Send to AI)                        │ (Passthrough)
      ▼                                     ▼
┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
│        AI CLIENT                   │   │     PASSTHROUGH PATH                │
├─────────────────────────────────────┤   ├─────────────────────────────────────┤
│ client.appendInputAudio(data.mono)  │   │ if (_passthroughEnabled) {          │
│                                     │   │   _passthroughPlayer.addImmediatePCM│
│ ↓ Process and generate response     │   │   (data.mono, _passthroughVolume)   │
│                                     │   │ }                                   │
│ onConversationUpdated: ({ delta })  │   │                                     │
│ audioService.addAudioData(delta.audio)│ │ ↓ Immediate playback (ECHO SOURCE 1)│
└─────────────────────────────────────┘   └─────────────────────────────────────┘
      │                                     │
      │ (AI response audio)                 │
      ▼                                     │
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        WAV_STREAM_PLAYER PROCESSING                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ addAudioData(data) → wavStreamPlayer.add16BitPCM(data, trackId)                    │
│                                                                                     │
│ EnhancedWavStreamPlayer.add16BitPCM() {                                            │
│   const result = super.add16BitPCM(arrayBuffer, trackId, volume);                 │
│   this.audioService.sendPcmDataToTabs(result, trackId); // ← Send to virtual mic  │
│   return result;                                                                   │
│ }                                                                                  │
│                                                                                     │
│ streamNode = new AudioWorkletNode(context, 'stream_processor');                    │
│ streamNode.connect(context.destination); // ← Direct playback (ECHO SOURCE 2)     │
└─────┬─────────────────────────────────────┬─────────────────────────────────────────┘
      │                                     │
      │ (Playback to speakers)              │ (Send to virtual microphone)
      ▼                                     ▼
┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
│     PHYSICAL SPEAKERS               │   │   VIRTUAL MICROPHONE                │
├─────────────────────────────────────┤   ├─────────────────────────────────────┤
│ AudioContext.destination            │   │ sendPcmDataToTabs() →               │
│                                     │   │ virtual-microphone.js →             │
│ ↓ Audio output to physical environment│  │ Meeting apps (Zoom/Meet/Teams)      │
│                                     │   │                                     │
│ 🔊 Speaker plays:                   │   │ 🎤 Virtual microphone outputs:     │
│ - AI response audio (ECHO SOURCE 2) │   │ - AI translation audio              │
│ - User original voice (from Passthrough)│ │ - User original voice (if enabled) │
└─────────────────────────────────────┘   └─────────────────────────────────────┘
      │
      │ (Acoustic feedback)
      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              ECHO FEEDBACK LOOPS                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ 🔄 LOOP 1 - Passthrough Echo (Immediate echo):                                     │
│ User speaks → wav_recorder → handlePassthrough → wav_stream_player →               │
│ Speakers → Microphone captures → wav_recorder → handlePassthrough (cycles)        │
│                                                                                     │
│ 🔄 LOOP 2 - AI Response Echo (AI response echo):                                   │
│ User speaks → AI processing → wav_stream_player plays AI response →                │
│ Speakers → Microphone captures AI response → Sent as new input to AI              │
│                                                                                     │
│ 🔄 LOOP 3 - Cumulative Echo (Cumulative echo):                                     │
│ Multiple LOOP 1 + LOOP 2 → Audio quality gradually degrades → Delay accumulates   │
│ → Volume may amplify                                                               │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Echo Source Analysis

### ECHO SOURCE 1: Real Voice Passthrough
```
Location: wav_recorder.js:102-112
Trigger: Every recording chunk
Delay: ~20ms (real-time)
Impact: Immediate echo of own voice
```

### ECHO SOURCE 2: AI Response Audio
```
Location: wav_stream_player.js:78
Trigger: AI response playback
Delay: ~500-2000ms (depends on AI processing time)
Impact: AI responses include echo from previous conversation
```

## 4. Why Browser AEC Fails

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                       Why Browser AEC Cannot Work                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ Standard AEC Working Principle:                                                     │
│ ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                              │
│ │ Microphone  │───▶│  AEC        │───▶│ Clean Audio │                              │
│ │ Input       │    │ Algorithm   │    └─────────────┘                              │
│ └─────────────┘    │             │                                                 │
│                    │ Reference   │                                                 │
│ ┌─────────────┐    │ Signal ↑    │                                                 │
│ │ Speaker     │────┘             │                                                 │
│ │ Output      │    └─────────────┘                                                 │
│ └─────────────┘                                                                    │
│                                                                                     │
│ Sokuji Actual Situation:                                                           │
│ ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                              │
│ │ Microphone  │───▶│ Browser AEC │───▶│ Still Has   │                              │
│ │ Input       │    │             │    │ Echo        │                              │
│ └─────────────┘    │             │    └─────────────┘                              │
│                    │ Reference   │                                                 │
│ ┌─────────────┐    │ Signal      │                                                 │
│ │AudioWorkletNode│ │ ✗ Cannot    │                                                 │
│ │Generated Audio│  │ Identify    │                                                 │
│ └─────────────┘────┘             │                                                 │
│                    └─────────────┘                                                 │
│                                                                                     │
│ Key Issues:                                                                         │
│ • AudioWorkletNode generated audio is invisible to browser AEC                     │
│ • suppressLocalAudioPlayback only works for <audio>/<video> elements               │
│ • echoCancellation cannot process programmatically generated audio                 │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## 5. Speaker Mode vs Headphone Mode

### Speaker Mode (Problem Mode):
```
┌─────────────┐         ┌─────────────┐
│  Microphone │  Air     │  Speakers   │
│     🎤      │◀─────────│     🔊     │
└─────────────┘ Acoustic └─────────────┘
                Feedback       ↑
                             │ 
                    ┌─────────────────┐
                    │ wav_stream_player│
                    └─────────────────┘
                             
Result: Physical acoustic feedback + Digital audio feedback = Double echo
```

### Headphone Mode (Solution):
```
┌─────────────┐         ┌─────────────┐
│  Microphone │   ✗     │  Headphones │
│     🎤      │ Physical│     🎧     │
└─────────────┘ Isolation└─────────────┘
                             ↑
                             │ 
                    ┌─────────────────┐
                    │ wav_stream_player│
                    └─────────────────┘
                             
Result: Physical feedback blocked, only need to handle software Passthrough
```

## 6. Solution Comparison

| Solution | Implementation Complexity | Effectiveness | Performance Impact | Recommendation |
|----------|---------------------------|---------------|-------------------|----------------|
| Headphone Usage | None (user behavior) | ✅ 100% effective | None | ⭐⭐⭐⭐⭐ |
| Disable Passthrough | Low (configuration option) | ✅ Partially effective | None | ⭐⭐⭐⭐ |
| Software AEC | High (algorithm implementation) | ❓ Uncertain effectiveness | High CPU usage | ⭐⭐ |
| Architecture Refactor | Very High (rewrite audio chain) | ✅ Possibly effective | High | ⭐ |

## 7. Technical Implementation Details

### wav_recorder Audio Processing Chain:
```javascript
// Location: wav_recorder.js:358-388
const constraints = {
  audio: {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    sampleRate: this.sampleRate,
    // These constraints are INEFFECTIVE for AudioWorklet-generated audio
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    suppressLocalAudioPlayback: true,
    googEchoCancellation: true,
    // ... other Google-specific constraints
  }
};
```

### wav_stream_player Audio Output Chain:
```javascript
// Location: wav_stream_player.js:77-78
const streamNode = new AudioWorkletNode(this.context, 'stream_processor');
streamNode.connect(this.context.destination); // Direct speaker output - NO AEC REFERENCE
```

### Real Voice Passthrough Mechanism:
```javascript
// Location: wav_recorder.js:102-112
handlePassthrough(data) {
  if (this._passthroughEnabled && this._passthroughPlayer && data.mono) {
    // IMMEDIATE PLAYBACK - Creates instant feedback loop
    this._passthroughPlayer.addImmediatePCM(data.mono, this._passthroughVolume);
  }
}
```

### Enhanced Player with Virtual Microphone:
```javascript
// Location: BrowserAudioService.ts:23-32
add16BitPCM(arrayBuffer: ArrayBuffer | Int16Array, trackId: string = 'default', volume: number = 1.0): Int16Array {
  const result = super.add16BitPCM(arrayBuffer, trackId, volume); // Play to speakers
  this.audioService.sendPcmDataToTabs(result, trackId);          // Send to virtual mic
  return result;
}
```

## 8. Conclusion

This technical analysis confirms that:

1. **The combination of wav_recorder and wav_stream_player creates multiple echo feedback loops**
2. **Real Voice Passthrough mechanism is the primary echo amplifier**
3. **Browser built-in echo cancellation is completely ineffective for this architecture**
4. **Headphone solution is the most reliable and practical approach**
5. **Software AEC solutions would require major architectural changes with uncertain effectiveness**

The analysis validates that GitHub issue #55's assessment is completely accurate: recommending headphone usage is the most practical solution for speaker mode echo elimination.