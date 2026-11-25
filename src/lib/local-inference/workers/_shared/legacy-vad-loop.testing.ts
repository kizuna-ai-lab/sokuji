/**
 * The reference the detector is held to; deleted in step 5.
 *
 * `whisper-webgpu.worker.ts` `feedAudio` and `handleFlush` as they stood at 17642a804, the segmenting logic every
 * VAD worker ran: resample, 512-sample frames, vad-web's FrameProcessor, Smart Turn's gate, the max-speech cap.
 * Module state became locals, `scheduleWhisper` became a push to a list, and Silero (`infer`) and the Smart link
 * (`smart`) are injected. Nothing else is changed: do not tidy it, it is a record of what the worker did.
 */
import { FrameProcessor } from '@ricky0123/vad-web/dist/frame-processor';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';
import { Message } from '@ricky0123/vad-web/dist/messages';
import type { VadWebConfig } from '../../types';
import { resolveMaxSpeechFrames, VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE, type SegmentLimit } from './max-speech-frames';
import { segmentStartSample } from './segmentStart';
import type { TurnLink } from './turn-gate';
import { openTurnLink } from './turn-gate';
import type { FrameProcessorParams } from './turn-gate';
import { resolveVadThresholds } from './vad-thresholds';

const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

/** What `scheduleWhisper` was handed. */
export interface LegacySegment {
  audio: Float32Array;
  startSample: number;
  end: { endedBy: 'silence' | 'smart' | 'cap' | 'flush' | 'kept'; smartTurnProbability?: number };
  /** `totalSamplesFed` when it was scheduled: the 16 kHz position after the frame that ended it. */
  fedAt: number;
}

export interface LegacyVadLoopOptions {
  vadConfig: VadWebConfig;
  limit: SegmentLimit;
  /** Silero's speech probability for the next frame. */
  infer: (frame: Float32Array) => number;
  /** The Smart Turn link, as `openTurnLink` makes it; null without Smart Turn. */
  smartPort?: MessagePort;
  inputRate?: number;
}

/** Int16@inputRate to Float32@16 kHz, linear: the worker's `resampleInt16ToFloat32_16k`. */
export function resampleInt16ToFloat32_16k(samples: Int16Array, inputRate: number): Float32Array {
  const ratio = inputRate / VAD_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    const vLo = samples[lo] / 32768;
    const vHi = samples[hi] / 32768;
    out[i] = vLo + (vHi - vLo) * frac;
  }

  return out;
}

export function legacyVadLoop(o: LegacyVadLoopOptions) {
  const segments: LegacySegment[] = [];
  const inputRate = o.inputRate ?? 24000;
  let audioBuffer = new Float32Array(0);
  let totalSamplesFed = 0;
  let speechFramesSinceStart = 0;

  const scheduleWhisper = (audio: Float32Array, startSample: number, end: LegacySegment['end']) => {
    segments.push({ audio, startSample, end, fedAt: totalSamplesFed });
  };

  // initVad
  const config = o.vadConfig;
  const { positive: positiveSpeechThreshold, negative: negativeSpeechThreshold } = resolveVadThresholds(config);
  const redemptionMs = (config?.minSilenceDuration ?? 1.4) * 1000;
  const minSpeechMs = (config?.minSpeechDuration ?? 0.4) * 1000;
  const preSpeechPadMs = (config?.preSpeechPadDuration ?? 0.8) * 1000;
  const maxSpeechFrames = resolveMaxSpeechFrames(config?.maxSpeechDuration, preSpeechPadMs, o.limit);
  const frameProcessor = new FrameProcessor(
    async (frame) => {
      const prob = o.infer(frame);
      return { isSpeech: prob, notSpeech: 1 - prob };
    },
    () => { /* resetModel: a no-op, the probabilities are replayed */ },
    { positiveSpeechThreshold, negativeSpeechThreshold, redemptionMs, minSpeechMs, preSpeechPadMs, submitUserSpeechOnPause: false },
    VAD_FRAME_MS,
  );
  frameProcessor.resume();
  const turnLink: TurnLink | null = openTurnLink(o.smartPort, config, frameProcessor as unknown as FrameProcessorParams);

  /** feedAudio, minus the `processingVad` guard (one caller, awaited). */
  async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
    const resampled = resampleInt16ToFloat32_16k(samples, sampleRate);

    const newBuf = new Float32Array(audioBuffer.length + resampled.length);
    newBuf.set(audioBuffer);
    newBuf.set(resampled, audioBuffer.length);
    audioBuffer = newBuf;

    while (audioBuffer.length >= VAD_FRAME_SAMPLES) {
      const frame = audioBuffer.slice(0, VAD_FRAME_SAMPLES);
      audioBuffer = audioBuffer.slice(VAD_FRAME_SAMPLES);
      totalSamplesFed += VAD_FRAME_SAMPLES;

      const events: FrameProcessorEvent[] = [];
      await frameProcessor.process(frame, (ev) => events.push(ev));

      let speechProbability = 0;
      for (const ev of events) {
        switch (ev.msg) {
          case Message.FrameProcessed:
            speechProbability = ev.probs.isSpeech;
            break;

          case Message.SpeechStart:
            speechFramesSinceStart = 0;
            break;

          case Message.SpeechEnd:
            speechFramesSinceStart = 0;
            scheduleWhisper(ev.audio, segmentStartSample(totalSamplesFed, ev.audio), { endedBy: 'silence' });
            break;

          case Message.VADMisfire: {
            speechFramesSinceStart = 0;
            const rescued = turnLink?.rescue();
            if (rescued) scheduleWhisper(rescued, segmentStartSample(totalSamplesFed, rescued), { endedBy: 'kept' });
            break;
          }
        }
      }

      const smartTurnProbability = turnLink?.afterFrame(frame, speechProbability, frameProcessor.speaking) ?? null;
      if (smartTurnProbability !== null) {
        const endEvents: FrameProcessorEvent[] = [];
        frameProcessor.endSegment((ev) => endEvents.push(ev));
        for (const ev of endEvents) {
          if (ev.msg === Message.SpeechEnd) scheduleWhisper(ev.audio, segmentStartSample(totalSamplesFed, ev.audio), { endedBy: 'smart', smartTurnProbability });
        }
      }

      if (frameProcessor.speaking) {
        speechFramesSinceStart++;
        if (speechFramesSinceStart >= maxSpeechFrames) {
          const endEvents: FrameProcessorEvent[] = [];
          frameProcessor.endSegment((ev) => endEvents.push(ev));
          for (const ev of endEvents) {
            if (ev.msg === Message.SpeechEnd) {
              scheduleWhisper(ev.audio, segmentStartSample(totalSamplesFed, ev.audio), { endedBy: 'cap' });
            }
          }
          turnLink?.reset();
          speechFramesSinceStart = 0;
        }
      } else {
        speechFramesSinceStart = 0;
      }
    }
  }

  /** handleFlush, minus the wait for the decode chain. */
  function handleFlush(): void {
    if (frameProcessor?.speaking) {
      const endEvents: FrameProcessorEvent[] = [];
      frameProcessor.endSegment((ev) => endEvents.push(ev));
      for (const ev of endEvents) {
        if (ev.msg === Message.SpeechEnd) {
          scheduleWhisper(ev.audio, segmentStartSample(totalSamplesFed, ev.audio), { endedBy: 'flush' });
        } else if (ev.msg === Message.VADMisfire) {
          const rescued = turnLink?.rescue();
          if (rescued) scheduleWhisper(rescued, segmentStartSample(totalSamplesFed, rescued), { endedBy: 'kept' });
        }
      }
      turnLink?.reset();
      speechFramesSinceStart = 0;
    }
  }

  return {
    segments,
    maxSpeechFrames,
    feed: (samples: Int16Array) => feedAudio(samples, inputRate),
    flush: handleFlush,
  };
}
