/**
 * Voxtral WebGPU Streaming ASR Worker
 *
 * The turn detector's audio (Int16@24kHz) with turn marks → Voxtral Mini 4B (WebGPU)
 * Model files loaded from IndexedDB via customCache bridge (same as Whisper WebGPU).
 *
 * Unlike Whisper (batch: VAD → complete utterance → decode), Voxtral runs
 * continuous streaming inference with an async inputFeaturesGenerator.
 * The turns come from the app's turn detector: it relays the leg's audio on `segmentPort`, in order, with
 * `start`, `end` and `cancel` marks between the samples, and this worker acts on each mark where it arrives
 * (spec C1). Optional punctuation splitting inside a turn gives lower translation latency.
 * The worker runs no VAD: it cannot start without the port.
 *
 * Input messages:  VoxtralAsrInitMessage | AsrDisposeMessage (and, on `segmentPort`, MarksOutput)
 * Output messages: StreamingAsrWorkerOutMessage (ready, status, partial, result, error, disposed)
 */

import {
  BaseStreamer,
  StoppingCriteria,
  VoxtralRealtimeForConditionalGeneration,
  VoxtralRealtimeProcessor,
  env,
  type ProgressInfo,
} from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';
import { DETECTOR_INPUT_SAMPLE_RATE, type MarksOutput } from './_shared/turn-detector-protocol';
import {
  AudioPositionBudget,
  boundedBatchEndSample,
  promoteQueued,
  QueuedUtterance,
  StreamingAudioFeed,
  StreamingTextAccumulator,
  tailPadSamples,
} from './_shared/streaming-generation';

import type {
  VoxtralAsrInitMessage,
  AsrDisposeMessage,
  StreamingAsrWorkerOutMessage,
} from '../types';
import { bindCheckedWebGpuAdapter } from './shaderF16Gate';

// ─── ORT / Transformers.js env setup ─────────────────────────────────────────

// Workaround: HF CDN Range request cache pollution
const _origFetch = env.fetch;
env.fetch = (input: any, init?: any) => {
  const headers = init?.headers;
  const hasRange =
    headers instanceof Headers
      ? headers.has('Range')
      : Array.isArray(headers)
        ? headers.some(([k]: [string]) => k.toLowerCase() === 'range')
        : headers && typeof headers === 'object' && 'Range' in headers;
  if (hasRange) {
    return _origFetch(input, { ...init, cache: 'no-store' });
  }
  return _origFetch(input, init);
};

// ─── Types & Helpers ─────────────────────────────────────────────────────────

type WorkerMessage = VoxtralAsrInitMessage | AsrDisposeMessage;

function post(msg: StreamingAsrWorkerOutMessage) {
  self.postMessage(msg);
}

// ─── Pre-roll ───────────────────────────────────────────────────────────────

/** The sample rate the model's feed runs at. */
const MODEL_FEED_SAMPLE_RATE = 16000;
/** How much audio before a turn's start mark is kept while idle (the turn's onset and the pre-pad the detector relayed ahead of it). */
let preSpeechPadSamples = Math.ceil(0.8 * MODEL_FEED_SAMPLE_RATE);

/** The detector's audio-and-marks port; null before init and after dispose. */
let marksPort: MessagePort | null = null;
/** Between a `start` mark and its `end` or `cancel`: the detector says a turn is open. */
let turnOpen = false;

// ─── Audio Buffer & Resampling ──────────────────────────────────────────────

function resampleInt16ToFloat32_16k(samples: Int16Array, inputRate: number): Float32Array {
  const ratio = inputRate / MODEL_FEED_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = samples[lo] / 32768 + ((samples[hi] / 32768) - (samples[lo] / 32768)) * frac;
  }
  return out;
}

// ─── Voxtral Model State ────────────────────────────────────────────────────

let voxtralModel: any = null;
let voxtralProcessor: any = null;
/**
 * Toggle punctuation-based sentence splitting.
 * When enabled, sentences ending with . 。 ! ? ！ ？ trigger immediate
 * result finalization (and translation) without waiting for VAD silence.
 * Set to false to use VAD-only endpoint detection.
 *
 * The renderer turns this off while the sentence-segmentation stage is active.
 * That stage does the same job against the growing partial and does it better:
 * it counts a mark only once RIGHT_CONTEXT_CHARS of text follow it, so it never
 * cuts inside a word the way this does when the decoder emits a period
 * mid-word, and it honours the user's sentences-per-bubble setting instead of
 * forcing one. Absent from the init message means true — the historical
 * default, and what every caller but Local Inference sends.
 */
let punctuationEndpointEnabled = true;

let isGenerating = false;
/** The turn that is generating was cancelled: its un-emitted text is dropped, not published. */
let discardRun = false;
/** An utterance that arrived while the previous run was still draining its tail. */
const queuedUtterance = new QueuedUtterance();
/** Teardown in progress — un-emitted tokens are dropped instead of flushed. */
let disposing = false;

// Voxtral audio buffer (Float32 @ 16kHz, accumulating for generate)
const audioFeed = new StreamingAudioFeed();

/**
 * Silence to append at an utterance end so the model can decode its tail.
 *
 * Voxtral Realtime emits tokens behind the audio it has been fed, and the
 * non-streaming path pads on the right for exactly this reason. Cutting the
 * feed at the VAD endpoint instead leaves the last words of every utterance
 * undecoded — the audio was buffered but never turned into tokens.
 * TAIL_PAD_TOKENS is the processor's `num_right_pad_tokens`.
 */
function utterancePadSamples(): number {
  if (!voxtralProcessor) return 0;
  return tailPadSamples(voxtralProcessor.raw_audio_length_per_tok);
}

function waitUntil(condition: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (condition()) return resolve();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

// ─── Voxtral Streaming Inference ────────────────────────────────────────────

async function runVoxtralGenerate(): Promise<void> {
  if (!voxtralModel || !voxtralProcessor || isGenerating) return;
  isGenerating = true;
  discardRun = false;

  const startTime = performance.now();
  const audio = () => audioFeed.audio;
  let accumulator: StreamingTextAccumulator | null = null;

  try {
    const numSamplesFirst = voxtralProcessor.num_samples_first_audio_chunk;

    await waitUntil(() => audioFeed.readyFor(numSamplesFirst));
    // Ended before a single chunk accumulated (misfire, or teardown): nothing to decode.
    if (audioFeed.stopped || !audioFeed.hasSamples(numSamplesFirst)) return;

    const firstChunkInputs = await voxtralProcessor(
      audio().subarray(0, numSamplesFirst),
      { is_streaming: true, is_first_audio_chunk: true },
    );

    const featureExtractor = voxtralProcessor.feature_extractor;
    const { hop_length, n_fft } = featureExtractor.config;
    const winHalf = Math.floor(n_fft / 2);
    const samplesPerTok = voxtralProcessor.audio_length_per_tok * hop_length;
    const tokensIn = (features: any): number => features.dims[2] / voxtralProcessor.audio_length_per_tok;

    // Audio positions against sampled tokens, so the run stops on the last
    // audio position instead of decoding one step with no audio.
    const budget = new AudioPositionBudget(firstChunkInputs.input_ids.dims[1]);
    budget.addChunk(tokensIn(firstChunkInputs.input_features));
    // Where the chunk after the ones yielded would end. Once the feed is
    // finishing and that lies past its length, no chunk is coming.
    let nextEndNeeded = voxtralProcessor.num_mel_frames_first_audio_chunk * hop_length - winHalf
      + voxtralProcessor.num_samples_per_audio_chunk;

    async function* inputFeaturesGenerator() {
      yield firstChunkInputs.input_features;

      let melFrameIdx = voxtralProcessor.num_mel_frames_first_audio_chunk;
      let startIdx = melFrameIdx * hop_length - winHalf;

      while (!audioFeed.stopped) {
        const endNeeded = startIdx + voxtralProcessor.num_samples_per_audio_chunk;

        await waitUntil(() => audioFeed.readyFor(endNeeded));
        if (audioFeed.stopped) break;
        // Graceful finish: keep consuming whole chunks until the padded tail is
        // drained. The stop criterion then ends generate() on the last audio
        // position and the streamer flushes its last tokens.
        if (!audioFeed.hasSamples(endNeeded)) break;

        const batchEndSample = boundedBatchEndSample(endNeeded, audio().length, samplesPerTok);

        const chunkInputs = await voxtralProcessor(
          audio().slice(startIdx, batchEndSample),
          { is_streaming: true, is_first_audio_chunk: false },
        );

        melFrameIdx += chunkInputs.input_features.dims[2];
        startIdx = melFrameIdx * hop_length - winHalf;
        // Counted before the yield: the step that pulls this chunk encodes it
        // and is judged against it.
        budget.addChunk(tokensIn(chunkInputs.input_features));
        nextEndNeeded = startIdx + voxtralProcessor.num_samples_per_audio_chunk;

        yield chunkInputs.input_features;
      }
    }

    const noMoreChunks = () => audioFeed.stopped || (audioFeed.finishing && !audioFeed.hasSamples(nextEndNeeded));
    const stopAtLastAudio = new (class extends StoppingCriteria {
      _call(inputIds: number[][]): boolean[] {
        return inputIds.map(() => budget.exhausted(noMoreChunks()));
      }
    })();

    const tokenizer = voxtralProcessor.tokenizer;
    const specialIds = new Set(tokenizer.all_special_ids.map(BigInt));
    let isPrompt = true;
    let segmentStartTime = startTime;

    accumulator = new StreamingTextAccumulator(
      (tokens) => tokenizer.decode(tokens, { skip_special_tokens: true }),
      {
        onPartial: (text) => post({ type: 'partial', text }),
        onResult: (text) => {
          const now = performance.now();
          post({
            type: 'result',
            text,
            durationMs: Math.round(now - segmentStartTime),
            recognitionTimeMs: Math.round(now - startTime),
          });
          segmentStartTime = now;
        },
        punctuationEndpoint: punctuationEndpointEnabled,
        // Tekken's decoder is pure ByteLevel with clean_up_tokenization_spaces
        // false (tokenizer.json / tokenizer_config.json), so a window that
        // starts at a character boundary decodes to exactly the text the
        // whole utterance would have there.
        positionIndependentDecode: true,
      },
    );

    const streamer = new (class extends BaseStreamer {
      put(value: bigint[][]) {
        if (audioFeed.stopped) return;
        if (isPrompt) { isPrompt = false; return; }
        budget.tokenSampled();
        const tokens = value[0];
        if (tokens.length === 1 && specialIds.has(tokens[0])) return;
        accumulator!.push(tokens);
      }
      end() {
        // Flush, don't drop: tokens decoded but not yet emitted are real
        // transcription. Only teardown discards them.
        accumulator!.end({ discard: disposing || discardRun });
        isPrompt = true;
      }
    })();

    await (voxtralModel as any).generate({
      input_ids: firstChunkInputs.input_ids,
      input_features: inputFeaturesGenerator(),
      max_new_tokens: 4096,
      streamer: streamer as any,
      stopping_criteria: stopAtLastAudio,
    });
  } catch (err: any) {
    if (!audioFeed.stopped) {
      post({ type: 'error', error: `Voxtral inference failed: ${err.message || err}` });
    }
  } finally {
    // Safety net: generate() throwing skips the streamer's end().
    accumulator?.end({ discard: disposing || discardRun });
    // A cancelled press's run publishes no text, but the source segment its partials opened is still open on the main
    // thread. An empty result closes it, with no job, and so the next press opens a segment of its own.
    if (discardRun && !disposing) {
      post({ type: 'result', text: '', durationMs: 0, recognitionTimeMs: 0 });
    }
    isGenerating = false;
    discardRun = false;
    // Audio staged during the finish belongs to the next utterance.
    audioFeed.complete();
    const next = disposing ? null : promoteQueued(audioFeed, queuedUtterance);
    if (next && (!voxtralModel || !voxtralProcessor)) {
      // No run can start, so nothing would ever drain the queue: drop it rather
      // than hold the idle trim off indefinitely.
      audioFeed.clear();
      queuedUtterance.clear();
    } else if (next) {
      void runVoxtralGenerate();
      // SpeechEnd arrived while the old run was still draining. Its segment was
      // sealed at that endpoint, so the promoted run finishes right away.
      if (next === 'finish') audioFeed.requestFinish(utterancePadSamples());
    }
  }
}

/**
 * End the current utterance gracefully: pad the tail with silence so the model
 * decodes the words it is still holding, then let generate() finish on its own.
 */
function finishGenerate() {
  if (queuedUtterance.finish()) {
    audioFeed.sealStaged();
    return;
  }
  if (!isGenerating) {
    audioFeed.clear();
    return;
  }
  audioFeed.requestFinish(utterancePadSamples());
}

/**
 * Abandon the current utterance without decoding its tail. `discardText`: also drop what it has decoded but not yet
 * emitted (a cancelled press publishes nothing); a queued utterance is the one cancelled, if there is one, and the run
 * still draining is the turn before it, which keeps its text.
 */
function abortGenerate(discardText = false) {
  if (discardText) {
    // A cancelled press may be queued still open or already ended; either way it is the one cancelled, and the run
    // draining ahead of it keeps its text. An ended one already owns a sealed segment; only an open one seals now.
    const queued = queuedUtterance.cancel();
    if (queued !== null) {
      if (queued === 'open') audioFeed.sealStaged();
      return;
    }
  } else if (queuedUtterance.stop()) {
    audioFeed.sealStaged();
    return;
  }
  if (discardText && isGenerating) discardRun = true;
  audioFeed.requestStop();
  if (!isGenerating) audioFeed.clear();
}

// ─── The turn detector's audio and marks ────────────────────────────────────

/** Keep enough pre-roll for the turn onset and Voxtral's first chunk, but not an unbounded idle backlog. */
function trimIdleAudio(): void {
  if (!turnOpen && !isGenerating && !queuedUtterance.pending) {
    audioFeed.retainLatest(Math.max(preSpeechPadSamples, voxtralProcessor?.num_samples_first_audio_chunk ?? 0));
  }
}

/**
 * One message from the detector, handled the moment it arrives: the port is ordered and nothing here awaits, so
 * a mark acts on exactly the audio before it (spec C1). `start` starts, or queues behind the run still draining
 * its tail; `end` finishes on the audio received so far; `cancel` abandons the turn.
 */
function onMarksMessage(msg: MarksOutput): void {
  if (!voxtralModel) return;
  switch (msg.type) {
    case 'audio':
      audioFeed.append(resampleInt16ToFloat32_16k(msg.pcm, DETECTOR_INPUT_SAMPLE_RATE));
      trimIdleAudio();
      return;
    case 'mark':
      switch (msg.event) {
        case 'start':
          turnOpen = true;
          // Keep accumulated audio: it holds the pre-roll and the onset that opened the turn. The detector
          // tells the main thread about the speech; this worker does not.
          if (isGenerating) {
            // The previous utterance is still draining its padded tail; its run picks this one up when it completes.
            queuedUtterance.start();
          } else {
            void runVoxtralGenerate();
          }
          return;
        case 'end':
          turnOpen = false;
          finishGenerate();
          return;
        case 'cancel':
          turnOpen = false;
          abortGenerate(true);
          return;
      }
  }
}

// ─── Init Handler ───────────────────────────────────────────────────────────

async function handleInit(msg: VoxtralAsrInitMessage): Promise<void> {
  try {
    const startTime = performance.now();

    punctuationEndpointEnabled = msg.punctuationEndpoint ?? true;

    if (!msg.segmentPort) throw new Error('segmentPort is required — this worker takes the turn detector\'s audio and marks');

    // 1. How much audio to keep ahead of a turn: the only part of the VAD config this worker reads.
    const padMs = (msg.vadConfig?.preSpeechPadDuration ?? 0.8) * 1000;
    preSpeechPadSamples = Math.ceil((padMs / 1000) * MODEL_FEED_SAMPLE_RATE);
    // NaN would survive the idle trim's Math.max() and discard the first chunk too.
    if (!Number.isFinite(preSpeechPadSamples) || preSpeechPadSamples < 0) preSpeechPadSamples = 0;

    // 2. Configure Transformers.js for IndexedDB blob URL cache
    initTransformersEnv(env, msg);

    // 3. Load Voxtral model
    post({ type: 'status', message: 'Loading Voxtral model (WebGPU)...' });

    const dtype = typeof msg.dtype === 'string'
      ? { audio_encoder: msg.dtype, embed_tokens: msg.dtype, decoder_model_merged: msg.dtype }
      : msg.dtype;

    await bindCheckedWebGpuAdapter(env.backends.onnx, dtype, 'Voxtral');

    voxtralModel = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
      msg.hfModelId,
      {
        dtype: dtype as any,
        device: 'webgpu',
        progress_callback: (info: ProgressInfo) => {
          if (info.status === 'progress' && info.file.endsWith('.onnx_data') && info.total > 0) {
            const pct = Math.round((info.loaded / info.total) * 100);
            post({ type: 'status', message: `Loading model... ${pct}%` });
          }
        },
      },
    );

    // 4. Load processor
    post({ type: 'status', message: 'Loading processor...' });
    voxtralProcessor = await VoxtralRealtimeProcessor.from_pretrained(msg.hfModelId);

    // Reset buffers
    audioFeed.clear();
    queuedUtterance.clear();
    disposing = false;
    turnOpen = false;

    // Listen to the detector only now the model is ready: nothing it sent before is acted on against no model.
    marksPort?.close();
    marksPort = msg.segmentPort;
    marksPort.onmessage = (e: MessageEvent<MarksOutput>) => onMarksMessage(e.data);

    const loadTimeMs = Math.round(performance.now() - startTime);
    post({ type: 'ready', loadTimeMs });
  } catch (err: any) {
    // A port this worker was handed but never listened to: close it, so the detector's relay does not post into a void.
    if (marksPort !== msg.segmentPort) msg.segmentPort?.close();
    post({ type: 'error', error: err.message || String(err) });
  }
}

// ─── Dispose ────────────────────────────────────────────────────────────────

async function handleDispose(): Promise<void> {
  disposing = true;
  // Stop listening first: a mark arriving mid-teardown must not start a run.
  if (marksPort) {
    marksPort.onmessage = null;
    marksPort.close();
    marksPort = null;
  }
  turnOpen = false;
  // Drop queued utterances first: with one queued, abortGenerate() would only
  // seal it and leave the run that is still draining untouched.
  queuedUtterance.clear();
  abortGenerate();

  // Wait briefly for generate to stop
  await new Promise((r) => setTimeout(r, 100));

  // Dispose Voxtral
  if (voxtralModel) {
    await (voxtralModel as any).dispose?.();
    voxtralModel = null;
  }
  voxtralProcessor = null;

  audioFeed.clear();
  queuedUtterance.clear();
  isGenerating = false;

  post({ type: 'disposed' });
}

// ─── Message Router ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg as VoxtralAsrInitMessage);
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
