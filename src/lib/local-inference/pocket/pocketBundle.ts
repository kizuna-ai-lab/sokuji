/**
 * Pocket TTS bundle constants for the dev playground PoC.
 *
 * The English int8 bundle is downloaded into public/wasm/pocket-tts-en/ by
 * scripts/download-pocket-tts-en.sh and served by the dev server at /wasm/pocket-tts-en/.
 * Tensor/frame values mirror the working KevinAHM/pocket-tts-web ONNX port.
 */

/** Public path (served by the dev server) where the bundle lives. */
export const POCKET_BUNDLE_BASE = '/wasm/pocket-tts-en';

/** ONNX session id → filename within the bundle. */
export const POCKET_MODEL_STEMS = {
  mimiEncoder: 'mimi_encoder_int8.onnx',
  textConditioner: 'text_conditioner_int8.onnx',
  flowLmMain: 'flow_lm_main_int8.onnx',
  flowLmFlow: 'flow_lm_flow_int8.onnx',
  mimiDecoder: 'mimi_decoder_int8.onnx',
} as const;

export type PocketSessionId = keyof typeof POCKET_MODEL_STEMS;

export const POCKET_TOKENIZER_FILE = 'tokenizer.model';
export const POCKET_METADATA_FILE = 'metadata.json';
export const POCKET_VOICES_FILE = 'voices.bin';

/** Audio/frame configuration (from the ONNX port). */
export const POCKET_SAMPLE_RATE = 24000;
export const POCKET_SAMPLES_PER_FRAME = 1920; // 80 ms @ 24 kHz
export const POCKET_LATENT_DIM = 32;

/** Generation defaults (configurable via ttsConfig). */
export const POCKET_DEFAULT_LSD_STEPS = 1; // consistency sampling; NOT sherpa's 5
export const POCKET_DEFAULT_MAX_FRAMES = 500;
export const POCKET_EOS_LOGIT_THRESHOLD = -4.0;
export const POCKET_DECODER_CHUNK_FRAMES = 12;

/** Build the full /wasm path for a bundle file. */
export function pocketBundleUrl(file: string): string {
  return `${POCKET_BUNDLE_BASE}/${file}`;
}
