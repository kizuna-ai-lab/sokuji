/**
 * ManagedVoicesClient — the managed (Kizuna AI) counterpart to
 * SonioxVoicesClient. Where the BYOK client talks to Soniox's /v1/voices with
 * the user's permanent project key, this one talks to our own backend with a
 * Better Auth session token, because managing voices needs a permanent Soniox
 * key that a managed user never has.
 *
 * The backend runs Soniox's 20-voice organization quota as a CACHE: an account
 * holds at most one voice, warm voices are kept, and the least recently used
 * one is evicted when someone else needs the space. Two consequences shape
 * this API:
 *
 *  - `ensure` is the only way to obtain a voice, and it is idempotent. Call it
 *    without a clip first: a warm slot answers immediately and no upload
 *    happens. Only a `clip_required` refusal means this device must upload.
 *  - The voice id is NOT stable across a rebuild. Every `ensure` response is
 *    authoritative and must be written through to settings.
 *
 * Errors are thrown as SonioxVoicesError with the backend's own slug as
 * `errorType`, so SonioxVoiceSection's existing error mapping works unchanged
 * whichever source is behind it.
 *
 * Also mints a single-use preview key (`sessionKey`) and reports a preview's
 * completion (`previewDone`) — the two calls a preview travels through on its
 * way to `POST /soniox/session-key` / `POST /soniox/preview-done`, per the
 * phase-1 backend (sokuji-backend #68). Those two live on this class rather
 * than a new one for the same reason `mine`/`ensure`/`remove` do: one class
 * per Better-Auth-token-authenticated backend surface, one shared HTTP idiom.
 */
import { DEFAULT_SONIOX_REGION, asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
import { getApiUrl } from '../../utils/environment';
import { SonioxVoicesError } from './SonioxVoicesClient';

export type ManagedVoiceStatus = 'not_computed' | 'processing' | 'ready' | 'failed';

export interface ManagedVoice {
  voiceId: string;
  /** Read through to Soniox by the backend, so this is Soniox's full enum —
   *  not the ready/processing pair `ensure` narrows its answer to. */
  status: ManagedVoiceStatus;
  createdAt: number;
}

/** What `sessionKey({ mode: 'voice_preview' })` mints. No `sttApiKey` field
 *  at all — the backend issues exactly one stream (`preview_tts`) for this
 *  mode, so there is nothing to transcribe (backend design §5.6) — and this
 *  type says so structurally rather than leaving it optional and hoping no
 *  caller reaches for it. */
export interface ManagedPreviewSessionKey {
  ttsApiKey: string;
  /** The region THESE KEYS belong to, echoed back by the backend rather than
   *  assumed to be the request's own `region` — same reasoning as
   *  `ManagedSonioxSession.fileBundles`'s use of the response's region. A
   *  missing or unrecognised value narrows to THIS CLIENT's own `region`
   *  (see `sessionKey` below), never to the global US default: for a eu/jp
   *  account that default is the one value guaranteed to disagree with both
   *  the request and the backend, and would route the returned key at the
   *  wrong TTS host. */
  region: SonioxRegion;
}

const REQUEST_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export class ManagedVoicesClient {
  constructor(
    private readonly getToken: () => Promise<string | null>,
    /** Which Soniox regional project the backend should build this account's
     *  voice in. A cloned voice's UUID exists only inside one project, so a
     *  slot claimed in the wrong region names a voice the session cannot use.
     *  Defaults to US so existing call sites keep their behaviour.
     *
     *  Public (not `private`, unlike `getToken`): `managedVoiceSource` reads
     *  it to namespace its preview cache per project, the same reason
     *  `byokVoiceSource` namespaces its own cache by region — a cache entry
     *  keyed only by voice id would cross projects if the account's region
     *  setting ever changed between two previews. */
    public readonly region: SonioxRegion = DEFAULT_SONIOX_REGION,
  ) {}

  /**
   * Normalizes a rejection from either the `fetch()` call or a subsequent
   * body read into this module's single error shape. The caller's own
   * signal is checked before sniffing the rejection's name: it survived the
   * abort (unlike a DOMException instance, which can fail `instanceof`
   * across realms — observed right here under the jsdom test environment)
   * and is realm-agnostic, same reasoning as SonioxTtsRest.asSonioxError,
   * this module's precedent for the shape.
   */
  private toTransportError(e: unknown, signal: AbortSignal | undefined, timeoutMs: number): SonioxVoicesError {
    if (signal?.aborted) return new SonioxVoicesError('aborted', 'Cancelled by the caller', 0);
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'TimeoutError') {
      return new SonioxVoicesError('timeout', `Request timed out after ${timeoutMs / 1000}s`, 408);
    }
    if (name === 'AbortError') {
      return new SonioxVoicesError('aborted', 'Cancelled by the caller', 0);
    }
    return new SonioxVoicesError('network', e instanceof Error ? e.message : String(e), 0);
  }

  /**
   * Shared HTTP idiom for every backend call this client makes: bearer auth
   * from `getToken()`, a caller-cancellable timeout via an explicit
   * AbortController (not `AbortSignal.any` — the deadline and the caller's
   * cancel must stay distinguishable at the catch site below), every non-2xx
   * response turned into a SonioxVoicesError carrying the backend's own
   * slug, and the timer/listener released only once `consume(res)` has
   * settled — not the moment `fetch()` resolves headers — so a caller that
   * reads the body (`fetchJsonWithAuth` below) stays bounded by the same
   * deadline while the body streams in. `fetchWithAuth` itself passes an
   * identity `consume`, so its own timer still clears at headers-arrived
   * time, same as before this was factored out.
   *
   * Takes the full request URL rather than building one, unlike `request()`
   * below: `sessionKey` (via `fetchJsonWithAuth`) and `previewDone` (via
   * `fetchWithAuth`) reach it without `request()` because neither
   * endpoint lives under `/soniox/voices` or takes that method's automatic
   * `region` query param (session-key's region travels in the JSON body;
   * preview-done needs no region at all — the backend resolves the account's
   * own lease). `request()` is this method plus that one URL shape.
   */
  private async withTimedRequest<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    /** Caller cancellation (e.g. the Start this call belongs to was aborted).
     *  Forwarded into an internal AbortController rather than handed to fetch
     *  directly — see the comment below for why not `AbortSignal.any`. */
    signal: AbortSignal | undefined,
    consume: (res: Response) => Promise<T>
  ): Promise<T> {
    if (timeoutMs <= 0) {
      // A caller working to a deadline can hand down a budget that has already
      // run out (its own earlier steps consumed it). Issuing a fetch only to
      // abort it on the same tick wastes a request and leans on
      // AbortSignal.timeout(0) behaving sensibly; refusing outright says the
      // same thing sooner and more plainly.
      throw new SonioxVoicesError('timeout', 'No time left in the caller\'s budget', 408);
    }
    if (signal?.aborted) {
      // Refuse before spending a fetch: an already-cancelled caller (Start
      // already ended) must not dial out at all.
      throw new SonioxVoicesError('aborted', 'Cancelled by the caller', 0);
    }
    const token = await this.getToken();
    if (!token) {
      // Asking the server to tell us what we already know costs a round trip
      // and returns a 401 that reads like an outage instead of "sign in".
      throw new SonioxVoicesError('authentication_required', 'Sign in to manage your voice', 401);
    }
    // An explicit controller rather than AbortSignal.any(): the deadline and
    // the caller's cancel must stay distinguishable at the catch site below,
    // and the abort reason's `name` is what carries that distinction (see
    // SonioxTtsRest.synthesizeOnce, the precedent for this shape).
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException(`Request timed out after ${timeoutMs / 1000}s`, 'TimeoutError')),
      timeoutMs
    );
    const forwardAbort = () =>
      controller.abort(signal?.reason ?? new DOMException('Cancelled by the caller', 'AbortError'));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    // An abort landing during the `getToken()` await above fires before this
    // listener existed to hear it; catch it here so the fetch below starts
    // (and rejects) already aborted instead of running to its own timeout.
    if (signal?.aborted) forwardAbort();
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } catch (e) {
        throw this.toTransportError(e, signal, timeoutMs);
      }
      if (!res.ok) await this.throwBackendError(res);
      try {
        // Still inside the timed section: `consume` reads the body through
        // the SAME `controller.signal` the fetch above used, so a body read
        // that stalls past the deadline aborts exactly like a stalled
        // connect would, and is mapped the same way.
        return await consume(res);
      } catch (e) {
        if (e instanceof SonioxVoicesError) throw e;
        throw this.toTransportError(e, signal, timeoutMs);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private async fetchWithAuth(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<Response> {
    return this.withTimedRequest(url, init, timeoutMs, signal, async (res) => res);
  }

  /**
   * Same as `fetchWithAuth`, except the JSON body is read WHILE the timer is
   * still armed, per "released only once the body has been consumed"
   * (SonioxTtsRest.synthesizeOnce, this module's precedent). `fetchWithAuth`
   * releases its timer the moment response headers arrive — fine for
   * `mine`/`ensure`/`previewDone`, whose callers read the body afterwards on
   * no deadline of their own — but wrong for `sessionKey`: under per-source
   * preview serialization (`managedVoiceSource.preview`), a mint that hangs
   * on an unbounded body read parks every later preview on this source
   * behind it forever, not just this one call.
   */
  private async fetchJsonWithAuth<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    return this.withTimedRequest(url, init, timeoutMs, signal, (res) => res.json() as Promise<T>);
  }

  /** `fetchWithAuth` plus the one URL shape every voices-CRUD call shares:
   *  `/soniox/voices<path>`, with this client's own region as a query param
   *  on every request. */
  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<Response> {
    return this.fetchWithAuth(
      `${getApiUrl()}/soniox/voices${path}${path.includes('?') ? '&' : '?'}region=${this.region}`,
      init,
      timeoutMs,
      signal
    );
  }

  /** Every failing response from this backend carries `{ error: '<slug>' }`,
   *  and 409 pool_exhausted additionally carries `retryAfterMs`. Preserve both
   *  verbatim: the slug is what callers branch on, and the hint comes from a
   *  reconciler poke we cannot second-guess from here. */
  private async throwBackendError(res: Response): Promise<never> {
    let slug = 'http_error';
    let retryAfterMs: number | undefined;
    try {
      const body = await res.json();
      if (typeof body?.error === 'string') slug = body.error;
      if (typeof body?.retryAfterMs === 'number') retryAfterMs = body.retryAfterMs;
    } catch {
      // Non-JSON body (a gateway error page): the status still carries meaning.
    }
    throw new SonioxVoicesError(slug, `HTTP ${res.status}`, res.status, retryAfterMs);
  }

  /** This account's voice as the backend currently sees it, or null when it
   *  holds none — including while a build has been reserved but has no real
   *  Soniox id yet.
   *
   *  `budgetMs` caps this call's own timeout, same contract as `ensure`: a
   *  caller polling against a deadline would otherwise have its last poll run
   *  the full 15s past that deadline. Callers with no deadline omit it.
   *
   *  `signal` cancels an in-flight request too, not just future ones —
   *  threaded straight into `request()`'s own AbortController. */
  async mine(budgetMs?: number, signal?: AbortSignal): Promise<ManagedVoice | null> {
    const res = await this.request(
      '/mine',
      { method: 'GET' },
      budgetMs !== undefined ? Math.min(REQUEST_TIMEOUT_MS, budgetMs) : REQUEST_TIMEOUT_MS,
      signal
    );
    const body = await res.json();
    return body?.voice ?? null;
  }

  /**
   * Claim (or refresh) this account's slot.
   *
   * `pin: true` protects the slot from eviction for a short start window and
   * is what the session-start path asks for; the backend extends that pin to
   * the session's own expiry once the session actually starts.
   *
   * Omit `clip` first. A warm slot needs no upload, and `clip_required` is the
   * backend's way of saying this device must supply the recording.
   *
   * `budgetMs` caps this call's own timeout. The upload default is 120s, which
   * a caller working to a shorter deadline of its own cannot otherwise
   * respect: session start budgets 60s for the whole preparation, so without
   * this a single cold upload could hold Start disabled for twice that with no
   * way to cancel. Callers with no deadline omit it and keep the defaults.
   *
   * `signal` cancels an in-flight request too (including a cold upload),
   * same threading as `mine`.
   */
  async ensure(
    opts: { pin: boolean; clip?: Blob; budgetMs?: number; signal?: AbortSignal }
  ): Promise<{ voiceId: string; status: 'ready' | 'processing' }> {
    const form = new FormData();
    form.set('pin', opts.pin ? '1' : '0');
    if (opts.clip) form.set('clip', opts.clip, 'reference.wav');
    const defaultTimeout = opts.clip ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    // No Content-Type header on purpose: fetch generates the multipart
    // boundary, and setting the header by hand strips it, which makes the
    // backend's formData() parse fail.
    const res = await this.request(
      '/ensure',
      { method: 'POST', body: form },
      opts.budgetMs !== undefined ? Math.min(defaultTimeout, opts.budgetMs) : defaultTimeout,
      opts.signal
    );
    const body = await res.json();
    return { voiceId: body.voiceId, status: body.status };
  }

  /** Give the slot back. Refused with `voice_pinned` while a live session
   *  still holds it. */
  async remove(): Promise<void> {
    await this.request('/mine', { method: 'DELETE' }, REQUEST_TIMEOUT_MS);
  }

  /**
   * Mint a single-use Soniox TTS key for one voice preview, via the third
   * `mode` on `POST /soniox/session-key` (backend design §5.6). Always sends
   * THIS client's own `region` in the body — never a caller-supplied one —
   * because a preview must mint from the same project the account's voice
   * actually lives in; minting from the wrong project would return a key
   * that cannot resolve the voice's UUID at all.
   *
   * Errors surface as SonioxVoicesError, same as every method above, so
   * `SonioxVoiceSection.mapTtsError` can branch on `.status` the way it
   * already does for the voices-CRUD errors: 402 (insufficient balance), 409
   * (another session or preview already holds the account's lease), and 503
   * (Soniox capacity full) are this route's own documented outcomes.
   */
  async sessionKey(request: { mode: 'voice_preview' }): Promise<ManagedPreviewSessionKey> {
    // `fetchJsonWithAuth`, not `fetchWithAuth` + a separate `res.json()`: see
    // that method's docstring for why THIS call in particular needs the body
    // read bounded by the deadline. Un-abortable on purpose (no `signal`
    // passed) — this call's own caller (`managedVoiceSource.mintPreviewKey`)
    // must not cancel a mint whose response may already have acquired the
    // account's lease, since `preview-done` has to follow every acquired one.
    const body = await this.fetchJsonWithAuth<{ ttsApiKey?: unknown; region?: unknown }>(
      `${getApiUrl()}/soniox/session-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: request.mode, region: this.region }),
      },
      REQUEST_TIMEOUT_MS
    );
    if (typeof body?.ttsApiKey !== 'string') {
      // A contract break, not a user-facing failure mode: this route always
      // mints a TTS key for `voice_preview` (backend design §5.6). Loud
      // rather than a preview that silently tries to synthesize with
      // `undefined` as its credential.
      throw new SonioxVoicesError('http_error', 'Preview session-key response is missing ttsApiKey', 0);
    }
    // Fall back to THIS CLIENT's own region, not the global default: see
    // `ManagedPreviewSessionKey.region`'s docstring for why `us` specifically
    // is the wrong thing to default a eu/jp account to.
    return { ttsApiKey: body.ttsApiKey, region: asSonioxRegion(body.region, this.region) };
  }

  /**
   * Report a preview's synthesis as over — the BILLING TRIGGER for a
   * preview, not a courtesy notification. It writes the lease's
   * `started_at`, which is what gives the reconciler's usage-log sweep a
   * lease to find at all (backend design §5.3), and what lets that sweep
   * release the account's exclusivity lease instead of leaving it to the
   * ~45s expiry backstop.
   *
   * Empty body, the same rule `session-end` follows: the backend resolves
   * the account's OWN preview lease, so there is no reference a caller could
   * name — or forge — here. Answers 404 when there is nothing to complete
   * (already reconciled, expired, or no preview lease was ever taken); the
   * caller (`managedVoiceSource.preview`) always calls this from a `finally`
   * and swallows whatever it throws, so a 404 here is inert by design.
   */
  async previewDone(): Promise<void> {
    await this.fetchWithAuth(`${getApiUrl()}/soniox/preview-done`, { method: 'POST' }, REQUEST_TIMEOUT_MS);
  }
}
