import { SonioxCostMeter, SonioxBudgetSnapshot } from './SonioxCostMeter';
import i18n from '../../locales';
import { getApiUrl } from '../../utils/environment';

/**
 * The managed (backend-billed) Soniox SESSION: everything that belongs to the
 * account's lease rather than to one socket.
 *
 * Extracted out of SonioxClient because a lease is not a stream property. A
 * client is now just "a thing that runs one stream with credentials it was
 * handed"; this object owns the session-key exchange (and its 409 retry), the
 * per-role credential bundles, the lease lifecycle notifications, and the
 * session allowance countdown.
 *
 * Who drives it: MainPanel.connectConversation acquires one per Start, hands
 * each client its bundle through ClientOptions.sonioxManaged, calls
 * markStarted() once each leg's socket is up, and end() once every client is
 * down. ProviderDescriptor.createClient is synchronous and returns exactly one
 * client, so it cannot own an awaited acquire() without going async for all
 * eleven providers.
 */

/**
 * The closed role vocabulary. `side` says which audio source feeds the stream;
 * `mix` is shared-Both's single mixed stream, and calling that `spk_*` would be
 * a lie. `par_tts` is unreachable while the participant config forces textOnly,
 * but stays in the vocabulary so adding it later is a change of policy, not of
 * format.
 */
export type SonioxStreamRole =
  | 'spk_stt' | 'spk_tts'
  | 'par_stt' | 'par_tts'
  | 'mix_stt' | 'mix_tts';

/**
 * What one SonioxClient needs to run its sockets. A NEW construction shape for
 * BOTH flavours — BYOK is not an existing shape managed is being moved onto.
 *
 * `clientReferenceId` is the exact string the backend already bound to the
 * temporary key(s). Probed live 2026-08-11: Soniox attributes a usage log to
 * the reference bound to the KEY and ignores the one a socket declares in its
 * config frame, so this value is INERT on the wire. It is sent anyway (harmless
 * hedge, and it is what the pre-extraction client sent), but nothing may rely
 * on it and it must never be the only thing carrying a role.
 */
export interface SonioxCredentialBundle {
  /** Key for the STT socket. */
  stt: string;
  /** Key for the TTS socket. Absent for a text-only lease. BYOK: the same key as `stt`. */
  tts?: string;
  /** Backend-bound reference; absent for BYOK, which is not billed by us. */
  clientReferenceId?: string;
}

/** BYOK: one user key serves both sockets, and no reference is sent. */
export function byokCredentials(apiKey: string): SonioxCredentialBundle {
  return { stt: apiKey, tts: apiKey };
}

/**
 * The matrix inputs the server expands into a role set. This IS the wire body
 * of `POST /soniox/session-key` — the client never sends a stream list, because
 * server-side expansion is what makes an unreachable role set unrepresentable
 * rather than merely rejected (spec A2).
 *
 * The backend requires `textOnly` for `speaker` and `both`, and `bothSplit` for
 * `both`; neither has a server-side default, so a client that dropped one would
 * be refused rather than silently sold the more expensive shape. All three are
 * always sent.
 */
export interface ManagedSessionRequest {
  mode: 'speaker' | 'participant' | 'both';
  textOnly: boolean;
  bothSplit: boolean;
}

/** The plan's name for the same three fields, used by the MainPanel wiring
 *  module. One type, two names, so neither call site had to be renamed. */
export type SonioxSessionMatrixInput = ManagedSessionRequest;

/**
 * The lease's single STT role — the "primary leg" the flat legacy response
 * fields describe. NOT simply "the speaker": a participant-only session's
 * primary leg is par_stt, and shared Both's is mix_stt.
 */
export function primarySttRoleFor(request: ManagedSessionRequest): SonioxStreamRole {
  if (request.mode === 'participant') return 'par_stt';
  if (request.mode === 'both' && !request.bothSplit) return 'mix_stt';
  return 'spk_stt';
}

// Fallback only — the backend's 409 body always carries its own retryAfterMs
// (see describeError); this is used solely if that field is somehow missing
// from a malformed/empty body.
const DEFAULT_CONFLICT_RETRY_MS = 3000;

/** One issued Soniox temporary key and the four-segment reference bound to it.
 *  Mirrors the backend's `SessionStream` (sokuji-backend routes/soniox.ts). */
interface SonioxSessionKeyStream {
  role: SonioxStreamRole;
  apiKey: string;
  clientReferenceId: string;
  expiresAt: string;
}

/**
 * The session-key response. `streams` is what the deployed backend answers with
 * — one entry per Soniox stream this session may open. The flat fields are kept
 * populated from the PRIMARY leg, which is what made the backend deployable
 * ahead of this client.
 */
interface SonioxSessionKeyResponse {
  sttApiKey: string;
  ttsApiKey?: string;
  expiresAt: string;
  maxSessionDurationSeconds: number;
  budgetMicroUsd: number;
  rateUsdPerHour: number;
  sku: string;
  leaseId: string;
  clientReferenceId: string;
  streams?: SonioxSessionKeyStream[];
}

/** The audio source a role's stream carries: `spk` mic, `par` far end, `mix`
 *  both mixed. What pairs an STT leg with the TTS key of the SAME side. */
function roleSide(role: SonioxStreamRole): 'spk' | 'par' | 'mix' {
  return role.slice(0, 3) as 'spk' | 'par' | 'mix';
}

function isSttRole(role: SonioxStreamRole): boolean {
  return role.endsWith('_stt');
}

export interface ManagedSonioxSessionOptions {
  /** Better-auth session token. Sent ONLY to our backend's Authorization
   *  header — never to Soniox, which receives the short-lived keys minted in
   *  exchange for it. */
  sessionToken: string;
  /** Debug-timeline sink. The client used to emit these through its own
   *  handlers; the session has none of its own, so the owner supplies one. */
  onEvent?: (type: string, data: unknown) => void;
}

export class ManagedSonioxSession {
  private readonly sessionToken: string;
  private readonly onEvent?: (type: string, data: unknown) => void;
  private request: ManagedSessionRequest | null = null;
  private readonly bundles = new Map<SonioxStreamRole, SonioxCredentialBundle>();
  private leaseIdValue: string | null = null;
  private costMeter: SonioxCostMeter | null = null;
  private exhaustedHandler: (() => void) | null = null;
  // session-end is a hint the backend acts on once; teardown can reach it from
  // more than one path (the user's Stop, a client's onClose, connect()'s catch).
  private endSignalled = false;

  constructor(options: ManagedSonioxSessionOptions) {
    this.sessionToken = options.sessionToken;
    this.onEvent = options.onEvent;
  }

  get leaseId(): string | null {
    return this.leaseIdValue;
  }

  get primarySttRole(): SonioxStreamRole {
    if (!this.request) throw new Error('ManagedSonioxSession.primarySttRole read before acquire()');
    return primarySttRoleFor(this.request);
  }

  /**
   * Exchange the better-auth session token for a Soniox key set.
   *
   * Called at Start, never earlier: the STT key's start window is only 60 s, so
   * fetching sooner risks it expiring before the socket opens — and issue
   * failures (402/403/409/502/503) need to land on the caller's error path,
   * where the UI already handles a failed connect.
   *
   * A 409 (another session already active on this account) is retried exactly
   * once, after the backend's own `retryAfterMs` hint — the prior session is
   * very often just finishing its teardown.
   */
  async acquire(request: ManagedSessionRequest): Promise<void> {
    this.request = request;
    let response = await this.requestSessionKey(request);
    if (!response.ok && response.status === 409) {
      const conflict = await this.describeError(response);
      const retryAfterMs = conflict.retryAfterMs ?? DEFAULT_CONFLICT_RETRY_MS;
      this.onEvent?.('session.retry', { provider: 'soniox', status: 409, retryAfterMs });
      await ManagedSonioxSession.delay(retryAfterMs);
      response = await this.requestSessionKey(request);
    }
    if (!response.ok) {
      throw new Error((await this.describeError(response)).message);
    }
    const data = await response.json() as SonioxSessionKeyResponse;
    // No fallback to leaseId: a missing clientReferenceId is a backend contract
    // break that must surface as a failed Start, not be papered over with a
    // value the reconciler is already known to reject.
    if (!data.clientReferenceId) {
      throw new Error('Soniox session-key response is missing clientReferenceId');
    }
    this.leaseIdValue = data.leaseId;
    this.bundles.clear();
    this.fileBundles(request, data);
    this.costMeter = new SonioxCostMeter({
      budgetMicroUsd: data.budgetMicroUsd,
      rateUsdPerHour: data.rateUsdPerHour,
      // Read through the field, not captured: the announcing client registers
      // at connect() time, strictly after this.
      onExhausted: () => this.exhaustedHandler?.(),
    });
    this.costMeter.start(Date.now());
  }

  /**
   * Turn the response into ONE bundle per transcription leg.
   *
   * A bundle is what a SonioxClient runs on, and there is exactly one client
   * per transcription stream — so the map is keyed on the `*_stt` roles and a
   * `*_tts` role is not a leg of its own, it is the synthesis key that rides
   * the STT leg of the SAME side. Matching by side is what keeps a split Both
   * session's single `spk_tts` key on the speaker and off the participant.
   *
   * Every leg gets its OWN stt key and its OWN four-segment reference. That is
   * a requirement, not tidiness: Soniox attributes a usage log to the reference
   * bound to the KEY (probed live 2026-08-11), so two legs sharing a key are
   * indistinguishable in the usage logs and the lease's ended-mask could not be
   * driven at all.
   */
  private fileBundles(request: ManagedSessionRequest, data: SonioxSessionKeyResponse): void {
    const primary = primarySttRoleFor(request);
    const streams = data.streams;
    if (!Array.isArray(streams) || streams.length === 0) {
      // Defensive fallback for a response with no per-stream structure. Files
      // the flat pair under the primary role ALONE — never under a second role
      // as well, which would hand two legs the same key. A split session then
      // fails at the participant's credentialsFor, inside the non-fatal
      // participant catch, and degrades to one-way rather than mis-attributing.
      this.bundles.set(primary, {
        stt: data.sttApiKey,
        ...(data.ttsApiKey ? { tts: data.ttsApiKey } : {}),
        clientReferenceId: data.clientReferenceId,
      });
      return;
    }
    for (const stream of streams) {
      if (!isSttRole(stream.role)) continue;
      const tts = streams.find(
        (s) => !isSttRole(s.role) && roleSide(s.role) === roleSide(stream.role),
      );
      this.bundles.set(stream.role, {
        stt: stream.apiKey,
        ...(tts ? { tts: tts.apiKey } : {}),
        clientReferenceId: stream.clientReferenceId,
      });
    }
    // Loud rather than a lease that is held while the speaker leg fails to
    // build: the primary role is the one the flat fields describe and the one
    // every single-leg shape runs on, so its absence is a contract break.
    if (!this.bundles.has(primary)) {
      throw new Error(`Soniox session-key response issued no key for the primary role ${primary}`);
    }
  }

  hasRole(role: SonioxStreamRole): boolean {
    return this.bundles.has(role);
  }

  /** Throws rather than falling back to the primary bundle: a silent fallback
   *  would let FE3's split legs share one key, which the usage logs cannot tell
   *  apart (attribution is key-bound). */
  credentialsFor(role: SonioxStreamRole): SonioxCredentialBundle {
    const bundle = this.bundles.get(role);
    if (!bundle) throw new Error(`No Soniox credentials were issued for role ${role}`);
    return bundle;
  }

  /**
   * Fire-and-forget: confirms a leg's socket is up so the backend extends the
   * lease from its short start-window TTL to the full granted duration. Never
   * awaited — a failure here just means the lease expires on its own schedule,
   * never worth failing an already-open session over.
   */
  markStarted(role: SonioxStreamRole): void {
    const leaseId = this.leaseIdValue;
    if (!leaseId) return;
    fetch(`${getApiUrl()}/soniox/session-started`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json',
      },
      // The role is REQUIRED on a lease that runs more than one transcription
      // stream: the backend answers 400 `role_required` there rather than
      // reporting a success it did not get, because a roleless body would leave
      // the lease at its ~195 s start window while both Soniox keys stayed
      // valid for the full grant — the account would then acquire a SECOND
      // lease while the first was still streaming. A wrong role is refused just
      // as hard (`role_not_issued`), which is why the caller's role must be
      // derived from the same matrix body the server expanded.
      body: JSON.stringify({ leaseId, role }),
    }).catch((error) => console.error('[ManagedSonioxSession] session-started notify failed:', error));
  }

  /**
   * Fire-and-forget: hints the reconciler to look for this session's usage logs
   * sooner. Sent EXACTLY ONCE per session, after every client is down —
   * SonioxClient.disconnect() used to post it unconditionally, so with two legs
   * the first one torn down would signal the end (and unpin the voice slot)
   * while the other was still streaming.
   */
  end(): void {
    const leaseId = this.leaseIdValue;
    if (!leaseId || this.endSignalled) return;
    this.endSignalled = true;
    fetch(`${getApiUrl()}/soniox/session-end`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ leaseId }),
    }).catch((error) => console.error('[ManagedSonioxSession] session-end notify failed:', error));
  }

  /**
   * Exactly ONE owner announces exhaustion — the LAST registration wins, which
   * is why FE3/FE4 must register only the announcing (speaker/primary) client.
   */
  setExhaustedHandler(fn: (() => void) | null): void {
    this.exhaustedHandler = fn;
  }

  /** The meter has no clock of its own: it is advanced by an STT stream's ~5 s
   *  keepalive tick, forwarded here. `tick` is absolute (now - startedAt), so
   *  more than one forwarder is harmless. */
  tick(nowMs: number): void {
    this.costMeter?.tick(nowMs);
  }

  getBudgetSnapshot(): SonioxBudgetSnapshot | null {
    return this.costMeter?.getBudgetSnapshot() ?? null;
  }

  /**
   * POST /soniox/session-key. Network failures (DNS, offline, CORS) throw
   * immediately — transport errors have nothing to retry; only an HTTP-level
   * response (ok or not) is returned for the caller to interpret status-by-status.
   */
  private async requestSessionKey(request: ManagedSessionRequest): Promise<Response> {
    // The MATRIX body. `mode` here is the AUDIO shape ('speaker' | 'participant'
    // | 'both'), not the legacy BILLING shape ('text_only' | 'speech_to_speech')
    // this used to send. The backend tells the two vocabularies apart by the
    // value of `mode` and nothing else, checking the legacy one first, so the
    // switch is the value — there is no version flag to set.
    //
    // All three fields, always: the backend defaults neither `textOnly` (for
    // speaker/both) nor `bothSplit` (for both) and answers 400 without them,
    // deliberately, so a client that dropped one cannot silently buy the more
    // expensive synthesis path or halve the price of a two-leg session.
    const body: ManagedSessionRequest = {
      mode: request.mode,
      textOnly: request.textOnly,
      bothSplit: request.bothSplit,
    };
    try {
      return await fetch(`${getApiUrl()}/soniox/session-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Failed to reach the Soniox session service: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Distinct, user-facing reasons for each session-key failure — a 402
   * (insufficient balance) must read differently from every other failure so
   * the UI can point at the right fix. Also surfaces the 409 body's
   * `retryAfterMs` so acquire's single retry uses the backend's hint, not a guess.
   */
  private async describeError(response: Response): Promise<{ message: string; retryAfterMs?: number }> {
    let serverMessage = '';
    let retryAfterMs: number | undefined;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string') serverMessage = body.error;
      if (typeof body?.retryAfterMs === 'number') retryAfterMs = body.retryAfterMs;
    } catch {
      // Body wasn't JSON (or was empty) — fall back to the status-based message below.
    }
    switch (response.status) {
      case 401:
        // Effectively unreachable via the normal UI flow: MainPanel refuses to
        // acquire without a session token. Left as a plain string rather than a
        // new locale key, matching its pre-extraction behaviour.
        return { message: 'Sign-in is required to start a managed Soniox session' };
      case 402:
        return { message: i18n.t('mainPanel.sonioxInsufficientBalance', 'Insufficient balance to start a session. Please top up your balance and try again.') };
      case 403:
        return { message: i18n.t('mainPanel.walletFrozen', 'Wallet is frozen. Please contact support.') };
      case 409:
        return { message: i18n.t('mainPanel.sonioxSessionConflict', 'Another session is already running on your account. Please try again in a moment.'), retryAfterMs };
      case 502:
        return { message: i18n.t('mainPanel.sonioxServiceUnavailable', 'Soniox is temporarily unavailable. Please try again in a moment.') };
      case 503:
        return { message: i18n.t('mainPanel.sonioxServiceBusy', 'Soniox is at capacity right now. Please try again shortly.') };
      default:
        return { message: serverMessage || `Failed to start a managed Soniox session (HTTP ${response.status})` };
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
