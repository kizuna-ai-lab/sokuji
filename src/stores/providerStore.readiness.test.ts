import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnyProvider, CheckContext, CheckResult, LanguageOption } from '../lib/provider/types';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

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
  reportErrorSpy.mockClear();
  store = await import('./providerStore');
});

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });
const noAuth = { signedIn: false, getToken: async () => null };
const signedIn = { signedIn: true, getToken: async () => 't' };
const signedOut = noAuth;

function probe(kind: 'own-key' | 'local' | 'managed', check: (k: unknown, s: unknown, ctx: CheckContext) => Promise<CheckResult>): AnyProvider {
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

/** What a run hands the check: its frozen shape's inputs. */
function runInputs(legs: CheckContext['legs'] = ['speaker']) {
  const { settings, credentials, pair } = store.useProviderStore.getState().entries.probe;
  return { settings, credentials, pair, legs };
}

describe('refreshReadiness', () => {
  it("words missing credentials by the provider's own code, and by credentials_missing when it gives none", async () => {
    const signInCheck = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const signIn: AnyProvider = {
      ...probe('own-key', signInCheck),
      credentials: {
        keys: ['apiKey'],
        fields: () => [{ key: 'apiKey', labelKey: 'k', secret: true }],
        read: () => ({ missing: 'Sign in first.', code: 'sign_in_required', params: { who: 'you' } }),
      },
    } as AnyProvider;
    await store.useProviderStore.getState().load(signIn);
    await expect(store.useProviderStore.getState().refreshReadiness(signIn, noAuth)).resolves.toEqual({
      state: 'not-ready', reason: 'Sign in first.', code: 'sign_in_required', params: { who: 'you' },
    });
    expect(signInCheck).not.toHaveBeenCalled();

    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await store.useProviderStore.getState().load(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'no key', code: 'credentials_missing' });
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
    expect(check).toHaveBeenCalledWith({ key: 'sk-9' }, { mode: 'a' }, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'], signal: undefined });
  });

  it('records a refusal as not ready, with its reason', async () => {
    const p = probe('own-key', async () => ({ ok: false, reason: 'bad key' }));
    await loadedWithKey(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'bad key' });
  });

  it("carries a refusal's code and params into readiness, and the store", async () => {
    const p = probe('own-key', async () => ({ ok: false, reason: 'r', code: 'c', params: { n: 1 } }));
    await loadedWithKey(p);
    await expect(store.useProviderStore.getState().refreshReadiness(p, noAuth)).resolves.toEqual({ state: 'not-ready', reason: 'r', code: 'c', params: { n: 1 } });
    expect(readiness()).toEqual({ state: 'not-ready', reason: 'r', code: 'c', params: { n: 1 } });
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

describe('forgetReadiness', () => {
  it('forgetReadiness makes readiness unknown and drops a check still running', async () => {
    const answer = deferred<CheckResult>();
    const p = probe('own-key', () => answer.promise);
    await loadedWithKey(p);
    const done = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(readiness()).toEqual({ state: 'checking' });
    store.useProviderStore.getState().forgetReadiness(p);
    expect(readiness()).toEqual({ state: 'unknown' });
    answer.resolve({ ok: true });
    await done;
    expect(readiness()).toEqual({ state: 'unknown' });
  });
});

describe('refreshReadiness — a managed provider and the sign-in (roadmap 1b)', () => {
  /** A managed probe: no fields of its own; `read` decides by the sign-in. */
  function managed(check: () => Promise<CheckResult>, read: AnyProvider['credentials']['read']): AnyProvider {
    return { ...probe('managed', check), credentials: { keys: [], fields: () => [], read } } as AnyProvider;
  }

  it("keeps a managed provider's answer per sign-in (roadmap 1b)", async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = managed(check, (_v, auth) => (auth.signedIn ? {} : { missing: 'Sign in first.', code: 'sign_in_required' }));
    await store.useProviderStore.getState().load(p);
    await store.useProviderStore.getState().refreshReadiness(p, signedIn);
    await store.useProviderStore.getState().refreshReadiness(p, signedIn);
    expect(check).toHaveBeenCalledTimes(1);

    await expect(store.useProviderStore.getState().refreshReadiness(p, signedOut)).resolves.toMatchObject({ state: 'not-ready', code: 'sign_in_required' });
    expect(readiness()).toMatchObject({ state: 'not-ready', code: 'sign_in_required' });
    expect(check).toHaveBeenCalledTimes(1);

    await expect(store.useProviderStore.getState().refreshReadiness(p, signedIn)).resolves.toEqual({ state: 'ready', models: [] });
    expect(readiness()).toEqual({ state: 'ready', models: [] });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('asks again when only the sign-in changed', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = managed(check, () => ({}));
    await store.useProviderStore.getState().load(p);
    await store.useProviderStore.getState().refreshReadiness(p, signedIn);
    await store.useProviderStore.getState().refreshReadiness(p, signedOut);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe('refreshReadiness — the models a ready answer found (F2; choice 3)', () => {
  const models = () => store.useProviderStore.getState().models.probe;

  it('keeps the models of the latest ready answer through a re-check, and empties them on a refusal', async () => {
    let answer: CheckResult = { ok: true, models: [{ id: 'm2' }, { id: 'm1' }] };
    const p = probe('own-key', async () => answer);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(models()).toEqual([{ id: 'm2' }, { id: 'm1' }]);

    store.useProviderStore.getState().updateSettings(p, { mode: 'b' });
    expect(readiness()).toEqual({ state: 'unknown' });
    expect(models()).toEqual([{ id: 'm2' }, { id: 'm1' }]);

    answer = { ok: false, reason: 'no' };
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(models()).toEqual([]);
  });

  it('empties them for missing credentials, and keeps them through a check that threw', async () => {
    const p = probe('own-key', async () => ({ ok: true, models: [{ id: 'm1' }] }));
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(models()).toEqual([{ id: 'm1' }]);
    store.useProviderStore.getState().setCredential(p, 'apiKey', '');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(models()).toEqual([]);

    // A fresh module: nothing kept from the half above.
    vi.resetModules();
    store = await import('./providerStore');
    let throws = false;
    const q = probe('own-key', async () => {
      if (throws) throw new Error('offline');
      return { ok: true, models: [{ id: 'm1' }] };
    });
    await loadedWithKey(q);
    await store.useProviderStore.getState().refreshReadiness(q, noAuth);
    expect(models()).toEqual([{ id: 'm1' }]);
    store.useProviderStore.getState().updateSettings(q, { mode: 'b' });
    throws = true;
    await store.useProviderStore.getState().refreshReadiness(q, noAuth);
    expect(readiness()).toMatchObject({ state: 'not-ready' });
    expect(models()).toEqual([{ id: 'm1' }]);
  });

  it('restores the models with a kept answer: the same key typed back reuses the answer, and its models', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true, models: [{ id: 'm1' }] }));
    const p = probe('own-key', check);
    await loadedWithKey(p, 'k1');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    store.useProviderStore.getState().setCredential(p, 'apiKey', '');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(models()).toEqual([]);
    store.useProviderStore.getState().setCredential(p, 'apiKey', 'k1');
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    // Asked once: the answer came from the kept one, so only its recording can have restored the list.
    expect(check).toHaveBeenCalledTimes(1);
    expect(readiness()).toEqual({ state: 'ready', models: [{ id: 'm1' }] });
    expect(models()).toEqual([{ id: 'm1' }]);
  });

  it('records one shared empty list for a ready answer that found no models', async () => {
    const answers: CheckResult[] = [{ ok: true }, { ok: true, models: [] }];
    const p = probe('local', async () => answers.shift()!);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(models()).toBe(store.NO_MODELS);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(models()).toBe(store.NO_MODELS);
    expect(readiness()).toEqual({ state: 'ready', models: [] });
  });
});

describe('refreshReadiness — a cancelled check', () => {
  it('is not a failure: a check that rejects once its signal aborts reports nothing and leaves readiness unknown', async () => {
    const p = probe('own-key', (_k, _s, ctx) => new Promise<CheckResult>((_resolve, reject) => {
      ctx.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    }));
    await loadedWithKey(p);
    const cancel = new AbortController();
    const done = store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(), cancel.signal);
    expect(readiness()).toEqual({ state: 'checking' });
    cancel.abort();
    await expect(done).resolves.toEqual({ state: 'unknown' });
    expect(readiness()).toEqual({ state: 'unknown' });
    expect(reportErrorSpy).not.toHaveBeenCalled();
  });

  it('keeps no answer that lands after its signal aborted, and asks again next time', async () => {
    const answer = deferred<CheckResult>();
    const check = vi.fn(() => answer.promise);
    const p = probe('own-key', check);
    await loadedWithKey(p);
    const cancel = new AbortController();
    const done = store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(), cancel.signal);
    cancel.abort();
    answer.resolve({ ok: true });
    await expect(done).resolves.toEqual({ state: 'unknown' });
    expect(readiness()).toEqual({ state: 'unknown' });
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs());
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("refreshReadiness — a run's own check", () => {
  it('returns its own answer when a panel check begins meanwhile, and leaves the store to the newer check', async () => {
    const answers = [deferred<CheckResult>(), deferred<CheckResult>()];
    let calls = 0;
    const p = probe('local', () => answers[calls++].promise);
    await loadedWithKey(p);
    const run = store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(), new AbortController().signal);
    const panel = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    answers[0].resolve({ ok: true, models: [{ id: 'm1' }] });
    await expect(run).resolves.toEqual({ state: 'ready', models: [{ id: 'm1' }] });
    expect(readiness()).toEqual({ state: 'checking' });
    answers[1].resolve({ ok: false, reason: 'no model' });
    await panel;
    expect(readiness()).toEqual({ state: 'not-ready', reason: 'no model' });
  });

  it('records its answer when no newer check began', async () => {
    const p = probe('local', async () => ({ ok: true, models: [{ id: 'm1' }] }));
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(), new AbortController().signal);
    expect(readiness()).toEqual({ state: 'ready', models: [{ id: 'm1' }] });
  });
});

describe('refreshReadiness — the legs a run would open', () => {
  it('hands check the legs: the store\'s for the live entry, the run\'s for its shape', async () => {
    const check = vi.fn(async (_k: unknown, _s: unknown, _ctx: CheckContext): Promise<CheckResult> => ({ ok: true }));
    const p = probe('local', check);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check.mock.calls[0][2].legs).toEqual(['speaker']);
    store.useProviderStore.getState().setLegs(['speaker', 'participant']);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth);
    expect(check.mock.calls[1][2].legs).toEqual(['speaker', 'participant']);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(['participant']));
    expect(check.mock.calls[2][2].legs).toEqual(['participant']);
  });

  it('forgets every loaded provider\'s readiness when the legs change, and nothing when they do not', async () => {
    const answer = deferred<CheckResult>();
    const p = probe('own-key', () => answer.promise);
    await loadedWithKey(p);
    const pending = store.useProviderStore.getState().refreshReadiness(p, noAuth);
    store.useProviderStore.getState().setLegs(['speaker']);
    expect(store.useProviderStore.getState().legs).toEqual(['speaker']);
    expect(readiness()).toEqual({ state: 'checking' });
    answer.resolve({ ok: true });
    await pending;
    expect(readiness()).toEqual({ state: 'ready', models: [] });
    store.useProviderStore.getState().setLegs(['speaker', 'participant']);
    expect(store.useProviderStore.getState().legs).toEqual(['speaker', 'participant']);
    expect(readiness()).toEqual({ state: 'unknown' });
  });

  it('keeps a network answer per legs: other legs ask again', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(['speaker']));
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(['speaker']));
    expect(check).toHaveBeenCalledTimes(1);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs(['speaker', 'participant']));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('keeps a network answer per pair: another pair asks again', async () => {
    const check = vi.fn(async (): Promise<CheckResult> => ({ ok: true }));
    const p = probe('own-key', check);
    await loadedWithKey(p);
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, runInputs());
    await store.useProviderStore.getState().refreshReadiness(p, noAuth, { ...runInputs(), pair: { source: 'ja', target: 'en' } });
    expect(check).toHaveBeenCalledTimes(2);
  });
});
