class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Silence detection threshold (RMS below this is considered silence)
    // Typical speech RMS is 0.01-0.3, silence is < 0.001
    this.silenceThreshold = 0.005;
    // Count of consecutive silent frames (used for trailing silence)
    this.silentFrameCount = 0;
    // Send a few frames after speech ends to avoid cutting off audio
    this.trailingSilenceFrames = 10; // ~25ms at 128 samples/frame
  }

  process(inputs) {
    // We expect one input, with one channel.
    const inputChannel = inputs[0][0];

    // If there's no input, do nothing.
    if (!inputChannel) {
      return true;
    }

    // Calculate RMS (Root Mean Square) for silence detection
    let sumSquares = 0;
    for (let i = 0; i < inputChannel.length; i++) {
      sumSquares += inputChannel[i] * inputChannel[i];
    }
    const rms = Math.sqrt(sumSquares / inputChannel.length);

    // Check if this frame is silence
    const isSilent = rms < this.silenceThreshold;

    if (isSilent) {
      this.silentFrameCount++;
      // Skip sending if we've been silent for too long
      if (this.silentFrameCount > this.trailingSilenceFrames) {
        return true;
      }
    } else {
      // Reset silent frame count when we detect audio
      this.silentFrameCount = 0;
    }

    // Convert Float32Array to Int16Array (PCM)
    const pcmData = new Int16Array(inputChannel.length);
    for (let i = 0; i < inputChannel.length; i++) {
      pcmData[i] = Math.max(-32768, Math.min(32767, inputChannel[i] * 32767));
    }

    // Post the PCM data back to the main thread.
    // The second argument is a list of Transferable objects.
    // This transfers ownership of the ArrayBuffer, making it more efficient.
    this.port.postMessage(pcmData, [pcmData.buffer]);

    // Keep the processor alive.
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
