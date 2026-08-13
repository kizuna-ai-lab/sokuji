import { ProviderConfig, LanguageOption } from './ProviderConfig';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
// Type-only, so this adds no runtime edge from the shared descriptor module to
// SonioxClient's dependency graph (i18n, the wire components).
import type { ManagedSonioxSession, SonioxCredentialBundle, SonioxSttRole } from '../clients/ManagedSonioxSession';

/** Transport for realtime providers. Moved here from settingsStore so the
 *  services layer no longer imports from stores. settingsStore re-exports it. */
export type TransportType = 'websocket' | 'webrtc';

/** Normalized credentials produced by a descriptor from its settings slice.
 *  `missing` carries the user-facing message shown when validation is attempted
 *  with incomplete fields (e.g. "Both Client ID and Client Secret are required
 *  for Palabra AI"). Callers never name provider-specific fields. */
export type Credentials =
  | { ok: true; primary: string; secret?: string; endpoint?: string }
  | { ok: false; missing: string };

export type CredentialCtx = {
  /** Better Auth session-token accessor — required only by the kizuna twins. */
  getAuthToken?: () => Promise<string | null>;
};

export type ClientOptions = {
  transport: TransportType;
  webrtcOptions?: { inputDeviceId?: string; outputDeviceId?: string };
  /**
   * Managed Soniox only. The lease is acquired by MainPanel BEFORE any client
   * exists (an awaited round trip with a 409 retry), so the keys arrive here
   * rather than being minted inside the client. Keeping this optional is what
   * lets createClient stay synchronous and return exactly one IClient for all
   * eleven providers.
   */
  sonioxManaged?: {
    credentials: SonioxCredentialBundle;
    session: ManagedSonioxSession;
    /**
     * WHICH leg this client is — the role its bundle was taken with. Required,
     * not optional: it is how the leg names itself when it reports that Soniox
     * accepted its stream, and on a two-stream lease `session-started` refuses
     * a roleless body (400 `role_required`) and another leg's role
     * (`role_not_issued`), leaving the lease at its start window either way.
     */
    role: SonioxSttRole;
    /**
     * Whether THIS client speaks for the session when it ends for a
     * session-level reason — the balance running out, or Soniox dropping the
     * session at its granted duration. Defaults to true.
     *
     * Exactly one client per session may say yes; it is the primacy bit, and
     * this is its single source (ManagedSonioxSession reads it back off the leg
     * rather than being told a second time). Every leg is still ENDED by such
     * an outcome — saying no only means "not the one who says the sentence".
     *
     * It has to be the speaker whenever there is one, because MainPanel's
     * teardown renders `speakerClient.getConversationItems()`: a notice emitted
     * on the participant leg is not merely misplaced, it is never displayed.
     */
    announcesSessionOutcome?: boolean;
  };
};

export interface BothModePlan {
  /** One session, mic and system audio mixed. */
  shared: boolean;
  /** Two sessions, one per audio source. */
  split: boolean;
}

export interface ParticipantNotice {
  channel: 'error' | 'warning' | 'info';
  message: string;
}

export interface ParticipantSessionResult {
  /** null ⇒ this provider cannot run a participant leg right now; MainPanel
   *  maps null to the participant-skip path (splitParticipantFailure =
   *  'no-participant-config'). */
  config: SessionConfig | null;
  /** User-facing participant.error/.warning/.info events. Emitting them is
   *  MainPanel's job (side effects stay in the component). */
  notices: ParticipantNotice[];
}

export type PrepareOutcome =
  | {
      ok: true;
      /** Merged into the built session config just before connect (S5). */
      sessionPatch?: Record<string, unknown>;
      /** Applied via settingsStore.updateProviderSlice (S5). */
      settingsPatch?: Record<string, unknown>;
      /** Two-phase stale-selection guard (S5): `expect` is checked against the
       *  slice when the hook returns — on mismatch ALL outcome parts are
       *  discarded and Start proceeds unmodified. `expectAtApply` is re-checked
       *  immediately before merging sessionPatch — on mismatch the patch is
       *  dropped and the notice suppressed, Start proceeds. */
      expect?: Record<string, unknown>;
      expectAtApply?: Record<string, unknown>;
      /** Display-ready user notice (the hook owns i18n, S4-T3 precedent) —
       *  replaces the never-consumed noticeKey. */
      notice?: string;
    }
  | { ok: false; /** Display-ready text; blocks Start. */ message: string };

export interface PreparePorts {
  getAuthToken: () => Promise<string | null>;
  userId: string | null;
  /** Re-runs provider validation via the STORE action (validateApiKey) and
   *  reports the outcome. Exists because the revalidation authority IS
   *  settingsStore.validateApiKey — a store action with slice-writing side
   *  effects (isApiKeyValid drives the Start gate and the subtitle window's
   *  blocked state) that a descriptor must not import: settingsStore imports
   *  every descriptor, and the reverse edge is a cycle. MainPanel binds it. */
  revalidate: () => Promise<{ valid: boolean; message?: string }>;
  /** The session shape this Start is about to create. Provider-agnostic
   *  facts the component owns; hooks gate on them instead of re-deriving
   *  (the kizuna-soniox hook prepares a voice only when the speaker channel
   *  will actually speak). */
  sessionShape: { speakerWillStart: boolean; participantWillStart: boolean; textOnly: boolean };
  /** null clears the phase (a hook's finally). */
  onPhase: (phase: InitPhase | null) => void;
  /** Start cancellation. No caller aborts today — MainPanel supplies a live
   *  controller per Start and S6's abort path is the intended aborter; a hook
   *  must still honor it (result discarded silently once fired). */
  signal: AbortSignal;
}

/** Semantic preparation/loading phases the init button can display. Sites map
 *  phase → their own i18n key. */
export type InitPhase =
  | { phase: 'loading-models'; completed: number; total: number }
  | { phase: 'loading-native-asr' }
  | { phase: 'preparing-voice' };

/** Provider-neutral view of a metered session budget. The soniox descriptor
 *  adapts its SonioxBudgetSnapshot behind this; nothing provider-shaped
 *  crosses the seam. */
export interface BudgetSnapshot {
  remainingMs: number;
  totalMs: number;
}

/**
 * Session-scoped resources a provider acquires before any client exists and
 * releases after every client is down. MainPanel holds exactly one,
 * provider-agnostically, in sessionResourcesRef.
 */
export interface SessionResources {
  /** Per-leg additions to ClientOptions (today: the sonioxManaged bundle).
   *  Empty object when this leg gets nothing. A non-empty result means the
   *  acquire already produced this leg's credentials, so createAIClient
   *  skips extractCredentials for it. */
  legClientOptions(role: 'speaker' | 'participant'): Partial<ClientOptions>;
  /** Present iff the session runs on a metered budget. Drives the countdown
   *  generically — a data condition, not a provider condition. Returns null
   *  while the budget is not yet known. Implementations must not rely on `this`:
   *  callers may extract the function and call it bare. */
  budget?: () => BudgetSnapshot | null;
  /** Idempotent. 'aborted' = Start failed after acquire (the no-channel
   *  abort branch); 'disconnect' = normal teardown, including the
   *  init-failure unwind that routes through disconnectConversation. Called
   *  from afterBothLegs at both teardown sites, strictly after both legs are
   *  down — and never for a failed acquire (see acquireSessionResources). */
  release(reason: 'disconnect' | 'aborted'): void;
}

export interface AcquireSessionResourcesContext {
  getAuthToken: () => Promise<string | null>;
  /** The session's channel matrix, resolved by MainPanel. `textOnly` is the
   *  EFFECTIVE session text-only-ness — `speakerWillStart ? <store snapshot>
   *  : true` — resolved at the call site; the rule and its rationale live at
   *  the MainPanel computation, the descriptor consumes the value. `splitBoth`
   *  feeds the resolver's both-split decision; `sharedBoth` is carried for
   *  call-shape symmetry and deliberately NOT read — the soniox resolver
   *  derives roles from the acquire body instead (resolveManagedSonioxWiring
   *  documents why). */
  wiring: {
    speakerWillStart: boolean;
    participantWillStart: boolean;
    sharedBoth: boolean;
    splitBoth: boolean;
    textOnly: boolean;
  };
  /** Session-lifecycle events for the realtime log. Closed vocabulary — the
   *  managed lease emits 'session.retry' (409 on acquire) and
   *  'session.started_refused' (a refused session-started report). MainPanel
   *  forwards these to addRealtimeEvent; the log renders unknown types
   *  generically. */
  onEvent: (type: 'session.retry' | 'session.started_refused', data: unknown) => void;
}

/**
 * The deep module for one provider. Everything the app needs to know about a
 * provider is answered here; callers dispatch via
 * ProviderConfigFactory.getDescriptor(provider) instead of switching on the enum.
 * See CONTEXT.md ("ProviderDescriptor").
 */
export interface ProviderDescriptor {
  getConfig(): ProviderConfig;
  /** zustand slice in SettingsStore holding this provider's persisted settings. */
  readonly settingsSliceKey: string;
  /** i18n namespace under `providers.*`; defaults to getConfig().id. */
  readonly i18nKey?: string;
  /** True when the CLIENT owns audio capture over WebRTC transport
   *  (MediaStreamTrack) and MainPanel must not start the native recorder.
   *  NOT "can run over webrtc": PalabraAI always runs webrtc transport yet
   *  declares false, because its capture path is appendInputAudio. See
   *  capabilities.forcedTransport for transport selection. */
  readonly supportsWebRTC: boolean;

  createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient;
  validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }>;
  latestRealtimeModel(models: FilteredModel[]): string;

  extractCredentials(slice: unknown, ctx: CredentialCtx): Promise<Credentials>;
  /** Sync read of what the user has typed as the primary credential — for UI
   *  display only (ProviderSection key indicator). '' when not applicable. */
  peekPrimaryCredential(slice: unknown): string;

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig;

  /**
   * Session config for the participant (reverse-direction) channel.
   *
   * Base: buildSessionConfig(slice, swappedInstructions) + the generic
   * participant overrides — textOnly is forced true (the participant leg
   * never speaks), turn detection is overridden to OpenAI-shaped semantic
   * VAD (providers that don't read the field ignore it, exactly as before
   * the extraction). Providers whose direction lives in config fields
   * override to also reverse those fields.
   */
  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult;

  resolveSourceLanguages(): LanguageOption[];
  resolveTargetLanguages(source: string): LanguageOption[];
  reconcileTarget(source: string, currentTarget: string): string;

  /** Session shape for Both mode. Base: neither — one client per channel,
   *  the historical fall-through every non-Soniox provider runs today.
   *  `mode` is the effective AudioMode-shaped scope ('speaker' | 'participant'
   *  | 'both'). */
  planBothMode(slice: unknown, mode: string): BothModePlan;

  /**
   * Does this provider/model build its participant session by swapping a
   * *concrete* source language into the translate target?
   *
   * Most providers carry translation direction in the system instruction, and
   * the participant session is built from an already-reversed one — those are
   * indifferent to an `auto` source, because nothing has to be swapped.
   * Base: false — most providers carry direction in the system instruction.
   *
   * The two here are not:
   * - **Soniox** reverses `sourceLanguage`/`targetLanguage` directly.
   * - **Gemini Live Translate** reverses `translationConfig.targetLanguageCode`,
   *   which overrules the instruction, so the instruction swap cannot stand in
   *   for it. Only the translate models — the dialogue Live models carry
   *   direction in the instruction like everyone else.
   *
   * For both, an `auto` source would reverse into the literal `auto` as the
   * participant's translate target, which is not a language. Callers require a
   * concrete source language whenever a participant channel is in scope; see
   * `computeStartGate`'s `autoSourceParticipantBlocked`.
   */
  reversesDirectionViaSourceLanguage(model: string | null | undefined): boolean;

  /**
   * Optional async pre-start hook, awaited by MainPanel FIRST in the connect
   * sequence (before the no-channel guard, any audio init, any client).
   * ok:false blocks Start with the display-ready message; a REJECTED promise
   * is treated as ok:false with a generic message (MainPanel catches and
   * logs); once ports.signal fires the result is discarded silently.
   */
  prepareToStart?(slice: unknown, ports: PreparePorts): Promise<PrepareOutcome>;

  /**
   * Acquire session-scoped resources (a lease, metered credentials) before
   * any client is constructed. Undefined on providers whose clients carry
   * their own key — MainPanel treats undefined as null resources.
   *
   * Deliberately separate from createClient: acquiring is an awaited network
   * round trip, createClient is synchronous and per-leg, and the resources
   * outlive any one client.
   *
   * Error path (normative): either return resources or throw AFTER cleaning
   * up your own partial state (ManagedSonioxSession.end() is idempotent and
   * no-ops without a lease, so a wrapper's catch may always call it).
   * MainPanel catches the throw, unwinds Start through the existing abort
   * path, and NEVER calls release() for a failed acquire.
   */
  acquireSessionResources?(ctx: AcquireSessionResourcesContext): Promise<SessionResources | null>;
}

/** Shared defaults. Subclasses override only what differs from the common case
 *  (single apiKey credential, model list from config, unrestricted languages). */
export abstract class BaseProviderDescriptor implements ProviderDescriptor {
  abstract getConfig(): ProviderConfig;
  abstract readonly settingsSliceKey: string;
  readonly i18nKey?: string;
  readonly supportsWebRTC: boolean = false;

  abstract createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient;
  abstract validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }>;
  abstract buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig;

  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const config = {
      ...this.buildSessionConfig(slice, swappedInstructions),
      keepReplayAudio: shell.keepReplayAudio,
      textOnly: true,
      // Override turn detection to use semantic VAD for participant audio (OpenAI-compatible)
      turnDetection: {
        type: 'semantic_vad' as const,
        createResponse: true,
        interruptResponse: false,
        eagerness: 'high',
      },
    } as SessionConfig;
    return { config, notices: [] };
  }

  latestRealtimeModel(models: FilteredModel[]): string {
    return models[0]?.id ?? this.getConfig().models[0]?.id ?? '';
  }

  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const apiKey = (slice as { apiKey?: string })?.apiKey ?? '';
    if (!apiKey) return { ok: false, missing: `API key is required for ${this.getConfig().id}` };
    return { ok: true, primary: apiKey };
  }

  peekPrimaryCredential(slice: unknown): string {
    return (slice as { apiKey?: string })?.apiKey ?? '';
  }

  resolveSourceLanguages(): LanguageOption[] {
    return this.getConfig().languages;
  }

  resolveTargetLanguages(_source: string): LanguageOption[] {
    const cfg = this.getConfig();
    return cfg.targetLanguages ?? cfg.languages;
  }

  reconcileTarget(source: string, currentTarget: string): string {
    const allowed = this.resolveTargetLanguages(source).map(l => l.value);
    return allowed.includes(currentTarget) ? currentTarget : (allowed[0] ?? currentTarget);
  }

  planBothMode(_slice: unknown, _mode: string): BothModePlan {
    return { shared: false, split: false };
  }

  reversesDirectionViaSourceLanguage(_model: string | null | undefined): boolean {
    return false;
  }
}
