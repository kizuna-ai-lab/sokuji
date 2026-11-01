// The module's frames cross as little-endian 16-bit bytes. Apart from the
// wrapper, which is native: the node tests import these.

/** A copy, so a frame at an odd offset of its buffer can still be read as Int16. */
export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const copy = bytes.slice(0, bytes.length - (bytes.length % 2));
  return new Int16Array(copy.buffer, 0, copy.length / 2);
}

export function int16ToBytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}
