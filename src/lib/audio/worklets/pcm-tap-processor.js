/**
 * Hands the main thread what reaches this node, in fixed chunks of mono float
 * samples at the context's rate. An input with nothing connected counts as
 * silence, so a tap stays clocked while nothing plays (the echo monitor
 * correlates against wall time).
 */
class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunk = options && options.processorOptions && options.processorOptions.chunk;
    this.chunk = chunk || 2400;
    this.buffer = new Float32Array(this.chunk);
    this.filled = 0;
  }

  process(inputs, outputs) {
    const channel = inputs[0] && inputs[0][0];
    const frames = channel ? channel.length : (outputs[0] && outputs[0][0] ? outputs[0][0].length : 128);
    for (let i = 0; i < frames; i++) {
      this.buffer[this.filled++] = channel ? channel[i] : 0;
      if (this.filled === this.chunk) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.chunk);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-tap-processor', PcmTapProcessor);

export {};
