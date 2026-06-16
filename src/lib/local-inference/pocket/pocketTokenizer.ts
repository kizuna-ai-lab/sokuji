// @ts-expect-error — vendored JS module without types
import { SentencePieceProcessor } from './sentencepiece.js';

/** Base64-encode an ArrayBuffer without blowing the call stack on large inputs. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Typed wrapper over the vendored SentencePiece processor.
 * Loads a `tokenizer.model` buffer and encodes text to int64-ready bigint ids.
 */
export class PocketTokenizer {
  private sp: { loadFromB64StringModel(b64: string): Promise<void>; encodeIds(t: string): number[] } | null = null;

  async load(modelBuffer: ArrayBuffer): Promise<void> {
    const sp = new SentencePieceProcessor();
    await sp.loadFromB64StringModel(toBase64(modelBuffer));
    this.sp = sp;
  }

  encodeIds(text: string): bigint[] {
    if (!this.sp) throw new Error('PocketTokenizer not loaded');
    return this.sp.encodeIds(text).map((t) => BigInt(t));
  }
}
