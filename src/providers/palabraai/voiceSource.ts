/**
 * Where the Palabra voice library's voices come from (voice library spec §3):
 * the account's `PalabraVoicesClient`, plus previews. A preview plays the
 * voice's own sample from Palabra's CDN — nothing is synthesized and nothing
 * is billed — decoded to mono once and kept in the shared preview cache.
 * Voice ids are global, so one cache namespace serves every account.
 */
import { useMemo } from 'react';
import { downmixToMono } from '../../lib/local-inference/native/nativeVoiceStores';
import { readCredentials } from '../../lib/provider/credentials';
import type { ProviderAccount } from '../../lib/provider/types';
import { getCachedPreview, previewCacheKey, setCachedPreview } from '../../lib/tts/previewCache';
import { palabraCredentials, type PalabraCredentials, type PalabraSettings } from './settings';
import { isHttpsUrl, PalabraVoicesClient, PalabraVoicesError, type PalabraVoiceInfo } from './voicesClient';

export interface PalabraVoiceSource {
  list(signal?: AbortSignal): Promise<{ builtin: PalabraVoiceInfo[]; mine: PalabraVoiceInfo[] }>;
  get(id: string, signal?: AbortSignal): Promise<PalabraVoiceInfo>;
  create(args: { name: string; wav: Blob; langCode: string; denoise: boolean }): Promise<PalabraVoiceInfo>;
  delete(id: string): Promise<void>;
  limits(): Promise<{ used: number; limit: number; remaining: number }>;
  preview(args: { id: string; sample: string; signal?: AbortSignal }): Promise<{ audio: Float32Array; sampleRate: number }>;
  /** The last list that succeeded, with the last quota read; null before any (owner, 2026-11-03: no request on every visit). */
  cached(): PalabraVoiceSnapshot | null;
  readonly cacheNamespace: 'palabra';
}

export interface PalabraVoiceSnapshot {
  builtin: PalabraVoiceInfo[];
  mine: PalabraVoiceInfo[];
  limits: { used: number; limit: number; remaining: number } | null;
}

export const PALABRA_CACHE_NAMESPACE = 'palabra';

async function decodeWithAudioContext(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(bytes);
  } finally {
    void ctx.close();
  }
}

export function palabraVoiceSource(
  client: PalabraVoicesClient,
  deps: { fetch?: typeof fetch; decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer> } = {},
): PalabraVoiceSource {
  const decode = deps.decode ?? decodeWithAudioContext;
  // What the picker shows on its next visit without asking again: only a
  // success replaces it, so going offline keeps the last good answer.
  let snapshot: PalabraVoiceSnapshot | null = null;
  let lastLimits: PalabraVoiceSnapshot['limits'] = null;
  return {
    list: async (signal) => {
      const [builtin, mine] = await Promise.all([client.listBuiltin(signal), client.listMine(signal)]);
      snapshot = { builtin, mine, limits: lastLimits };
      return { builtin, mine };
    },
    get: (id, signal) => client.get(id, signal),
    create: (args) => client.create(args),
    delete: (id) => client.delete(id),
    limits: async () => {
      const limits = await client.limits();
      lastLimits = limits;
      if (snapshot) snapshot = { ...snapshot, limits };
      return limits;
    },
    cached: () => snapshot,
    async preview({ id, sample, signal }) {
      // A sample is one fixed recording: no language, no speed in its key.
      const key = previewCacheKey(PALABRA_CACHE_NAMESPACE, id, '', 1);
      const cached = getCachedPreview(key);
      if (cached) return cached;
      if (!isHttpsUrl(sample)) throw new PalabraVoicesError('unknown', 'The voice sample is not on an https address.', 0);
      const doFetch = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
      let response: Response;
      try {
        response = await doFetch(sample, { signal });
      } catch {
        if (signal?.aborted) throw new PalabraVoicesError('aborted', 'The preview was cancelled.', 0);
        throw new PalabraVoicesError('network', 'Could not fetch the voice sample.', 0);
      }
      if (!response.ok) throw new PalabraVoicesError('unknown', `The voice sample answered HTTP ${response.status}.`, response.status);
      const buffer = await decode(await response.arrayBuffer());
      const result = { audio: downmixToMono(buffer), sampleRate: buffer.sampleRate };
      setCachedPreview(key, result);
      return result;
    },
    cacheNamespace: PALABRA_CACHE_NAMESPACE,
  };
}

/** A stable identity for the credentials, so the source is rebuilt only when they change. */
const identity = (k: PalabraCredentials) => (k.kind === 'apiKey' ? `key\u0000${k.apiKey}` : `app\u0000${k.clientId}\u0000${k.clientSecret}`);

/** A non-reversible tag for an identity (FNV-1a, two lanes): the registry below keys on it, never on a credential. */
function tag(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x811c9dc5);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

/** One source per credentials for the app session, so its remembered list outlives a settings visit. A few at most. */
const shared = new Map<string, PalabraVoiceSource>();
const SHARED_LIMIT = 4;

export function sharedPalabraVoiceSource(k: PalabraCredentials): PalabraVoiceSource {
  const key = tag(identity(k));
  const found = shared.get(key);
  if (found) {
    // Most recent last, so the oldest is the one let go.
    shared.delete(key);
    shared.set(key, found);
    return found;
  }
  const made = palabraVoiceSource(new PalabraVoicesClient(k));
  shared.set(key, made);
  while (shared.size > SHARED_LIMIT) shared.delete(shared.keys().next().value as string);
  return made;
}

/**
 * The account's source, or null until its mode's credentials are saved
 * (spec §3). Read through `readCredentials`: the saved values hold every
 * mode's fields, and reading them whole would take an app pair for a key.
 */
export function usePalabraVoiceSource(account: ProviderAccount | undefined, settings: PalabraSettings): PalabraVoiceSource | null {
  const credentials = account ? readCredentials({ credentials: palabraCredentials }, settings, account.credentials, account.auth) : null;
  const k = credentials && !('missing' in credentials) ? credentials : null;
  const key = k ? identity(k) : '';
  // `k` is fully described by `key`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (k ? sharedPalabraVoiceSource(k) : null), [key]);
}

/** Poll waits (spec §4): every 5 s for the first minute, then every 15 s; give up at 15 minutes. */
export const PALABRA_POLL = { fastMs: 5_000, fastForMs: 60_000, slowMs: 15_000, budgetMs: 15 * 60_000 } as const;

/** A wait that rejects when `signal` aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;
export const realSleep: Sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new PalabraVoicesError('aborted', 'Cancelled.', 0)); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(new PalabraVoicesError('aborted', 'Cancelled.', 0)); };
  signal.addEventListener('abort', onAbort, { once: true });
});

/**
 * Wait FIRST, then ask, until the voice is ready or failed. The budget is
 * counted in the waits asked for, not the wall clock, so it is exact and
 * testable. A 404 (`not_found`) means Palabra dropped the voice: it is not
 * caught here. Past the budget: `timeout`. An abort: `aborted`.
 */
export async function waitUntilSettled(
  source: Pick<PalabraVoiceSource, 'get'>, id: string, opts: { sleep: Sleep; signal: AbortSignal },
): Promise<PalabraVoiceInfo> {
  let waited = 0;
  while (waited < PALABRA_POLL.budgetMs) {
    const ms = Math.min(waited < PALABRA_POLL.fastForMs ? PALABRA_POLL.fastMs : PALABRA_POLL.slowMs, PALABRA_POLL.budgetMs - waited);
    try {
      await opts.sleep(ms, opts.signal);
    } catch {
      throw new PalabraVoicesError('aborted', 'Cancelled.', 0);
    }
    waited += ms;
    if (opts.signal.aborted) throw new PalabraVoicesError('aborted', 'Cancelled.', 0);
    const voice = await source.get(id, opts.signal);
    if (voice.status !== 'processing') return voice;
  }
  throw new PalabraVoicesError('timeout', 'Palabra is still processing the voice.', 408);
}
