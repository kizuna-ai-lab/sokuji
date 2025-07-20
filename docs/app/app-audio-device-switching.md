# Dynamic Audio Device Switching

This document describes the dynamic audio device switching feature in Sokuji, which allows users to change recording devices during active translation sessions without interruption.

## Overview

The dynamic device switching feature enables seamless microphone changes while a translation session is running. This is particularly useful when:
- Users need to switch between headset and desktop microphones
- A device becomes disconnected and needs to be replaced
- Users want to test different microphones without restarting

## Architecture

### Key Components

1. **ModernBrowserAudioService**
   - Tracks current recording device with `currentRecordingDeviceId`
   - Provides `switchRecordingDevice()` method for device changes
   - Maintains recording state during device transitions

2. **ModernAudioRecorder**
   - Handles the actual device connection and disconnection
   - Preserves audio processing callbacks during switches
   - Manages MediaStream and AudioContext lifecycle

3. **MainPanel Component**
   - Detects device selection changes via React useEffect
   - Triggers device switching when user selects new input
   - Provides error feedback to users

## Implementation Details

### Audio Service Method

```typescript
public async switchRecordingDevice(deviceId: string | undefined): Promise<void> {
  // Check if already using the same device
  if (this.currentRecordingDeviceId === deviceId) {
    return;
  }

  // Save current state
  const wasRecording = this.recorder.getStatus() === 'recording';
  const savedCallback = this.recordingCallback;
  
  // End current recording session
  if (this.recorder.getStatus() !== 'ended') {
    await this.recorder.end();
  }
  
  // Begin with new device
  await this.recorder.begin(deviceId);
  this.currentRecordingDeviceId = deviceId;
  
  // Resume recording if it was active
  if (wasRecording && savedCallback) {
    await this.recorder.record(savedCallback);
  }
}
```

### React Integration

```typescript
useEffect(() => {
  // Only handle device changes if session is active
  if (!isSessionActive || !isInputDeviceOn) {
    if (!isSessionActive) {
      isInitializedRef.current = false;
    }
    return;
  }

  // Skip initial mount
  if (!isInitializedRef.current) {
    isInitializedRef.current = true;
    return;
  }

  // Switch device
  const handleDeviceSwitch = async () => {
    try {
      await audioService.switchRecordingDevice(selectedInputDevice?.deviceId);
    } catch (error) {
      // Handle error with user feedback
    }
  };

  handleDeviceSwitch();
}, [selectedInputDevice?.deviceId, isSessionActive, isInputDeviceOn]);
```

## Best Practices

### 1. Use Device ID in Dependencies
Always use the device ID string (`selectedInputDevice?.deviceId`) rather than the full device object in React dependencies. This prevents unnecessary re-renders when the device object reference changes but the actual device remains the same.

### 2. Track Initialization State
Use a ref to track whether the component has been initialized to prevent device switching on the initial mount when a session starts.

### 3. Reset State on Session End
Clear the initialization flag when the session ends so the next session starts fresh.

### 4. Handle Errors Gracefully
Provide clear error messages to users if device switching fails, using the LogContext for visibility.

## Common Issues and Solutions

### Issue: Infinite Loop in useEffect
**Cause**: Including the full device object or unstable function references in dependencies  
**Solution**: Use only the device ID string and exclude functions like `addRealtimeEvent` that may be recreated on each render

### Issue: Device Not Switching
**Cause**: Audio service not properly tracking current device  
**Solution**: Ensure `currentRecordingDeviceId` is updated in both `startRecording` and `stopRecording`

### Issue: Audio Interruption During Switch
**Cause**: Brief gap while reconnecting to new device  
**Solution**: This is expected behavior - the switch happens as quickly as possible but some interruption is unavoidable

## Testing

To test device switching:

1. Start a translation session
2. Open device settings while session is active
3. Select a different input device
4. Verify:
   - Session continues without error
   - New device is being used for recording
   - AI continues to receive audio input
   - No infinite loops or excessive re-renders

## Future Improvements

- Add visual indicator during device switch
- Implement seamless switching with audio buffer preservation
- Add device change detection for automatic switching when devices are unplugged