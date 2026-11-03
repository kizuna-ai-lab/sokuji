/**
 * Palabra AI's voices over REST (voice library spec §2): the built-in roster,
 * the account's own voices, creating one from a WAV sample, deleting one, and
 * the account's quota. Either credential works on every call, in the headers
 * `restHeaders` writes; nothing here puts a credential anywhere else — not in
 * a URL, not in a thrown message, and not on the pre-signed upload, which goes
 * to Palabra's object storage and carries its own signature.
 *
 * Shapes are the ones measured with both credential types on 2026-11-03 (the
 * spec's "What Palabra offers"); the public OpenAPI document is
 * `https://api.palabra.ai/docs/openapi.json`.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { PalabraCredentials } from './settings';
import { PALABRA_API, restHeaders, restWords } from './wire';

export interface PalabraVoiceInfo {
  id: string;
  name: string;
  /** The language its sample speaks: a built-in speaks one. Null without a sample. */
  language: string | null;
  facets: { gender?: 'male' | 'female' };
  status: 'ready' | 'processing' | 'failed';
  /** The sample to preview: the first of `tts_sample` then `tts_samples` at a usable https address (trimmed); null when none is. */
  sample: string | null;
}

export type PalabraVoicesErrorType =
  | 'auth' | 'rate_limit' | 'limit_reached' | 'bad_audio' | 'invalid_request'
  | 'upload_failed' | 'not_found' | 'timeout' | 'network' | 'aborted' | 'unknown';

export class PalabraVoicesError extends Error {
  constructor(readonly errorType: PalabraVoicesErrorType, message: string, readonly status: number) {
    super(message);
    this.name = 'PalabraVoicesError';
  }
}

/** One API call's bound, and the upload's: a 10 MB WAV over a slow line. */
export const VOICES_TIMEOUT_MS = 15_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
/** The roster was 116 voices (two pages of 100); ten pages is room, not a loop. */
const MAX_PAGES = 10;
/** Palabra's `error_code`s a create can meet (`docs/error_codes`), all HTTP 422. */
const VOICE_LIMIT_EXCEEDED = 200200;
const AUDIO_REFUSED = new Set([200040, 200041, 200046, 200047]);

/** A voice as Palabra sends it: every field unknown until read (`normalise`). */
interface WireVoice {
  voice_id?: unknown; name?: unknown; voice_type?: unknown; processing_status?: unknown;
  labels?: unknown; tts_sample?: unknown; tts_samples?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** `p`, unless `signal` aborts first; the listener goes once either settles. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/** Only https is fetched or uploaded to: a recording and a sample never travel in the clear. */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A list entry that is a voice at all: a plain object with an id. Anything else is an unexpected answer. */
function isWireVoice(v: unknown): v is WireVoice {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && str((v as WireVoice).voice_id) !== null;
}

/** `x` as a plain object, else null: what Palabra sends is read field by field, never trusted whole. */
const obj = (x: unknown): Record<string, unknown> | null =>
  (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/**
 * One voice in our shape. Every nested field is read defensively, so an odd
 * shape (samples not a list, a sample or labels not an object) reads as no
 * sample or no labels instead of throwing (PR #684 review).
 */
function normalise(v: WireVoice): PalabraVoiceInfo {
  const samples = [v.tts_sample, ...(Array.isArray(v.tts_samples) ? v.tts_samples : [])]
    .map(obj)
    .filter((s): s is Record<string, unknown> => s !== null);
  // The first sample a preview can actually play: a blank or plain-http address is passed over.
  const usable = samples
    .map((s) => ({ s, url: typeof s.url === 'string' ? s.url.trim() : '' }))
    .find(({ url }) => isHttpsUrl(url)) ?? null;
  const sample = usable?.s ?? null;
  const gender = str(obj(v.labels)?.gender)?.toLowerCase();
  const status = v.processing_status;
  return {
    id: String(v.voice_id ?? ''),
    name: (typeof v.name === 'string' ? v.name : '').trim(),
    language: sample ? str(obj(sample.text)?.lang) : null,
    facets: gender === 'male' || gender === 'female' ? { gender } : {},
    status: status === undefined || status === 'ready' ? 'ready' : status === 'failed' ? 'failed' : 'processing',
    sample: usable?.url ?? null,
  };
}

/** Palabra's refusal in its own words (`restWords`), typed for the section's copy. Never echoes a request. */
function refusal(status: number, body: unknown, onCreate: boolean, secrets: readonly string[]): PalabraVoicesError {
  const code = (body as { errors?: Array<{ error_code?: unknown }> } | null)?.errors?.[0]?.error_code;
  // Palabra's words are kept, but never a credential it might echo back.
  // Any credential, whatever its length: a mangled word costs less than an exposed secret.
  const words = secrets.reduce((text, secret) => (secret ? text.split(secret).join('…') : text), restWords(status, body, 'Palabra refused the request.'));
  if (status === 401 || status === 403) return new PalabraVoicesError('auth', words, status);
  if (status === 429) return new PalabraVoicesError('rate_limit', words, status);
  if (status === 404) return new PalabraVoicesError('not_found', words, status);
  if (code === VOICE_LIMIT_EXCEEDED) return new PalabraVoicesError('limit_reached', words, status);
  if (typeof code === 'number' && AUDIO_REFUSED.has(code)) return new PalabraVoicesError('bad_audio', words, status);
  if (onCreate && status >= 400 && status < 500) return new PalabraVoicesError('invalid_request', words, status);
  return new PalabraVoicesError('unknown', words, status);
}

export class PalabraVoicesClient {
  private readonly headers: Record<string, string>;
  /** What must never appear in a thrown message. */
  private readonly secrets: readonly string[];
  private readonly clock: Pick<Clock, 'setTimeout'>;
  private readonly fetchImpl?: typeof fetch;

  constructor(k: PalabraCredentials, deps: { fetch?: typeof fetch; clock?: Pick<Clock, 'setTimeout'> } = {}) {
    this.headers = { Accept: 'application/json', ...restHeaders(k) };
    this.secrets = k.kind === 'apiKey' ? [k.apiKey] : [k.clientId, k.clientSecret];
    this.clock = deps.clock ?? realClock;
    this.fetchImpl = deps.fetch;
  }

  /** Read at call time, so a test's stubbed global is seen. */
  private doFetch(input: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl ? this.fetchImpl(input, init) : fetch(input, init);
  }

  /** One bounded request; every failure leaves as a `PalabraVoicesError`. */
  private async request<T>(
    url: string, init: RequestInit, read: (r: Response) => Promise<T>,
    opts: { signal?: AbortSignal; ms?: number; onCreate?: boolean } = {},
  ): Promise<T> {
    const ms = opts.ms ?? VOICES_TIMEOUT_MS;
    const late = `Palabra did not answer within ${ms / 1000} s.`;
    if (opts.signal?.aborted) throw new PalabraVoicesError('aborted', 'The request was cancelled.', 0);
    // The bound covers the body too: a response whose body stalls times out like one that never came.
    let outcome: { value: T } | { refused: PalabraVoicesError };
    try {
      outcome = await boundedFetch({ clock: this.clock, ms, signal: opts.signal, late }, async (signal) => {
        const response = await this.doFetch(url, { ...init, signal });
        if (!response.ok) {
          const body: unknown = await raceAbort(response.json().catch(() => ({})), signal);
          return { refused: refusal(response.status, body, opts.onCreate ?? false, this.secrets) };
        }
        return { value: await raceAbort(read(response), signal) };
      });
    } catch (error) {
      if (error instanceof PalabraVoicesError) throw error;
      if (opts.signal?.aborted) throw new PalabraVoicesError('aborted', 'The request was cancelled.', 0);
      if (error instanceof Error && error.message === late) throw new PalabraVoicesError('timeout', late, 408);
      throw new PalabraVoicesError('network', 'Could not reach Palabra.', 0);
    }
    if ('refused' in outcome) throw outcome.refused;
    return outcome.value;
  }

  /** A call's `data`; a 2xx without it is Palabra answering something unexpected, typed as such unless `optional`. */
  private json<T>(url: string, init: RequestInit, signal?: AbortSignal, onCreate = false, optional = false): Promise<T> {
    return this.request(url, { ...init, headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) } }, async (r) => {
      const body = (await r.json().catch(() => null)) as { data?: unknown } | null;
      if (!optional && (body?.data === undefined || body.data === null)) {
        throw new PalabraVoicesError('unknown', 'Palabra returned an unexpected response.', r.status);
      }
      return body?.data as T;
    }, { signal, onCreate });
  }

  private async pages(path: string, signal?: AbortSignal): Promise<WireVoice[]> {
    const items: WireVoice[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: string = token ? `token=${encodeURIComponent(token)}` : 'page_size=100';
      const data: { items?: WireVoice[]; next?: unknown } | undefined = await this.json(`${PALABRA_API}${path}?${query}`, { method: 'GET' }, signal);
      if (!Array.isArray(data?.items) || !data.items.every(isWireVoice)) {
        throw new PalabraVoicesError('unknown', 'Palabra returned a voice list with missing or malformed entries.', 200);
      }
      items.push(...data.items);
      token = str(data?.next);
      if (!token) break;
    }
    return items;
  }

  async listBuiltin(signal?: AbortSignal): Promise<PalabraVoiceInfo[]> {
    return (await this.pages('/saas/voice/builtin', signal)).map(normalise);
  }

  /** Only the account's own: a built-in here would be offered for deletion (spec §2). */
  async listMine(signal?: AbortSignal): Promise<PalabraVoiceInfo[]> {
    return (await this.pages('/saas/voice', signal)).filter((v) => v.voice_type === 'instantly_cloned').map(normalise);
  }

  async get(id: string, signal?: AbortSignal): Promise<PalabraVoiceInfo> {
    return normalise(await this.json<WireVoice>(`${PALABRA_API}/saas/voice/m/${encodeURIComponent(id)}`, { method: 'GET' }, signal));
  }

  /**
   * The clone request with the sample's metadata, then the sample itself to
   * the pre-signed upload. A voice whose upload failed would hold a quota
   * slot at `created` until Palabra drops it, so it is deleted first.
   */
  async create(args: { name: string; wav: Blob; langCode: string; denoise: boolean }, signal?: AbortSignal): Promise<PalabraVoiceInfo> {
    const body = JSON.stringify({
      data: { name: args.name, samples: [{ filename: 'sample.wav', mime_type: 'audio/wav', lang_code: args.langCode, denoise: args.denoise }] },
    });
    const created = await this.json<WireVoice & { samples?: Array<{ url?: unknown; form_data?: Record<string, string> | null }> }>(
      `${PALABRA_API}/saas/voice/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, signal, true,
    );
    const id = String(created?.voice_id ?? '');
    const upload = created?.samples?.[0];
    try {
      if (!id || !upload || !str(upload.url) || !isHttpsUrl(upload.url as string)) throw new PalabraVoicesError('upload_failed', 'Palabra gave no usable upload for the sample.', 0);
      const form = new FormData();
      for (const [k, v] of Object.entries(upload.form_data ?? {})) form.append(k, v);
      form.append('file', new File([args.wav], 'sample.wav', { type: 'audio/wav' }));
      // No credential headers: the form carries the storage's own signature.
      await this.request(upload.url as string, { method: 'POST', body: form }, async () => undefined, { signal, ms: UPLOAD_TIMEOUT_MS });
    } catch (error) {
      if (id) await this.delete(id).catch(() => undefined);
      if (error instanceof PalabraVoicesError && error.errorType === 'aborted') throw error;
      throw new PalabraVoicesError('upload_failed', 'The sample could not be uploaded to Palabra.', error instanceof PalabraVoicesError ? error.status : 0);
    }
    return normalise({ ...created, voice_type: 'instantly_cloned', processing_status: created.processing_status ?? 'created' });
  }

  async delete(id: string, signal?: AbortSignal): Promise<void> {
    await this.json(`${PALABRA_API}/saas/voice/m/${encodeURIComponent(id)}`, { method: 'DELETE' }, signal, false, true);
  }

  async limits(signal?: AbortSignal): Promise<{ used: number; limit: number; remaining: number }> {
    const d = await this.json<{ total?: unknown; limit?: unknown; remaining?: unknown }>(`${PALABRA_API}/saas/voice/limits`, { method: 'GET' }, signal);
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return { used: n(d?.total), limit: n(d?.limit), remaining: n(d?.remaining) };
  }
}
