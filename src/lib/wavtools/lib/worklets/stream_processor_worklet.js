// AudioWorklet processor for streaming audio data
class StreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hasStarted = false;
    this.hasInterrupted = false;
    this.trackBuffers = {}; // Separate buffer queues for each trackId
    this.bufferLength = 128;
    this.currentWrites = {}; // Current write buffers for each trackId
    this.trackSampleOffsets = {};
    
    this.port.onmessage = (event) => {
      if (event.data) {
        const payload = event.data;
        if (payload.event === 'write') {
          const int16Array = payload.buffer;
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 0x8000; // Convert Int16 to Float32
          }
          this.writeData(float32Array, payload.trackId);
        } else if (
          payload.event === 'offset' ||
          payload.event === 'interrupt'
        ) {
          const requestId = payload.requestId;
          // Find the most recently active trackId or use the first available one
          const trackIds = Object.keys(this.trackSampleOffsets);
          const trackId = trackIds.length > 0 ? trackIds[trackIds.length - 1] : null;
          const offset = trackId ? (this.trackSampleOffsets[trackId] || 0) : 0;
          this.port.postMessage({
            event: 'offset',
            requestId,
            trackId,
            offset,
          });
          if (payload.event === 'interrupt') {
            this.hasInterrupted = true;
          }
        } else {
          throw new Error(`Unhandled event "${payload.event}"`);
        }
      }
    };
  }

  writeData(float32Array, trackId = 'default') {
    // Initialize track-specific data structures if needed
    if (!this.trackBuffers[trackId]) {
      this.trackBuffers[trackId] = [];
      this.currentWrites[trackId] = {
        buffer: new Float32Array(this.bufferLength),
        offset: 0
      };
    }

    let { buffer, offset } = this.currentWrites[trackId];
    
    for (let i = 0; i < float32Array.length; i++) {
      buffer[offset++] = float32Array[i];
      if (offset >= buffer.length) {
        // Push completed buffer to track's queue
        this.trackBuffers[trackId].push(buffer);
        // Create new buffer for this track
        buffer = new Float32Array(this.bufferLength);
        offset = 0;
      }
    }
    
    // Update current write state for this track
    this.currentWrites[trackId].buffer = buffer;
    this.currentWrites[trackId].offset = offset;
    
    return true;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputChannelData = output[0];
    
    if (this.hasInterrupted) {
      this.port.postMessage({ event: 'stop' });
      return false;
    }

    // Initialize output with silence
    for (let i = 0; i < outputChannelData.length; i++) {
      outputChannelData[i] = 0;
    }

    let hasAnyAudio = false;
    
    // Mix audio from all active tracks
    for (const trackId in this.trackBuffers) {
      const trackQueue = this.trackBuffers[trackId];
      
      if (trackQueue.length > 0) {
        hasAnyAudio = true;
        this.hasStarted = true;
        
        const buffer = trackQueue.shift();
        
        // Mix this track's audio with the output
        for (let i = 0; i < outputChannelData.length && i < buffer.length; i++) {
          outputChannelData[i] += buffer[i];
        }
        
        // Update sample offset for this track
        this.trackSampleOffsets[trackId] = this.trackSampleOffsets[trackId] || 0;
        this.trackSampleOffsets[trackId] += buffer.length;
      }
    }
    
    // Clean up empty track queues
    for (const trackId in this.trackBuffers) {
      if (this.trackBuffers[trackId].length === 0) {
        delete this.trackBuffers[trackId];
        delete this.currentWrites[trackId];
      }
    }
    
    if (!hasAnyAudio && this.hasStarted) {
      // Send notification but don't stop processing
      this.port.postMessage({ event: 'buffer-empty' });
    }
    
    return true;
  }
}

// This is required for AudioWorklet registration
registerProcessor('stream_processor', StreamProcessor);
