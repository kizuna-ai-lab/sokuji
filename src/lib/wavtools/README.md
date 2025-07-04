# WavTools Library

This library provides audio recording and streaming capabilities for the Sokuji application.

## Components

### WavRecorder

Records live audio from microphone and provides real-time audio passthrough functionality.

```javascript
import { WavRecorder } from './lib/wavtools';

const recorder = new WavRecorder({ sampleRate: 24000 });
```

### WavStreamPlayer

Plays audio streams with support for both queued and parallel playback.

```javascript
import { WavStreamPlayer } from './lib/wavtools';

const player = new WavStreamPlayer({ sampleRate: 24000 });
await player.connect();
```

## Real-time Audio Passthrough

The WavRecorder now supports real-time audio passthrough to a WavStreamPlayer with volume control. This allows recording audio from a microphone and simultaneously playing it through speakers with adjustable volume.

The implementation uses unique trackIds for each audio chunk to avoid queuing behavior, ensuring immediate playback without interfering with other audio streams.

### Basic Setup

```javascript
// Create recorder and player instances
const recorder = new WavRecorder({ sampleRate: 24000 });
const player = new WavStreamPlayer({ sampleRate: 24000 });

// Connect player to audio output
await player.connect();

// Setup passthrough with 20% volume
recorder.setupPassthrough(player, true, 0.2);

// Begin recording (passthrough will start automatically)
await recorder.begin('microphone-device-id');
await recorder.record();
```

### Dynamic Control

```javascript
// Enable/disable passthrough during recording
recorder.setPassthroughEnabled(true);
recorder.setPassthroughEnabled(false);

// Adjust volume (0.0 to 1.0)
recorder.setPassthroughVolume(0.3); // 30% volume
recorder.setPassthroughVolume(0.6); // 60% volume (maximum recommended)
```

### Integration with Sokuji

In the Sokuji application, passthrough is automatically configured when:

1. Real voice passthrough is enabled in AudioContext
2. A recording session is started
3. Both input and output devices are available

The integration happens in `MainPanel.tsx`:

```javascript
// Setup passthrough during session connection
if (isRealVoicePassthroughEnabled && audioServiceRef.current) {
  const wavStreamPlayer = audioServiceRef.current.getWavStreamPlayer();
  if (wavStreamPlayer) {
    wavRecorder.setupPassthrough(
      wavStreamPlayer, 
      isRealVoicePassthroughEnabled, 
      realVoicePassthroughVolume
    );
  }
}
```

## Technical Details

### Queued vs Immediate Playback

- **Queued Playback** (`add16BitPCM` with same trackId): Audio chunks are played sequentially
- **Immediate Playback** (`addImmediatePCM` or `add16BitPCM` with unique trackIds): Audio is played immediately without queuing

### Audio Processing

1. **Recording**: Audio is captured via AudioWorklet and processed in chunks
2. **Passthrough**: Each audio chunk is automatically processed during `_chunkProcessor` execution, sent to the player via `addImmediatePCM` with unique trackIds
3. **Volume Control**: Audio samples are multiplied by the volume factor before playback
4. **Multiple Streams**: Different trackIds allow multiple audio streams to play simultaneously

### Processing Flow

```
AudioWorklet → chunk event → _chunkProcessor → handlePassthrough → WavStreamPlayer
                                            ↓
                                     User callback (e.g., AI processing)
```

The passthrough processing happens automatically when audio chunks are processed, ensuring real-time audio feedback without requiring manual callback modifications.

### Parallel Audio Mixing

The StreamProcessor AudioWorklet now supports true parallel playback by:

1. **Per-Track Queues**: Each trackId maintains its own buffer queue (`this.trackBuffers[trackId]`)
2. **Audio Mixing**: All active tracks are mixed together in real-time using additive mixing
3. **Automatic Cleanup**: Empty track queues are automatically cleaned up to prevent memory leaks
4. **Unique TrackIds**: `addImmediatePCM` generates truly unique trackIds for each chunk (`immediate_${timestamp}_${random}`)

This allows multiple audio streams (e.g., AI responses + real-time voice passthrough) to play simultaneously without interference.

**Before Fix**: All trackIds shared one queue → sequential playback only
**After Fix**: Each trackId has its own queue → true parallel playback with mixing

### Performance Considerations

- Passthrough adds minimal latency (typically < 10ms)
- Volume control is applied at the sample level for precise control
- Unique trackIds ensure immediate playback without queuing delays
- Multiple audio streams can play simultaneously using different trackIds
- Audio mixing happens in real-time within the AudioWorklet for optimal performance
- Automatic cleanup prevents memory leaks from unused track queues
- **Audio Clipping**: When mixing multiple loud tracks, sum may exceed [-1, 1] range causing distortion
- **Recommended**: Keep individual track volumes low (e.g., 0.2-0.4) when using multiple simultaneous streams

## API Reference

### WavRecorder Methods

#### `setupPassthrough(player, enabled, volume)`
- `player`: WavStreamPlayer instance
- `enabled`: Boolean to enable/disable passthrough
- `volume`: Number between 0.0 and 1.0

#### `setPassthroughEnabled(enabled)`
- `enabled`: Boolean to enable/disable passthrough

#### `setPassthroughVolume(volume)`
- `volume`: Number between 0.0 and 1.0

#### `handlePassthrough(data)`
- `data`: Object with `{mono: ArrayBuffer, raw: ArrayBuffer}` audio data
- Manually processes passthrough for a specific audio chunk
- Note: Automatically called during recording, manual use typically not needed

### WavStreamPlayer Methods

#### `add16BitPCM(arrayBuffer, trackId, volume)`
- `arrayBuffer`: Int16Array or ArrayBuffer containing audio data
- `trackId`: String identifier for the track (default: 'default')
- `volume`: Optional volume multiplier (default: 1.0)

#### `addImmediatePCM(arrayBuffer, volume)`
- `arrayBuffer`: Int16Array or ArrayBuffer containing audio data
- `volume`: Optional volume multiplier (default: 1.0)

Returns: Int16Array of the processed audio data

Note: `addImmediatePCM` automatically generates unique trackIds for immediate playback without queuing.

## Examples

### Basic Voice Monitoring

```javascript
const recorder = new WavRecorder({ sampleRate: 24000 });
const player = new WavStreamPlayer({ sampleRate: 24000 });

await player.connect();
recorder.setupPassthrough(player, true, 0.2);

await recorder.begin();
await recorder.record((data) => {
  // Process recorded data for other purposes
  console.log('Recorded chunk:', data);
});

// Voice is now being monitored through speakers at 20% volume
```

### Dynamic Volume Control

```javascript
// Start with low volume
recorder.setupPassthrough(player, true, 0.1);

// Gradually increase volume
setTimeout(() => recorder.setPassthroughVolume(0.2), 1000);
setTimeout(() => recorder.setPassthroughVolume(0.3), 2000);
setTimeout(() => recorder.setPassthroughVolume(0.4), 3000);
```

### Conditional Passthrough

```javascript
let passthroughEnabled = false;

// Toggle passthrough based on user input
document.addEventListener('keydown', (e) => {
  if (e.key === 'p') {
    passthroughEnabled = !passthroughEnabled;
    recorder.setPassthroughEnabled(passthroughEnabled);
    console.log('Passthrough:', passthroughEnabled ? 'ON' : 'OFF');
  }
});
```

### Parallel Audio Streams

```javascript
const recorder = new WavRecorder({ sampleRate: 24000 });
const player = new WavStreamPlayer({ sampleRate: 24000 });

await player.connect();

// Setup real-time voice passthrough at 20% volume
recorder.setupPassthrough(player, true, 0.2);

// Start recording with passthrough
await recorder.begin();
await recorder.record((data) => {
  // Send to AI for processing
  processWithAI(data);
});

// Simultaneously play AI response (different trackId)
function playAIResponse(audioData) {
  // Uses 'default' trackId - will mix with passthrough audio
  player.add16BitPCM(audioData, 'default', 0.3);
}

// Result: User hears their own voice (passthrough) + AI response simultaneously
``` 