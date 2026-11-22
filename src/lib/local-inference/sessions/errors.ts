/** Worded as today's `errors.gpuOutOfMemory`; surfaces put `gpu_out_of_memory` into words by code. */
export const GPU_OUT_OF_MEMORY = 'GPU out of memory — the selected model is too large for your GPU. Please switch to a smaller model.';

/** A lost WebGPU device: nothing on this GPU will run again. */
export function isDeviceLost(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('a valid external instance reference no longer exists') || (lower.includes('webgpu') && lower.includes('device lost'));
}

/**
 * A GPU out-of-memory failure from ONNX Runtime's WebGPU / Vulkan backend
 * (today's detection, `LocalInferenceClient.ts` ~52-61), which counts a lost
 * device too: error messages cascade through several stages, and these are
 * the most distinctive patterns.
 */
export function isGpuOutOfMemory(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('out_of_device_memory') || lower.includes('out of memory') || isDeviceLost(message);
}

/** What each Bing error tag says, as a sentence. */
const BING_ERROR_MESSAGES: Record<string, string> = {
  token: 'Bing Translator could not connect. Check your network and try again.',
  unsupported: 'Bing Translator does not support this language pair.',
  network: 'Bing Translator is temporarily unavailable.',
};

/**
 * The Bing worker prefixes its errors with a tag (`[bing:token]`, `[bing:network]`, …;
 * `bing-translation.worker.ts`): peel it off into a sentence. Untagged errors keep their own message.
 */
export function humanizeTranslationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (!raw) return 'Translation failed.';
  const match = raw.match(/^\[bing:(token|unsupported|network|unknown)\]\s*(.*)$/);
  if (match) {
    const known = BING_ERROR_MESSAGES[match[1]];
    if (known) return known;
    // 'unknown': keep the detail, still marked as Bing's.
    return match[2] ? `Bing Translator failed: ${match[2]}` : 'Bing Translator failed.';
  }
  return raw;
}
