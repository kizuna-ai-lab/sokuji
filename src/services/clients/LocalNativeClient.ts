import type { IClient, SessionConfig, ConversationItem, ClientEventHandlers, ResponseConfig } from '../interfaces/IClient';
import { isLocalNativeSessionConfig } from '../interfaces/IClient';
import type { ProviderType } from '../../types/Provider';
import { Provider } from '../../types/Provider';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { resampleFloat32, float32ToInt16 } from '../../utils/audio-conversion';
import { reconcileTtsVoice } from '../../lib/local-inference/native/nativeTtsVoiceReconciliation';
import { voiceCapability, requiresVoiceClip, eligibleCustomVoices } from '../../lib/local-inference/native/nativeCatalog';
import { voiceStoreFor } from '../../lib/local-inference/native/nativeVoiceStores';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { splitSentences } from '../../utils/splitSentences';
import { useNativeModelStore, nativeListTtsVoices, nativeHardwareInfo } from '../../stores/nativeModelStore';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { createNativeVadWorker } from './createNativeVadWorker';
import { SentenceStream } from '../../lib/segmentation/SentenceStream';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
import { countSkeleton, offsetAfterSkeleton } from '../../lib/segmentation/sealCursor';

interface Deps {
  asr?: NativeAsrClient | any;
  translate?: NativeTranslateClient | any;
  tts?: NativeTtsClient | any;
  vadWorker?: () => Worker | null;
  /** The sentence segmentation stage. Absent, or disabled at connect, means
   *  today's behaviour exactly — see ensureStream(). The object is live: its
   *  `enabled` can turn true when the punctuation pack finishes downloading,
   *  which is why connect() freezes that answer for the session. */
  segmentation?: SegmentationRuntime | null;
  /** How many sentences fill one bubble. Configuration, not a collaborator —
   *  there is no sensible default to fall back to besides "absent". */
  sentencesPerChunk?: number;
}

interface AsrTiming {
  durationMs?: number;
  recognitionTimeMs?: number;
}

/**
 * IClient for the native (Electron sidecar) provider. Orchestrates the native
 * WS clients into the session's ConversationItem pipeline: ASR → translation,
 * with TTS optional (native TTS today is Pocket/voice-cloning and needs a
 * reference clip, so the MVP is text-only). Does not touch LocalInferenceClient.
 */
export class LocalNativeClient implements IClient {
  private asr: any;
  private translate: any;
  private tts: any;
  private handlers: ClientEventHandlers = {};
  private items: ConversationItem[] = [];
  private connected = false;
  private idCounter = 0;
  private cfg: any = null;
  private ttsEnabled = false;
  private ttsStreaming = false;
  private ttsSpeed = 1.0;
  private ttsVoiceLabel = '';
  private keepReplayAudio: boolean = false;
  private queue: Promise<void> = Promise.resolve();
  private partialUserItem: ConversationItem | null = null;
  /** The assistant item created on the first translate_partial of the job
   *  currently running, cleared once that job finishes (success or failure).
   *  The job queue serializes runJob calls, so one field suffices. */
  private currentTranslateItem: ConversationItem | null = null;
  private vadWorkerFactory: () => Worker | null;
  private vadWorker: Worker | null = null;
  private vadReady = false;

  // Sentence segmentation: the runtime and per-bubble sentence count, read
  // once from Deps in the constructor — the client never touches a store.
  // Absent, or disabled at connect, means today's behaviour exactly; see
  // `sessionSegmentation` and ensureStream().
  private segmentation: SegmentationRuntime | null = null;
  private sentencesPerChunk = 3;
  /**
   * The runtime THIS session seals with, or null when it does not seal at
   * all. Built once, in `connect()`, as a frozen view over the live runtime:
   * `enabled: true` fixed, `punctuate` delegated.
   *
   * Frozen because the live `enabled` moves in both directions under an open
   * session — the pack finishing its download turns it true, a delete or the
   * memory-debug override turns it false. True-again would wake this stage up
   * halfway through an utterance that started without it. False-again is
   * worse: every `SentenceStream` also reads `enabled` once, at its own
   * construction, so a stream built after the flip is inert while the client
   * still routes the utterance into it — no bubble, no translation, for that
   * utterance and every later one in the session. One frozen view handed to
   * every stream is what makes those two reads one answer. Reset in
   * `disconnect()`. (LocalInferenceClient carries the same field for the same
   * reason, plus the ASR worker's own punctuation endpoint, which it derives
   * from the same one answer.)
   */
  private sessionSegmentation: SegmentationRuntime | null = null;
  /** One stream per utterance, source side. Null between utterances. */
  private stream: SentenceStream | null = null;
  /**
   * How much of the current utterance's raw ASR text is already folded into
   * a seal, counted in LETTERS AND DIGITS (see sealCursor.ts).
   * `SentenceStream.update()` expects the text since the last seal, not the
   * cumulative hypothesis the sidecar actually sends: `asr_engine.py` appends
   * every partial onto its buffer and posts the whole of it, resetting only
   * at a cut (which is what becomes `onAsrResult`). Re-slicing the raw text
   * at this cursor on every call turns that cumulative growth into the delta
   * the stream expects.
   *
   * Not a character offset, and not a count of non-whitespace characters
   * either, because a final is not the last partial with more text on the
   * end. The sidecar's gated streaming branch posts the partial unstripped
   * (`_drive_utterance`) and the final stripped (`_finalize`), so a
   * character offset lands one too far — a real character in Chinese or
   * Japanese, where no space separates two sentences. A streaming final is
   * also a fresh decode (`full_text`, `asr_backend.py`), which revises
   * punctuation: moonshine dropped a full stop its partial had, and a
   * non-whitespace count then ate the next sentence's first letter. Letters
   * and digits are what every spelling of the same words agrees on, and they
   * are the unit the segmentation stage compares by (`skeleton()` in
   * sentenceEnd.ts). A final that revises WORDS before the seal point is
   * beyond any count — see `isTruncationOfSameUtterance`.
   *
   * Advanced from `onPending`, NOT by the sealed text's own length: on the
   * model path the sealed text carries inserted punctuation the raw input did
   * not, so advancing by it would over-consume the raw text and silently
   * delete real speech from the next chunk — see the `onPending` wiring in
   * `ensureStream()`.
   */
  private sealedSkeleton = 0;
  /** `sealedSkeleton` at the moment `lastPassedToStream` was handed to
   *  `stream.update()` — the base the `onPending` recompute in
   *  `ensureStream()` adds to. Set by `feedStream()`. */
  private sealedSkeletonBase = 0;
  /** The exact string most recently passed to `stream.update()` (already
   *  sliced at `sealedSkeletonBase`). Set by `feedStream()`. */
  private lastPassedToStream = '';
  /**
   * The full raw text most recently handed to `onAsrPartial`, before slicing
   * at `sealedSkeleton`. Used to tell a genuinely different ASR result apart
   * from one that merely re-decoded (and truncated) the SAME utterance —
   * see `isTruncationOfSameUtterance()`.
   */
  private lastRawPartialText = '';
  /** Set by `onAsrResult` AFTER it feeds the final text to the stream but
   *  BEFORE calling `end()` — not before `feedStream()`, because `update()`
   *  alone can seal more than one chunk synchronously. Read by
   *  `sealUserChunk` (captured into a local before the job is queued) when it
   *  pushes the job. Undefined at every other moment, which is what keeps the
   *  timing off the mid-utterance chunks. */
  private pendingAsrTiming: AsrTiming | undefined;

  constructor(deps: Deps = {}) {
    this.asr = deps.asr ?? new NativeAsrClient();
    this.translate = deps.translate ?? new NativeTranslateClient();
    this.tts = deps.tts ?? new NativeTtsClient();
    this.vadWorkerFactory = deps.vadWorker ?? createNativeVadWorker;
    this.segmentation = deps.segmentation ?? null;
    this.sentencesPerChunk = deps.sentencesPerChunk ?? 3;
  }


  /**
   * Emit a diagnostic: the session continues, degraded. participantTelemetry
   * gives the code its channel and severity.
   */
  private diagnose(code: ClientDiagnosticCode, message: string, cause?: unknown): void {
    this.handlers.onDiagnostic?.({ code, message, cause });
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isLocalNativeSessionConfig(config)) throw new Error('LocalNativeClient requires a local_native config');
    this.cfg = config;
    // The one read of the runtime's `enabled` this session gets — see the
    // `sessionSegmentation` field doc.
    //
    // `enabled` is the session's answer, not the runtime's current one: both
    // the pack finishing its download and the memory-debug override can flip
    // the real getter mid-session, and a stream built from a flipped value is
    // inert while the client still routes the utterance into it — no bubble,
    // no translation.
    const active = this.segmentation?.enabled === true;
    const runtime = this.segmentation;
    this.sessionSegmentation = active && runtime
      ? {
          enabled: true,
          punctuate: (lang, text, opts) => runtime.punctuate(lang, text, opts),
          // Forwarded so the stage's own counters survive the freeze: this view
          // is what SentenceStream and punctuateDefinite report through, and
          // dropping it here would make every seal invisible. Counts, never text.
          observe: (event) => runtime.observe?.(event),
        }
      : null;
    // A reconnect without an intervening disconnect() must not inherit a
    // stream opened under the PREVIOUS config.
    this.stream?.dispose();
    this.stream = null;
    this.sealedSkeleton = 0;
    this.pendingAsrTiming = undefined;
    this.lastRawPartialText = '';
    this.asr.onResult = (r: any) => this.onAsrResult(r);
    this.asr.onPartialResult = (text: string) => this.onAsrPartial(text);
    this.asr.onError = (e: string) => this.handlers.onError?.(e);
    this.translate.onError = (e: string) => this.handlers.onError?.(e);
    this.translate.onPartial = (text: string) => this.onTranslatePartial(text);
    this.tts.onError = (e: string) => this.handlers.onError?.(e);
    this.emitEvent('local.native.init.start', 'client', {
      asr: config.asrModelId, translation: config.translationModelId, tts: config.ttsModelId,
      sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage,
    });
    // Best-effort machine snapshot so the Logs panel shows which GPU/backends
    // the session resolved against (helps diagnose "GPU wasn't used"). Fire-and-
    // forget: this diagnostic probe must never delay ASR/translation init on the
    // startup critical path. Null (sidecar unavailable) simply skips the line.
    nativeHardwareInfo().then((hw) => {
      if (hw) {
        this.emitEvent('local.native.hardware', 'client', {
          os: hw.os, arch: hw.arch, cpuCores: hw.cpuCores,
          gpus: hw.gpus, backendsInstalled: hw.backendsInstalled, accelAvailable: hw.accelAvailable,
          generation: hw.generation ?? null, devices: hw.devices ?? null,
        });
      }
    }).catch(() => { /* diagnostics only — ignore probe failures */ });
    this.ttsSpeed = config.ttsSpeed ?? 1.0;
    this.keepReplayAudio = config.keepReplayAudio ?? false;
    const store = useNativeModelStore.getState();
    const initTranslate = async () => {
      // Transcription-only session: no model selected. Skip init entirely —
      // the sidecar would otherwise substitute its default translation model
      // and silently translate in a session the UI declared ASR-only.
      if (!config.translationModelId) return;
      const tr = await this.translate.init(
        config.sourceLanguage, config.targetLanguage, config.translationModelId, config.translationDevice,
        config.asrModelId, config.ttsModelId, config.translationVariant,
      );
      store.setTranslationResolved({ model: config.translationModelId ?? '', device: tr.device ?? 'cpu', backend: tr.backend, computeType: tr.computeType, tokensPerSec: tr.tokensPerSec, memoryBytes: tr.memoryBytes, fallbackReason: tr.fallbackReason });
      this.emitInitReady('translation', config.translationModelId ?? '', tr);
    };
    const initAsr = async () => {
      store.setAsrLoading(true);
      try {
        const res = await this.asr.init(config.sourceLanguage, config.asrModelId, 24000,
          config.asrDevice, config.asrVariant);
        store.setAsrResolved({ model: config.asrModelId, device: res.device ?? 'cpu', backend: res.backend, computeType: res.computeType, rtf: res.rtf, memoryBytes: res.memoryBytes, fallbackReason: res.fallbackReason });
        this.emitInitReady('asr', config.asrModelId ?? '', res);
      } finally {
        store.setAsrLoading(false);
      }
    };
    // Load the GPU-priority stage first so it claims VRAM before the flexible
    // stage. With two Auto models that can't co-reside (e.g. a GPU-only Voxtral +
    // a 2B Qwen translation), whoever loads first wins the card; the flexible
    // model then degrades to CPU instead of the GPU-only one hard-failing.
    if (this.asrLoadsFirst(config.asrModelId, config.translationModelId ?? '')) {
      await initAsr();
      await initTranslate();
    } else {
      await initTranslate();
      await initAsr();
    }
    this.ttsEnabled = !!config.ttsModelId && !config.textOnly;
    if (this.ttsEnabled) {
      // Renderer-side mirror of the sidecar's R16 pre-check (tts_backend.py's
      // `_ensure_voice_ready`, over `catalog.VOICE_REQUIRED_FAMILIES`): a model
      // that reports `voice.required` — qwen3_tts, omnivoice, index_tts2 — can
      // never speak without a stored clip. That flag comes off the wire; it is
      // NOT inferred from the voice shape, which looks identical for the
      // families that clone but speak fine with nothing set (MOSS, VoxCPM,
      // Irodori). Checked BEFORE loading the model: catching it
      // here turns what would otherwise be a `tts_degraded` diagnostic on
      // EVERY sentence of the session into one clear, up-front notice, and
      // skips a model load that could only ever fail to synthesize. Skipped
      // entirely when the catalog hasn't loaded yet (voiceCapability then
      // resolves to none/none) — the unchanged init path below still applies
      // in that case, same as before this check existed.
      const gateCap = voiceCapability(store.catalog[config.ttsModelId!]);
      if (requiresVoiceClip(gateCap)) {
        const gateStore = voiceStoreFor(gateCap.custom, config.ttsModelId!);
        let eligibleClips = 0;
        if (gateStore) {
          try {
            const clips = await gateStore.list();
            eligibleClips = eligibleCustomVoices(clips, gateCap.transcriptRequired).length;
          } catch { /* storage unavailable — treated as no clip, matches R16 */ }
        }
        if (eligibleClips === 0) {
          this.ttsEnabled = false;
          this.diagnose('tts_degraded', `TTS unavailable, continuing without it: "${config.ttsModelId}" needs a voice clip — record or import one in Settings first`);
          // A notice, not onError: the session goes on (text-only), so the
          // user is owed a sentence they can still find, not a session-broken
          // signal. onError's bubble lives only in MainPanel's React state and
          // connectConversation's setItems(getConversationItems()) wipes it
          // the moment connect() resolves — which is exactly how this notice
          // used to vanish before anyone read it (#481 has the full inventory).
          this.emitSystemNotice(`"${config.ttsModelId}" needs a voice clip — record or import one in Settings before it can speak`);
        }
      }
    }
    if (this.ttsEnabled) {
      store.setTtsLoading(true);
      try {
        const r = await this.tts.init(config.ttsModelId, config.ttsDevice, config.targetLanguage, config.ttsVariant);
        this.ttsStreaming = !!r.streaming;
        store.setTtsResolved({ model: config.ttsModelId!, device: r.device ?? 'cpu', backend: r.backend, computeType: r.computeType,
          rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason });
        this.emitInitReady('tts', config.ttsModelId!, r);
        // Apply the selected voice (next-session semantics), driven by the
        // model's capability (built-in named and/or custom clip — native_tts
        // has no range/style equivalent, see nativeCatalog.voiceCapability)
        // rather than a MOSS-specific "clones" flag, so any current or future
        // voice-capable model resolves through the same path. Custom ids
        // resolve against the capability's own store; a missing/deleted
        // custom voice reconciles back to the per-language default. Storage
        // failure degrades to built-in voices only (it must not kill TTS),
        // so list() failures are caught locally.
        // If the catalog hasn't loaded yet, fall back to the init response's
        // clones flag (the pre-capability behavior) so a clone-capable model
        // still applies its custom/named voice instead of silently degrading.
        const ttsModel = store.catalog[config.ttsModelId!]
          ?? ({ clones: r.clones } as unknown as NativeModelInfo);
        const cap = voiceCapability(ttsModel);
        const voiceStore = voiceStoreFor(cap.custom, config.ttsModelId!);
        // Filtered by the SAME eligibility predicate as the pre-init gate above:
        // an unfiltered list would let a stored `custom:X` survive reconciliation
        // even when X lacks a transcript this model requires, as long as some
        // OTHER clip happens to be eligible (the gate only checks "does at
        // least one eligible clip exist", not "is the STORED selection one of
        // them") — reconcileTtsVoice would then keep applying the ineligible X.
        let customIds: number[] = [];
        if (voiceStore) {
          try { customIds = eligibleCustomVoices(await voiceStore.list(), cap.transcriptRequired).map((v) => v.id); }
          catch { /* storage unavailable → built-in voices only */ }
        }
        const voiceList = cap.builtin === 'named' ? await nativeListTtsVoices(config.ttsModelId) : [];
        const storedVoice = config.ttsVoice ?? '';
        const voice = reconcileTtsVoice(storedVoice, customIds, config.targetLanguage, voiceList,
                                       cap.custom !== 'none', cap.builtin === 'named');
        // R35: the stored selection was a custom clip and reconcile swapped it
        // for a DIFFERENT eligible one (never '' or the same id — this is
        // exactly the "your ineligible clip got substituted" case, not the
        // ordinary "no selection yet" default resolution). One diagnostic per
        // session start, session continues normally on the substitute.
        if (storedVoice.startsWith('custom:') && voice.startsWith('custom:') && voice !== storedVoice) {
          this.diagnose('voice_fallback',
            `Configured voice ${storedVoice.slice('custom:'.length)} is no longer usable with this model (deleted, or missing a required transcript); substituted voice ${voice.slice('custom:'.length)}. Update the selection in settings.`);
        }
        this.ttsVoiceLabel = voice;   // e.g. builtin:Bella | custom:7 | sid:3 — logged on tts.start
        if (voice.startsWith('builtin:')) {
          await this.tts.setVoice?.(voice.slice('builtin:'.length));
        } else if (voice.startsWith('custom:') && voiceStore) {
          const payload = await voiceStore.resolveApply(Number(voice.slice('custom:'.length)));
          if (payload?.kind === 'clip') await this.tts.setReferenceVoice(payload.audio, payload.sampleRate, payload.transcript);
        }
        // else: single-voice model with no selection, or a stale sid:<n> setting
        // from before native_tts (which has no speaker-id equivalent) — send
        // nothing (backend uses speaker 0).
      } catch (e) {
        this.ttsEnabled = false;
        this.handlers.onError?.(`native TTS init failed: ${e}`);
      } finally {
        store.setTtsLoading(false);
      }
    }
    await new Promise<void>((resolve, reject) => {
      const worker = this.vadWorkerFactory();
      if (!worker) { resolve(); return; }               // test/no-worker env
      this.vadWorker = worker;
      const timer = setTimeout(() => reject(new Error('VAD worker init timeout')), 15000);
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'ready') { clearTimeout(timer); resolve(); }
        else if (msg.type === 'speech_start') {
          this.asr.sendVadMark?.('start');
          this.emitEvent('local.native.speech_start', 'client', {});
        }
        else if (msg.type === 'speech_end') { this.asr.sendVadMark?.('end'); }
        else if (msg.type === 'speech_cancel') { this.asr.sendVadMark?.('cancel'); }
        else if (msg.type === 'error') {
          if (this.vadReady) { this.handlers.onError?.(`VAD worker: ${msg.message}`); }
          else { clearTimeout(timer); reject(new Error(msg.message)); }
        }
      };
      worker.onerror = (err) => {
        // Post-ready the connect promise is settled — reject() would be a silent
        // no-op and the session would keep feeding a dead segmenter. Surface it.
        if (this.vadReady) { this.handlers.onError?.(`VAD worker: ${(err as ErrorEvent)?.message ?? err}`); return; }
        clearTimeout(timer); reject(err as any);
      };
      worker.postMessage({
        type: 'init',
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        vadConfig: {
          threshold: config.vadThreshold,
          minSilenceDuration: config.vadMinSilenceDuration,
          minSpeechDuration: config.vadMinSpeechDuration,
        },
      });
    });
    this.vadReady = true;
    this.connected = true;
    this.emitEvent('local.native.init.ready', 'client', { ttsEnabled: this.ttsEnabled });
    this.handlers.onOpen?.();
  }

  /**
   * Decide which stage loads first so the model that most needs the GPU claims
   * VRAM before the other. A model is "GPU-only" when the sidecar catalog lists
   * tiers for it but none is `cpu` (e.g. Voxtral) — that stage MUST get the GPU,
   * so it goes first. When both or neither are GPU-only, the larger model (by
   * download size) leads. Falls back to ASR-first when catalog/size data isn't
   * loaded yet — ASR is the only stage that can be GPU-only today, so leading
   * with it is the safe default. Never throws; ordering is best-effort.
   */
  private asrLoadsFirst(asrId: string, translationId: string): boolean {
    try {
      const { catalog, sizes } = useNativeModelStore.getState();
      const gpuOnly = (id: string): boolean => {
        const info = catalog[id];
        return !!info && info.tiers.length > 0 && !info.tiers.some((t) => t.tier === 'cpu');
      };
      const asrGpuOnly = gpuOnly(asrId);
      const trGpuOnly = gpuOnly(translationId);
      if (asrGpuOnly !== trGpuOnly) return asrGpuOnly;
      return (sizes[asrId] ?? 0) >= (sizes[translationId] ?? 0);
    } catch {
      return true;
    }
  }

  private nextId(p: string): string { return `${p}_${Date.now()}_${++this.idCounter}`; }

  private emit(item: ConversationItem, delta?: any): void {
    this.handlers.onConversationUpdated?.({ item, delta });
  }

  /**
   * A system notice the CLIENT holds. Pushed into `items` before it is
   * emitted, so it is part of every `getConversationItems()` read and survives
   * MainPanel's wholesale `setItems(getConversationItems())` — both the one in
   * connectConversation right after connect() and the one on every later
   * conversation update. Same contract as SonioxClient.emitSystemNotice; `error`
   * is the one system-item type the bubble renderer draws. `severity: 'warning'`
   * because the session goes on: without it, subtitleIdleState would read this
   * row, when it trails a session stopped before its first transcript, as a
   * failed start and offer Retry. Cleared with the rest of the conversation.
   */
  private emitSystemNotice(text: string): void {
    const item: ConversationItem = {
      id: this.nextId('notice'),
      role: 'system',
      type: 'error',
      severity: 'warning',
      status: 'completed',
      createdAt: Date.now(),
      formatted: { text },
      content: [{ type: 'text', text }],
    };
    this.items.push(item);
    this.emit(item);
  }

  /** Mirror the LocalInferenceClient logging contract so events reach the Logs panel. */
  private emitEvent(type: string, source: 'client' | 'server', data: Record<string, any> = {}): void {
    this.handlers.onRealtimeEvent?.({ source, event: { type, data } } as any);
  }

  /**
   * Surface the sidecar's resolved plan for one stage into the Logs panel:
   * which device/backend/quant it landed on, its load time and RTF/tokens, and
   * — critically — a distinct `.fallback` line when the stage was moved off the
   * requested device (e.g. GPU→CPU), which was previously silent. Only defined
   * metrics are attached so CPU-only stages don't log empty `rtf`/`memoryBytes`.
   */
  private emitInitReady(engine: 'asr' | 'translation' | 'tts', modelId: string, r: any): void {
    this.emitEvent(`local.native.init.${engine}.ready`, 'client', {
      model: modelId, device: r.device ?? 'cpu', backend: r.backend, computeType: r.computeType,
      ...(r.rtf !== undefined && { rtf: r.rtf }),
      ...(r.tokensPerSec !== undefined && { tokensPerSec: r.tokensPerSec }),
      ...(r.memoryBytes !== undefined && { memoryBytes: r.memoryBytes }),
      loadTimeMs: r.loadTimeMs,
    });
    if (r.fallbackReason) {
      this.emitEvent(`local.native.init.${engine}.fallback`, 'client', { model: modelId, fallbackReason: r.fallbackReason });
    }
  }

  /**
   * Accumulate a TTS audio chunk onto the item so the inline replay button has
   * a complete buffer. Gated on `keepReplayAudio`; real-time playback (via the
   * audio delta) is unaffected when this is skipped.
   */
  private appendItemAudio(item: ConversationItem, chunk: Int16Array): void {
    if (!item.formatted) item.formatted = {};
    const prev = item.formatted.audio;
    if (prev instanceof Int16Array && prev.length > 0) {
      const combined = new Int16Array(prev.length + chunk.length);
      combined.set(prev);
      combined.set(chunk, prev.length);
      item.formatted.audio = combined;
    } else {
      item.formatted.audio = new Int16Array(chunk);
    }
  }

  /**
   * The stream for the utterance in progress, created on first text.
   *
   * Returns null — meaning "no segmentation, behave exactly as today" —
   * whenever `sessionSegmentation` is null: no runtime, or one that was
   * disabled at connect. That check matters here and not just inside
   * SentenceStream: SentenceStream's own contract for "no runtime or
   * disabled" is "no sealing at all" (see its `active()`), so if this method
   * still built a live-but-inert stream, the whole utterance would be
   * silently dropped (no item, no job) instead of completing as one item and
   * one job the way it does today.
   *
   * An already-open stream is always reused (checked first, before the
   * guard) — "N is read once per stream".
   */
  private ensureStream(): SentenceStream | null {
    // Reuse the existing stream if already constructed. Safe because
    // `sessionSegmentation` is built once per session (see its field doc), so
    // the answer cannot change under an open stream: neither the pack
    // finishing its download nor the toggle moving reaches this decision
    // until the next connect(). Reading `this.segmentation.enabled` here
    // instead would reintroduce exactly that: a mid-utterance flip to false
    // would reuse this stream while SentenceStream went inert, and the tail
    // would be lost with the stranded user bubble overwritten by the next
    // utterance.
    if (this.stream) return this.stream;
    if (!this.sessionSegmentation) return null;
    this.sealedSkeleton = 0;
    this.stream = new SentenceStream({
      lang: this.cfg?.sourceLanguage ?? 'auto',
      // The session's frozen view, never `this.segmentation`: the stream reads
      // `enabled` once at construction, and that read must give the same
      // answer connect() gave.
      runtime: this.sessionSegmentation,
      sentencesPerChunk: this.sentencesPerChunk,
      onSeal: (chunk) => this.sealUserChunk(chunk.text),
      onPending: (text) => {
        // Recompute the cursor from how much of what feedStream() last
        // handed the stream remains unconsumed — see the sealedSkeleton
        // field doc. Cannot advance by the sealed text in sealUserChunk
        // instead: the model path's seal can differ from the raw input it
        // consumed (SentenceStream.applyResult inserts punctuation), so that
        // would drift the cursor and silently delete raw characters from the
        // next chunk.
        this.sealedSkeleton = this.sealedSkeletonBase
          + countSkeleton(this.lastPassedToStream) - countSkeleton(text);
        this.showPartialUserText(text);
      },
    });
    return this.stream;
  }

  /**
   * Slice the raw ASR text at `sealedSkeleton` and feed the relative
   * tail to the stream, recording what was passed so the `onPending` callback
   * (wired in ensureStream()) can recompute the cursor from the remainder it
   * reports afterward.
   */
  private feedStream(stream: SentenceStream, text: string): void {
    const relative = text.slice(offsetAfterSkeleton(text, this.sealedSkeleton));
    this.sealedSkeletonBase = this.sealedSkeleton;
    this.lastPassedToStream = relative;
    stream.update(relative);
  }

  /**
   * True when `text` looks like a truncated re-decode of the SAME utterance
   * that `previousRaw` already captured more of, rather than genuinely
   * different content. Used wherever a new ASR result would otherwise slice
   * to an empty relative tail — see onAsrPartial/onAsrResult.
   *
   * Compares TRIMMED forms, not raw ones: on the gated branch the sidecar
   * posts the partial unstripped (`_drive_utterance`, asr_engine.py:382) and
   * strips the final (`_finalize`, :403), so an untrimmed prefix test would
   * read a genuine truncation as divergence and produce a duplicate bubble
   * and a duplicate spoken translation. (The always-on branch strips both,
   * :455 and `_result_event` :419.) The cursor ignores spacing and marks for
   * the same reason — see the `sealedSkeleton` field doc.
   */
  private isTruncationOfSameUtterance(text: string, previousRaw: string): boolean {
    const trimmedText = text.trim();
    return trimmedText.length > 0 && previousRaw.trim().startsWith(trimmedText);
  }

  /**
   * Create or update the in-progress user bubble with interim text. Shared by
   * onAsrPartial's direct (no-segmentation) path and the stream's onPending
   * callback (wired in ensureStream()).
   */
  private showPartialUserText(text: string): void {
    if (!this.partialUserItem) {
      this.partialUserItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'in_progress',
        createdAt: Date.now(), formatted: { transcript: text },
      };
      this.items.push(this.partialUserItem);
      this.emit(this.partialUserItem);
    } else {
      this.partialUserItem.formatted!.transcript = text;
      this.emit(this.partialUserItem, { transcript: text });
    }
  }

  /** Finish the in-progress user bubble at the seal and queue its translation. */
  private sealUserChunk(text: string): void {
    let userItem = this.partialUserItem;
    if (userItem) {
      userItem.status = 'completed';
      userItem.formatted!.transcript = text;
      this.partialUserItem = null;
    } else {
      userItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
        createdAt: Date.now(), formatted: { transcript: text },
      };
      this.items.push(userItem);
    }
    this.emit(userItem);
    // Captured synchronously, not read lazily inside the .then() below:
    // onAsrResult clears pendingAsrTiming right after stream.end() returns,
    // before this queued continuation ever runs — see the field's doc.
    const asrTiming = this.pendingAsrTiming;
    // Same chain as onAsrResult: serialized so text and audio stay ordered.
    this.queue = this.queue.then(() => this.runJob(text, asrTiming)).catch((e) => {
      this.emitEvent('local.native.error', 'client', { error: String(e) });
      this.handlers.onError?.(String(e));
    });
  }

  /**
   * Route a partial ASR result: through the sentence stream when
   * segmentation is active, or straight to the bubble when it is not (no
   * runtime or disabled — see ensureStream()).
   *
   * `text` is the sidecar's cumulative buffer for the whole utterance so far,
   * not a delta (asr_engine.py:454-455 appends to `_pending` and posts the
   * whole buffer, resetting only at a cut). feedStream() slices off
   * what is sealed before handing it to the stream.
   */
  private onAsrPartial(text: string): void {
    if (!text) return;
    this.emitEvent('local.native.asr.partial', 'server', { text });
    const previousRaw = this.lastRawPartialText;
    this.lastRawPartialText = text;
    const stream = this.ensureStream();
    if (!stream) {
      this.showPartialUserText(text);
      return;
    }
    // Everything this text holds is already sealed: slicing it at the cursor
    // would hand the stream an empty string.
    if (text.length > 0 && offsetAfterSkeleton(text, this.sealedSkeleton) >= text.length) {
      if (this.isTruncationOfSameUtterance(text, previousRaw)) {
        // The engine retracted its hypothesis back to (or below) what's
        // already sealed. Nothing new to show yet: leave the bubble and the
        // cursor alone — self-healing, since partials keep growing.
        return;
      }
      // Genuinely different text: start segmentation over rather than feed a
      // cursor that no longer describes anything this text contains.
      this.sealedSkeleton = 0;
    }
    this.feedStream(stream, text);
  }

  /**
   * Live-update the assistant bubble as translate() streams tokens: create the
   * item lazily on the first partial, then update transcript in place — mirrors
   * onAsrPartial's cadence (one emit per push). translate_partial is id-less and
   * one in-flight translate per connection is the job queue's guarantee, so
   * currentTranslateItem never sees two jobs interleave.
   * Cadence note: the sidecar pushes one partial per generated token (up to
   * 512/translation); at that rate an emit-per-partial is cheap for the UI to
   * render (same as ASR partials, which already update per chunk). If token-level
   * updates ever overwhelm the renderer, throttle here (e.g. only emit every Nth
   * partial or batch on rAF) — the sidecar side deliberately does not throttle.
   */
  private onTranslatePartial(text: string): void {
    this.emitEvent('local.native.translation.partial', 'server', { text });
    if (!this.currentTranslateItem) {
      this.currentTranslateItem = {
        id: this.nextId('asst'), role: 'assistant', type: 'message', status: 'in_progress',
        createdAt: Date.now(), formatted: { transcript: text },
      };
      this.items.push(this.currentTranslateItem);
      this.emit(this.currentTranslateItem);
    } else {
      this.currentTranslateItem.formatted!.transcript = text;
      this.emit(this.currentTranslateItem, { transcript: text });
    }
  }

  private onAsrResult(r: { text: string; durationMs?: number; recognitionTimeMs?: number; startSample?: number }): void {
    if (!r.text?.trim()) return;
    // rtf = compute time / audio duration — the single "can it keep up with
    // real time" number. Only derived when the sidecar sent both timings.
    const rtf = r.durationMs && r.recognitionTimeMs !== undefined
      ? Math.round((r.recognitionTimeMs / r.durationMs) * 1000) / 1000 : undefined;
    this.emitEvent('local.native.asr.end', 'server', {
      text: r.text, modelId: this.cfg?.asrModelId,
      ...(r.durationMs !== undefined && { durationMs: r.durationMs }),
      ...(r.recognitionTimeMs !== undefined && { recognitionTimeMs: r.recognitionTimeMs }),
      ...(rtf !== undefined && { rtf }),
    });
    const timing: AsrTiming | undefined = (r.durationMs !== undefined || r.recognitionTimeMs !== undefined)
      ? { durationMs: r.durationMs, recognitionTimeMs: r.recognitionTimeMs }
      : undefined;

    // ensureStream() — not a bare read of this.stream — is what lets a final
    // that arrives with no preceding partial (e.g. appendInputText's direct
    // call) still segment: it creates the stream fresh here, the cursor at
    // 0, so update() sees the whole final text.
    const previousRaw = this.lastRawPartialText;
    const stream = this.ensureStream();
    if (stream) {
      let skipJob = false;
      if (r.text.length > 0 && offsetAfterSkeleton(r.text, this.sealedSkeleton) >= r.text.length) {
        if (this.isTruncationOfSameUtterance(r.text, previousRaw)) {
          // A truncated re-decode of the SAME utterance: the confirmed text
          // is already fully captured by the earlier seal(s). Close the open
          // bubble without a job instead of sealing (and translating, and
          // with TTS on, speaking) it a second time.
          skipJob = true;
        } else {
          // Genuinely different text: restart the cursor so the whole final
          // still seals as (at least) one chunk instead of feeding ''.
          this.sealedSkeleton = 0;
        }
      }
      if (skipJob) {
        if (this.partialUserItem) {
          this.partialUserItem.status = 'completed';
          this.emit(this.partialUserItem);
          this.partialUserItem = null;
        }
      } else {
        // update() first, WITHOUT the timing attached yet: it can seal more
        // than one chunk synchronously on its own, and those chunks must not
        // carry it. pendingAsrTiming is set only after feedStream() returns,
        // so only the chunk end() emits for the true tail sees it.
        this.feedStream(stream, r.text);
        this.pendingAsrTiming = timing;
        stream.end();
      }
      stream.dispose();
      this.stream = null;
      this.sealedSkeleton = 0;
      this.pendingAsrTiming = undefined;
      return;
    }

    let userItem = this.partialUserItem;
    if (userItem) {
      userItem.status = 'completed';
      userItem.formatted!.transcript = r.text;
      this.partialUserItem = null;
    } else {
      userItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
        createdAt: Date.now(), formatted: { transcript: r.text },
      };
      this.items.push(userItem);
    }
    this.emit(userItem);
    // serialize pipeline jobs so text/audio stay ordered. Deliberately no
    // asrTiming here: this is the legacy (no-stream) path, where
    // local.native.asr.end above already reports durationMs/recognitionTimeMs
    // /rtf once for this (sole) job. Passing timing through as well would
    // duplicate it on translation.start for no reason — asrTiming only earns
    // its place on the segmented path (sealUserChunk), where it marks which
    // of several chunks is the final one.
    this.queue = this.queue.then(() => this.runJob(r.text)).catch((e) => {
      this.emitEvent('local.native.error', 'client', { error: String(e) });
      this.handlers.onError?.(String(e));
    });
  }

  /**
   * `asrTiming` describes the whole utterance, so it rides the final chunk's
   * job only (see `pendingAsrTiming`'s field doc) — attached here purely for
   * Logs panel visibility, not consumed by the pipeline itself.
   */
  private async runJob(text: string, asrTiming?: AsrTiming): Promise<void> {
    if (!this.cfg?.translationModelId) {
      // Transcription-only: the user item already carries the transcript;
      // there is no assistant stage to run.
      return;
    }
    this.emitEvent('local.native.translation.start', 'client', {
      sourceText: text, modelId: this.cfg?.translationModelId,
      systemPrompt: this.cfg?.instructions ?? '', wrapTranscript: !!this.cfg?.wrapTranscript,
      ...(asrTiming && { asrTiming }),
    });
    // Stage-local catch so a translation failure surfaces in the Logs panel with
    // translation-stage context (which model/text), rather than only through the
    // generic queue catch. Aborts this job — no assistant item is produced.
    let tr: { sourceText?: string; translatedText: string; inferenceTimeMs?: number };
    try {
      tr = await this.translate.translate(text, this.cfg?.instructions ?? '', !!this.cfg?.wrapTranscript);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.emitEvent('local.native.error', 'client', { stage: 'translation', modelId: this.cfg?.translationModelId, sourceText: text, error });
      // A half-streamed bubble beats a vanishing one: if partials already reached
      // the renderer, finalize the item with what we have instead of leaving it
      // stuck in_progress forever (or discarding it).
      if (this.currentTranslateItem) {
        const streamedItem = this.currentTranslateItem;
        this.currentTranslateItem = null;
        streamedItem.status = 'completed';
        this.emit(streamedItem);
      }
      this.handlers.onError?.(error);
      return;
    }
    this.emitEvent('local.native.translation.end', 'server', {
      sourceText: tr.sourceText ?? text, translatedText: tr.translatedText,
      inferenceTimeMs: tr.inferenceTimeMs, modelId: this.cfg?.translationModelId,
    });
    let item: ConversationItem;
    if (this.currentTranslateItem) {
      // Reuse the item partials already streamed into — the renderer bubble
      // keeps its identity across the last token and the final resolved text.
      item = this.currentTranslateItem;
      this.currentTranslateItem = null;
      item.formatted!.transcript = tr.translatedText;
    } else {
      // No partial ever arrived (e.g. a fake translate in tests, or a job that
      // resolved before its first token push) — create the item as before.
      item = {
        id: this.nextId('asst'), role: 'assistant', type: 'message', status: 'in_progress',
        createdAt: Date.now(), formatted: { transcript: tr.translatedText },
      };
      this.items.push(item);
    }
    this.emit(item);
    if (this.ttsEnabled) {
      const displayText = tr.translatedText;
      // Iterate the non-empty sentences so sentenceIndex/sentenceCount are clean
      // and consistent with the per-sentence events emitted below.
      const sentences = splitSentences(displayText, this.cfg?.targetLanguage).filter((s) => s.trim());
      const sentenceCount = sentences.length;
      this.emitEvent('local.native.tts.start', 'client', {
        text: displayText, sentenceCount, modelId: this.cfg?.ttsModelId,
        voice: this.ttsVoiceLabel, speed: this.ttsSpeed,
      });
      const ttsStartTime = performance.now();
      item.formatted!.audioSegments = [];
      let searchFrom = 0;
      let cumulativeAudioDuration = 0;

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const pos = displayText.indexOf(sentence, searchFrom);
        const textEnd = pos >= 0 ? pos + sentence.length : searchFrom + sentence.length;
        searchFrom = textEnd;

        this.emitEvent('local.native.tts.sentence.start', 'client', {
          sentenceIndex: i, sentenceCount, text: sentence,
        });
        const sentenceStart = performance.now();

        try {
          let sentenceSamples: number;
          let generateMs: number | undefined;
          if (this.ttsStreaming) {
            // Pre-set audioTextEnd so every chunk delta already carries current karaoke
            // metadata — mirrors LocalInferenceClient streaming path (LIC line 647).
            item.formatted!.audioTextEnd = textEnd;
            let chunkSampleCount = 0;
            const done = await this.tts.generate(sentence, this.ttsSpeed, (pcm: Float32Array) => {
              const int16 = float32ToInt16(resampleFloat32(pcm, 24000, 24000));
              chunkSampleCount += int16.length;
              if (this.keepReplayAudio) this.appendItemAudio(item, int16);
              this.emit(item, { audio: int16 });
            });
            sentenceSamples = chunkSampleCount;
            generateMs = done?.generationTimeMs;
            cumulativeAudioDuration += chunkSampleCount / 24000;
            item.formatted!.audioSegments.push({ textEnd, audioEnd: cumulativeAudioDuration });
            // Bare emit (no delta) publishes finalized segment metadata to the renderer
            // — mirrors LocalInferenceClient line 687: onConversationUpdated({ item }).
            this.emit(item);
          } else {
            // Set audioTextEnd before generate so metadata is current when the audio
            // delta fires — mirrors LocalInferenceClient non-streaming path (LIC line 713).
            item.formatted!.audioTextEnd = textEnd;
            const res = await this.tts.generate(sentence, this.ttsSpeed);
            const int16 = float32ToInt16(resampleFloat32(res.samples as Float32Array, res.sampleRate, 24000));
            sentenceSamples = int16.length;
            generateMs = res.generationTimeMs;
            cumulativeAudioDuration += int16.length / 24000;
            item.formatted!.audioSegments.push({ textEnd, audioEnd: cumulativeAudioDuration });
            if (this.keepReplayAudio) this.appendItemAudio(item, int16);
            this.emit(item, { audio: int16 });
          }

          const audioDurationMs = Math.round((sentenceSamples / 24000) * 1000);
          // Prefer the sidecar's reported synth time; fall back to wall time when
          // it isn't provided so the log always carries a generateMs.
          const gm = generateMs ?? Math.round(performance.now() - sentenceStart);
          const rtf = audioDurationMs > 0 ? Math.round((gm / audioDurationMs) * 1000) / 1000 : undefined;
          this.emitEvent('local.native.tts.sentence.end', 'server', {
            sentenceIndex: i, sentenceCount, text: sentence,
            generateMs: gm, audioDurationMs, ...(rtf !== undefined && { rtf }),
          });
        } catch (ttsError) {
          // Mirror LocalInferenceClient lines 751-757: log + skip failed sentence,
          // loop continues so the item still reaches status='completed'.
          this.diagnose('tts_degraded', `a sentence could not be spoken: ${describeCause(ttsError)}`, ttsError);
          this.emitEvent('local.native.tts.error', 'server', {
            error: ttsError instanceof Error ? ttsError.message : String(ttsError),
            sentenceIndex: i,
          });
        }
      }

      // Ensure trailing whitespace is covered
      item.formatted!.audioTextEnd = displayText.length;
      this.emitEvent('local.native.tts.end', 'server', {
        sentenceCount, durationMs: Math.round(performance.now() - ttsStartTime),
      });
    }
    item.status = 'completed';
    this.emit(item);
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.connected) return;
    this.asr.feedAudio(audioData, 24000);
    this.vadWorker?.postMessage({ type: 'audio', pcm: audioData, sampleRate: 24000 });
  }
  // Re-enters onAsrResult, so when segmentation is active a long typed
  // message is chunked into several bubbles and several jobs, exactly like a
  // long spoken utterance would be — an accepted consequence of routing text
  // input through the same finalization path as ASR, not a special case this
  // method avoids (mirrors LocalInferenceClient.appendInputText).
  appendInputText(text: string): void { this.onAsrResult({ text }); }
  createResponse(_config?: ResponseConfig): void {
    this.vadWorker?.postMessage({ type: 'flush' });
    this.asr.flush?.();
  }
  cancelResponse(): void { try { this.tts?.cancel?.(); } catch (_) {} }
  async disconnect(): Promise<void> {
    this.connected = false;
    this.partialUserItem = null;
    this.currentTranslateItem = null;
    this.sessionSegmentation = null;
    this.stream?.dispose();
    this.stream = null;
    this.sealedSkeleton = 0;
    this.pendingAsrTiming = undefined;
    this.lastRawPartialText = '';
    this.emitEvent('local.native.session.closed', 'client', { reason: 'user_disconnect' });
    this.vadWorker?.postMessage({ type: 'dispose' });
    this.vadWorker?.terminate();
    this.vadWorker = null;
    this.vadReady = false;
    this.asr.dispose?.(); this.translate.dispose?.(); this.tts.dispose?.();
    this.handlers.onClose?.({});
  }
  isConnected(): boolean { return this.connected; }
  updateSession(_config: Partial<SessionConfig>): void {}
  reset(): void {
    this.items = [];
    this.partialUserItem = null;
    this.currentTranslateItem = null;
    // Without this, a stream left open from the utterance in progress could
    // still deliver a seal (and its job) against a conversation that was
    // just cleared out from under it.
    this.stream?.dispose();
    this.stream = null;
    this.sealedSkeleton = 0;
    this.lastRawPartialText = '';
  }
  getConversationItems(): ConversationItem[] { return [...this.items]; }  // fresh ref so setItems() re-renders
  clearConversationItems(): void {
    // drop in-progress partials too, else the next final mutates a detached item
    this.items = [];
    this.partialUserItem = null;
    this.currentTranslateItem = null;
    // Same reasoning as reset(): a cleared conversation must not still
    // receive a seal (and its job) from the utterance that was in progress
    // before the clear.
    this.stream?.dispose();
    this.stream = null;
    this.sealedSkeleton = 0;
    this.lastRawPartialText = '';
  }
  setEventHandlers(handlers: ClientEventHandlers): void { this.handlers = handlers; }
  getProvider(): ProviderType { return Provider.LOCAL_NATIVE; }
}
