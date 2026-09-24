import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnyProvider, CheckResult, LanguageOption } from '../lib/provider/types';

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// Fresh module per test: the store keeps its check bookkeeping at module scope.
let store: typeof import('./providerStore');
beforeEach(async () => {
  vi.resetModules();
  store = await import('./providerStore');
});

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });
const noAuth = { signedIn: false, getToken: async () => null };

function probe(kind: 'own-key' | 'local', check: (k: unknown, s: unknown) => Promise<CheckResult>): AnyProvider {
  return {
    id: 'probe',
    kind,
    settings: { key: 'probe', defaults: { mode: 'a' } },
    credentials: {
      keys: ['apiKey'],
      fields: () => [{ key: 'apiKey', labelKey: 'k', secret: true }],
      read: (values: Record<string, string>) => (values.apiKey ? { key: values.apiKey } : { missing: 'no key' }),
    },
    check,
    languages: { sources: () => [opt('en')], targets: () => [opt('ja')] },
  } as unknown as AnyProvider;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function loadedWithKey(p: AnyProvider, key = 'k1') {
  const s = store.useProviderStore.getState();
  await s.load(p);
  s.setCredential(p, 'apiKey', key);
}

const readiness = () => store.useProviderStore.getState().readiness.probe;

describe('refreshReadiness', () => {
  it('reports missing credentials without calling check', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await store.useProviderStore.getState().load(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'no key' });
    expect(check).not.toHaveBeenCalled();
  });

  it('is checking while the check runs, then ready with its models', async () => {
    const answer = deferred<CheckResult>();
    const p = probe('own-key', () => answer.promise);
    await loadedWithKey(p);
    const done = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(readiness()).toEqual({ state: 'checking' });
    answer.resolve({ ok: true, models: [{ id: 'm2' }, { id: 'm1' }] });
    await expect(done).resolves.toEqual({ state: 'ready', models: [{ id: 'm2' }, { id: 'm1' }] });
    expect(readiness()).toEqual({ state: 'ready', models: [{ id: 'm2' }, { id: 'm1' }] });
  });

  it('passes what read returned, the settings, and the pair, to check', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await loadedWithKey(p, 'sk-9');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledWith({ key: 'sk-9' }, { mode: 'a' }, { pair: { source: 'en', target: 'ja' }, signal: undefined });
  });

  it('records a refusal as not ready, with its reason', async () => {
    const p = probe('own-key', async () => ({ ok: false, reason: 'bad key' }));
    await loadedWithKey(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'bad key' });
  });

  it('shows a thrown check as not ready, and asks again next time', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => { throw new Error('offline'); });
    const p = probe('own-key', check);
    await loadedWithKey(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'offline' });
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('asks again after a refusal', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: false, reason: 'rate limited' }));
    const p = probe('own-key', check);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('keeps a network answer for the same inputs, and asks again when they change', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await loadedWithKey(p, 'k1');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(1);
    store.useProviderStore.getState().setCredential(p, 'apiKey', 'k2');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('asks a local engine every time, since its readiness changes as models download', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('local', check);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('lets the newest check win over an older one that finishes later', async () => {
    const first = deferred<CheckResult>();
    const second = deferred<CheckResult>();
    const answers = [first.promise, second.promise];
    const p = probe('local', () => answers.shift()!);
    await loadedWithKey(p);
    const a = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    const b = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    second.resolve({ ok: true });
    await b;
    first.resolve({ ok: false, reason: 'stale' });
    await a;
    expect(readiness()).toEqual({ state: 'ready', models: [] });
  });

  it('forgets readiness when a credential changes, and drops the check that change outdated', async () => {
    const answer = deferred<CheckResult>();
    const p = probe('own-key', () => answer.promise);
    await loadedWithKey(p);
    const done = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    store.useProviderStore.getState().setCredential(p, 'apiKey', 'k2');
    expect(readiness()).toEqual({ state: 'unknown' });
    answer.resolve({ ok: true });
    await done;
    expect(readiness()).toEqual({ state: 'unknown' });
  });

  it('forgets a ready answer when a setting changes', async () => {
    const p = probe('own-key', async () => ({ ok: true }));
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(readiness()).toEqual({ state: 'ready', models: [] });
    store.useProviderStore.getState().updateSettings(p, { mode: 'b' });
    expect(readiness()).toEqual({ state: 'unknown' });
  });
});
