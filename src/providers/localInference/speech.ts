import { SAMPLE_RATE, type TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
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
 * (`text.indexOf`, searching from where the last sentence ended — omitted,
 * and the search still advances by the sentence's length, when the search
 * misses: `LocalInferenceClient.ts` ~1252-1254, 1318-1320) and is spoken,
 * resampled to the contract's 24 kHz mono Int16, and reported as one clip.
 * Edge TTS streams a sentence in many chunks over the network; they are
 * gathered into that one clip so karaoke's linear sweep covers the sentence
 * once, not once per chunk (the adapter closes the translation segment only
 * after the last clip — ruling 8's "why close last"). A sentence that fails
 * to synthesize is reported and skipped, without reporting the clip's own
 * delivery (a throwing event handler is the caller's problem, not a
 * synthesis failure); the next sentence still runs. `isEnded` is checked
 * between sentences and again when a sentence's synthesis settles, since
 * the session may stop (or its TTS die) while one is being synthesized —
 * matching today's own `this.disposed` checks: a late answer or failure is
 * dropped unreported, and the run ends without a closing `local.tts.end`
 * frame either.
 */
export interface SpeechEmit {
  /** One synthesized clip and the exact stretch of the translation it speaks. */
  audio(pcm: Int16Array, range?: TextRange): void;
  /** A sentence could not be synthesized; always `tts_degraded` at the caller. */
  degraded(message: string, cause?: unknown): void;
  /**
   * Today's `local.tts.*` diagnostics (`LocalInferenceClient.ts` ~1216-1373),
   * reported structurally — `speech.ts` names no `AdapterEvents`/
   * `ClientDiagnosticCode` type, only the plain shape the adapter's own
   * `frame()` already takes (and already clips and redacts). Optional so a
   * caller that doesn't care about the Logs panel can leave it out.
   */
  frame?(direction: 'in' | 'out', type: string, payload: Record<string, unknown>): void;
}

/**
 * The sentence's exact UTF-16 range in `text`, and where the next sentence's
 * search should resume: `indexOf(sentence, searchFrom)` — or, on a miss, no
 * range, with the search advancing by the sentence's length anyway (today's
 * fallback), so one missed sentence does not strand every later one at the
 * same search position.
 */
export function locateSentence(text: string, sentence: string, searchFrom: number): { range?: TextRange; nextSearchFrom: number } {
  const pos = text.indexOf(sentence, searchFrom);
  if (pos >= 0) return { range: [pos, pos + sentence.length], nextSearchFrom: pos + sentence.length };
  return { range: undefined, nextSearchFrom: searchFrom + sentence.length };
}

export async function speakTranslation(
  tts: TtsLike,
  text: string,
  lang: string,
  config: NonNullable<LocalInferenceConfig['tts']>,
  emit: SpeechEmit,
  isEnded: () => boolean,
  clock: Clock,
): Promise<void> {
  const sentences = splitSentences(text, lang);
  // Today's client tells an Edge model apart by the manifest alone (LocalInferenceClient.ts ~1211-1212).
  const isEdge = getManifestEntry(config.modelId)?.engine === 'edge-tts';

  emit.frame?.('out', 'local.tts.start', {
    text,
    sentenceCount: sentences.length,
    modelId: config.modelId,
    voice: isEdge ? config.edgeVoice : `speaker:${config.speakerId}`,
    speed: config.speed,
  });
  const ttsStart = clock.now();

  let searchFrom = 0;
  for (let i = 0; i < sentences.length; i++) {
    if (isEnded()) return;
    const sentence = sentences[i];

    const { range, nextSearchFrom } = locateSentence(text, sentence, searchFrom);
    searchFrom = nextSearchFrom;

    emit.frame?.('out', 'local.tts.sentence.start', { sentenceIndex: i, sentenceCount: sentences.length, text: sentence });
    const sentenceStart = clock.now();

    let pcm: Int16Array;
    try {
      pcm = isEdge
        ? await speakEdgeSentence(tts, sentence, lang, config)
        : await speakSentence(tts, sentence, lang, config);
    } catch (error) {
      if (isEnded()) return; // abandoned while synthesizing: its failure is nobody's news
      emit.frame?.('in', 'local.tts.error', { error: error instanceof Error ? error.message : String(error), sentenceIndex: i });
      emit.degraded(`a sentence could not be spoken: ${describeCause(error)}`, error);
      continue;
    }
    if (isEnded()) return; // abandoned while synthesizing: a late answer is not spoken

    emit.frame?.('in', 'local.tts.sentence.end', {
      sentenceIndex: i,
      sentenceCount: sentences.length,
      text: sentence,
      generateMs: clock.now() - sentenceStart,
      audioDurationMs: Math.round((pcm.length / SAMPLE_RATE) * 1000),
    });
    // Outside the try: a throwing consumer is a delivery fault, not a synthesis failure.
    emit.audio(pcm, range);
  }

  emit.frame?.('in', 'local.tts.end', { sentenceCount: sentences.length, durationMs: clock.now() - ttsStart });
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
