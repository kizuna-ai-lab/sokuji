import { SAMPLE_RATE, type TextRange } from '../../lib/contract/adapter';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { float32ToInt16, resampleFloat32 } from '../../utils/audio-conversion';
import { splitSentences } from '../../utils/splitSentences';
import type { TtsLike } from './engines';
import type { LocalInferenceConfig } from './config';

/**
 * One sentence, one clip (spec ruling 8, ported from `LocalInferenceClient.ts`
 * ~1209-1374). `splitSentences` cuts the translation the same way the display
 * does; each sentence gets its exact UTF-16 range in that text
 * (`text.indexOf`, searching from where the last sentence ended — omitted
 * when the search misses) and is spoken, resampled to the contract's
 * 24 kHz mono Int16, and reported as one clip. Edge TTS streams a sentence in
 * many chunks over the network; they are gathered into that one clip so
 * karaoke's linear sweep covers the sentence once, not once per chunk (the
 * adapter closes the translation segment only after the last clip — ruling
 * 8's "why close last"). A sentence that fails to synthesize is reported and
 * skipped; the next sentence still runs. `isEnded` is checked between
 * sentences, since the session may stop while one is being synthesized.
 */
export interface SpeechEmit {
  /** One synthesized clip and the exact stretch of the translation it speaks. */
  audio(pcm: Int16Array, range?: TextRange): void;
  /** A sentence could not be synthesized; always `tts_degraded` at the caller. */
  degraded(message: string, cause?: unknown): void;
}

export async function speakTranslation(
  tts: TtsLike,
  text: string,
  lang: string,
  config: NonNullable<LocalInferenceConfig['tts']>,
  emit: SpeechEmit,
  isEnded: () => boolean,
): Promise<void> {
  const sentences = splitSentences(text, lang);
  // Today's client tells an Edge model apart the same way (LocalInferenceClient.ts ~1211-1212).
  const isEdge = Boolean(config.edgeVoice) && getManifestEntry(config.modelId)?.engine === 'edge-tts';

  let searchFrom = 0;
  for (const sentence of sentences) {
    if (isEnded()) return;

    const pos = text.indexOf(sentence, searchFrom);
    const range: TextRange | undefined = pos >= 0 ? [pos, pos + sentence.length] : undefined;
    if (pos >= 0) searchFrom = pos + sentence.length;

    try {
      const pcm = isEdge
        ? await speakEdgeSentence(tts, sentence, lang, config)
        : await speakSentence(tts, sentence, lang, config);
      emit.audio(pcm, range);
    } catch (error) {
      emit.degraded(`a sentence could not be spoken: ${describeCause(error)}`, error);
    }
  }
}

async function speakSentence(
  tts: TtsLike,
  sentence: string,
  lang: string,
  config: NonNullable<LocalInferenceConfig['tts']>,
): Promise<Int16Array> {
  const result = await tts.generate(sentence, config.speakerId, config.speed, lang);
  return float32ToInt16(resampleFloat32(result.samples, result.sampleRate, SAMPLE_RATE));
}

/** Edge TTS's chunks, each resampled and converted as they arrive, joined into the sentence's one clip. */
async function speakEdgeSentence(
  tts: TtsLike,
  sentence: string,
  lang: string,
  config: NonNullable<LocalInferenceConfig['tts']>,
): Promise<Int16Array> {
  const chunks: Int16Array[] = [];
  // sid is unused for edge-tts (today's client passes 0 too: LocalInferenceClient.ts ~1261).
  await tts.generateStream(
    sentence,
    0,
    config.speed,
    lang,
    (samples, sampleRate) => { chunks.push(float32ToInt16(resampleFloat32(samples, sampleRate, SAMPLE_RATE))); },
    config.edgeVoice,
  );
  return concatInt16(chunks);
}

function concatInt16(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
