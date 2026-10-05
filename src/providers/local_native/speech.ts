import { SAMPLE_RATE, type TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { tileSpan } from '../../lib/contract/ranges';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { float32ToInt16, resampleFloat32 } from '../../utils/audio-conversion';
import { splitSentences } from '../../utils/splitSentences';
import type { NativeTtsLike } from './engines';

/**
 * One translation spoken sentence by sentence (the old client's `runJob`
 * TTS loop). One-shot families: one clip per sentence with its exact range.
 * Streaming families: each chunk as it arrives, unranged, and once the
 * sentence ends its range divided among those chunks by sample count —
 * `speechRanges`, Soniox's method (#578 ruling 9). A sentence that fails is
 * reported and skipped; `isEnded` is read between sentences and when one
 * settles, so a session that stopped meanwhile hears nothing more.
 */
export interface NativeSpeechEmit {
  audio(pcm: Int16Array, range?: TextRange): void;
  /** The ranges of this text's earlier audio entries, by their place among them (0 first). */
  ranges(entries: ReadonlyArray<{ index: number; range: TextRange }>): void;
  degraded(message: string, cause?: unknown): void;
  frame(direction: 'in' | 'out', type: string, payload: Record<string, unknown>): void;
}

/** The sentence's UTF-16 range in `text`, searching from where the last one ended; on a miss, no range, and the search still advances. */
export function locateSentence(text: string, sentence: string, searchFrom: number): { range?: TextRange; nextSearchFrom: number } {
  const pos = text.indexOf(sentence, searchFrom);
  if (pos >= 0) return { range: [pos, pos + sentence.length], nextSearchFrom: pos + sentence.length };
  return { range: undefined, nextSearchFrom: searchFrom + sentence.length };
}

export async function speakNative(
  tts: NativeTtsLike,
  text: string,
  lang: string,
  opts: { modelId: string; voice: string; speed: number; streaming: boolean },
  emit: NativeSpeechEmit,
  isEnded: () => boolean,
  clock: Clock,
): Promise<void> {
  const sentences = splitSentences(text, lang).filter((s) => s.trim());
  emit.frame('out', 'local.native.tts.start', { text, sentenceCount: sentences.length, modelId: opts.modelId, voice: opts.voice, speed: opts.speed });
  const ttsStart = clock.now();
  let searchFrom = 0;
  /** Audio entries this text has had so far: a `ranges` index names one of them. */
  let entries = 0;

  for (let i = 0; i < sentences.length; i++) {
    if (isEnded()) return;
    const sentence = sentences[i];
    const { range, nextSearchFrom } = locateSentence(text, sentence, searchFrom);
    searchFrom = nextSearchFrom;
    emit.frame('out', 'local.native.tts.sentence.start', { sentenceIndex: i, sentenceCount: sentences.length, text: sentence });
    const sentenceStart = clock.now();
    const chunks: Array<{ index: number; samples: number }> = [];
    let samples = 0;
    let generationTimeMs: number;
    try {
      if (opts.streaming) {
        const done = await tts.generate(sentence, opts.speed, (pcm) => {
          if (isEnded()) return;
          // Streaming chunks arrive at the contract's 24 kHz already.
          const int16 = float32ToInt16(pcm);
          if (int16.length === 0) return;
          chunks.push({ index: entries++, samples: int16.length });
          samples += int16.length;
          emit.audio(int16);
        });
        generationTimeMs = done.generationTimeMs;
      } else {
        const result = await tts.generate(sentence, opts.speed);
        if (isEnded()) return;
        const int16 = float32ToInt16(resampleFloat32(result.samples, result.sampleRate, SAMPLE_RATE));
        samples = int16.length;
        generationTimeMs = result.generationTimeMs;
        if (int16.length > 0) {
          entries++;
          emit.audio(int16, range);
        }
      }
    } catch (error) {
      if (isEnded()) return;
      emit.frame('in', 'local.native.tts.error', { error: describeCause(error), sentenceIndex: i });
      emit.degraded(`a sentence could not be spoken: ${describeCause(error)}`, error);
      continue;
    }
    if (isEnded()) return;
    if (range && chunks.length > 0) {
      const tiles = tileSpan(range, chunks.map((c) => c.samples), text);
      emit.ranges(chunks.map((c, k) => ({ index: c.index, range: tiles[k] })));
    }
    const audioDurationMs = Math.round((samples / SAMPLE_RATE) * 1000);
    const generateMs = generationTimeMs ?? clock.now() - sentenceStart;
    emit.frame('in', 'local.native.tts.sentence.end', {
      sentenceIndex: i,
      sentenceCount: sentences.length,
      text: sentence,
      generateMs,
      audioDurationMs,
      ...(audioDurationMs > 0 ? { rtf: Math.round((generateMs / audioDurationMs) * 1000) / 1000 } : {}),
    });
  }
  emit.frame('in', 'local.native.tts.end', { sentenceCount: sentences.length, durationMs: clock.now() - ttsStart });
}
