import { SonioxCostMeter, SonioxBudgetSnapshot } from './SonioxCostMeter';
import {
  SonioxSessionOutcome,
  type SonioxSessionLeg,
  type SonioxSessionOutcomeKind,
  type SonioxSessionOutcomeNotice,
} from './SonioxSessionOutcome';
import i18n from '../../locales';
import { getApiUrl } from '../../utils/environment';
import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';

/**
 * The managed (backend-billed) Soniox SESSION: everything that belongs to the
 * account's lease rather than to one socket.
 *
 * Extracted out of SonioxClient because a lease is not a stream property. A
 * client is now just "a thing that runs one stream with credentials it was
 * handed"; this object owns the session-key exchange (and its 409 retry), the
 * per-role credential bundles, the lease lifecycle notifications, the session
 * allowance countdown, and the two endings that belong to the session rather
 * than to any one stream — the balance running out, and the granted duration
 * being reached. Both are announced exactly once and tear down EVERY leg,
 * which is why they cannot live on a client: under split there are two, they
 * share one `max_session_duration_seconds`, and a per-leg announcement means
 * the same sentence twice (or once, in the wrong panel).
 *
 * Who drives it: MainPanel.connectConversation acquires one per Start, hands
 * each client its bundle and its role through ClientOptions.sonioxManaged, and
 * calls end() once every client is down. The started bit is NOT MainPanel's to
 * set — only the leg's own stream can tell an accepted stream from a socket
 * that merely opened, so each client reports `noteStreamAccepted(role)` and the
 * decision of what that is worth stays here. ProviderDescriptor.createClient is
 * synchronous and returns exactly one client, so it cannot own an awaited
 * acquire() without going async for all eleven providers.
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
 * The TRANSCRIPTION roles — the closed set one SonioxClient can BE. There is
 * exactly one client per transcription stream, and a `*_tts` role is not a leg
 * of its own but the synthesis key riding the STT leg of the same side.
 *
 * Narrower than `SonioxStreamRole` on purpose wherever a leg names itself:
 * these are also exactly the roles that carry a bit in the backend's
 * `stt_started_mask`, and `session-started` answers 400 "Invalid role" for any
 * other (sokuji-backend `sessionStartedHandler`, `sttRoleBit`).
 */
export type SonioxSttRole = 'spk_stt' | 'par_stt' | 'mix_stt';

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
  /**
   * Which Soniox deployment these keys belong to.
   *
   * On the BUNDLE rather than on the client or a module global, because a split
   * Both session runs two clients at once and a global would be one mutable
   * cell shared by both legs and by any settings change made mid-session.
   * Binding it here makes "dial an EU host with a US key" unrepresentable
   * rather than merely a bug we test for.
   */
  region: SonioxRegion;
  /** Key for the STT socket. */
  stt: string;
  /** Key for the TTS socket. Absent for a text-only lease. BYOK: the same key as `stt`. */
  tts?: string;
  /** Backend-bound reference; absent for BYOK, which is not billed by us. */
  clientReferenceId?: string;
}

/** BYOK: one user key serves both sockets, and no reference is sent. */
export function byokCredentials(apiKey: string, region: SonioxRegion): SonioxCredentialBundle {
  return { stt: apiKey, tts: apiKey, region };
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
  /** Which Soniox regional project should mint this session's keys. The backend
   *  refuses a region it has no project key for rather than serving US. */
  region: SonioxRegion;
}

/** The plan's name for the same three fields, used by the MainPanel wiring
 *  module. One type, two names, so neither call site had to be renamed. */
export type SonioxSessionMatrixInput = ManagedSessionRequest;

/**
 * The lease's single STT role — the "primary leg" the flat legacy response
 * fields describe. NOT simply "the speaker": a participant-only session's
 * primary leg is par_stt, and shared Both's is mix_stt.
 */
export function primarySttRoleFor(request: ManagedSessionRequest): SonioxSttRole {
  if (request.mode === 'participant') return 'par_stt';
  if (request.mode === 'both' && !request.bothSplit) return 'mix_stt';
  return 'spk_stt';
}

// Fallback only — the backend's 409 body always carries its own retryAfterMs
// (see describeError); this is used solely if that field is somehow missing
// from a malformed/empty body.
const DEFAULT_CONFLICT_RETRY_MS = 3000;

/**
 * How long one /soniox/session-key attempt may hang before it is abandoned.
 *
 * MainPanel awaits `acquire()` inside connectConversation with `isInitializing`
 * already set, so a request that never settles leaves Start disabled and no Stop
 * button rendered — the user's only exit is restarting the app. 15 s matches
 * `ManagedVoicesClient.REQUEST_TIMEOUT_MS`, the sibling client talking to the
 * same backend; this endpoint is a small JSON POST (the backend mints the
 * temporary Soniox keys behind it), so 15 s is generous rather than tight.
 */
const SESSION_KEY_TIMEOUT_MS = 15_000;

/**
 * The two session-level endings, as the user sees them.
 *
 * `realtimeEvent` is present only where nothing else already emits one:
 * the duration cutoff is emitted PER LEG by SonioxClient.handleSttClose
 * (deliberately — that is how both legs' 403s stay countable), so emitting it
 * again here would double-count it. Exhaustion has no per-leg emitter at all
 * once the meter belongs to the session, so it carries its own, under the exact
 * name it has always had.
 *
 * `analytics` is present only for exhaustion. The cutoff has never fired
 * onError and must not start: it is the normal way a managed segment ends,
 * and routing it to api_error would drown the dashboard in non-errors.
 */
const SESSION_OUTCOME_COPY: Record<
  SonioxSessionOutcomeKind,
  { key: string; defaultValue: string; realtimeEvent?: string; analytics?: { code: string; rawMessage: string } }
> = {
  budget_exhausted: {
    key: 'mainPanel.sonioxBudgetExhausted',
    defaultValue: 'Your session balance is used up. Top up your balance to keep translating.',
    realtimeEvent: 'session.budget_exhausted',
    // The notice text is localized; analytics gets a stable English original
    // so this ending stays countable across UI languages.
    analytics: { code: 'budget_exhausted', rawMessage: 'Session budget exhausted' },
  },
  duration_cutoff: {
    key: 'mainPanel.sonioxSegmentEnded',
    defaultValue: 'This segment has ended — tap Start Session to continue.',
  },
};

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
  /** The session ALLOWANCE, in micro-USD: a snapshot of the account balance,
   *  and the ceiling this session may consume. Not a bill. */
  budgetMicroUsd: number;
  // The CONSERVATIVE aggregate rate the backend budgeted this session's whole
  // stream set at — what the granted duration was divided out of, not a price.
  // Charging is provider cost × a revenue coefficient, per usage log, after the
  // fact. See SonioxCostMeter's class docstring.
  rateUsdPerHour: number;
  sku: string;
  leaseId: string;
  clientReferenceId: string;
  /** Which regional project minted these keys. Absent from an older backend's
   *  response, which normalizes to us. */
  region?: string;
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
  /**
   * How close to the end of the granted duration a bare 403 has to arrive to
   * be read as the cutoff rather than as a recoverable outage.
   *
   * The only clock this session has is the STT stream's ~5 s keepalive, and
   * the close that carries the 403 can lag it by seconds more, so the margin
   * only needs to absorb tick granularity plus teardown skew. 90 s is far
   * wider than that, and still narrow enough that a 403 arriving in the first
   * minutes of a 15-minute grant — a revoked key, a frozen wallet — falls
   * through to the outage path instead of claiming "this segment has ended".
   */
  static readonly CUTOFF_MARGIN_MS = 90_000;

  private readonly sessionToken: string;
  private readonly onEvent?: (type: string, data: unknown) => void;
  private request: ManagedSessionRequest | null = null;
  private readonly bundles = new Map<SonioxStreamRole, SonioxCredentialBundle>();
  private leaseIdValue: string | null = null;
  private costMeter: SonioxCostMeter | null = null;
  // The grant, as acquire() received it. Both are needed to tell a
  // granted-duration cutoff from any other bare 403 — see isAtGrantedDurationEnd.
  private startedAtMs: number | null = null;
  private maxSessionDurationSeconds = 0;
  // One-shot ownership of this lease's ending announcement, and the streams it
  // has to tear down. Replaces the single `exhaustedHandler` slot: that could
  // name the ONE leg that speaks, but not the OTHER legs that must still be
  // ended — under split, exhaustion left the participant streaming on an empty
  // balance, and the granted-duration cutoff was announced once per leg.
  private outcome = new SonioxSessionOutcome();
  private readonly legs: SonioxSessionLeg[] = [];
  // session-end is a hint the backend acts on once; teardown can reach it from
  // more than one path (the user's Stop, a client's onClose, connect()'s catch).
  private endSignalled = false;
  // Which legs have already been reported accepted. Session-scoped rather than
  // client-scoped because "this lease's spk_stt bit is set" is lease state: a
  // client resets its own fields on every connect(), and the question here is
  // per lease, not per socket.
  private readonly acceptedRoles = new Set<SonioxSttRole>();

  constructor(options: ManagedSonioxSessionOptions) {
    this.sessionToken = options.sessionToken;
    this.onEvent = options.onEvent;
  }

  get leaseId(): string | null {
    return this.leaseIdValue;
  }

  get primarySttRole(): SonioxSttRole {
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
    // A new lease is a new mask (acquire resets stt_started_mask to 0 server
    // side), so a role carried over from a previous one would suppress the very
    // report that extends this lease. The ending claim is per-lease for the
    // same reason: a claim carried over would silence the new lease entirely.
    this.acceptedRoles.clear();
    this.outcome = new SonioxSessionOutcome();
    this.fileBundles(request, data);
    // ONE timestamp for both readers: the meter's countdown and the
    // granted-duration margin describe the same lease, and two Date.now()
    // calls a millisecond apart would make them disagree by that millisecond.
    const startedAtMs = Date.now();
    this.startedAtMs = startedAtMs;
    this.maxSessionDurationSeconds = data.maxSessionDurationSeconds;
    this.costMeter = new SonioxCostMeter({
      budgetMicroUsd: data.budgetMicroUsd,
      rateUsdPerHour: data.rateUsdPerHour,
      // Session-level, not stream-level: exhaustion ends EVERY leg and is
      // announced exactly once. In split, both legs forward keepalive ticks
      // into this one meter, so this can fire from either — finishSession
      // does not care which. Read through the method, not a captured leg:
      // clients register at connect() time, strictly after this.
      onExhausted: () => this.finishSession('budget_exhausted'),
    });
    this.costMeter.start(startedAtMs);
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
    // The RESPONSE's region, never the request's. The backend is the authority
    // on which project actually minted these keys, and a settings change
    // between request and connect must not pair one region's keys with
    // another's hosts. A missing field (an older backend, which predates the
    // field entirely) or an unrecognised value normalizes to us — which is
    // exactly asSonioxRegion's job, and why it defaults instead of rejecting.
    const region = asSonioxRegion(data.region);
    const streams = data.streams;
    if (!Array.isArray(streams) || streams.length === 0) {
      // Defensive fallback for a response with no per-stream structure. Files
      // the flat pair under the primary role ALONE — never under a second role
      // as well, which would hand two legs the same key. A split session then
      // fails at the participant's credentialsFor, inside the non-fatal
      // participant catch, and degrades to one-way rather than mis-attributing.
      this.bundles.set(primary, {
        region,
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
        region,
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
   * A leg's stream was ACCEPTED by Soniox — the only observation that may set a
   * started bit. Reported by the leg's own SonioxClient on every frame it
   * receives, because a frame is the only proof available: SonioxSttStream
   * routes anything carrying `error_code` to `onError` and returns, so a frame
   * that reaches the client got past authentication.
   *
   * Socket-open is NOT that proof. `SonioxSttStream.connect()` resolves inside
   * `ws.onopen`, right after the config frame goes out and before Soniox has
   * looked at `api_key` — the same fact SonioxClient's managed-503 gate turns
   * on. A key whose start window lapsed (the participant's waits behind the OS
   * screen-recording dialog for up to 180 s) still opens a socket and is
   * rejected afterwards. Marking that leg started would OR a bit into
   * `stt_started_mask` that no usage log can ever clear — Soniox writes no log
   * for a stream it refused — and the backend releases the lease only when
   * `(ended & started) = started`, so the account would 409 every subsequent
   * Start for up to an hour.
   *
   * The first report per role becomes one `session-started`; the hundreds that
   * follow are the same fact restated. `markStarted` is idempotent server-side
   * (ORed mask, MAX()-ed expiry), so the dedupe is about not flooding the
   * backend at frame rate, not about the mask.
   *
   * KNOWN COST, taken deliberately: Soniox answers as it PROCESSES AUDIO, so a
   * leg that is accepted but sent no audio at all — the speaker leg of a session
   * started with the input device off, whose per-frame callback drops every
   * chunk — produces no frame and never reports. Its lease then keeps the short
   * start-window TTL instead of the full grant. That is the same direction the
   * backend chose for `role_not_issued`: an unset bit costs THIS session its
   * extension (and frees the account), while a wrongly-set bit costs the ACCOUNT
   * every subsequent Start for up to an hour. A silent session is one nobody is
   * getting value from; a locked account is one nobody can escape.
   */
  noteStreamAccepted(role: SonioxSttRole): void {
    if (this.acceptedRoles.has(role)) return;
    this.acceptedRoles.add(role);
    this.markStarted(role);
  }

  /**
   * Fire-and-forget: tells the backend one transcription stream of this session
   * is confirmed RUNNING, so it extends the lease from its short start-window
   * TTL to the full granted duration. Never awaited — a failure here just means
   * the lease expires on its own schedule, never worth failing an already-open
   * session over.
   *
   * Reached through `noteStreamAccepted`, which owns the "what counts as
   * confirmed" question. Kept separate (and public) because this is purely the
   * wire act: one role, one POST, no memory.
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
    })
      // Fire-and-forget is about not AWAITING the answer, not about throwing it
      // away. `.catch` alone fires for transport failures only: a 400 resolves
      // normally, and the backend answers 400 precisely for the two states no
      // client can otherwise detect — `role_required` and `role_not_issued`,
      // both meaning THE LEASE WAS NOT EXTENDED. Unread, that presents later as
      // a session dying mid-call at its start window with a generic "connection
      // closed unexpectedly", while both Soniox keys stay valid past the lease
      // and the account can take a second one. `no_live_lease` is a 200 by
      // design (routine, and nothing the client can act on), so silence here
      // still means silence for it.
      .then((response) => (response.ok ? null : this.reportStartedRefusal(response, role)))
      .catch((error) => console.error('[ManagedSonioxSession] session-started notify failed:', error));
  }

  /**
   * Surface a refused `session-started` in both places a diagnosis is looked
   * for: the console and the app's own debug timeline (LogsPanel), so the cause
   * is named where the symptom is seen. Deliberately does NOT fail the session —
   * the stream is already up and the user would gain nothing from a torn-down
   * call; what was missing is any record naming the reason.
   */
  private async reportStartedRefusal(response: Response, role: SonioxStreamRole): Promise<void> {
    // The reason is a machine-readable field, so read it as one. A body that is
    // not JSON (a proxy's HTML error page, an empty 500) still leaves the status,
    // which alone says the lease was not extended.
    let reason: string | null = null;
    try {
      const body = await response.json();
      if (typeof body?.reason === 'string') reason = body.reason;
    } catch {
      // Not JSON — the status carries the news on its own.
    }
    console.error(
      `[ManagedSonioxSession] session-started was REFUSED for role ${role} ` +
      `(HTTP ${response.status}${reason ? `, reason ${reason}` : ''}). The lease was NOT ` +
      `extended: this session will expire at its start window while its Soniox keys stay valid.`
    );
    this.onEvent?.('session.started_refused', {
      provider: 'soniox',
      status: response.status,
      reason,
      role,
    });
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
   * Register a client as one of this session's streams.
   *
   * Every leg registers, not just the announcing one: the session has to be
   * able to END them all, and only the leg itself knows whether it speaks for
   * the session (`SonioxSessionLeg.announcesSessionOutcome`, the bit MainPanel's
   * `managedLegOptions` computes and hands to the client at construction).
   * Reading that bit here rather than taking a second `{ primary }` argument is
   * what keeps "which leg is primary" a single source of truth.
   *
   * Legs attach themselves from SonioxClient.connect() and detach in
   * disconnect(), which is what keeps this list to the streams that actually
   * exist: a participant leg whose connect throws never registers, so the
   * session neither announces on it nor waits for it.
   *
   * Idempotent: re-attaching the same client does not create a second leg,
   * which would tear it down twice on every outcome.
   */
  attachLeg(leg: SonioxSessionLeg): void {
    if (this.legs.includes(leg)) return;
    this.legs.push(leg);
  }

  /** Stand a leg down — it has disconnected and must not be announced on or
   *  ended again. Unknown legs are ignored. */
  detachLeg(leg: SonioxSessionLeg): void {
    const index = this.legs.indexOf(leg);
    if (index !== -1) this.legs.splice(index, 1);
  }

  /**
   * The session is over for a session-level reason. Announce it ONCE, on the
   * announcing leg, then tear down every leg.
   *
   * Callable from any leg, any number of times. In split Both both STT keys
   * carry the same `max_session_duration_seconds`, but Soniox starts each
   * stream's clock at that stream's OWN connect — and the participant leg opens
   * behind the OS loopback permission dialog, so its cutoff can trail the
   * speaker's by up to the difference between the two start windows (120 s
   * today). Both legs therefore 403 eventually, but not necessarily close
   * together; the claim decides who speaks whenever the second one arrives, and
   * the teardown loop runs regardless so the losing leg still ends gracefully.
   * (`isAtGrantedDurationEnd` is one-sided — at-or-past the margin — so a late
   * 403 still classifies as the cutoff rather than as an outage.) That teardown
   * is what stops the losing leg's own close from falling into
   * handleSttClose's bare-close branch and layering "the connection was
   * interrupted" on top of the real reason.
   */
  finishSession(kind: SonioxSessionOutcomeKind): void {
    if (this.outcome.claim(kind)) {
      const copy = SESSION_OUTCOME_COPY[kind];
      const notice: SonioxSessionOutcomeNotice = {
        text: i18n.t(copy.key, copy.defaultValue),
        realtimeEvent: copy.realtimeEvent,
        analytics: copy.analytics,
      };
      // Fall back to the first registered leg rather than swallowing the
      // announcement: a session whose announcer has already disconnected is
      // reachable (the speaker can die while the participant streams on), and
      // a silent ending is exactly the failure this exists to prevent.
      //
      // The fallback is NOT a lesser announcement. Its system notice lands in
      // `participantItems`, which MainPanel merges into the rendered
      // conversation (combinedItems, sorted by createdAt) — an earlier version
      // of this comment claimed that list is not rendered, and it is. Its
      // onError now reaches api_error too, tagged 'participant'; before the
      // participant leg was given telemetry handlers it was dropped on the
      // floor, so this sentence used to describe something that did not
      // happen. The one thing the fallback does not produce is the speaker's
      // extra red error item, which is withheld on purpose — the participant
      // list is replaced wholesale by onConversationUpdated and an appended
      // item would be wiped.
      const announcer = this.legs.find((leg) => leg.announcesSessionOutcome) ?? this.legs[0];
      announcer?.announceSessionOutcome(notice);
    }
    // Announce-then-end, matching the order the old per-client
    // handleBudgetExhausted always used, and unconditional so a second caller
    // still gets its leg ended. Iterated over a COPY: endForSessionOutcome
    // drives a close that can reach detachLeg synchronously.
    for (const leg of [...this.legs]) leg.endForSessionOutcome();
  }

  /**
   * Is `nowMs` within CUTOFF_MARGIN_MS of the end of the granted duration?
   *
   * Soniox reports the granted-duration cutoff as a bare 403, which is also
   * what a revoked key and a frozen wallet look like. Reading every managed
   * 403 as the cutoff tells a user whose key just died to "tap Start Session
   * to continue"; reading a real cutoff as an outage tells them "the
   * connection was interrupted". With no grant to compare against, the
   * second is the worse lie, so an unknown grant keeps today's behaviour.
   */
  isAtGrantedDurationEnd(nowMs: number): boolean {
    if (this.startedAtMs === null || !this.maxSessionDurationSeconds) return true;
    const elapsedMs = nowMs - this.startedAtMs;
    return elapsedMs >= this.maxSessionDurationSeconds * 1000 - ManagedSonioxSession.CUTOFF_MARGIN_MS;
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
   *
   * PER ATTEMPT, deliberately, not a budget shared across acquire's 409 retry.
   * The retry fires only on a 409, which means the first attempt received an
   * HTTP answer and therefore did not time out — so a shared budget could never
   * protect against the case timeouts actually guard (a hung request), and would
   * instead hand the healthy second attempt whatever was left after the
   * backend's own `retryAfterMs` wait, which this client does not choose and
   * cannot bound. The worst case stays finite and knowable either way:
   * timeout + retryAfterMs + timeout.
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
      region: request.region,
    };
    try {
      return await fetch(`${getApiUrl()}/soniox/session-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SESSION_KEY_TIMEOUT_MS),
      });
    } catch (error) {
      // A timeout is not a generic transport failure and must not be worded as
      // one: `signal is aborted without reason` is what the branch below would
      // show a user whose Start button has been stuck for 15 s.
      //
      // Reported with the SAME sentence as a 502 rather than a key of its own.
      // It says the true thing ("the service didn't answer, try again in a
      // moment") and it already ships in all 30 locale catalogs — and the
      // consistency test requires a new key to be translated 30 times before it
      // can be added, which is a poor trade for a distinction the user cannot
      // act on differently.
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error(i18n.t('mainPanel.sonioxServiceUnavailable', 'Soniox is temporarily unavailable. Please try again in a moment.'));
      }
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
