/**
 * The contract's pcm as the base64 a JSON wire carries it (Gemini's
 * `realtimeInput.audio`, OpenAI's `input_audio_buffer.append` and output
 * audio deltas): little-endian Int16, as the platforms are. Written first in
 * Gemini's wire, copied into OpenAI Translate's, and lifted here at its
 * third user, OpenAI Realtime (Stage 2 OpenAI Realtime, choice 1). Pure.
 */

/** Base64 of the view's own bytes, never its backing buffer's (the old fork encoded the whole buffer); in 32 KiB steps, which `String.fromCharCode` spreads safely. */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Base64 of little-endian Int16 as pcm; an odd trailing byte is dropped, where the old decoders threw. Throws on text that is not base64. */
export function base64ToPcm(data: string): Int16Array {
  const binary = atob(data);
  const even = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(even);
  for (let i = 0; i < even; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
