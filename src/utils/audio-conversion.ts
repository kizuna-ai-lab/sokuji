/**
 * Audio format conversion utilities for sherpa-onnx WASM integration.
 * sherpa-onnx expects Float32Array @ 16kHz in range [-1.0, 1.0].
 * sokuji records Int16Array @ 24kHz.
 */

/**
 * Downsample Int16Array audio to Float32Array at the target sample rate.
 * Combines format conversion (Int16 → Float32 normalized) and resampling.
 *
 * @param input Int16Array audio samples
 * @param inputSampleRate Source sample rate (e.g. 24000)
 * @param outputSampleRate Target sample rate (e.g. 16000)
 * @returns Float32Array in range [-1.0, 1.0] at the target rate
 */
export function downsampleInt16ToFloat32(
  input: Int16Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    // Just convert format, no resampling needed
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] / 32768;
    }
    return output;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const frac = srcIndex - srcIndexFloor;

    // Linear interpolation between adjacent samples
    const sample = input[srcIndexFloor] * (1 - frac) + input[srcIndexCeil] * frac;
    output[i] = sample / 32768;
  }

  return output;
}

/**
 * Convert Float32Array audio to Int16Array.
 * Used when converting TTS output back to Int16 format.
 *
 * @param input Float32Array in range [-1.0, 1.0]
 * @returns Int16Array
 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}
