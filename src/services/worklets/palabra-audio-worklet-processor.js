class PalabraPCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    // We expect one input, with one channel.
    const inputChannel = inputs[0][0];

    // If there's no input, do nothing.
    if (!inputChannel) {
      return true;
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

registerProcessor('palabra-pcm-processor', PalabraPCMProcessor); 