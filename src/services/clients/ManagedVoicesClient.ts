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
 */
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

const REQUEST_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export class ManagedVoicesClient {
  constructor(private readonly getToken: () => Promise<string | null>) {}

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    /** Caller cancellation (e.g. the Start this call belongs to was aborted).
     *  Forwarded into an internal AbortController rather than handed to fetch
     *  directly — see the comment below for why not `AbortSignal.any`. */
    signal?: AbortSignal
  ): Promise<Response> {
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
        res = await fetch(`${getApiUrl()}/soniox/voices${path}`, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } catch (e) {
        // The caller's own signal is checked before sniffing the rejection's
        // name: it survived the abort (unlike a DOMException instance, which
        // can fail `instanceof` across realms — observed right here under
        // the jsdom test environment) and is realm-agnostic, same reasoning
        // as SonioxTtsRest.asSonioxError, this module's precedent for the
        // shape.
        if (signal?.aborted) throw new SonioxVoicesError('aborted', 'Cancelled by the caller', 0);
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'TimeoutError') {
          throw new SonioxVoicesError('timeout', `Request timed out after ${timeoutMs / 1000}s`, 408);
        }
        if (name === 'AbortError') {
          throw new SonioxVoicesError('aborted', 'Cancelled by the caller', 0);
        }
        throw new SonioxVoicesError('network', e instanceof Error ? e.message : String(e), 0);
      }
      if (!res.ok) await this.throwBackendError(res);
      return res;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
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
}
