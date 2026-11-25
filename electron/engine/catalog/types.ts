/**
 * The model catalog's shapes (port of the dataclasses in sidecar/sokuji_sidecar/catalog.py): per model, which
 * backends and hardware tiers run it and what artifact each needs. Fields are the dataclasses', camelCased; every
 * card is plain data, made by the factories below with the same defaults.
 */

export const ALL_PLATFORMS: readonly string[] = ['linux', 'windows', 'macos'];

export interface Deployment {
  /** The backend NAME: native_asr | native_asr_stream | native_translate | native_tts. */
  readonly backend: string;
  /** cpu | gpu-vulkan | gpu-metal. */
  readonly tier: string;
  /** The quant or dtype label (q4_k_m, q8_0, bf16, ...). */
  readonly computeType: string;
  /** The backend's model ref: a repo id, or "org/repo/file.gguf". */
  readonly artifact: string;
  /** Tie-breaker within a tier; higher is preferred. */
  readonly rank: number;
  /** Footprint estimate; null falls back to the artifact's size. */
  readonly estBytes: number | null;
  /** The OSes this deployment runs on (D9). */
  readonly platforms: readonly string[];
}

export function deployment(
  backend: string, tier: string, computeType: string, artifact: string, rank: number,
  opts: { estBytes?: number | null; platforms?: readonly string[] } = {},
): Deployment {
  return { backend, tier, computeType, artifact, rank, estBytes: opts.estBytes ?? null, platforms: opts.platforms ?? ALL_PLATFORMS };
}

/** The shape every card shares. */
export interface ModelBase {
  readonly id: string;
  readonly name: string;
  /** ['multi'] means any language. */
  readonly languages: readonly string[];
  readonly deployments: readonly Deployment[];
  readonly recommended: boolean;
  readonly sortOrder: number;
  /** Total download size; 0 = unknown. */
  readonly sizeBytes: number;
  /** fnmatch patterns the downloader skips. */
  readonly downloadIgnore: readonly string[];
  /**
   * The graph this card runs, the key of its op recording (spec A §3.2): transcribe.cpp's architecture for ASR,
   * llama.cpp's general.architecture for translation, audio.cpp's family for TTS. Not a prompt strategy.
   */
  readonly graphFamily: string;
}

export type BaseOptions = Partial<Pick<ModelBase, 'recommended' | 'sortOrder' | 'sizeBytes' | 'downloadIgnore' | 'graphFamily'>>;

function base(id: string, name: string, languages: readonly string[], deployments: readonly Deployment[], opts: BaseOptions): ModelBase {
  return {
    id, name, languages, deployments,
    recommended: opts.recommended ?? false,
    sortOrder: opts.sortOrder ?? 99,
    sizeBytes: opts.sizeBytes ?? 0,
    downloadIgnore: opts.downloadIgnore ?? [],
    graphFamily: opts.graphFamily ?? '',
  };
}

export type AsrModel = ModelBase;

export function asrModelCard(id: string, name: string, languages: readonly string[], deployments: readonly Deployment[], opts: BaseOptions = {}): AsrModel {
  return base(id, name, languages, deployments, opts);
}

export interface TranslateModel extends ModelBase {
  /** Qwen3/Qwen3.5's thinking kill switch: an empty <think></think> prefill. */
  readonly disableThinking: boolean;
  /** Plain Qwen3 also gets "/no_think" appended to its system prompt. */
  readonly appendNoThink: boolean;
  /** Which prompt strategy builds the prompt: qwen | hunyuan | gemma. */
  readonly promptFamily: string;
}

export function translateModelCard(
  id: string, name: string, languages: readonly string[], deployments: readonly Deployment[],
  opts: BaseOptions & Partial<Pick<TranslateModel, 'disableThinking' | 'appendNoThink' | 'promptFamily'>> = {},
): TranslateModel {
  return {
    ...base(id, name, languages, deployments, opts),
    disableThinking: opts.disableThinking ?? false,
    appendNoThink: opts.appendNoThink ?? false,
    promptFamily: opts.promptFamily ?? '',
  };
}

/**
 * Non-standard licence terms on a card (e.g. CC-BY-NC): generic data the download gate reads, not a special case
 * of a model id. `requiresConsent` is its own axis: a licence can need acknowledging while still permitting
 * commercial use, and the renderer gates on it and words the gate from `nonCommercial`.
 */
export interface License {
  /** An SPDX id, or a LicenseRef-* for a vendor licence with none. */
  readonly spdx: string;
  readonly name: string;
  readonly url: string;
  readonly nonCommercial: boolean;
  readonly sourceRepo: string;
  readonly attribution: string;
  readonly requiresConsent: boolean;
}

export function license(opts: Omit<License, 'requiresConsent'> & { requiresConsent?: boolean }): License {
  return { ...opts, requiresConsent: opts.requiresConsent ?? true };
}

export interface TtsModel extends ModelBase {
  /** sk_tts_load's family hint. */
  readonly family: string;
  /** pocket_tts's load-time language package ("english", ...); "" elsewhere. */
  readonly loadLanguage: string;
  /** Zero-shot cloning from a reference clip. */
  readonly clones: boolean;
  /** Audio deltas within an utterance. */
  readonly streaming: boolean;
  readonly sampleRate: number;
  /** sk_tts_presets returns a curated, non-empty list. */
  readonly namedVoices: boolean;
  /** sk_tts_set_voice's ref_text is mandatory. */
  readonly transcriptRequired: boolean;
  readonly license: License | null;
  /** (filename relative to the artifact's directory, bytes): assets sk_tts_presets finds next to the GGUF. */
  readonly extraFiles: ReadonlyArray<readonly [string, number]>;
}

export type TtsOptions = BaseOptions & Partial<Pick<TtsModel,
  'family' | 'loadLanguage' | 'clones' | 'streaming' | 'sampleRate' | 'namedVoices' | 'transcriptRequired' | 'license' | 'extraFiles'>>;

export function ttsModelCard(id: string, name: string, languages: readonly string[], deployments: readonly Deployment[], opts: TtsOptions = {}): TtsModel {
  return {
    ...base(id, name, languages, deployments, opts),
    family: opts.family ?? '',
    loadLanguage: opts.loadLanguage ?? '',
    clones: opts.clones ?? false,
    streaming: opts.streaming ?? false,
    sampleRate: opts.sampleRate ?? 24000,
    namedVoices: opts.namedVoices ?? false,
    transcriptRequired: opts.transcriptRequired ?? false,
    license: opts.license ?? null,
    extraFiles: opts.extraFiles ?? [],
  };
}

/** Python's repr of a list or tuple of strings, for error texts the sidecar wrote with `!r`. */
export function pyRepr(value: string | readonly string[], tuple = false): string {
  if (typeof value === 'string') return `'${value}'`;
  const inner = value.map((v) => `'${v}'`).join(', ');
  return tuple ? `(${inner}${value.length === 1 ? ',' : ''})` : `[${inner}]`;
}
