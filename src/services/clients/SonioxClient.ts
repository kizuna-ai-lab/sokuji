import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  SonioxSessionConfig
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { SonioxSttStream, SonioxSttMessage, SonioxToken, SonioxTranslationConfig, SonioxSttConfig } from './SonioxSttStream';
import { SonioxTtsStream } from './SonioxTtsStream';
import { SonioxBudgetSnapshot } from './SonioxCostMeter';
import { SONIOX_TTS_MODEL, SONIOX_DEFAULT_VOICE } from '../../lib/soniox/ttsCatalog';
import { sonioxHosts, type SonioxRegion } from '../../lib/soniox/regions';
import type { ManagedSonioxSession, SonioxCredentialBundle, SonioxSttRole } from './ManagedSonioxSession';
import type { SonioxSessionLeg, SonioxSessionOutcomeNotice } from './SonioxSessionOutcome';
import { PcmMixer } from './PcmMixer';
import { SonioxSideTracker } from './SonioxSideTracker';
import i18n from '../../locales';

/**
 * Soniox speech-to-speech translation client.
 *
 * Orchestrates two protocol components:
 * - SonioxSttStream: STT+translation (always on)
 * - SonioxTtsStream: spoken translation (only when !textOnly; best-effort —
 *   a TTS failure degrades the session to subtitles, never kills it)
 *
 * All Sokuji conversation semantics (items, finals-only feeding, <end>
 * segmentation) live here; the streams speak only the Soniox wire protocol.
 *
 * No-interruption rule: createResponse/cancelResponse are no-ops and
 * onConversationInterrupted is never fired — the translation stream is
 * continuous and AI output must never be cut by user audio.
 */

const STT_MODEL = 'stt-rt-v5';
const SAMPLE_RATE = 24000; // Sokuji mic pipeline and ModernAudioPlayer both run at 24 kHz
/**
 * STT failures the user did not cause and cannot fix from the settings — the
 * only useful response is to start again:
 *  - 503: service unavailable. Transient by definition.
 *  - 408: request timeout, i.e. no audio reached Soniox for ~20 s. Reachable
 *    in a live session when input stops (a long mute), so it is a dead
 *    session, not a misconfiguration.
 *  - socket_error: SonioxSttStream's own code for a transport-level failure.
 * Everything else (400/401/429/…) stays on surfaceSttError's raw path, where
 * the server's own words ARE the actionable part and replacing them with a
 * generic sentence would hide the fix.
 */
const RECOVERABLE_STT_CODES: ReadonlySet<string> = new Set(['503', '408', 'socket_error']);

/**
 * Second constructor argument. The PRESENCE of `session` is the explicit
 * managed-mode flag — deliberately not inferred from the credential bundle's
 * shape, because "the bundle carries a clientReferenceId" would silently
 * mis-gate the BYOK-only 503 resume ladder for any managed-looking bundle.
 * It is also what feeds the allowance countdown its clock (wireSttHandlers
 * forwards the STT keepalive tick to it).
 */
export interface SonioxClientOptions {
  session?: ManagedSonioxSession;
  /**
   * WHICH leg of the session this client is — the same role its credential
   * bundle was taken with. Managed only; a BYOK client has no lease and no leg.
   *
   * It exists so the client can name itself when it reports that Soniox
   * accepted its stream (see handleSttMessage). The role must be this leg's
   * OWN: on a two-stream lease the backend refuses a roleless body with 400
   * `role_required` and another leg's role with `role_not_issued`, and in both
   * cases the lease is left at its start window while both keys stay valid.
   *
   * Optional, and a managed client without it simply reports nothing: no bit is
   * better than a bit naming the wrong leg, which can never be cleared. In
   * production KizunaAISonioxProviderConfig always supplies it — ClientOptions
   * makes it required there.
   */
  sttRole?: SonioxSttRole;
  /** See ClientOptions.sonioxManaged.announcesSessionOutcome. Defaults to true,
   *  which is the right answer for every single-leg session and for the speaker
   *  leg of a split one. */
  announcesSessionOutcome?: boolean;
}

export class SonioxClient implements IClient, SonioxSessionLeg {
  private stt: SonioxSttStream | null = null;
  private tts: SonioxTtsStream | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private isConnectedState = false;
  // Monotonic session generation. connect() stamps a new one; disconnect()
  // bumps it to invalidate any in-flight connect()/ensureTts() whose awaited
  // socket resolves after the session was already stopped — without this a
  // late reconnect installs a live socket and flushes speech after Stop
  // (audio-after-stop) and leaks the socket.
  private generation = 0;
  private instanceId: string;
  private currentConfig: SonioxSessionConfig | null = null;
  private bidirectional = false;
  // Both single-session: mixes appendInputAudio (channel A) with the
  // secondary port's appendParticipantAudio (channel B) into one STT stream.
  private mixer: PcmMixer | null = null;
  // Both single-session only: energy timeline + speaker-label memory that
  // resolves which side an utterance belongs to (see SonioxSideTracker docs).
  private sideTracker: SonioxSideTracker | null = null;

  // Per-utterance display state
  private currentUserItemId: string | null = null;
  private currentAssistantItemId: string | null = null;
  private userFinal = '';
  private assistantFinal = '';
  // Detected language of the in-flight utterance's text, per side, from the
  // tokens themselves: the transcript (original) token's `language` is the
  // spoken language; the translation token's `language` is the language it was
  // translated into. Surfaced as ConversationItem.detectedLanguage so the
  // bubble badge shows what was actually spoken/produced, not the configured
  // pair (which is wrong for two_way and auto-detect). Reset per utterance.
  private userLanguage: string | null = null;
  private assistantLanguage: string | null = null;
  // TTS language for the in-flight utterance (two_way: from the first final
  // translation token; one_way: always the target language)
  private utteranceTtsLanguage: string | null = null;
  private ttsFailedOnce = false;
  // Bidirectional only: which side (my language vs. the other's) the
  // in-flight utterance belongs to, derived from the first original token's
  // language (or the first translation token's source_language, if the
  // original arrived in an earlier already-flushed message). Reset on
  // <end> and in reset().
  private utteranceSide: 'speaker' | 'participant' | null = null;
  // Tracks which utterance's audio is currently streaming back from TTS.
  // Deliberately independent of currentAssistantItemId: text_end is sent on
  // <end> (which clears currentAssistantItemId), but the trailing audio for
  // that same utterance keeps arriving afterward — it must still land on the
  // completed utterance's item, not mint a new one.
  private audioItemId: string | null = null;
  // Snapshot of utteranceSide taken at the same moment audioItemId is
  // latched (in feedTts). TTS audio and STT text are independent async
  // streams: <end> resets the live utteranceSide to null, and the NEXT
  // utterance can re-latch a new one before this utterance's trailing audio
  // has finished arriving. emitAssistantAudio must tag with the side this
  // audio's utterance actually belonged to, not whatever utteranceSide is
  // live when the audio happens to show up.
  private audioItemSide: 'speaker' | 'participant' | null = null;
  // Text fed to TTS for the current utterance, accumulated for the tts.speak
  // debug-timeline event (reset each utterance).
  private ttsSpokenText = '';
  // Reconnect-on-demand: the server closes an idle TTS socket with no active
  // stream after ~5.3 s (408: "Request timeout") regardless of keep_alive —
  // measured live; well inside the 20 s keepalive interval, so keep_alive
  // never gets a chance to save it — so between/before utterances the socket
  // often dies. When feedTts finds it closed it queues the text/end here and
  // re-establishes the socket; the queue is flushed in order once connected.
  private ttsConnecting = false;
  private ttsPending: Array<{ kind: 'text'; text: string; language: string } | { kind: 'end' }> = [];

  // The lease is gone from this class (design decision 7). What is left is what
  // a STREAM needs: the keys for its two sockets and the reference to echo.
  // Both are readonly constructor fields, which is what makes reset() — which
  // runs at the TOP of connect() — structurally unable to clear them.
  private readonly credentials: SonioxCredentialBundle;
  private readonly session: ManagedSonioxSession | null;
  // Which leg of the session this client is. Readonly and constructor-set for
  // the same reason the bundle is: it identifies the stream, so reset() must be
  // structurally unable to clear it. Null for BYOK.
  private readonly sttRole: SonioxSttRole | null;
  // Whether this leg is the session's ONE announcer of session-level outcomes.
  // False only for the participant leg of a split Both session, where the
  // speaker owns the announcement — see the option's docstring. Exposed
  // read-only as `announcesSessionOutcome` (the SonioxSessionLeg member the
  // session reads), so the primacy bit has exactly one source: the value
  // MainPanel's managedSonioxArgFor computed at construction.
  private readonly announcesSessionOutcomeFlag: boolean;
  // Guards endForSessionOutcome. finishSession calls it on every leg on every
  // invocation, and in split the second leg's own 403 re-enters — without this,
  // end() would be sent twice on the same socket. Per-session, so reset()
  // (which runs at the top of connect()) clears it.
  private sessionOutcomeEnded = false;
  // Set by handleSttError when a managed session's STT stream reports the
  // 403 "granted duration reached" error frame; consumed (and cleared) by
  // the close that always immediately follows it — see onClose's docstring.
  private pendingDurationCutoff = false;
  // Set by handleSttError when the STT stream reports a 503 "service
  // unavailable" error frame — a transient server condition, not a fatal
  // one. Holds the original error message (null = no 503 pending); consumed
  // (and cleared) by the close that always immediately follows the error
  // frame, which passes it to resumeSttStream() so a final failure can still
  // report the ORIGINAL 503, not whatever the last reconnect attempt threw.
  // BYOK-only (unlike pendingDurationCutoff, which is managed-only) — see
  // handleSttError's docstring for why a managed reconnect can't work.
  // MUST be cleared by disconnect(), not just consumed by the close that is
  // supposed to follow the error frame: that "always followed by a close"
  // assumption is only live-verified for the 403 cutoff, not the 503. If a
  // 503 frame arrives with no close and the user hits Stop, disconnect()
  // bumps generation and closes the socket itself; the resulting close
  // (fired by the browser after ws.close(), possibly after disconnect()
  // has already returned) would otherwise still find this flag set and
  // kick off resumeSttStream() — which captures the ALREADY-BUMPED
  // generation at entry, so every "stale attempt" guard trivially passes
  // and a fresh socket connects after Stop (zombie socket, managed billing
  // restart if this were ever allowed in managed mode).
  private pendingSttResume503: string | null = null;
  // True once the user has already been told why THIS stream is ending —
  // wider than "an error frame arrived": it also covers a graceful ending
  // whose reason was announced before the socket closed
  // (endForSessionOutcome, on EVERY leg the session tears down — including
  // the one that lost the announcement race and never said anything itself,
  // because the sentence was rendered on the other leg and a second,
  // contradictory one here would be worse than silence). Read by
  // handleSttClose's fall-through to tell
  // "the socket died with no warning" (say so) from "we already told the
  // user why" (stay quiet), so a close that follows an announced outcome
  // never gets a second, contradictory notice layered on top of it. Set at
  // the top of handleSttError, BEFORE its early returns, so the cutoff and
  // resume paths count as having spoken too — a 503 whose close never
  // arrives must not let a later close file a second, contradictory report.
  // endForSessionOutcome sets it too, immediately above its own
  // this.stt?.end(), for the identical reason. Cleared per stream in
  // wireSttHandlers, and by reset().
  private sttOutcomeAnnounced = false;
  // Per-session count of 503 resume cycles actually started (incremented in
  // handleSttError, reset by reset() → i.e. every connect()). Caps a
  // flapping server from looping forever: past MAX_STT_RESUME_CYCLES a 503
  // is treated like any other error instead of triggering another resume.
  private sttResumeCycles = 0;
  private static readonly MAX_STT_RESUME_CYCLES = 5;

  constructor(credentials: SonioxCredentialBundle, options?: SonioxClientOptions) {
    this.credentials = credentials;
    this.session = options?.session ?? null;
    this.sttRole = options?.sttRole ?? null;
    this.announcesSessionOutcomeFlag = options?.announcesSessionOutcome ?? true;
    this.instanceId = `soniox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * SonioxSessionLeg: is this the ONE leg that speaks for the session?
   *
   * Read by ManagedSonioxSession.finishSession to pick the announcer. True for
   * the speaker of a split Both session and for every single-leg session;
   * false for the split participant, whose conversation items MainPanel never
   * renders (its teardown does setItems(speakerClient.getConversationItems())).
   */
  get announcesSessionOutcome(): boolean {
    return this.announcesSessionOutcomeFlag;
  }

  /** Backend-billed session? One question, one answer, five readers: the two
   *  key selections, the 403 granted-duration gate, the BYOK-only 503 resume
   *  gate, and the allowance countdown. */
  private get isManaged(): boolean {
    return this.session !== null;
  }

  private generateItemId(type: string): string {
    return `${this.instanceId}_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /** Validate the key with a cheap temporary-key probe (201 = valid), against
   *  the region the key belongs to. A key probed on the WRONG region's host
   *  answers 401 and would be reported to the user as invalid. */
  static async validateApiKeyAndFetchModels(apiKey: string, region: SonioxRegion): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    if (!apiKey) {
      return {
        validation: { valid: false, message: i18n.t('settings.errorValidatingApiKey'), validating: false },
        models: []
      };
    }
    try {
      const response = await fetch(`https://${sonioxHosts(region).api}/v1/auth/temporary-api-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
      });
      if (response.status === 200 || response.status === 201) {
        return {
          validation: { valid: true, message: i18n.t('settings.apiKeyValidationCompleted'), validating: false },
          models: [{ id: STT_MODEL, type: 'realtime', created: Date.now() }]
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          validation: { valid: false, message: i18n.t('settings.invalidApiKeyFormat'), validating: false },
          models: []
        };
      }
      return {
        validation: { valid: false, message: `${i18n.t('settings.errorValidatingApiKey')}: HTTP ${response.status}`, validating: false },
        models: []
      };
    } catch (error: any) {
      return {
        validation: { valid: false, message: error.message || i18n.t('settings.errorValidatingApiKey'), validating: false },
        models: []
      };
    }
  }

  async connect(config: SessionConfig): Promise<void> {
    if (config.provider !== 'soniox') {
      throw new Error('Invalid session config for Soniox client');
    }
    this.currentConfig = config as SonioxSessionConfig;
    this.reset();
    const gen = ++this.generation;

    const cfg = this.currentConfig;
    // two_way needs a concrete source; degrade to one_way on 'auto'
    // (the descriptor applies the same rule — this is the safety belt).
    this.bidirectional = cfg.bidirectional && cfg.sourceLanguage !== 'auto';

    // No network round trip here any more: MainPanel acquired the session and
    // handed this client its bundle before construction. What happens here is
    // registration: this stream joins the session's list of legs, so a
    // session-level ending (balance exhausted, granted duration reached) can be
    // announced once and tear down EVERY leg.
    //
    // EVERY leg registers, not just the announcing one — the session reads
    // `announcesSessionOutcome` off each leg to pick who speaks. Registering
    // here rather than in the constructor is deliberate: a leg that is
    // constructed and never connected (the participant whose loopback
    // permission was refused) has no stream to end and must not be waited on.
    this.session?.attachLeg(this);

    this.stt = new SonioxSttStream();
    this.wireSttHandlers(this.stt);
    // buildSttConnectConfig() is a pure function of currentConfig, the
    // readonly credential bundle, and the instance fields set above
    // (this.bidirectional) — resumeSttStream() calls the exact same helper to
    // rebuild a byte-identical config frame on a fresh stream.
    const sttConfig = this.buildSttConnectConfig();
    await this.stt.connect(sttConfig);
    // If disconnect() ran during the STT connect await, this attempt is stale:
    // close the socket we just opened and bail before wiring anything up.
    if (gen !== this.generation) { this.stt?.close(); this.stt = null; return; }
    this.isConnectedState = true;

    if (this.bidirectional) {
      this.sideTracker = new SonioxSideTracker();
      this.mixer = new PcmMixer({
        frameSamples: Math.round(SAMPLE_RATE * 0.1),
        intervalMs: 100,
        maxBacklogSamples: SAMPLE_RATE * 2,
        // Record energy ONLY for frames actually sent: dropped frames don't
        // advance the server's audio clock, and the tracker's frame index
        // must line up with token start_ms.
        onFrame: (mixed, energyA, energyB) => {
          if (this.stt?.isOpen()) {
            this.stt.sendAudio(mixed);
            this.sideTracker?.recordFrame(energyA, energyB);
          }
        },
      });
      this.mixer.start();
    }

    if (!cfg.textOnly) {
      try {
        const stream = this.createTtsStream();
        await stream.connect();
        // Stale attempt guard: if disconnect() ran during the connect await,
        // discard the socket instead of installing it (would leak + speak after Stop).
        if (gen !== this.generation) { stream.close(); return; }
        this.tts = stream;
        // No prewarm: a config-only TTS stream with no text — and, the same
        // way, an idle socket with no active stream at all — is closed by the
        // server after ~5.3 s (408: "Request timeout"; measured live) regardless
        // of keep_alive, so this socket may die during a long silence before
        // the first translation. feedTts detects a closed socket and
        // reconnects on demand (see ensureTts).
      } catch (error) {
        // Best-effort: never fail the session because TTS is unavailable.
        // feedTts will retry the connection on the first translation.
        console.error('[SonioxClient] TTS initial connect failed — will reconnect on demand:', error);
        this.tts = null;
      }
    }

    // Final stale-attempt guard before announcing the session is open.
    if (gen !== this.generation) return;
    this.emitRealtime('client', 'session.opened', {
      provider: 'soniox',
      translation: sttConfig.translation,
      textOnly: !!cfg.textOnly,
    });
    this.eventHandlers.onOpen?.();
  }

  /**
   * Wire a fresh SonioxSttStream's handlers to this client's message/error/
   * close/tick routing. Used identically by connect() and resumeSttStream()
   * so a resumed stream behaves exactly like the original one — including
   * being eligible for a FUTURE 503 resume of its own.
   */
  private wireSttHandlers(stream: SonioxSttStream): void {
    // Captured at wire time. Both connect() and disconnect() bump
    // `generation`, so comparing it inside onClose is what distinguishes a
    // live socket dying from the close event a browser fires asynchronously
    // for a socket disconnect() already closed. Without this, a clean Stop
    // would end with a "connection interrupted" notice.
    const gen = this.generation;
    this.sttOutcomeAnnounced = false;
    stream.setHandlers({
      onMessage: (message) => this.handleSttMessage(message),
      onError: (code, message) => this.handleSttError(code, message),
      onClose: (event) => this.handleSttClose(event, gen),
      // The meter's own clock, not a second timer — see onTick's docstring
      // on SonioxSttStreamHandlers. Forwarded to the SESSION, which owns the
      // meter. A no-op for BYOK. `tick` is absolute (now - startedAt), so
      // FE3's second forwarder from the participant leg is harmless.
      onTick: () => this.session?.tick(Date.now()),
    });
  }

  /**
   * Build the STT wire config frame. A pure function of currentConfig, the
   * readonly credential bundle, and the instance fields that outlive a single
   * stream (this.bidirectional) — never of local variables
   * computed inline during one connect() call — so resumeSttStream() can
   * call this same helper after a 503 and get a byte-identical config on
   * the fresh stream, without connect()'s caller-specific setup re-running.
   */
  private buildSttConnectConfig(): SonioxSttConfig {
    const cfg = this.currentConfig!;
    const translation: SonioxTranslationConfig = this.bidirectional
      ? { type: 'two_way', language_a: cfg.sourceLanguage, language_b: cfg.targetLanguage }
      : { type: 'one_way', target_language: cfg.targetLanguage };
    const languageHints = this.bidirectional
      ? [cfg.sourceLanguage, cfg.targetLanguage]
      : (cfg.sourceLanguage !== 'auto' ? [cfg.sourceLanguage] : undefined);
    // Map the session config's camelCase context to the wire's snake_case.
    // buildSessionConfig only sets `context` when at least one of
    // terms/translations/background text is non-empty.
    const sttContext = cfg.context
      ? {
          ...(cfg.context.terms?.length ? { terms: cfg.context.terms } : {}),
          ...(cfg.context.translationTerms?.length
            ? { translation_terms: cfg.context.translationTerms }
            : {}),
          ...(cfg.context.text ? { text: cfg.context.text } : {}),
        }
      : undefined;
    return {
      apiKey: this.credentials.stt,
      // From the BUNDLE, so a split Both session's two legs cannot drift onto
      // different regions and neither can a mid-session settings change.
      region: this.credentials.region,
      model: cfg.model || STT_MODEL,
      sampleRate: SAMPLE_RATE,
      languageHints,
      translation,
      ...(sttContext ? { context: sttContext } : {}),
      endpointSensitivity: cfg.endpointSensitivity,
      endpointLatencyAdjustmentLevel: cfg.endpointLatencyAdjustmentLevel,
      // Inert on the wire — Soniox attributes usage to the reference bound to
      // the KEY (probed 2026-08-11). Kept as a harmless hedge; nothing relies on it.
      clientReferenceId: this.credentials.clientReferenceId,
      ...(this.bidirectional ? { enableSpeakerDiarization: true } : {}),
    };
  }

  /**
   * Shared onClose routing for every SonioxSttStream this client ever wires
   * (the original one from connect() and any resumed one from
   * resumeSttStream()). Three branches, checked in order: the managed-
   * duration cutoff (a pending 403), a resumable BYOK 503 (silently
   * reconnects instead of tearing the session down), and — falling through
   * both — a bare close, which reports a recoverable-outage notice UNLESS
   * sttOutcomeAnnounced is already true, meaning some earlier step
   * (handleSttError's own early paths, or a session-level ending routed
   * through endForSessionOutcome) already accounted for why this stream is
   * ending.
   * Order matters for the first two: the managed-duration cutoff is checked
   * first so a managed 403 is never misread as a resumable 503 — the two
   * flags are mutually exclusive in practice (handleSttError only ever sets
   * one per error frame) but cutoff must win if that ever changes.
   *
   * `gen` is the generation this stream's handlers were wired under
   * (captured once, at wireSttHandlers time). Comparing it against the
   * CURRENT this.generation, before anything else runs, is what
   * distinguishes a live socket dying from the close event a browser fires
   * asynchronously for a socket that a user-initiated disconnect() (or a
   * stale connect()/resume attempt) already closed. Those closes describe a
   * session that is over and must change nothing: not the notice, not
   * isConnectedState, not onClose.
   */
  private handleSttClose(event: { code?: number; reason?: string }, gen: number): void {
    // A stale close belongs to a socket nobody is listening to any more, and
    // it must not touch session state at all — not just skip the notice.
    // Everything below assumes it is describing the CURRENT session:
    // `isConnectedState = false` would mark a freshly started session
    // disconnected, and `onClose` would run MainPanel's full teardown on it
    // (MainPanel's own `isSessionActive` guard passes, because the new
    // session really is active). The narrow but real path: Stop, Start, then
    // the browser dispatches the first socket's close. There is also a
    // guaranteed, harmless-today case this closes — disconnect() reports the
    // close itself, so without this every Stop delivered onClose twice.
    if (gen !== this.generation) {
      this.emitRealtime('client', 'session.stale_close', { provider: 'soniox', ...event });
      return;
    }
    this.isConnectedState = false;
    // Managed sessions: Soniox drops the session at its granted duration by
    // sending a 403 error frame (caught by handleSttError, which sets this
    // flag and suppresses the generic error bubble) immediately followed by
    // this close. Say so as a normal system notice — the same seam every
    // client uses — rather than a provider-specific field on the close event
    // that only MainPanel could read. Per explicit product decision this does
    // NOT auto-reconnect: a silent reconnect would restart billing without
    // the user knowing, so the user must tap Start for a new segment.
    if (this.pendingDurationCutoff) {
      this.pendingDurationCutoff = false;
      // Per-LEG telemetry, deliberately emitted by both legs: in split both
      // STT keys share one max_session_duration_seconds, so seeing two of
      // these in one session is the expected shape, not a duplicate.
      this.emitRealtime('client', 'session.duration_cutoff', { provider: 'soniox', ...event });
      if (this.session) {
        // Session-level: announced ONCE, on the announcing leg, and every leg
        // torn down. Whichever leg's close arrives first calls this; the other
        // one's call is a no-op for the notice and still ends it.
        this.session.finishSession('duration_cutoff');
      } else {
        // Unreachable by construction — pendingDurationCutoff is only ever set
        // on the managed branch of handleSttError, which implies a session.
        // Kept because that invariant lives in a mutable field two hundred
        // lines away, and the cost of it breaking is a session that ends in
        // silence — the exact failure this whole path exists to prevent.
        this.emitSystemNotice(
          i18n.t('mainPanel.sonioxSegmentEnded', 'This segment has ended — tap Start Session to continue.')
        );
      }
      this.eventHandlers.onClose?.(event);
      return;
    }
    // A 503 error frame (transient "service unavailable") is always
    // immediately followed by a close, same protocol shape as the 403
    // cutoff above. Unlike the cutoff, this one silently resumes: no error
    // bubble, no onClose to MainPanel (which would tear the whole session
    // down) — just onReconnecting while a fresh stream is negotiated.
    if (this.pendingSttResume503 !== null) {
      const originalMessage = this.pendingSttResume503;
      this.pendingSttResume503 = null;
      this.emitRealtime('client', 'session.stt_resuming', { provider: 'soniox', ...event });
      this.eventHandlers.onReconnecting?.();
      void this.resumeSttStream(originalMessage);
      return;
    }
    // A close with no announced outcome before it is the shape of a network
    // drop (or a server going away): the user has been told nothing at all,
    // and this was the last silent failure left. No generation check needed
    // here — the stale-close guard at the top of this method already
    // established that this close describes the current session.
    if (!this.sttOutcomeAnnounced) {
      this.surfaceRecoverableOutage(
        String(event.code ?? 'socket_closed'),
        event.reason || 'The Soniox connection closed unexpectedly'
      );
    }
    this.emitRealtime('client', 'session.closed', { provider: 'soniox', ...event });
    this.eventHandlers.onClose?.(event);
  }

  /**
   * Reconnect the STT stream after a transient 503, up to 3 attempts with
   * 0 ms / 1000 ms / 3000 ms gaps between them. Runs the same config-frame
   * builder and handler wiring as connect() so the resumed stream is
   * indistinguishable from the original one on the wire.
   *
   * `originalMessage` is the 503 error frame's own message — final failure
   * surfaces THIS, not whatever the last reconnect attempt's rejection
   * reason happened to be, since from the user's perspective the story is
   * "the service was unavailable and never came back", not "attempt 3
   * failed for reason X".
   */
  private async resumeSttStream(originalMessage: string): Promise<void> {
    // Captured once at entry: disconnect() bumps this.generation, and every
    // await below re-checks it so a Stop during a backoff delay or an
    // in-flight connect leaves nothing dangling.
    const gen = this.generation;

    // The interrupted utterance cannot survive the stream swap: the fresh
    // socket restarts the server's audio clock at 0 and re-mints its own
    // speaker labels, so anything keyed to the old stream's timeline must
    // be abandoned, not carried forward.
    this.abandonUtteranceState();
    this.sideTracker?.reset();

    const delaysBeforeAttempt = [0, 1000, 3000];
    for (const delayMs of delaysBeforeAttempt) {
      if (delayMs > 0) await SonioxClient.delay(delayMs);
      if (gen !== this.generation) return; // disconnect() ran during the delay
      try {
        const stream = new SonioxSttStream();
        this.wireSttHandlers(stream);
        await stream.connect(this.buildSttConnectConfig());
        // Stale-attempt guard: disconnect() ran while this attempt's connect
        // was in flight — discard the socket instead of installing it.
        if (gen !== this.generation) { stream.close(); return; }
        this.stt = stream;
        this.isConnectedState = true;
        this.emitRealtime('client', 'session.stt_resumed', { provider: 'soniox' });
        this.eventHandlers.onReconnected?.();
        return;
      } catch (error) {
        console.error('[SonioxClient] STT resume attempt failed:', error);
        if (gen !== this.generation) return; // disconnect() ran during the failed connect await
      }
    }

    // All attempts exhausted: from here the story is the one a managed 503
    // already tells — the service was unavailable and never came back — so it
    // reads the same, then closes the session so MainPanel tears it down
    // exactly like any other fatal client close. Emit the realtime milestone
    // BEFORE the notice/onClose — the generic close branch in handleSttClose
    // always emits one (session.closed); this path bypasses that branch
    // entirely, so without this the debug timeline would show the 503 and the
    // resume attempts but nothing marking the session as actually over.
    if (gen !== this.generation) return;
    this.emitRealtime('client', 'session.stt_resume_failed', { provider: 'soniox', message: originalMessage });
    this.surfaceRecoverableOutage('503', originalMessage);
    this.eventHandlers.onClose?.({ code: 1006, reason: 'stt resume failed' });
  }

  /**
   * Complete one role's in-progress item with the text accumulated so far —
   * flips it to 'completed' in place, preserving any replay audio already
   * buffered on it. No-op when there's no text. Shared by finishUtterance
   * (normal <end>) and abandonUtteranceState (an utterance interrupted by a
   * 503 stream swap) — both need identical "complete what we have" semantics,
   * just triggered by different events.
   */
  private completeItem(role: 'user' | 'assistant', existingId: string | null, text: string): void {
    if (!text) return;
    // Preserve any replay audio already accumulated on this item: this
    // rebuild would otherwise drop TTS audio that arrived before the
    // completion trigger (keepReplayAudio only — undefined otherwise, a no-op).
    const prev = existingId ? this.conversationItems.find((i) => i.id === existingId) : undefined;
    const audio = prev?.formatted?.audio as Int16Array | undefined;
    const detected = role === 'user' ? this.userLanguage : this.assistantLanguage;
    const item = this.upsertItem(role, existingId, {
      status: 'completed',
      formatted: audio ? { text, transcript: text, audio } : { text, transcript: text },
      content: [{ type: 'text', text }],
      ...(detected ? { detectedLanguage: detected } : {}),
    });
    if (this.bidirectional && this.utteranceSide) item.source = this.utteranceSide;
    this.eventHandlers.onConversationUpdated?.({ item, delta: {} });
  }

  /**
   * An item minted by emitTextUpdate for a PARTIAL-only utterance (no
   * is_final token ever arrived before the 503 landed) never reaches
   * completeItem's text-based completion above — userFinal/assistantFinal
   * is still '' at that point, so completeItem no-ops — yet the item
   * exists and is listed as 'in_progress'. Left alone it would stay
   * in_progress forever (partial text is never retained in instance state,
   * so there's nothing to feed completeItem after the fact). Flip it to
   * 'completed' WITHOUT touching its existing formatted/content: we cannot
   * honestly claim any particular text as "final" here, only that nothing
   * more is coming for it. A no-op if completeItem already completed it
   * (non-empty final text) or if no item was ever minted for this role.
   */
  private forceCompleteStuckItem(id: string | null): void {
    if (!id) return;
    const idx = this.conversationItems.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const previous = this.conversationItems[idx];
    if (previous.status === 'completed') return; // already completed above
    const item: ConversationItem = { ...previous, status: 'completed' };
    this.conversationItems[idx] = item;
    this.eventHandlers.onConversationUpdated?.({ item, delta: {} });
  }

  /**
   * Ahead of a 503 stream resume: complete whatever text the in-flight
   * user/assistant items already have (same "flip in place" as a normal
   * <end>), catch a partial-only item completeItem couldn't touch, and
   * clear every per-utterance field a fresh stream would otherwise see as
   * stale. Deliberately narrower than finishUtterance/reset(): it must NOT
   * touch conversationItems HISTORY, TTS sockets, managed session keys, or
   * the cost meter — those are session-lifetime state, not per-utterance
   * state, and the session (and its billing) continues across the resume.
   *
   * Unlike the per-utterance fields below, audioItemId/audioItemSide are
   * deliberately LEFT ALONE — same rule finishUtterance follows for a
   * normal <end>. Only the STT stream is being replaced here; the TTS
   * socket survives the swap untouched and keeps producing audio for text
   * already fed to it before the 503. Clearing the anchor here would make
   * emitAssistantAudio mint a fresh in_progress ghost item for that
   * trailing audio, which would then wrongly anchor the NEXT utterance's
   * text once it starts arriving on the resumed stream (cross-utterance
   * bleed).
   */
  private abandonUtteranceState(): void {
    this.completeItem('user', this.currentUserItemId, this.userFinal);
    this.completeItem('assistant', this.currentAssistantItemId, this.assistantFinal);
    this.forceCompleteStuckItem(this.currentUserItemId);
    this.forceCompleteStuckItem(this.currentAssistantItemId);
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.userFinal = '';
    this.assistantFinal = '';
    this.userLanguage = null;
    this.assistantLanguage = null;
    this.utteranceTtsLanguage = null;
    this.utteranceSide = null;
    this.closeTtsUtterance();
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * SonioxSessionLeg: render the session's single ending notice on this leg.
   *
   * Goes through emitSystemNotice — a CLIENT-held conversation item — and not
   * through onError alone, because MainPanel's teardown replaces its rendered
   * list with getConversationItems(). A message living only in React state is
   * wiped the instant the session tears down, and an exhausted balance then
   * reads as "the connection was interrupted — tap Start Session", which sends
   * the user to retry into a 402.
   *
   * The session decides what rides along: `realtimeEvent` only where nothing
   * else already emits one (the cutoff is emitted per leg by handleSttClose),
   * and `analytics` only for endings that are genuinely errors — a normal
   * end-of-segment must not land in the api_error dashboard.
   */
  announceSessionOutcome(notice: SonioxSessionOutcomeNotice): void {
    if (notice.realtimeEvent) {
      this.emitRealtime('client', notice.realtimeEvent, { provider: 'soniox' });
    }
    this.emitSystemNotice(notice.text);
    if (notice.analytics) {
      // `notice.text` is localized for the bubble; analytics gets a stable
      // English original so this ending stays countable across UI languages.
      this.eventHandlers.onError?.({
        code: notice.analytics.code,
        message: notice.text,
        rawMessage: notice.analytics.rawMessage,
      });
    }
  }

  /**
   * SonioxSessionLeg: end this leg because the SESSION ended. Idempotent.
   *
   * The stream is ended the way a normal session ends — the protocol's
   * empty-text-frame end-of-stream signal — so the server flushes and closes
   * cleanly instead of the socket being torn down mid-utterance.
   *
   * sttOutcomeAnnounced is set BEFORE that end() for the reason its own
   * declaration gives: the close that follows would otherwise reach
   * handleSttClose's bare-close fallthrough with nothing on record and layer a
   * contradictory "connection interrupted" notice on top of the real reason.
   * In split this is also what silences the leg that LOST the announcement
   * race — it is torn down having "already spoken", even though the sentence
   * was rendered on the other leg.
   */
  endForSessionOutcome(): void {
    if (this.sessionOutcomeEnded) return;
    this.sessionOutcomeEnded = true;
    this.sttOutcomeAnnounced = true;
    this.stt?.end();
  }

  /**
   * Is a bare managed 403 close enough to the end of the granted duration to
   * mean "segment ended"? True when there is no session, or the session does
   * not know its grant — see ManagedSonioxSession.isAtGrantedDurationEnd for
   * why that is the safer default.
   */
  private isAtGrantedDurationEnd(): boolean {
    return this.session?.isAtGrantedDurationEnd(Date.now()) ?? true;
  }

  /**
   * Managed-mode only: the running session's fixed ALLOWANCE parameters (see
   * SonioxCostMeter.getBudgetSnapshot / computeSonioxRemainingMs). Null for
   * BYOK sessions (no session, no cost meter).
   *
   * MainPanel's countdown no longer reads this — the allowance belongs to the
   * SESSION, and asking a client became ambiguous the moment two of them could
   * share one lease. Kept as the IClient-level accessor for any caller that
   * holds only a client.
   *
   * The countdown this drives is a cutoff, not a running bill — the session
   * ends when it reaches zero, but what the user is charged is computed by the
   * backend from provider cost and is normally less. Do not render it as money.
   */
  getManagedBudgetInfo(): SonioxBudgetSnapshot | null {
    return this.session?.getBudgetSnapshot() ?? null;
  }

  private handleSttMessage(message: SonioxSttMessage): void {
    // Reaching here at all is PROOF Soniox accepted this stream, and it is the
    // only proof there is: SonioxSttStream routes every frame carrying
    // `error_code` to onError and returns, while connect() resolves inside
    // ws.onopen — before the server has looked at `api_key` (the same fact the
    // managed-503 gate in handleSttError turns on). Reported on every frame,
    // deliberately: the client OBSERVES, and the session decides what the
    // observation is worth (see ManagedSonioxSession.noteStreamAccepted, which
    // turns the first report per role into one session-started).
    if (this.sttRole) this.session?.noteStreamAccepted(this.sttRole);

    const tokens = message.tokens ?? [];
    this.emitDebugLog(tokens);

    // Partials are re-sent in full on every message: rebuild them each time.
    let userPartial = '';
    let assistantPartial = '';

    for (const token of tokens) {
      const text = token.text ?? '';
      if (text === '<fin>') continue;
      if (text === '<end>') {
        this.finishUtterance();
        continue;
      }
      const isTranslation = token.translation_status === 'translation';
      if (this.bidirectional && this.utteranceSide === null) {
        // Tier 1+2: established speaker label, else channel-energy verdict
        // (original tokens carry start_ms/end_ms; translation tokens can
        // still hit tier 1 via their speaker field).
        const evidence = this.sideTracker?.inferSide(token.speaker, token.start_ms, token.end_ms) ?? null;
        if (evidence) {
          this.utteranceSide = evidence.side;
        } else {
          // Tier 3: legacy language comparison (display only — never votes).
          const src = this.currentConfig?.sourceLanguage;
          if (!isTranslation && token.language) {
            this.utteranceSide = token.language === src ? 'speaker' : 'participant';
          } else if (isTranslation && token.source_language) {
            this.utteranceSide = token.source_language === src ? 'speaker' : 'participant';
          }
        }
      }
      if (isTranslation) {
        if (token.language) this.assistantLanguage = token.language; // translated-into language
        if (token.is_final) {
          this.assistantFinal += text;
          this.feedTts(text, token);
        } else {
          assistantPartial += text;
        }
      } else {
        if (token.language) this.userLanguage = token.language; // spoken language
        if (token.is_final) {
          this.userFinal += text;
        } else {
          userPartial += text;
        }
      }
    }

    this.emitTextUpdate('user', this.userFinal, userPartial);
    this.emitTextUpdate('assistant', this.assistantFinal, assistantPartial);
  }

  private createTtsStream(): SonioxTtsStream {
    // A Soniox temporary key is scoped to ONE usage type — an STT key cannot
    // open a TTS socket. Throwing beats falling back to `stt`: both callers
    // (connect()'s best-effort block and ensureTts's catch) degrade the session
    // to subtitles, which is the correct outcome for a lease that was issued no
    // TTS key at all.
    const ttsApiKey = this.credentials.tts;
    if (!ttsApiKey) {
      throw new Error('Soniox TTS was requested but no TTS key was issued for this stream');
    }
    const stream = new SonioxTtsStream({
      apiKey: ttsApiKey,
      // Same region as the STT socket, by construction: both keys come off the
      // one bundle, which is what makes a mixed-region session impossible.
      region: this.credentials.region,
      voice: this.currentConfig?.voice || SONIOX_DEFAULT_VOICE,
      model: SONIOX_TTS_MODEL,
      sampleRate: SAMPLE_RATE,
      speed: this.currentConfig?.ttsSpeed,
      // Same id as the STT stream — required for the TTS half of a managed
      // session to be attributed to the billing lease.
      clientReferenceId: this.credentials.clientReferenceId,
    });
    stream.setHandlers({
      onAudio: (audio) => this.emitAssistantAudio(audio),
      onError: (code, message, hadActiveStream) => this.handleTtsError(code, message, hadActiveStream),
    });
    return stream;
  }

  /**
   * (Re)establish the TTS socket when it is closed, then flush any text/end
   * markers queued while it was down. Idle TTS sockets are closed by the
   * server (~5.3 s, 408: "Request timeout"; measured live) between
   * utterances — almost every conversational pause — so this runs whenever a
   * translation needs speaking but the socket is not open.
   */
  private async ensureTts(): Promise<void> {
    if (this.ttsConnecting) return;
    if (!this.currentConfig || this.currentConfig.textOnly) return;
    this.ttsConnecting = true;
    const gen = this.generation;
    try {
      // Close any stale stream before replacing it — its socket and keepalive
      // interval may still be live. (ensureTts only runs when the old one is
      // already dead/closed, but close() is idempotent and this prevents a leak
      // if that ever changes.)
      this.tts?.close();
      this.tts = null;
      const stream = this.createTtsStream();
      await stream.connect();
      // Stale attempt guard: the session was stopped while we were connecting —
      // discard the socket instead of installing it and flushing speech (would
      // produce audio after Stop and leak the socket).
      if (gen !== this.generation) { stream.close(); this.ttsPending = []; return; }
      this.tts = stream;
      this.ttsFailedOnce = false; // recovered
      const pending = this.ttsPending;
      this.ttsPending = [];
      for (const op of pending) {
        if (op.kind === 'end') this.tts.endUtterance();
        else this.tts.sendText(op.text, op.language);
      }
    } catch (error) {
      // Reconnect itself failed → spoken output genuinely unavailable now.
      // hadActiveStream is always true here: this IS the "tried to resume
      // speech and could not" signal, unconditionally worth surfacing.
      this.ttsPending = [];
      if (gen === this.generation) this.handleTtsError('connect_failed', String(error), true);
    } finally {
      this.ttsConnecting = false;
    }
  }

  private feedTts(text: string, token: SonioxToken): void {
    if (!this.currentConfig || this.currentConfig.textOnly) return;
    if (this.bidirectional) {
      // The attribution chain has already run for this token in
      // handleSttMessage; fall back to the legacy language comparison only
      // if it produced nothing at all.
      const side = this.utteranceSide
        ?? (token.source_language === this.currentConfig.sourceLanguage ? 'speaker' : 'participant');
      if (side !== 'speaker') return; // v1: only me→other is spoken
    }
    if (this.utteranceTtsLanguage === null) {
      this.utteranceTtsLanguage = token.language || this.currentConfig.targetLanguage || 'en';
    }
    // Mint (or reuse) this utterance's assistant item id up front, and pin it
    // as the audio target — audio for this utterance keeps arriving after
    // <end> clears currentAssistantItemId, so it needs its own anchor.
    // Snapshot the CURRENT utterance's side alongside it: utteranceSide is
    // live state that a following utterance can overwrite before this
    // utterance's trailing audio finishes arriving (see audioItemSide doc).
    this.audioItemId = this.ensureItem('assistant').id;
    this.audioItemSide = this.utteranceSide;
    this.ttsSpokenText += text;
    const language = this.utteranceTtsLanguage;
    if (this.tts?.isOpen()) {
      this.tts.sendText(text, language);
    } else {
      // Socket died during the preceding silence (or never connected) — queue
      // and re-establish it; the queue flushes in order once connected.
      this.ttsPending.push({ kind: 'text', text, language });
      void this.ensureTts();
    }
  }

  /**
   * Mint-if-needed placeholder ConversationItem for a role's current
   * utterance side, pushing it into `conversationItems` immediately so it's
   * listed (and thus visible — MainPanel renders exclusively from
   * `getConversationItems()`) before any text has arrived for it. Returns
   * the existing item as-is if one is already tracked; never mutates it —
   * callers that need to update its content go through `upsertItem`
   * instead, which always builds a fresh object so a snapshot already
   * handed to an onConversationUpdated listener is never rewritten out from
   * under it by a later update.
   *
   * Looks the id up in `conversationItems` itself (not a separate cache) so
   * that if the array is externally truncated (clearConversationItems())
   * mid-utterance, the next call self-heals by minting a fresh id/item
   * instead of resuming a detached object that would never be visible
   * again.
   */
  private ensureItem(role: 'user' | 'assistant'): ConversationItem {
    const currentId = role === 'user' ? this.currentUserItemId : this.currentAssistantItemId;
    const existing = currentId ? this.conversationItems.find((i) => i.id === currentId) : undefined;
    if (existing) return existing;
    const id = this.generateItemId(role);
    if (role === 'user') this.currentUserItemId = id; else this.currentAssistantItemId = id;
    const item: ConversationItem = {
      id,
      role,
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text: '', transcript: '' },
      content: [{ type: 'text', text: '' }],
    };
    this.conversationItems.push(item);
    return item;
  }

  /**
   * Build a fresh ConversationItem carrying `patch` and store it — replacing
   * the `conversationItems` entry for `currentId` in place if one is
   * tracked there (self-healing to a freshly minted id/entry if `currentId`
   * doesn't resolve, e.g. after an external clearConversationItems()), or
   * appending a new one. Deliberately never mutates the previous item
   * object, so a reference already emitted to an onConversationUpdated
   * listener stays a frozen snapshot of that moment.
   */
  private upsertItem(
    role: 'user' | 'assistant',
    currentId: string | null,
    patch: Pick<ConversationItem, 'status' | 'formatted' | 'content' | 'detectedLanguage'>
  ): ConversationItem {
    const idx = currentId ? this.conversationItems.findIndex((i) => i.id === currentId) : -1;
    const previous = idx !== -1 ? this.conversationItems[idx] : undefined;
    const item: ConversationItem = {
      id: previous?.id ?? currentId ?? this.generateItemId(role),
      role,
      type: 'message',
      createdAt: previous?.createdAt ?? Date.now(),
      ...patch,
    };
    if (idx !== -1) this.conversationItems[idx] = item; else this.conversationItems.push(item);
    return item;
  }

  /** Update the in-progress item for one side of the pair. */
  private emitTextUpdate(role: 'user' | 'assistant', finalText: string, partialText: string): void {
    const text = finalText + partialText;
    if (!text) return;
    const currentId = role === 'user' ? this.currentUserItemId : this.currentAssistantItemId;
    const detected = role === 'user' ? this.userLanguage : this.assistantLanguage;
    const item = this.upsertItem(role, currentId, {
      status: 'in_progress',
      formatted: { text, transcript: text },
      content: [{ type: 'text', text }],
      ...(detected ? { detectedLanguage: detected } : {}),
    });
    if (this.bidirectional && this.utteranceSide) item.source = this.utteranceSide;
    if (role === 'user') this.currentUserItemId = item.id; else this.currentAssistantItemId = item.id;
    this.eventHandlers.onConversationUpdated?.({ item, delta: { text } });
  }

  /** <end>: complete both sides' stored items, reset per-utterance state. */
  private finishUtterance(): void {
    // <end> can arrive in the same STT message as the finals that complete
    // it — before the post-loop emitTextUpdate() has ever assigned an item
    // id for this batch (e.g. a user-side final with no preceding TTS
    // mint). completeItem()'s upsertItem() mints+lists one lazily rather
    // than dropping the completed item.
    this.completeItem('user', this.currentUserItemId, this.userFinal);
    this.completeItem('assistant', this.currentAssistantItemId, this.assistantFinal);
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    // audioItemId is intentionally NOT cleared here: trailing TTS audio for
    // this just-completed utterance keeps streaming in after <end> and must
    // still attach to it (MainPanel's audio-delta path ignores item status).
    this.userFinal = '';
    this.assistantFinal = '';
    this.userLanguage = null;
    this.assistantLanguage = null;
    this.utteranceTtsLanguage = null;
    this.utteranceSide = null;
    this.closeTtsUtterance();
  }

  /**
   * Shared tail of finishUtterance/abandonUtteranceState: log the spoken
   * text milestone and close the utterance's TTS stream. Ending the TTS
   * side matters just as much on the abandon path — the TTS socket survives
   * an STT stream swap, and an un-ended utterance stream would absorb the
   * NEXT utterance's text into one combined synthesis.
   */
  private closeTtsUtterance(): void {
    // Debug-timeline milestone: the text this utterance sent to TTS to be
    // spoken. Only appears when TTS actually received text — a missing
    // tts.speak next to a translation means spoken output was skipped/degraded.
    if (this.ttsSpokenText && !this.currentConfig?.textOnly) {
      this.emitRealtime('client', 'tts.speak', { text: this.ttsSpokenText });
    }
    this.ttsSpokenText = '';
    // Close the utterance's TTS stream — queue the end if we're mid-reconnect
    // so it's flushed in order after this utterance's buffered text.
    if (this.ttsConnecting) this.ttsPending.push({ kind: 'end' });
    else this.tts?.endUtterance();
  }

  /** TTS audio chunk → audio-only delta on the assistant item (MainPanel plays it). */
  private emitAssistantAudio(audio: Int16Array): void {
    // Debug-timeline: TTS audio arriving from the server (grouped by logStore
    // into a single counted `tts.audio (N)` entry).
    this.emitRealtime('server', 'tts.audio', { bytes: audio.length });
    // Pure-audio edge case that shouldn't happen in practice (audio always
    // follows feedTts, which sets audioItemId) — fall back to minting (and
    // listing) rather than dropping the chunk.
    if (!this.audioItemId) this.audioItemId = this.ensureItem('assistant').id;
    // Never mutate the stored entry in place (same discipline as upsertItem):
    // build a fresh object and, if one was already tracked, replace it in
    // conversationItems rather than rewriting fields on the shared reference —
    // a snapshot already handed to an onConversationUpdated listener must stay
    // a frozen snapshot of that moment.
    const idx = this.conversationItems.findIndex((i) => i.id === this.audioItemId);
    const previous = idx !== -1 ? this.conversationItems[idx] : undefined;
    const item: ConversationItem = {
      ...(previous ?? {
        id: this.audioItemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        formatted: {},
      }),
    };
    // keepReplayAudio: accumulate this utterance's TTS audio into
    // formatted.audio so the inline replay button has bytes to play (parity
    // with every other client). Off (default) → live-only via the delta below,
    // the item stays audio-free and the button is hidden. Build formatted fresh
    // (never mutate the shared reference) and grow the running buffer off the
    // previous entry, so it self-heals across the <end> complete() rebuild.
    if (this.currentConfig?.keepReplayAudio) {
      const prevAudio = previous?.formatted?.audio as Int16Array | undefined;
      item.formatted = { ...item.formatted, audio: SonioxClient.concatAudio(prevAudio, audio) };
    }
    if (this.bidirectional && this.audioItemSide) item.source = this.audioItemSide;
    if (idx !== -1) this.conversationItems[idx] = item;
    this.eventHandlers.onConversationUpdated?.({ item, delta: { audio } });
  }

  /** Grow a running Int16 replay buffer by one chunk — fresh array, never mutates its inputs. */
  private static concatAudio(prev: Int16Array | undefined, next: Int16Array): Int16Array {
    if (!prev || prev.length === 0) return next.slice();
    const out = new Int16Array(prev.length + next.length);
    out.set(prev, 0);
    out.set(next, prev.length);
    return out;
  }

  private handleSttError(code: string, message: string): void {
    this.sttOutcomeAnnounced = true;
    // Managed sessions only: Soniox reports the granted-duration cutoff as
    // this exact 403 error frame, immediately followed by a close (handled
    // in handleSttClose, wired via wireSttHandlers — used identically by
    // connect() and resumeSttStream() — which emits a dedicated "segment
    // ended" system notice conversation item). Set the flag and stop here —
    // no generic error bubble for this one, since it isn't really an error.
    // BYOK has no granted duration and never hits this: a genuine mid-session
    // 403 there (e.g. a revoked key) still falls through to the normal error
    // path below.
    //
    // ...and only when we are actually near the end of the grant. A revoked
    // key and a frozen wallet arrive as the same bare 403; reading those as
    // "this segment has ended — tap Start Session" invites a retry that the
    // start gate will refuse. Outside the margin this falls through to the
    // recoverable-outage path below.
    if (this.isManaged && code === '403' && this.isAtGrantedDurationEnd()) {
      this.pendingDurationCutoff = true;
      console.info('[SonioxClient] Managed session reached its granted duration (403); closing');
      return;
    }
    // 503 "service unavailable" is a transient server condition, not a
    // fatal one, and gets a silent auto-resume instead of a generic error —
    // but ONLY for BYOK sessions, and only up to MAX_STT_RESUME_CYCLES times
    // per session:
    //
    //  - Managed-only gate: the backend mints STT temporary keys with
    //    single_use: true (sokuji-backend soniox-api.ts,
    //    CreateTemporaryKeyOpts — it's what stops one issued key opening two
    //    concurrent transcription sessions; only TTS keys are
    //    single_use: false). A managed reconnect with the SAME sttApiKey is
    //    rejected by Soniox, but only AFTER the socket opens (connect()
    //    resolves pre-validation) — so resumeSttStream would "succeed", then
    //    immediately take a 403 error frame that pendingDurationCutoff would
    //    misreport as a normal granted-duration cutoff instead of the outage
    //    it actually is. Managed 503s fall straight through to the
    //    recoverable-outage path below (surfaceRecoverableOutage) instead —
    //    the same localized notice a BYOK 503 eventually gets once its
    //    resume ladder is exhausted, just with no retry attempted first.
    //  - Cycle cap: a flapping server would otherwise retry forever, each
    //    cycle silently dropping mic audio for up to ~4 s (0+1+3 s of
    //    backoff) with zero user-visible signal. Past the cap a 503 is just
    //    another error.
    //
    // Soniox always closes the socket immediately after an error frame, so
    // the actual resume is kicked off from handleSttClose, which consumes
    // this flag. No error bubble, no onError here — the user should never
    // see a 503 that successfully resumes.
    if (!this.isManaged && code === '503' && this.sttResumeCycles < SonioxClient.MAX_STT_RESUME_CYCLES) {
      this.sttResumeCycles++;
      this.pendingSttResume503 = message;
      console.info(`[SonioxClient] STT reported 503 (service unavailable); will resume after close (cycle ${this.sttResumeCycles}/${SonioxClient.MAX_STT_RESUME_CYCLES}): ${message}`);
      this.emitRealtime('client', 'session.stt_503', { provider: 'soniox', message });
      return;
    }
    // Ordered last of the three special cases on purpose: the managed-403
    // cutoff and the BYOK-503 resume ladder above both claim codes that would
    // otherwise match here, and both must keep winning.
    if (RECOVERABLE_STT_CODES.has(code)) {
      this.surfaceRecoverableOutage(code, message);
      return;
    }
    this.surfaceSttError(code, message);
  }

  /**
   * Push a system notice into the conversation.
   *
   * This is the seam every client in this repo uses to reach the UI:
   * MainPanel renders `type: 'error'` items generically and
   * `conversationFilter` shows system items unconditionally, so no
   * provider-specific plumbing is needed. Load-bearing detail: only items the
   * CLIENT holds survive teardown, because MainPanel's disconnect path calls
   * setItems(client.getConversationItems()) — an item minted by the UI is
   * wiped by that call moments after it appears.
   */
  private emitSystemNotice(text: string): void {
    const item: ConversationItem = {
      id: this.generateItemId('error'),
      role: 'system',
      type: 'error',
      status: 'completed',
      createdAt: Date.now(),
      formatted: { text },
      content: [{ type: 'text', text }],
    };
    this.conversationItems.push(item);
    this.eventHandlers.onConversationUpdated?.({ item });
  }

  /**
   * Generic STT error surfacing: a system-role error ConversationItem plus
   * onError. Shared by handleSttError's fallthrough (an error that is neither
   * the managed-403 cutoff, nor a resumable 503, nor a recoverable outage).
   */
  private surfaceSttError(code: string, message: string): void {
    console.error(`[SonioxClient] STT error ${code}: ${message}`);
    this.emitSystemNotice(`[Soniox ${code}] ${message}`);
    this.eventHandlers.onError?.({ code, message });
  }

  /**
   * A failure the user can only answer by starting again. Say that in their
   * language; keep the server's own words for the debug timeline, where they
   * are diagnostic rather than noise.
   *
   * onError still fires — it is what produces the `api_error` analytics
   * event, so suppressing it would silently lose outage telemetry. The extra
   * bubble MainPanel appends from onError is transient: the teardown that
   * follows replaces the list with getConversationItems(), leaving exactly
   * the one item emitted here.
   */
  private surfaceRecoverableOutage(code: string, message: string): void {
    console.warn(`[SonioxClient] STT connection lost (${code}): ${message}`);
    this.emitRealtime('client', 'session.connection_lost', { provider: 'soniox', code, message });
    const text = i18n.t(
      'mainPanel.sonioxConnectionLost',
      'The connection was interrupted — tap Start Session in a moment to continue.'
    );
    this.emitSystemNotice(text);
    // `message` is what the UI shows, so it is localized; `rawMessage` carries
    // the server's own words for analytics, which would otherwise receive one
    // of 30 translations of this sentence and be unable to group by cause.
    this.eventHandlers.onError?.({ code, message: text, rawMessage: message });
  }

  private handleTtsError(code: string, message: string, hadActiveStream: boolean): void {
    // hadActiveStream — not the wire code — decides whether this is worth
    // surfacing. A drop with no active/draining stream (nothing was actually
    // being spoken) is an idle-timeout: expected server behavior (~5.3 s,
    // measured live) recovered silently the next time ensureTts reconnects,
    // no matter whether the wire reports it as 408 "Request timeout",
    // socket_error, or a plain close. Only a drop that hit an in-flight
    // utterance, or a reconnect attempt that itself failed (ensureTts's
    // catch, which always passes true) — i.e. "we tried to resume speech and
    // could not", not "the socket closed" — means spoken output has
    // genuinely stopped.
    if (!hadActiveStream) return;
    // TTS errors are non-fatal to the SESSION — transcription and text
    // translation carry on — but they are not invisible to the USER: spoken
    // output has stopped, and (in managed mode) the session is still billed at
    // the speech-to-speech rate. A console.error and a debug event reach
    // neither. Surfaced through the same onError channel handleSttError and
    // announceSessionOutcome use, which puts a system bubble in the
    // conversation and a session.error entry in the LogsPanel.
    //
    // Reported ONCE per failure episode: ttsFailedOnce is reset on a successful
    // reconnect, so a later genuine failure reports again. The condition for
    // raising the error is deliberately unchanged — only its visibility is.
    if (!this.ttsFailedOnce) {
      this.ttsFailedOnce = true;
      console.error(`[SonioxClient] TTS error ${code}: ${message} — spoken translation degraded`);
      this.emitRealtime('client', 'tts.degraded', { code, message });
      this.eventHandlers.onError?.({
        // Namespaced so a UI branching on `code` cannot confuse a degraded-TTS
        // report with the STT error of the same wire code.
        code: `tts_${code}`,
        message: i18n.t(
          'mainPanel.sonioxTtsFailed',
          'Spoken translation has stopped. Transcription and text translation are still running.'
        ),
        // The localized sentence above is for the user; analytics needs what
        // actually broke. Degraded TTS is a silent quality regression, so
        // being able to count it by cause is the whole point of measuring it.
        rawMessage: message,
      });
    }
  }

  private emitRealtime(source: 'client' | 'server', type: string, data: unknown): void {
    this.eventHandlers.onRealtimeEvent?.({
      source,
      event: { type, data },
    } as any);
  }

  /**
   * Compact, groupable debug-timeline logging. Soniox re-sends the FULL
   * cumulative token list on every frame and interleaves empty keepalive
   * frames, so forwarding raw `message.received` payloads floods the timeline
   * with huge, unreadable, un-mergeable blobs. Instead:
   *  - empty keepalive/progress frames are dropped;
   *  - streaming partials emit one compact `stt.delta` (logStore collapses
   *    consecutive `.delta` events into a single counted group);
   *  - a finalized segment emits readable `stt.transcript` / `stt.translation`
   *    milestones (ungrouped);
   *  - an endpoint emits `stt.endpoint`.
   */
  private emitDebugLog(tokens: SonioxToken[]): void {
    if (tokens.length === 0) return; // skip empty keepalive/progress frames
    let transcript = '';
    let translation = '';
    let endpoint = false;
    let allFinal = true;
    let hasContent = false;
    for (const token of tokens) {
      const text = token.text ?? '';
      if (text === '<end>') { endpoint = true; continue; }
      if (text === '<fin>') continue;
      hasContent = true;
      if (!token.is_final) allFinal = false;
      if (token.translation_status === 'translation') translation += text;
      else transcript += text;
    }
    if (hasContent) {
      if (allFinal) {
        if (transcript) this.emitRealtime('server', 'stt.transcript', { text: transcript });
        if (translation) this.emitRealtime('server', 'stt.translation', { text: translation });
      } else {
        this.emitRealtime('server', 'stt.delta', { transcript, translation });
      }
    }
    if (endpoint) this.emitRealtime('server', 'stt.endpoint', {});
  }

  async disconnect(): Promise<void> {
    // Invalidate any in-flight connect()/ensureTts(): a socket whose connect
    // await resolves after this point must not be installed or fed.
    this.generation++;
    // Both "pending" error flags are consumed by a close that is SUPPOSED to
    // follow their error frame immediately — but that assumption isn't
    // live-verified for 503 (only for 403), and even for 403 the close is
    // driven by the server, not guaranteed to race ahead of a user-initiated
    // Stop. Clear both here, synchronously, before this method closes the
    // socket itself: otherwise the browser's own (possibly delayed) close
    // event for the socket we're about to close could still see a flag set
    // and mis-fire — for pendingSttResume503 specifically, that means
    // resumeSttStream() capturing the already-bumped generation at entry and
    // sailing past every stale-attempt guard, reconnecting a zombie socket
    // after Stop.
    this.pendingDurationCutoff = false;
    this.pendingSttResume503 = null;
    // session-end is NOT sent from here any more: it is one POST per SESSION,
    // and MainPanel sends it after every client is down. Stand down as a leg,
    // though — this stream is gone, so a session-level ending must neither
    // announce into a list nobody renders nor try to end a socket that is
    // already closed.
    //
    // Each leg detaches only ITSELF (the list is keyed on identity), so a
    // participant dying mid-session cannot disarm the speaker's announcement
    // for the rest of a session that is still live.
    this.session?.detachLeg(this);
    if (this.mixer) { this.mixer.stop(); this.mixer = null; }
    this.sideTracker = null;
    if (this.stt) {
      this.stt.end();   // empty text frame: server flushes and closes
      this.stt.close();
      this.stt = null;
    }
    if (this.tts) {
      this.tts.close();
      this.tts = null;
    }
    this.isConnectedState = false;
    this.emitRealtime('client', 'session.closed', { provider: 'soniox', reason: 'client_disconnect' });
    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean {
    return this.isConnectedState;
  }

  updateSession(_config: Partial<SessionConfig>): void {
    console.warn('[SonioxClient] Session updates are not supported. Reconnect to change configuration.');
  }

  reset(): void {
    if (this.mixer) { this.mixer.stop(); this.mixer = null; }
    this.sideTracker = null;
    this.conversationItems = [];
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.audioItemId = null;
    this.audioItemSide = null;
    this.userFinal = '';
    this.assistantFinal = '';
    this.userLanguage = null;
    this.assistantLanguage = null;
    this.utteranceTtsLanguage = null;
    this.utteranceSide = null;
    this.ttsSpokenText = '';
    this.ttsPending = [];
    this.ttsConnecting = false;
    this.ttsFailedOnce = false;
    // Nothing managed to clear: `credentials` and `session` are readonly
    // constructor fields. reset() runs at the TOP of connect(), so clearing
    // either would leave the very next socket with no key at all.
    this.pendingDurationCutoff = false;
    this.pendingSttResume503 = null;
    this.sttOutcomeAnnounced = false;
    this.sessionOutcomeEnded = false;
    // NOT cleared, and structurally unable to be: `announcesSessionOutcomeFlag`
    // is a readonly constructor field. reset() runs at the top of connect(),
    // and dropping the primacy bit there would orphan the leg for the very
    // session it is about to run.
    this.sttResumeCycles = 0;
  }

  appendInputAudio(audioData: Int16Array): void {
    if (this.mixer) { this.mixer.pushA(audioData); return; }
    if (!this.stt?.isOpen()) return;
    this.stt.sendAudio(audioData);
  }

  /** Channel B feed for the Both single-session mixer (fed by the secondary port). */
  appendParticipantAudio(audioData: Int16Array): void {
    if (this.mixer) this.mixer.pushB(audioData);
  }

  /**
   * Second IClient reference for MainPanel's participant slot in Both single-session.
   * Its audio is channel B of this core's mixer; every other method is inert so the
   * core is driven solely by the primary (speaker) reference.
   */
  createSecondaryPort(): IClient {
    const core = this;
    return {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => core.isConnected(),
      updateSession: () => {},
      reset: () => {},
      appendInputAudio: (d: Int16Array) => core.appendParticipantAudio(d),
      appendInputText: () => {},
      createResponse: () => {},
      cancelResponse: () => {},
      getConversationItems: () => [],
      clearConversationItems: () => {},
      setEventHandlers: () => {},
      getProvider: () => core.getProvider(),
    };
  }

  appendInputText(_text: string): void {
    console.warn('[SonioxClient] Text input is not supported for speech translation');
  }

  // Continuous streaming: responses are generated automatically by the server.
  createResponse(_config?: ResponseConfig): void { /* no-op by design */ }
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op by design (no-interruption rule) */ }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  clearConversationItems(): void {
    this.conversationItems = [];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.SONIOX;
  }
}
