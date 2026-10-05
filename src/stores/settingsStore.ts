import {create} from 'zustand';
import {subscribeWithSelector} from 'zustand/middleware';
import {ServiceFactory} from '../services/ServiceFactory';
import {ProviderConfigFactory} from '../services/providers/ProviderConfigFactory';
import {
  FilteredModel,
  SessionConfig,
  LocalNativeSessionConfig,
} from '../services/interfaces/IClient';
import type { Stage } from '../lib/local-inference/selection/types';
import { buildDefaultLocalPrompt } from '../lib/local-inference/prompts';
import { type NativeReadinessReason } from '../lib/local-inference/native/nativeCatalog';
import type { SegmentationMode } from '../lib/segmentation/segmentationMode';
import {
  DEFAULT_CHUNK_SENTENCES,
  DEFAULT_SEGMENT_PAUSE_SECONDS,
  MIN_SEGMENT_PAUSE_SECONDS,
  MAX_SEGMENT_PAUSE_SECONDS,
} from '../lib/segmentation/segmentationMode';
import { useNativeModelStore } from './nativeModelStore';
import useAudioStore, { speakerChannelInScope } from './audioStore';
import useLogStore from './logStore';
import { effectiveTextOnly } from '../utils/effectiveTextOnly';
import { getSubtitleSurface } from '../components/Subtitle/surfaces';
import { canEnterSubtitleMode } from '../components/Subtitle/subtitleEnterGate';
import { currentRunPhase } from '../app/runPhase';
import {ApiKeyValidationResult} from '../services/interfaces/ISettingsService';
import {Provider, ProviderType} from '../types/Provider';
import i18n from '../locales';
import {
  LocalNativeProviderConfig, LocalNativeSettings, defaultLocalNativeSettings,
} from '../services/providers/LocalNativeProviderConfig';
import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';
import { persistSetting } from '../services/persistSetting';

/** Map a native readiness reason to its user-facing message. Verbatim port of
 * the messages the inline LOCAL_NATIVE gate produced. */
function msgForNativeReason(reason: NativeReadinessReason): string {
  switch (reason) {
    case 'ready': return '';
    case 'not-electron': return i18n.t('settings.localNativeNotElectron', 'Native sidecar unavailable (desktop app + installed sidecar required)');
    case 'engine-mismatch': return i18n.t('settings.localNativeEngineUpdateRequired', 'The inference engine needs an update — open provider settings to update it');
    case 'engine-absent': return i18n.t('settings.localNativeEngineRequired', 'Download the inference engine in provider settings');
    case 'unavailable': return i18n.t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings');
    case 'starting': return i18n.t('settings.localNativeStarting', 'Starting the local engine…');
    case 'asr-incompatible': return i18n.t('settings.localNativeAsrIncompatible', 'Select a speech-recognition model for My language');
    case 'translation-incompatible': return i18n.t('settings.localNativeTranslationIncompatible', 'Select a translation model for this language pair');
  }
}

export type {
  LocalNativeSettings,
};

// ==================== Type Definitions ====================

// Conversation display mode — which half of a bilingual utterance to show
// 'none' hides every row of that side. The subtitle store carries an identical
// copy of this union (subtitleStore.ts) — change both together.
export type DisplayMode = 'source' | 'translation' | 'both' | 'none';

// Common Settings
export interface CommonSettings {
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';
  textOnly: boolean;
  keepReplayAudio: boolean;
  autoSaveOnStop: boolean;
  diagnosticLogs: boolean;
  /**
   * How bubbles are cut: Off, By pause, or By sentences (Amendment A2).
   * Stored once for every provider and clamped on read to what the current
   * one offers — `pause`, the default, means By pause on the three clients
   * that cut on their own timers and Off on every other provider. By
   * sentences stays inert until the three punctuation models are downloaded
   * (Amendment A1).
   */
  segmentationMode: SegmentationMode;
  /** How many sentences fill one bubble. 0 (Auto) to 5, clamped on read. */
  sentenceSegmentationChunkSentences: number;
  /** Seconds of silence that end a source utterance, for the clients that cut
   *  on their own timers. 0.1-3, clamped on read. */
  segmentationSourcePause: number;
  /** The same, for the translation side. */
  segmentationTranslationPause: number;
  speakerDisplayMode: DisplayMode;
  participantDisplayMode: DisplayMode;
}

/** The authentication forms that can sit over the app. */
export type AuthOverlayKind = 'sign-in' | 'sign-up' | 'forgot-password' | null;
export type AuthOverlayReason = 'session_expired';

// ==================== Default Values ====================

/**
 * The only place 0-5 is enforced.
 *
 * This is CommonSettings' first numeric field, and it reaches a SentenceStream
 * that multiplies it into three thresholds. A value from an older build, a
 * corrupted store or a hand-edited settings file must never get that far, so
 * the clamp sits on the read and on the write rather than in the picker.
 *
 * 0 is Auto since Amendment A2 — punctuate, never seal — so the range starts
 * one lower than the 1-5 A1 shipped.
 */
export function clampChunkSentences(value: unknown): number {
  // `null` means the setting is absent, so it takes the default like
  // `undefined` does. Without this line it would fall through to
  // `Number(null) === 0`, which is now a value in its own right: a missing
  // setting would silently read as Auto.
  if (value === null || value === undefined) return DEFAULT_CHUNK_SENTENCES;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_CHUNK_SENTENCES;
  return Math.min(5, Math.max(0, n));
}

/**
 * Seconds of silence that end an utterance, in the range and at the default
 * `segmentationMode.ts` owns — the same three numbers the clients clamp their
 * milliseconds to, so the store and a client built without a pause can never
 * disagree about them.
 *
 * Clamped on read and on write for the same reason as the sentence count: the
 * two values leave here for a client's timers, and a stored 0 would arm a
 * timer that fires on every gap between words.
 */
function clampSegmentationPause(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_SEGMENT_PAUSE_SECONDS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SEGMENT_PAUSE_SECONDS;
  return Math.min(MAX_SEGMENT_PAUSE_SECONDS, Math.max(MIN_SEGMENT_PAUSE_SECONDS, n));
}

/**
 * A stored mode this build does not know takes the default, which is what
 * `resolveSegmentationMode` does with it too — the store and the resolver
 * must not disagree about an unrecognised value.
 */
/**
 * Whether the sentence segmentation section shows. The owner's choice of
 * 2026-10-01: hidden, and segmentation kept Off for every provider, until the
 * feature is refined. While hidden, `loadSettings()` does not read the saved
 * mode, so one saved while the section showed — By sentences, or By pause,
 * the default it had — cannot run unseen; the saved value is left as it was,
 * not rewritten. Showing it again is this line.
 */
export const SENTENCE_SEGMENTATION_SHOWN = false;

function clampSegmentationMode(value: unknown): SegmentationMode {
  return value === 'off' || value === 'sentences' || value === 'pause' ? value : 'pause';
}

const defaultCommonSettings: CommonSettings = {
  // An id the old registry does not hold, so nothing old runs for it. Local
  // Native here would start its old readiness arm for every user of a build
  // that registers it (Stage 2 deletion, choice 4).
  provider: Provider.OPENAI,
  uiLanguage: 'en',
  uiMode: 'basic',
  textOnly: false,
  keepReplayAudio: false,
  autoSaveOnStop: false,
  diagnosticLogs: false,
  segmentationMode: SENTENCE_SEGMENTATION_SHOWN ? 'pause' : 'off',
  sentenceSegmentationChunkSentences: DEFAULT_CHUNK_SENTENCES,
  segmentationSourcePause: DEFAULT_SEGMENT_PAUSE_SECONDS,
  segmentationTranslationPause: DEFAULT_SEGMENT_PAUSE_SECONDS,
  speakerDisplayMode: 'both',
  participantDisplayMode: 'both',
};

// ==================== Store Definition ====================

export interface SettingsStore {
  // === State ===
  // Common settings
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';

  // Provider-specific settings
  localNative: LocalNativeSettings;

  // Validation state
  isApiKeyValid: boolean | null;
  isValidating: boolean;
  validationMessage: string;

  // Models state
  availableModels: FilteredModel[];

  // Navigation state
  settingsNavigationTarget: string | null;
  /** Ephemeral: raised by a surface that wants the title-bar account popover
   *  opened (the provider sign-in notice does). Never persisted — AccountButton
   *  reads it, opens the popover, and immediately clears it back to false. */
  accountPopoverRequested: boolean;
  /** Which authentication form is showing over the app, or null for none.
   *  Authentication is an OVERLAY, not a route: SignIn used to be a sibling of
   *  Home, so reaching for the account unmounted the whole tree — and any live
   *  translation session with it — before the user had typed anything. */
  authOverlay: AuthOverlayKind;
  /** Why the sign-in form opened, when the form should say so (spec 2026-10-05 §5): the session expired. Null for any other form or none. */
  authOverlayReason: AuthOverlayReason | null;
  /** Ephemeral: fired once by an engine chip (Task 10) to deep-link into the
   *  engine surface with a given slot pre-expanded. Never persisted — the
   *  consuming surface (SimpleSettings, ProviderSpecificSettings) reads it,
   *  opens the slot, and immediately clears it back to null. */
  engineSlotTarget: { dir: string; stage: Stage } | null;

  // Settings loading state
  settingsLoaded: boolean;

  // Text-only mode (no audio output)
  textOnly: boolean;

  // Keep per-item PCM audio in memory so the inline replay button works.
  // Off by default — reduces memory use during long sessions. Cached by
  // provider clients at session start; mid-session changes take effect
  // on the next session.
  keepReplayAudio: boolean;

  // Auto-save the whole conversation — both sides, originals and
  // translations — as a .txt file whenever a session ends, whatever the
  // Export menu's scope boxes say (those govern only the manual export). Off
  // by default — exporting is an explicit, opt-in action.
  autoSaveOnStop: boolean;
  // Diagnostic logs (Help). Opt-in: while off, logStore records nothing and
  // the title bar offers no logs button.
  diagnosticLogs: boolean;

  /**
   * How bubbles are cut: Off, By pause, or By sentences (Amendment A2).
   * Stored once for every provider and clamped on read to what the current
   * one offers.
   */
  segmentationMode: SegmentationMode;
  /** How many sentences fill one bubble. 0 (Auto) to 5, clamped on read. */
  sentenceSegmentationChunkSentences: number;
  /** Seconds of silence that end a source utterance. 0.1-3, clamped on read. */
  segmentationSourcePause: number;
  /** The same, for the translation side. */
  segmentationTranslationPause: number;

  // Conversation display mode filters
  speakerDisplayMode: DisplayMode;
  participantDisplayMode: DisplayMode;

  // Subtitle runtime flags (lifecycle only — subtitle settings live in subtitleStore)
  subtitleModeActive: boolean;
  // Ephemeral: true while subtitle mode is in OS fullscreen. Never persisted;
  // always reset to false on enter (start windowed) and exit. Electron-only.
  subtitleFullscreen: boolean;

  // === Actions ===
  // Common settings actions
  setProvider: (provider: ProviderType) => void;
  // Async: it writes through the settings service. Declared void, callers
  // had no way to know they should await it — a failed write surfaced as an
  // unhandled rejection with the UI already changed.
  setUILanguage: (lang: string) => Promise<void>;
  setUIMode: (mode: 'basic' | 'advanced') => void;
  setTextOnly: (textOnly: boolean) => void;
  setKeepReplayAudio: (keepReplayAudio: boolean) => Promise<void>;
  setAutoSaveOnStop: (autoSaveOnStop: boolean) => Promise<void>;
  setDiagnosticLogs: (diagnosticLogs: boolean) => Promise<void>;
  setSegmentationMode: (mode: SegmentationMode) => Promise<void>;
  setSentenceSegmentationChunkSentences: (n: number) => Promise<void>;
  setSegmentationSourcePause: (seconds: number) => Promise<void>;
  setSegmentationTranslationPause: (seconds: number) => Promise<void>;
  setSpeakerDisplayMode: (mode: DisplayMode) => Promise<void>;
  setParticipantDisplayMode: (mode: DisplayMode) => Promise<void>;
  enterSubtitleMode: () => Promise<void>;
  exitSubtitleMode: () => Promise<void>;
  /**
   * Internal: invoked by a SubtitleSurface implementation when the surface
   * exits outside of our explicit exitSubtitleMode() call (e.g. user closes
   * the iframe overlay, content script disposes, host page navigates).
   * Resets the flag without re-entering the exit path.
   */
  __notifySubtitleSurfaceExited: () => void;
  /** Toggle OS fullscreen for the active subtitle surface (Electron-only). */
  setSubtitleFullscreen: (flag: boolean) => Promise<void>;
  /**
   * Internal: invoked when the OS fullscreen state changes outside of our
   * setSubtitleFullscreen() call (app menu, F11, macOS gesture). Updates the
   * flag only — does NOT re-invoke the surface, which would loop.
   */
  __syncSubtitleFullscreen: (flag: boolean) => void;

  // Provider settings actions
  updateLocalNative: (settings: Partial<LocalNativeSettings>) => void;
  /** Generic slice update keyed by descriptor.settingsSliceKey — the write
   *  half of the read path the reactive selectors already use. Same registry
   *  as the named actions; throws on an unknown key. Built for MainPanel to
   *  apply a descriptor's prepareToStart settingsPatch (S4/S5 seam); nothing
   *  calls it since that session start went, until #578 ports Local Native
   *  (Stage 2 deletion, ruling 1). */
  updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>;

  // Async actions
  validateApiKey: () => Promise<ApiKeyValidationResult>;
  loadSettings: () => Promise<void>;
  clearCache: () => void;

  // Helper methods
  getProcessedLocalPrompt: (forParticipant?: boolean) => string;
  createSessionConfig: (systemInstructions: string) => SessionConfig;
  navigateToSettings: (target: string | null) => void;
  setEngineSlotTarget: (t: { dir: string; stage: Stage } | null) => void;
  setAccountPopoverRequested: (next: boolean) => void;
  setAuthOverlay: (next: AuthOverlayKind, reason?: AuthOverlayReason) => void;
}

// ==================== Helper Functions ====================

// Moved beside the descriptors (their caller since the S2 participant-config
// seam); re-exported here so existing importers keep working.
export { createParticipantLocalNativeConfig } from '../services/providers/localParticipantConfig';

/**
 * Back-compat wrapper: the canonical builder now lives on the descriptor
 * (LocalNativeProviderConfig.buildSessionConfig), which reads the native
 * catalog from nativeModelStore itself. Kept as a named export so tests can
 * exercise the variant-pin plumbing without going through the registry
 * (which only registers LOCAL_NATIVE inside Electron).
 */
export function createLocalNativeSessionConfig(
  settings: LocalNativeSettings,
  systemInstructions: string,
): LocalNativeSessionConfig {
  return new LocalNativeProviderConfig()
    .buildSessionConfig(settings, systemInstructions) as LocalNativeSessionConfig;
}

// ==================== Store Implementation ====================

// ─── Provider settings slice registry ────────────────────────────────────────
// One row per persisted provider slice. This table is the single home for the
// knowledge the twelve hand-written update actions used to re-encode: the
// slice's defaults (for loading). Persist keys are always
// `settings.<sliceKey>.<field>` — the sliceKey doubles as the storage prefix.

type SliceUpdateSpec = {
  /**
   * `object`, not `Record<string, unknown>`: every row's value is a concrete
   * settings interface, and interfaces have no implicit index signature, so the
   * stricter type made each row fail its own `satisfies` check. Only
   * `Object.keys` is read from it.
   */
  defaults: object;
};

const PROVIDER_SLICE_REGISTRY = {
  localNative: { defaults: defaultLocalNativeSettings },
} satisfies Record<string, SliceUpdateSpec>;

export type ProviderSliceKey = keyof typeof PROVIDER_SLICE_REGISTRY;

/** Shared implementation behind every updateXxx action: merge the patch
 *  into the slice, then persist each field under
 *  `settings.<sliceKey>.<field>`. */
async function updateProviderSlice(
  set: (fn: (state: SettingsStore) => Partial<SettingsStore>) => void,
  sliceKey: ProviderSliceKey,
  patch: Record<string, unknown>,
): Promise<void> {
  set((state) => ({ [sliceKey]: { ...(state as any)[sliceKey], ...patch } }) as Partial<SettingsStore>);

  // One seam for every slice. The registry used to carry
  // `persistErrors: 'throw' | 'swallow'`, split 6/6, but none of the six
  // "throw" actions is awaited or caught anywhere — they are typed `void` and
  // every caller is fire-and-forget — so "throw" meant an unhandled rejection
  // routed to PostHog and "swallow" meant a console line. Neither reached the
  // user, and which slice got which was arbitrary. `persistSetting` reports
  // the failure once per key instead.
  for (const [key, value] of Object.entries(patch)) {
    await persistSetting(`settings.${sliceKey}.${key}`, value);
  }
}

const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({
    // === Initial State ===
    ...defaultCommonSettings,
    localNative: defaultLocalNativeSettings,

    isApiKeyValid: null,
    isValidating: false,
    validationMessage: '',

    availableModels: [],

    settingsNavigationTarget: null,
    engineSlotTarget: null,
    accountPopoverRequested: false,
    authOverlay: null,
    authOverlayReason: null,

    settingsLoaded: false,
    subtitleModeActive: false,
    subtitleFullscreen: false,

    // === Common Settings Actions ===
    setProvider: async (provider) => {
      // Commit the provider change first so any subscriber sees the new value
      // synchronously. Persistence happens afterwards.
      set({provider});

      // Reset the validation state synchronously, before persisting, so the
      // previous provider's verdict does not linger. Nothing validates on a
      // provider change: the one provider this store validates, Local Native,
      // is revalidated by nativeModelStore when its bundle, sidecar or models
      // change (Stage 2 deletion, ruling 1).
      get().clearCache();

      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.provider', provider);
    },

    setUILanguage: async (uiLanguage) => {
      set({uiLanguage});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.uiLanguage', uiLanguage);
    },

    setUIMode: async (uiMode) => {
      set({uiMode});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.uiMode', uiMode);
    },

    setTextOnly: async (textOnly) => {
      const previous = get().textOnly;
      set({textOnly});
      if (!await persistSetting('settings.common.textOnly', textOnly)) {
        set({textOnly: previous});
      }
    },

    setKeepReplayAudio: async (keepReplayAudio) => {
      const previous = get().keepReplayAudio;
      set({keepReplayAudio});
      if (!await persistSetting('settings.common.keepReplayAudio', keepReplayAudio)) {
        set({keepReplayAudio: previous});
      }
    },

    setAutoSaveOnStop: async (autoSaveOnStop) => {
      const previous = get().autoSaveOnStop;
      set({autoSaveOnStop});
      if (!await persistSetting('settings.common.autoSaveOnStop', autoSaveOnStop)) {
        set({autoSaveOnStop: previous});
      }
    },

    // The log store follows this switch. Applied before the write so the
    // panel reacts at once, and rolled back with it if the write fails.
    setDiagnosticLogs: async (diagnosticLogs) => {
      const previous = get().diagnosticLogs;
      set({diagnosticLogs});
      useLogStore.getState().setEnabled(diagnosticLogs);
      if (!await persistSetting('settings.common.diagnosticLogs', diagnosticLogs)) {
        set({diagnosticLogs: previous});
        useLogStore.getState().setEnabled(previous);
      }
    },

    setSegmentationMode: async (mode) => {
      const previous = get().segmentationMode;
      const clamped = clampSegmentationMode(mode);
      set({segmentationMode: clamped});
      if (!await persistSetting('settings.common.segmentationMode', clamped)) {
        set({segmentationMode: previous});
      }
    },

    setSentenceSegmentationChunkSentences: async (n) => {
      const previous = get().sentenceSegmentationChunkSentences;
      const clamped = clampChunkSentences(n);
      set({sentenceSegmentationChunkSentences: clamped});
      if (!await persistSetting('settings.common.sentenceSegmentationChunkSentences', clamped)) {
        set({sentenceSegmentationChunkSentences: previous});
      }
    },

    setSegmentationSourcePause: async (seconds) => {
      const previous = get().segmentationSourcePause;
      const clamped = clampSegmentationPause(seconds);
      set({segmentationSourcePause: clamped});
      if (!await persistSetting('settings.common.segmentationSourcePause', clamped)) {
        set({segmentationSourcePause: previous});
      }
    },

    setSegmentationTranslationPause: async (seconds) => {
      const previous = get().segmentationTranslationPause;
      const clamped = clampSegmentationPause(seconds);
      set({segmentationTranslationPause: clamped});
      if (!await persistSetting('settings.common.segmentationTranslationPause', clamped)) {
        set({segmentationTranslationPause: previous});
      }
    },

    setSpeakerDisplayMode: async (speakerDisplayMode) => {
      const previous = get().speakerDisplayMode;
      set({speakerDisplayMode});
      if (!await persistSetting('settings.common.speakerDisplayMode', speakerDisplayMode)) {
        set({speakerDisplayMode: previous});
      }
    },

    setParticipantDisplayMode: async (participantDisplayMode) => {
      const previous = get().participantDisplayMode;
      set({participantDisplayMode});
      if (!await persistSetting('settings.common.participantDisplayMode', participantDisplayMode)) {
        set({participantDisplayMode: previous});
      }
    },

    enterSubtitleMode: async () => {
      if (get().subtitleModeActive) return;
      // Mirrors SubtitleEnterButton's `canEnter` gating exactly (see
      // subtitleEnterGate.ts) so the button can never be enabled while this
      // guard silently refuses the entry it triggers. Reads the page's run
      // phase through the non-React leaf (src/app/runPhase.ts) rather than
      // importing the root's stores back into this module.
      if (!canEnterSubtitleMode(currentRunPhase() === 'running')) {
        reportWarning('SettingsStore', 'enterSubtitleMode ignored — no active session');
        return;
      }
      // Claim the slot synchronously so a concurrent call (double-click,
      // duplicate dispatch) short-circuits at the guard above instead of
      // racing into a second surface.enter(). On the Electron path the
      // second IPC would otherwise overwrite normalBoundsSnapshot with
      // the already-shrunk subtitle bounds — same bug class as 8f9aea85.
      set({ subtitleModeActive: true, subtitleFullscreen: false });
      try {
        await getSubtitleSurface().enter();
      } catch (error) {
        reportError('SettingsStore', `enterSubtitleMode failed: ${describeCause(error)}`, { cause: error });
        set({ subtitleModeActive: false });
        // Re-throw so the caller (e.g. SubtitleEnterButton) can show a
        // user-facing toast for actionable failure modes such as a stale
        // meeting tab that needs a refresh.
        throw error;
      }
    },

    exitSubtitleMode: async () => {
      if (!get().subtitleModeActive) return;
      // Same TOCTOU-closing trick as enterSubtitleMode: flip the flag
      // first so a re-entrant exit() short-circuits. The original
      // `finally` already set the flag false on the way out; the only
      // observable difference is concurrent callers, which we want.
      set({ subtitleModeActive: false, subtitleFullscreen: false });
      try {
        await getSubtitleSurface().exit();
      } catch (error) {
        reportError('SettingsStore', `exitSubtitleMode failed: ${describeCause(error)}`, { cause: error });
      }
    },

    __notifySubtitleSurfaceExited: () => {
      set({ subtitleModeActive: false, subtitleFullscreen: false });
    },

    setSubtitleFullscreen: async (flag) => {
      const previous = get().subtitleFullscreen;
      if (previous === flag) return;
      set({ subtitleFullscreen: flag });
      try {
        await getSubtitleSurface().setFullscreen(flag);
      } catch (error) {
        // Swallow (unlike enterSubtitleMode, which re-throws so the entry
        // button can toast): a fullscreen-toggle failure is non-actionable
        // for the caller, and reverting the flag re-syncs the bar button.
        reportError('SettingsStore', `setSubtitleFullscreen failed: ${describeCause(error)}`, { cause: error });
        set({ subtitleFullscreen: previous });
      }
    },

    __syncSubtitleFullscreen: (flag) => {
      set({ subtitleFullscreen: flag });
    },

    // === Provider Settings Actions ===
    updateLocalNative: (settings) => updateProviderSlice(set, 'localNative', settings),
    updateProviderSlice: (sliceKey, patch) => {
      // hasOwnProperty.call, not `in`: 'toString'/'constructor' must reject, not index the prototype (same idiom as previewSample).
      if (!Object.prototype.hasOwnProperty.call(PROVIDER_SLICE_REGISTRY, sliceKey)) {
        return Promise.reject(new Error(`updateProviderSlice: unknown slice key '${sliceKey}'`));
      }
      return updateProviderSlice(set, sliceKey as ProviderSliceKey, patch);
    },

    // === Async Actions ===
    // The return type is annotated deliberately, not decoratively. Without it
    // this one action's inferred type poisons contextual typing across the
    // whole create<SettingsStore>() literal, and roughly a third of the
    // repository's type errors are downstream of that. See the commit that
    // added this line for the before/after numbers.
    validateApiKey: async (): Promise<ApiKeyValidationResult> => {
      const provider = get().provider;

      // Native (Electron sidecar) inference: no API key. Readiness is owned by
      // nativeModelStore's ensureSelectionReady facade — sidecar warmup,
      // lifecycle gating, resolving BOTH the speaker and participant
      // directions, and applying the session-gate table (speaker ASR/
      // translation block, speaker TTS and the whole participant direction
      // never do). This branch maps `reason` to a user-facing message; `notes`
      // is already stashed on nativeModelStore's `lastResolutionNotes` for
      // Plan 2 to render in place of this generic message. resolve() output IS
      // the answer, so there is nothing left to write back to settings here.
      if (provider === Provider.LOCAL_NATIVE) {
        // Settings go in as a thunk, not a snapshot: the facade warms the sidecar
        // first (seconds, on a cold start) and reads them only after — so a pair
        // or text-only change made during warmup is honoured, not resolved stale.
        //
        // The toggle is resolved against the channel matrix, not passed raw:
        // `requiredNativeModels` adds a TTS model when speech output is on, and
        // in a participant-only mode no leg ever speaks, so requiring one made
        // readiness fail over a voice the session would never load. Mode scope
        // rather than the start path's device-aware `speakerWillStart` — this
        // gate has no business knowing which microphone is selected, and the
        // Start gate refuses a mode whose devices are missing anyway.
        const { ready, reason } = await useNativeModelStore.getState()
          .ensureSelectionReady(() => ({
            selection: get().localNative,
            textOnly: effectiveTextOnly({
              speakerLegRuns: speakerChannelInScope(useAudioStore.getState().mode),
              textOnly: get().textOnly,
            }),
          }));
        const message = msgForNativeReason(reason);
        set({
          isApiKeyValid: ready,
          availableModels: ready ? [{ id: 'native-asr-translate', type: 'realtime' as const, created: 0 }] : [],
          validationMessage: message, isValidating: false,
        });
        return { valid: ready, message, validating: false };
      }

      // Every other provider validates in the new registry (its definition's
      // `check`); the old path holds only Local Native (Stage 2 deletion,
      // ruling 1), so there is nothing here to validate.
      set({ isApiKeyValid: null, availableModels: [], validationMessage: '', isValidating: false });
      return { valid: false, message: '', validating: false };
    },

    loadSettings: async () => {
      try {
        const service = ServiceFactory.getSettingsService();

        // The diagnostic logs switch comes first. Every read below can report a
        // warning, and nothing may be recorded before the user's choice is
        // known. The log store starts off, so if even this read fails it stays
        // off, which is the default.
        const diagnosticLogs = await service.getSetting('settings.common.diagnosticLogs', defaultCommonSettings.diagnosticLogs);
        useLogStore.getState().setEnabled(diagnosticLogs);

        // Load common settings
        const provider = await service.getSetting('settings.common.provider', defaultCommonSettings.provider);
        const uiLanguage = await service.getSetting('settings.common.uiLanguage', defaultCommonSettings.uiLanguage);
        const uiMode = await service.getSetting('settings.common.uiMode', defaultCommonSettings.uiMode);
        const textOnly = await service.getSetting('settings.common.textOnly', defaultCommonSettings.textOnly);
        const keepReplayAudio = await service.getSetting('settings.common.keepReplayAudio', defaultCommonSettings.keepReplayAudio);
        const autoSaveOnStop = await service.getSetting('settings.common.autoSaveOnStop', defaultCommonSettings.autoSaveOnStop);
        const segmentationMode = SENTENCE_SEGMENTATION_SHOWN
          ? clampSegmentationMode(await service.getSetting('settings.common.segmentationMode', defaultCommonSettings.segmentationMode))
          : 'off';
        const sentenceSegmentationChunkSentences = clampChunkSentences(
          await service.getSetting('settings.common.sentenceSegmentationChunkSentences', defaultCommonSettings.sentenceSegmentationChunkSentences),
        );
        const segmentationSourcePause = clampSegmentationPause(
          await service.getSetting('settings.common.segmentationSourcePause', defaultCommonSettings.segmentationSourcePause),
        );
        const segmentationTranslationPause = clampSegmentationPause(
          await service.getSetting('settings.common.segmentationTranslationPause', defaultCommonSettings.segmentationTranslationPause),
        );
        const speakerDisplayMode = await service.getSetting<DisplayMode>('settings.common.speakerDisplayMode', defaultCommonSettings.speakerDisplayMode);
        const participantDisplayMode = await service.getSetting<DisplayMode>('settings.common.participantDisplayMode', defaultCommonSettings.participantDisplayMode);
        // Subtitle settings now hydrated by subtitleStore.hydrate(); see stores/subtitleStore.ts.

        // A provider the old registry does not hold falls to the inert default
        // (Stage 2 deletion, choice 4).
        const validProvider = ProviderConfigFactory.isProviderSupported(provider) ? provider : Provider.OPENAI;

        // Load provider settings
        const loadProviderSettings = async <T>(prefix: string, defaults: T): Promise<T> => {
          const settings: any = {};
          for (const key of Object.keys(defaults as any)) {
            settings[key] = await service.getSetting(`${prefix}.${key}`, (defaults as any)[key]);
          }
          return settings as T;
        };

        // One load per registry row; the sliceKey doubles as the storage prefix.
        const loadedSlices = Object.fromEntries(await Promise.all(
          (Object.keys(PROVIDER_SLICE_REGISTRY) as ProviderSliceKey[]).map(async (sliceKey) => [
            sliceKey,
            await loadProviderSettings(`settings.${sliceKey}`, PROVIDER_SLICE_REGISTRY[sliceKey].defaults),
          ] as const),
        )) as Partial<SettingsStore>;

        set({
          provider: validProvider,
          uiLanguage,
          uiMode,
          textOnly,
          keepReplayAudio,
          autoSaveOnStop,
          diagnosticLogs,
          segmentationMode,
          sentenceSegmentationChunkSentences,
          segmentationSourcePause,
          segmentationTranslationPause,
          speakerDisplayMode,
          participantDisplayMode,
          ...loadedSlices,
          settingsLoaded: true,
        });

        console.info('[SettingsStore] Settings loaded successfully');
      } catch (error) {
        // `settingsLoaded` stays false forever after this, so the app runs on
        // defaults with no indication that the user's saved settings were not
        // applied. The panel entry is the only record until the basic-mode
        // banner lands (see the design's user-facing tier).
        reportError('SettingsStore', `Failed to load settings: ${describeCause(error)}`, { cause: error });
      }
    },

    clearCache: () => {
      set({
        availableModels: [],
        isApiKeyValid: null
      });
    },

    // === Helper Methods ===
    getProcessedLocalPrompt: (forParticipant = false) => {
      // Local Native's slice, the one local slice left (Stage 2 deletion,
      // ruling 3). It has no participant prompt, so the participant case
      // takes the speaker's, resolved for the reversed pair.
      const s = get().localNative;
      const [srcLang, tgtLang] = forParticipant
        ? [s.targetLanguage, s.sourceLanguage]
        : [s.sourceLanguage, s.targetLanguage];

      if (s.useTemplateMode) {
        return buildDefaultLocalPrompt(srcLang, tgtLang);
      }
      // Advanced mode: an empty prompt falls back to the default.
      return s.systemPrompt.trim() || buildDefaultLocalPrompt(srcLang, tgtLang);
    },

    createSessionConfig: (systemInstructions) => {
      const state = get();
      const descriptor = ProviderConfigFactory.getDescriptor(state.provider);
      const slice = state[descriptor.settingsSliceKey as keyof SettingsStore];
      const config = descriptor.buildSessionConfig(slice, systemInstructions);
      // Cross-provider fields stay in the shell — every provider honors them.
      config.textOnly = state.textOnly;
      config.keepReplayAudio = state.keepReplayAudio;
      return config;
    },

    navigateToSettings: (target) => {
      set({settingsNavigationTarget: target});
    },

    setEngineSlotTarget: (t: { dir: string; stage: Stage } | null) => {
      set({engineSlotTarget: t});
    },

    setAuthOverlay: (next: AuthOverlayKind, reason?: AuthOverlayReason) => {
      set({authOverlay: next, authOverlayReason: next === 'sign-in' ? reason ?? null : null});
    },

    setAccountPopoverRequested: (next: boolean) => {
      set({accountPopoverRequested: next});
    },
  }))
);

// ==================== Export Optimized Selectors ====================

// Common settings
export const useProvider = () => useSettingsStore((state) => state.provider);
export const useUILanguage = () => useSettingsStore((state) => state.uiLanguage);
export const useUIMode = () => useSettingsStore((state) => state.uiMode);
export const useSpeakerDisplayMode = () => useSettingsStore((state) => state.speakerDisplayMode);
export const useParticipantDisplayMode = () => useSettingsStore((state) => state.participantDisplayMode);
export const useSubtitleModeActive = () => useSettingsStore((state) => state.subtitleModeActive);
export const useEnterSubtitleMode = () => useSettingsStore((state) => state.enterSubtitleMode);
export const useExitSubtitleMode = () => useSettingsStore((state) => state.exitSubtitleMode);
export const useSubtitleFullscreen = () =>
  useSettingsStore((state) => state.subtitleFullscreen);
export const useSetSubtitleFullscreen = () =>
  useSettingsStore((state) => state.setSubtitleFullscreen);
export const useNotifySubtitleSurfaceExited = () =>
  useSettingsStore((state) => state.__notifySubtitleSurfaceExited);

// Provider settings
export const useLocalNativeSettings = () => useSettingsStore((state) => state.localNative);

// Validation state
export const useIsApiKeyValid = () => useSettingsStore((state) => state.isApiKeyValid);
export const useIsValidating = () => useSettingsStore((state) => state.isValidating);
export const useValidationMessage = () => useSettingsStore((state) => state.validationMessage);

// Models state
export const useAvailableModels = () => useSettingsStore((state) => state.availableModels);

// Navigation
export const useSettingsNavigationTarget = () => useSettingsStore((state) => state.settingsNavigationTarget);
export const useEngineSlotTarget = () => useSettingsStore((state: SettingsStore) => state.engineSlotTarget);
export const useSetEngineSlotTarget = () => useSettingsStore((state: SettingsStore) => state.setEngineSlotTarget);
// Annotated the way the engineSlotTarget pair beside them is: the store's own
// generic inference is broken in this file, so a bare `(state)` selector is a
// TS7006 implicit-any under noImplicitAny.
export const useAccountPopoverRequested = () =>
  useSettingsStore((state: SettingsStore) => state.accountPopoverRequested);
export const useSetAccountPopoverRequested = () =>
  useSettingsStore((state: SettingsStore) => state.setAccountPopoverRequested);
export const useAuthOverlay = () =>
  useSettingsStore((state: SettingsStore) => state.authOverlay);
export const useSetAuthOverlay = () =>
  useSettingsStore((state: SettingsStore) => state.setAuthOverlay);
export const useAuthOverlayReason = () =>
  useSettingsStore((state: SettingsStore) => state.authOverlayReason);

// Settings loading state
export const useSettingsLoaded = () => useSettingsStore((state) => state.settingsLoaded);

// Actions
export const useTextOnly = () => useSettingsStore((state) => state.textOnly);
export const useKeepReplayAudio = () => useSettingsStore((state) => state.keepReplayAudio);
export const useAutoSaveOnStop = () => useSettingsStore((state) => state.autoSaveOnStop);
export const useDiagnosticLogs = () => useSettingsStore((state) => state.diagnosticLogs);
export const useSetDiagnosticLogs = () => useSettingsStore((state) => state.setDiagnosticLogs);
export const useSegmentationMode = () => useSettingsStore((state) => state.segmentationMode);
export const useSetSegmentationMode = () => useSettingsStore((state) => state.setSegmentationMode);
export const useSentenceSegmentationChunkSentences = () => useSettingsStore((state) => state.sentenceSegmentationChunkSentences);
export const useSetSentenceSegmentationChunkSentences = () => useSettingsStore((state) => state.setSentenceSegmentationChunkSentences);
export const useSegmentationSourcePause = () => useSettingsStore((state) => state.segmentationSourcePause);
export const useSetSegmentationSourcePause = () => useSettingsStore((state) => state.setSegmentationSourcePause);
export const useSegmentationTranslationPause = () => useSettingsStore((state) => state.segmentationTranslationPause);
export const useSetSegmentationTranslationPause = () => useSettingsStore((state) => state.setSegmentationTranslationPause);

export const useSetProvider = () => useSettingsStore((state) => state.setProvider);
export const useSetUILanguage = () => useSettingsStore((state) => state.setUILanguage);
export const useSetUIMode = () => useSettingsStore((state) => state.setUIMode);
export const useSetTextOnly = () => useSettingsStore((state) => state.setTextOnly);
export const useSetKeepReplayAudio = () => useSettingsStore((state) => state.setKeepReplayAudio);
export const useSetAutoSaveOnStop = () => useSettingsStore((state) => state.setAutoSaveOnStop);
export const useSetSpeakerDisplayMode = () => useSettingsStore((state) => state.setSpeakerDisplayMode);
export const useSetParticipantDisplayMode = () => useSettingsStore((state) => state.setParticipantDisplayMode);

export const useUpdateLocalNative = () => useSettingsStore((state) => state.updateLocalNative);

export const useValidateApiKey = () => useSettingsStore((state) => state.validateApiKey);
export const useLoadSettings = () => useSettingsStore((state) => state.loadSettings);
export const useClearCache = () => useSettingsStore((state) => state.clearCache);

export const useGetProcessedLocalPrompt = () => useSettingsStore((state) => state.getProcessedLocalPrompt);
export const useCreateSessionConfig = () => useSettingsStore((state) => state.createSessionConfig);
export const useNavigateToSettings = () => useSettingsStore((state) => state.navigateToSettings);

export { useSettingsStore };
export default useSettingsStore;

// The old path's mode-aware revalidation lived here; readiness is the app session's since plan 1e-3b-2 (it re-ran the old gate, whose prune wrote the old slice).
